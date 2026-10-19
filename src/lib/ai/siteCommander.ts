/**
 * siteCommander.ts — 与链站内指令调度器 (In-App AI Agent / CLI)
 * 职责：
 * 1. 解析侧边栏对话框中的斜杠快捷指令与自然语言意图；
 * 2. 直接操控站内 Store / UI / 主题 / 导出 / 整理操作；
 * 3. 增强透明度：提供工具调用执行轨迹 (steps) 与行动卡片 (actionCard)；
 * 4. 增强安全性与可逆性：危险操作强制二次确认 (HITL)，支持对话式撤销 (/undo)；
 * 5. 上下文感知：感知当前浏览分类与多选状态；
 * 6. 严守克制美学：杜绝浮夸 emoji，采用纯净、温润的文字与符号排版。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { useToastStore } from '../../stores/toast.js'
import { addNewCategory, gid, esc, favicon } from '../../utils.js'
import { exportData } from '../../composables/domain/useDataIO.js'
import {
  findDuplicateCandidates,
  isOfficialBookmark,
  isUncategorized,
  calculateVaultHealth,
  clusterUncategorizedBookmarks,
  detectParentChildRelations,
} from './localClustering.js'
import { CAT_UNCATEGORIZED, CAT_ALL, ATTR_IS_GROUP } from '../../config/constants.js'
import { showConfirm } from '../toast.js'
import { candidateToBookmark } from './candidateSave.js'
import { inlineCardHTML } from '../../composables/useInlineCard.js'
import { searchWebsitesByIntent, findSimilarWebsites } from './cloudAiClient.js'
import { t, tN } from '../../i18n/index.js'
import type { Bookmark, Category, SiblingGroup } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'
import type { ChatTurnStep, ChatActionCard } from './chatSessions.js'

export interface SiteCommandResult {
  handled: boolean
  reply: string
  action?: string
  success?: boolean
  details?: Record<string, unknown>
  steps?: ChatTurnStep[]
  actionCard?: ChatActionCard
}

export interface SiteCommanderContext {
  ds?: ReturnType<typeof useDataStore>
  ui?: ReturnType<typeof useUIStore>
  app?: ReturnType<typeof useAppStore>
  /** 中止信号：「停止生成」后不再执行命令副作用（确认弹窗/网络等待之后的写操作） */
  signal?: AbortSignal
}

export interface UndoableAction {
  type: string
  description: string
  timestamp?: number
  revert: () => Promise<string> | string
}

const MAX_UNDO_STACK_DEPTH = 15
const undoTransactionStack: UndoableAction[] = []

let lastUndoableAction: UndoableAction | null = null

export function pushUndoAction(action: UndoableAction): void {
  action.timestamp = action.timestamp || Date.now()
  undoTransactionStack.push(action)
  if (undoTransactionStack.length > MAX_UNDO_STACK_DEPTH) {
    undoTransactionStack.shift()
  }
  lastUndoableAction = action
}

export function popUndoAction(): UndoableAction | null {
  const action = undoTransactionStack.pop() || null
  lastUndoableAction = undoTransactionStack.length > 0 ? undoTransactionStack[undoTransactionStack.length - 1] : null
  return action
}

export function getUndoStackDepth(): number {
  return undoTransactionStack.length
}

export function clearUndoStack(): void {
  undoTransactionStack.length = 0
  lastUndoableAction = null
}

export function getLastUndoableAction(): UndoableAction | null {
  return lastUndoableAction || (undoTransactionStack.length > 0 ? undoTransactionStack[undoTransactionStack.length - 1] : null)
}

export function setLastUndoableAction(action: UndoableAction | null): void {
  if (action) {
    pushUndoAction(action)
  } else {
    lastUndoableAction = null
    undoTransactionStack.pop()
  }
}

/**
 * 查重并一键合并所有重复项（函数级 HITL：合并前强制二次确认，不依赖 UI 层）
 */
export async function mergeDuplicateBookmarks(
  context?: SiteCommanderContext,
): Promise<{ mergedCount: number; message: string }> {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()
  const dups = findDuplicateCandidates(ds.bookmarks)
  if (!dups || dups.length === 0) {
    return { mergedCount: 0, message: t('aiCmd.mergeNone') }
  }

  const totalDupCount = dups.reduce((n, c) => n + c.duplicates.filter((d) => !d.deletedAt).length, 0)
  const confirmed = await showConfirm(
    tN('aiCmd.mergeConfirm', totalDupCount, { groups: dups.length, count: totalDupCount }),
  )
  if (context?.signal?.aborted) return { mergedCount: 0, message: '' }
  if (!confirmed) {
    return { mergedCount: 0, message: t('aiCmd.mergeCancelled') }
  }

  let mergedCount = 0
  const deletedIds: string[] = []
  for (const cluster of dups) {
    for (const dup of cluster.duplicates) {
      if (dup.id && !dup.deletedAt) {
        ds.deleteBookmark(dup.id)
        deletedIds.push(dup.id)
        mergedCount++
      }
    }
  }

  if (mergedCount > 0) {
    app.save()
    pushUndoAction({
      type: 'merge_dedup',
      description: tN('aiCmd.undoMergeDesc', mergedCount),
      revert: () => {
        for (const id of deletedIds) {
          ds.restoreBookmark(id)
        }
        app.save()
        return tN('aiCmd.undoMergeRevert', deletedIds.length)
      },
    })
  }

  return {
    mergedCount,
    message: tN('aiCmd.mergeDone', mergedCount),
  }
}

/**
 * 执行「收件箱清零」：识别同站子页建立 parentId 嵌套，并将待整理书签批量移动至推荐分类
 * 危险操作：函数级强制用户确认（HITL），拒绝则不做任何修改
 */
export async function applyInboxZeroClustering(
  context?: SiteCommanderContext,
): Promise<{ movedCount: number; nestedCount: number; message: string }> {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()

  const groupedIds = new Set<string>()
  for (const g of ds.siblingGroups || []) {
    if (!g.deletedAt && g.bookmarkIds?.length) {
      for (const id of g.bookmarkIds) groupedIds.add(id)
    }
  }

  // 1. 同站子页从属关系：待整理顶层书签中识别「同一站点下的子页」，归入其主页面下
  const uncatIds = new Set(
    ds.bookmarks.filter((b) => isUncategorized(b, groupedIds)).map((b) => b.id),
  )
  const relations = detectParentChildRelations(ds.bookmarks).filter((r) => uncatIds.has(r.childId))
  const nestedChildIds = new Set(relations.map((r) => r.childId))

  // 2. 聚类归类：已识别为子页的书签不再参与分类聚类，分类跟随父卡片归属
  const clusters = clusterUncategorizedBookmarks(
    ds.bookmarks.filter((b) => !nestedChildIds.has(b.id)),
    ds.categories,
    groupedIds,
  )
  const assignableClusters = clusters.filter(
    (c) => c.suggestedCategoryId && c.suggestedCategoryId !== CAT_UNCATEGORIZED && c.id !== 'cluster_unassigned',
  )

  const totalMoveCount = assignableClusters.reduce(
    (n, c) => n + c.bookmarks.filter((b) => b && !b.deletedAt).length,
    0,
  )
  if (totalMoveCount === 0 && relations.length === 0) {
    return { movedCount: 0, nestedCount: 0, message: t('aiCmd.inboxNone') }
  }

  // 函数级 HITL：批量改写分类与父子从属均属危险操作，必须显式确认（不依赖调用方自律）
  const confirmLines: string[] = []
  if (totalMoveCount > 0) {
    confirmLines.push(tN('aiCmd.inboxConfirm', totalMoveCount, { count: totalMoveCount }))
  }
  if (relations.length > 0) {
    confirmLines.push(tN('aiCmd.inboxNestConfirm', relations.length, { count: relations.length }))
  }
  const confirmed = await showConfirm(confirmLines.join('\n'))
  if (context?.signal?.aborted) return { movedCount: 0, nestedCount: 0, message: '' }
  if (!confirmed) {
    return { movedCount: 0, nestedCount: 0, message: t('aiCmd.inboxCancelled') }
  }

  let movedCount = 0
  let nestedCount = 0
  const revertMap: Array<{ id: string; prevCatId?: string; prevParentId?: string | null }> = []

  for (const cluster of assignableClusters) {
    const targetCatId = cluster.suggestedCategoryId!
    for (const bm of cluster.bookmarks) {
      if (bm && bm.id && !bm.deletedAt) {
        revertMap.push({ id: bm.id, prevCatId: bm.categoryId, prevParentId: bm.parentId })
        ds.updateBookmark(bm.id, { categoryId: targetCatId })
        movedCount++
      }
    }
  }

  // 3. 建立同站子页嵌套：子页归入主页面下并同步父级分类（子书签归属父卡片）
  for (const rel of relations) {
    const parent = ds.bookmarkMap[rel.parentId]
    const child = ds.bookmarkMap[rel.childId]
    if (!parent || parent.deletedAt || !child || child.deletedAt) continue
    revertMap.push({ id: rel.childId, prevCatId: child.categoryId, prevParentId: child.parentId })
    const parentCatId =
      parent.categoryId && parent.categoryId !== CAT_UNCATEGORIZED ? parent.categoryId : child.categoryId
    ds.updateBookmark(rel.childId, { parentId: rel.parentId, categoryId: parentCatId })
    nestedCount++
  }

  if (movedCount > 0 || nestedCount > 0) {
    app.save()
    pushUndoAction({
      type: 'inbox_zero',
      description: tN('aiCmd.undoInboxDesc', movedCount + nestedCount),
      revert: () => {
        for (const item of revertMap) {
          ds.updateBookmark(item.id, { categoryId: item.prevCatId, parentId: item.prevParentId })
        }
        app.save()
        const parts = [tN('aiCmd.undoInboxRevert', revertMap.length)]
        if (nestedCount > 0) parts.push(tN('aiCmd.undoInboxNestRevert', nestedCount))
        return parts.join(' ')
      },
    })
  }

  const parts: string[] = []
  if (movedCount > 0) parts.push(tN('aiCmd.inboxDone', movedCount))
  if (nestedCount > 0) parts.push(tN('aiCmd.inboxNestDone', nestedCount))
  return { movedCount, nestedCount, message: parts.join(' ') }
}

export interface CreateTopicWorkspaceResult {
  success: boolean
  group: SiblingGroup | null
  createdBmIds: string[]
  totalBookmarks: number
  message: string
}

/**
 * 创建主题工作台：一键建组、自动存入候选书签、生成带内嵌卡片的笔记并聚焦
 */
export async function createTopicWorkspace(
  topicName: string,
  candidates?: AiCandidateBookmark[],
  targetCatId?: string,
  context?: SiteCommanderContext,
): Promise<CreateTopicWorkspaceResult> {
  const ds = context?.ds ?? useDataStore()
  const ui = context?.ui ?? useUIStore()
  const app = context?.app ?? useAppStore()

  // 1. 确定归属分类
  let finalCatId = targetCatId
  if (!finalCatId || !ds.categories.some((c: Category) => !c.deletedAt && c.id === finalCatId)) {
    if (ui.curCat && ui.curCat !== CAT_ALL) {
      finalCatId = ui.curCat
    } else {
      const matchCat = ds.categories.find(
        (c: Category) =>
          !c.deletedAt &&
          (topicName.toLowerCase().includes(c.name.toLowerCase()) ||
            c.name.toLowerCase().includes(topicName.toLowerCase())),
      )
      finalCatId = matchCat ? matchCat.id : CAT_UNCATEGORIZED
    }
  }

  // 2. 准备候选工具
  let items = candidates
  if (!items || items.length === 0) {
    items = await searchWebsitesByIntent(topicName, [], ds.categories, ds.customAttributes)
    if (context?.signal?.aborted) {
      return { success: false, group: null, createdBmIds: [], totalBookmarks: 0, message: '' }
    }
  }
  if (!items || items.length === 0) {
    // 诚实返回空结果：不伪造 github.com 占位书签冒充个性化推荐
    return {
      success: false,
      group: null,
      createdBmIds: [],
      totalBookmarks: 0,
      message: t('aiCmd.wsNoCandidates', { name: topicName }),
    }
  }

  // 3. 将候选书签存入（若同 URL 已存在则复用已有书签，避免重复添加副本）
  const allBookmarkIds: string[] = []
  const savedBookmarks: Bookmark[] = []
  const createdBmIds: string[] = []

  for (const c of items) {
    const existing = ds.bookmarks.find(
      (b: Bookmark) => !b.deletedAt && b.url.toLowerCase() === c.url.toLowerCase(),
    )
    if (existing) {
      allBookmarkIds.push(existing.id)
      savedBookmarks.push(existing)
    } else {
      const bm = candidateToBookmark(ds, { ...c, categoryId: finalCatId })
      ds.addBookmark(bm)
      createdBmIds.push(bm.id)
      allBookmarkIds.push(bm.id)
      savedBookmarks.push(bm)
    }
  }

  // 4. 构建 SiblingGroup
  const maxBmOrder = ds.bookmarks.reduce(
    (m: number, b: Bookmark) => (b.parentId ? m : b.order > m ? b.order : m),
    -1,
  )
  const maxGrpOrder = (ds.siblingGroups || []).reduce(
    (m: number, g: SiblingGroup) => (g.order > m ? g.order : m),
    -1,
  )
  const order = Math.max(maxBmOrder, maxGrpOrder) + 1

  const cleanName =
    topicName.endsWith('工作台') || topicName.endsWith('工具箱')
      ? topicName
      : `${topicName} 工作台`

  let initialNotes = `<p>${t('aiCmd.wsNotesIntro', { name: esc(cleanName) })}</p><p>`
  for (const b of savedBookmarks) {
    initialNotes += inlineCardHTML(b) + ' '
  }
  initialNotes += '</p>'

  const group: SiblingGroup = {
    id: 'sg_' + gid(),
    name: cleanName,
    categoryId: finalCatId,
    icon: '',
    order,
    isExpanded: false,
    attributes: { [ATTR_IS_GROUP]: true },
    bookmarkIds: allBookmarkIds,
    notes: initialNotes,
    updatedAt: Date.now(),
    useCount: 0,
  }

  ds.addGroup(group)
  app.save?.()

  // 5. 视图平滑联动：切换至目标分类，并进入该组聚焦模式
  ui.curCat = finalCatId
  ui.focusedGroupId = group.id

  // 6. 注册撤销环路 (UndoableAction)
  pushUndoAction({
    type: 'topic_workspace',
    description: t('aiCmd.undoWsDesc', { name: group.name }),
    revert: () => {
      ds.deleteGroup(group.id)
      for (const bid of createdBmIds) {
        ds.deleteBookmark(bid)
      }
      if (ui.focusedGroupId === group.id) {
        ui.focusedGroupId = null
      }
      app.save?.()
      return tN('aiCmd.undoWsRevert', createdBmIds.length, { name: group.name })
    },
  })

  return {
    success: true,
    group,
    createdBmIds,
    totalBookmarks: allBookmarkIds.length,
    message: tN('aiCmd.wsDone', allBookmarkIds.length, { name: group.name }),
  }
}

export interface HealDeadlinkResult {
  success: boolean
  message: string
  deadBookmark?: Bookmark
  replacement?: AiCandidateBookmark
}

/**
 * 平替自愈死链：将失效书签的链接、标题、备注替换为现役平替，解除 dead-link 标记并支持撤销。
 * 函数级 HITL：改写书签 URL/标题/备注前强制二次确认（不信 UI 层）。
 */
export async function healDeadlink(
  deadBmId: string,
  replacement: AiCandidateBookmark,
  context?: SiteCommanderContext,
): Promise<HealDeadlinkResult> {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()

  const bm =
    (ds.bookmarkMap && ds.bookmarkMap[deadBmId]) ||
    ds.bookmarks.find((b: Bookmark) => b.id === deadBmId)

  if (!bm || bm.deletedAt) {
    return { success: false, message: t('aiCmd.healNotFound') }
  }

  const confirmed = await showConfirm(
    t('aiCmd.healConfirm', { title: bm.title, alt: replacement.title || replacement.url }),
  )
  if (context?.signal?.aborted) return { success: false, message: '' }
  if (!confirmed) {
    return { success: false, message: t('aiCmd.healCancelled') }
  }

  const prev = {
    title: bm.title,
    url: bm.url,
    icon: bm.icon,
    notes: bm.notes,
    attributes: { ...(bm.attributes || {}) },
  }

  const newAttributes = { ...(bm.attributes || {}) }
  delete newAttributes['dead-link']
  newAttributes['dead-link-healed'] = true

  ds.updateBookmark(deadBmId, {
    title: replacement.title || bm.title,
    url: replacement.url,
    icon: replacement.icon || favicon(replacement.url),
    notes: replacement.notes || bm.notes,
    attributes: newAttributes,
  })
  app.save?.()

  pushUndoAction({
    type: 'heal_deadlink',
    description: t('aiCmd.undoHealDesc', { from: prev.title, to: replacement.title }),
    revert: () => {
      ds.updateBookmark(deadBmId, {
        title: prev.title,
        url: prev.url,
        icon: prev.icon,
        notes: prev.notes,
        attributes: prev.attributes,
      })
      app.save?.()
      return t('aiCmd.undoHealRevert', { title: prev.title })
    },
  })

  return {
    success: true,
    deadBookmark: bm,
    replacement,
    message: t('aiCmd.healDone', { title: prev.title, alt: replacement.title, url: replacement.url }),
  }
}

/**
 * 调度站内命令与意图
 */
export async function dispatchSiteCommand(
  rawInput: string,
  context?: SiteCommanderContext,
): Promise<SiteCommandResult> {
  const query = rawInput.trim()
  if (!query) {
    return { handled: false, reply: '' }
  }

  const ds = context?.ds ?? useDataStore()
  const ui = context?.ui ?? useUIStore()
  const app = context?.app ?? useAppStore()

  // ── 1. 帮助说明 (/help, /?, 帮助) ──
  if (
    /^\/(?:help|\?)$/i.test(query) ||
    /^(?:help|\/\?|\/help|帮助|指南|使用指南|你能做什么|怎么用|有哪些命令|指令列表|命令列表|站内指令|支持哪些操作)$/i.test(
      query,
    )
  ) {
    return {
      handled: true,
      action: 'help',
      success: true,
      steps: [{ text: t('aiCmd.helpStep'), done: true }],
      reply: [
        t('aiCmd.helpTitle'),
        '',
        t('aiCmd.helpHealth'),
        t('aiCmd.helpHealthUsage'),
        '',
        t('aiCmd.helpInbox'),
        t('aiCmd.helpInboxUsage'),
        '',
        t('aiCmd.helpPack'),
        t('aiCmd.helpPackUsage'),
        '',
        t('aiCmd.helpTheme'),
        t('aiCmd.helpThemeUsage'),
        t('aiCmd.helpThemeHint'),
        '',
        t('aiCmd.helpView'),
        t('aiCmd.helpViewUsage'),
        t('aiCmd.helpViewHint'),
        '',
        t('aiCmd.helpCat'),
        t('aiCmd.helpCatUsage'),
        t('aiCmd.helpCatHint'),
        '',
        t('aiCmd.helpTrash'),
        t('aiCmd.helpTrashUsage'),
        t('aiCmd.helpTrashHint'),
        '',
        t('aiCmd.helpDedup'),
        t('aiCmd.helpDedupUsage'),
        '',
        t('aiCmd.helpDeadlink'),
        t('aiCmd.helpDeadlinkUsage'),
        '',
        t('aiCmd.helpExport'),
        t('aiCmd.helpExportUsage'),
        '',
        t('aiCmd.helpStats'),
        t('aiCmd.helpStatsUsage'),
        '',
        t('aiCmd.helpMove'),
        t('aiCmd.helpMoveUsage'),
        t('aiCmd.helpMoveHint'),
        '',
        t('aiCmd.helpUndo'),
        t('aiCmd.helpUndoUsage'),
        '',
        t('aiCmd.helpClean'),
        t('aiCmd.helpCleanUsage'),
        '',
        t('aiCmd.helpSettings'),
        t('aiCmd.helpSettingsUsage'),
        '',
        t('aiCmd.helpTip'),
      ].join('\n'),
    }
  }

  // ── 2. 主题外观 (/theme, 切换深色/浅色) ──
  const themeSlashMatch = query.match(/^\/theme(?:\s+(dark|light|auto))?$/i)
  if (themeSlashMatch) {
    const mode = themeSlashMatch[1]?.toLowerCase()
    if (mode === 'dark') {
      ui.setThemeColor('dark')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: t('aiCmd.stepToDark'), done: true }],
        reply: t('aiCmd.themeDarkDone'),
      }
    } else if (mode === 'light') {
      ui.setThemeColor('light')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: t('aiCmd.stepToLight'), done: true }],
        reply: t('aiCmd.themeLightDone'),
      }
    } else if (mode === 'auto') {
      if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: t('aiCmd.stepAutoTheme'), done: true }],
        reply: t('aiCmd.themeAutoDone'),
      }
    } else {
      ui.toggleTheme()
      const current = t(ui.themeColor === 'dark' ? 'aiCmd.themeNameDark' : 'aiCmd.themeNameLight')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: t('aiCmd.stepToggleTheme'), done: true }],
        reply: t('aiCmd.themeToggled', { mode: current }),
      }
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启|转成?|换成?|设为)?\s*(?:深色|暗黑|暗色|夜间|黑暗|黑夜)(?:模式|主题)?$/i.test(
      query,
    ) ||
    /^(?:switch\s+to\s+)?(?:dark\s+mode|dark\s+theme)$/i.test(query.trim())
  ) {
    ui.setThemeColor('dark')
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: t('aiCmd.stepToDark'), done: true }],
      reply: t('aiCmd.themeDarkDone'),
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启|转成?|换成?|设为)?\s*(?:浅色|白天|明亮|日间|白色)(?:模式|主题)?$/i.test(
      query,
    ) ||
    /^(?:switch\s+to\s+)?(?:light\s+mode|light\s+theme)$/i.test(query.trim())
  ) {
    ui.setThemeColor('light')
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: t('aiCmd.stepToLight'), done: true }],
      reply: t('aiCmd.themeLightDone'),
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|开启)?\s*(?:跟随系统|自动主题|系统主题|自动模式)(?:模式|主题)?$/i.test(
      query,
    ) ||
    /^(?:switch\s+to\s+)?(?:system\s+theme|auto\s+theme|auto\s+mode)$/i.test(query.trim())
  ) {
    if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: t('aiCmd.stepAutoTheme'), done: true }],
      reply: t('aiCmd.themeAutoDone'),
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换主题|换个主题|反转主题)$/i.test(query) ||
    /^(?:toggle\s+theme|change\s+theme|switch\s+theme)$/i.test(query.trim())
  ) {
    ui.toggleTheme()
    const current = t(ui.themeColor === 'dark' ? 'aiCmd.themeNameDark' : 'aiCmd.themeNameLight')
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: t('aiCmd.stepToggleTheme'), done: true }],
      reply: t('aiCmd.themeToggled', { mode: current }),
    }
  }

  // ── 3. 布局视图 (/view, 切换列表/网格/紧凑) ──
  const viewSlashMatch = query.match(/^\/view(?:\s+(grid|list|compact|mini-grid))?$/i)
  if (viewSlashMatch) {
    const rawMode = viewSlashMatch[1]?.toLowerCase() || 'grid'
    const targetMode = rawMode === 'compact' ? 'mini-grid' : (rawMode as 'grid' | 'list' | 'mini-grid')
    ui.layoutMode = targetMode
    ui.saveUIState?.()
    const nameMap: Record<'grid' | 'list' | 'mini-grid', string> = {
      grid: t('aiCmd.viewNameGrid'),
      list: t('aiCmd.viewNameList'),
      'mini-grid': t('aiCmd.viewNameCompact'),
    }
    return {
      handled: true,
      action: 'view',
      steps: [{ text: t('aiCmd.stepToView', { name: nameMap[targetMode] }), done: true }],
      reply: t('aiCmd.viewDone', { name: nameMap[targetMode] }),
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:列表视图|列表模式|清单视图)$/i.test(query) ||
    /^(?:switch\s+to\s+)?(?:list\s+view|list\s+mode)$/i.test(query.trim())
  ) {
    ui.layoutMode = 'list'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: t('aiCmd.stepToView', { name: t('aiCmd.viewNameList') }), done: true }],
      reply: t('aiCmd.viewDone', { name: t('aiCmd.viewNameList') }),
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:网格视图|宫格视图|网格模式|大宫格)$/i.test(query) ||
    /^(?:switch\s+to\s+)?(?:grid\s+view|grid\s+mode)$/i.test(query.trim())
  ) {
    ui.layoutMode = 'grid'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: t('aiCmd.stepToView', { name: t('aiCmd.viewNameGrid') }), done: true }],
      reply: t('aiCmd.viewDone', { name: t('aiCmd.viewNameGrid') }),
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换到?|换成?|设为)?\s*(?:紧凑视图|紧凑模式|小宫格|迷你宫格)$/i.test(query) ||
    /^(?:switch\s+to\s+)?(?:compact\s+view|compact\s+mode)$/i.test(query.trim())
  ) {
    ui.layoutMode = 'mini-grid'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: t('aiCmd.stepToView', { name: t('aiCmd.viewNameCompact') }), done: true }],
      reply: t('aiCmd.viewDone', { name: t('aiCmd.viewNameCompact') }),
    }
  }

  // ── 4. 分类管理 (/cat, 新建分类) ──
  if (/^\/cat\s+list$/i.test(query) || /^(?:分类列表|查看分类|所有分类)$/i.test(query)) {
    const activeCats = ds.categories.filter((c: Category) => !c.deletedAt)
    const lines = [t('aiCmd.catListHeader'), '']
    for (const cat of activeCats) {
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === cat.id).length
      lines.push(tN('aiCmd.catListLine', count, { name: cat.name }))
    }
    const uncatCount = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    lines.push(tN('aiCmd.catListLine', uncatCount, { name: t('aiCmd.catListUncategorized') }))
    return {
      handled: true,
      action: 'category_list',
      steps: [{ text: t('aiCmd.stepReadCats'), done: true }],
      reply: lines.join('\n'),
    }
  }

  const catSlashMatch = query.match(/^\/cat(?:\s+add)?\s+(.+)$/i)
  const catNlMatch = query.match(/^(?:请?帮?我?)?(?:新建|创建|添加|增加)分类\s*[:：]?\s*(.+)$/i)
  const catName = catSlashMatch ? catSlashMatch[1]?.trim() : catNlMatch ? catNlMatch[1]?.trim() : null
  if (catName) {
    const trimmed = catName.trim()
    if (!trimmed) {
      return { handled: true, action: 'category_add', success: false, reply: t('aiCmd.catNameEmpty') }
    }
    const exists = ds.categories.some(
      (c: Category) => !c.deletedAt && c.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (exists) {
      return {
        handled: true,
        action: 'category_add',
        success: false,
        steps: [{ text: t('aiCmd.stepCheckCatExists', { name: trimmed }), done: true }],
        reply: t('aiCmd.catExists', { name: trimmed }),
      }
    }
    const created = addNewCategory(trimmed, app)
    if (created) {
      pushUndoAction({
        type: 'category_add',
        description: t('aiCmd.undoCatDesc', { name: trimmed }),
        revert: () => {
          ds.deleteCategory(created.id)
          app.save()
          return t('aiCmd.undoCatRevert', { name: trimmed })
        },
      })
      return {
        handled: true,
        action: 'category_add',
        success: true,
        steps: [
          { text: t('aiCmd.stepValidateCat'), done: true },
          { text: t('aiCmd.stepCreateCat', { name: trimmed }), done: true },
        ],
        reply: t('aiCmd.catCreated', { name: trimmed }),
      }
    }
    return { handled: true, action: 'category_add', success: false, reply: t('aiCmd.catCreateFailed') }
  }

  // ── 5. 回收站管理 (/trash, 清空回收站, 打开回收站) ──
  if (
    /^\/trash\s+(?:clear|empty)$/i.test(query) ||
    /^(?:请?帮?我?)?(?:清空|清掉|清理|倒空|倒掉)(?:回收站|垃圾桶)$/i.test(query) ||
    /^(?:empty\s+trash|clear\s+trash)$/i.test(query.trim())
  ) {
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats
    if (total === 0) {
      return {
        handled: true,
        action: 'trash_clear',
        steps: [{ text: t('aiCmd.stepCheckTrash'), done: true }],
        reply: t('aiCmd.trashEmpty'),
      }
    }

    // Agent 危险操作人机确认 (Human-in-the-Loop)
    const confirmed = await showConfirm(
      tN('aiCmd.trashClearConfirm', total, { total, bm: bms, grp: grps, cat: cats }),
    )
    if (context?.signal?.aborted) {
      return { handled: true, action: 'trash_clear', success: false, reply: '' }
    }
    if (!confirmed) {
      return {
        handled: true,
        action: 'trash_clear',
        success: false,
        steps: [{ text: t('aiCmd.stepUserCancelTrash'), done: true }],
        reply: t('aiCmd.trashClearCancelled'),
      }
    }

    ds.emptyTrash()
    app.save()
    return {
      handled: true,
      action: 'trash_clear',
      steps: [
        { text: tN('aiCmd.stepVerifyTrash', total), done: true },
        { text: t('aiCmd.stepHitlPassed'), done: true },
        { text: t('aiCmd.stepDoEmptyTrash'), done: true },
      ],
      reply: tN('aiCmd.trashCleared', total, { total, bm: bms, grp: grps, cat: cats }),
    }
  }

  if (/^\/trash$/i.test(query) || /^(?:请?帮?我?)?(?:打开|查看|进入)?回收站$/i.test(query)) {
    ui.panels.trash = true
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats

    return {
      handled: true,
      action: 'trash_open',
      steps: [{ text: t('aiCmd.stepOpenTrash'), done: true }],
      actionCard:
        total > 0
          ? {
              type: 'trash',
              title: t('aiCmd.trashCardTitle'),
              desc: tN('aiCmd.trashCardDesc', total, { total, bm: bms, grp: grps }),
              buttonText: t('aiCmd.trashCardButton'),
              actionName: 'trash_clear',
            }
          : undefined,
      reply: total > 0 ? tN('aiCmd.trashOpened', total) : t('aiCmd.trashOpenedEmpty'),
    }
  }

  // ── 6. 查重巡检 (/dedup, 查找重复书签) ──
  if (
    /^\/dedup(?:\s+find)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:查重|查找重复书签|检查重复|有哪些重复书签|重复书签|重复链接)$/i.test(query) ||
    /^(?:find\s+duplicates|check\s+duplicates|dedup|find\s+dups)$/i.test(query.trim())
  ) {
    const dups = findDuplicateCandidates(ds.bookmarks)
    if (!dups || dups.length === 0) {
      return {
        handled: true,
        action: 'dedup',
        steps: [
          { text: t('aiCmd.stepScanUrls'), done: true },
          { text: t('aiCmd.stepNoDupFound'), done: true },
        ],
        reply: t('aiCmd.dedupClean'),
      }
    }
    const dupCount = dups.reduce((acc, d) => acc + d.duplicates.length, 0)
    const lines = [
      tN('aiCmd.dedupReport', dupCount, { groups: dups.length, count: dupCount }),
      '',
    ]
    const previewItems = dups.slice(0, 5)
    for (let i = 0; i < previewItems.length; i++) {
      const d = previewItems[i]
      lines.push(`${i + 1}. ${d.primary.title || t('aiCmd.untitled')}`)
      lines.push(t('aiCmd.dedupMainUrl', { url: d.normalizedUrl }))
      lines.push(
        tN('aiCmd.dedupCopies', d.duplicates.length, {
          titles: d.duplicates.map((dup) => dup.title || t('aiCmd.untitled')).join(', '),
        }),
      )
    }
    if (dups.length > 5) {
      lines.push(tN('aiCmd.dedupMore', dups.length - 5))
    }

    return {
      handled: true,
      action: 'dedup',
      steps: [
        { text: t('aiCmd.stepScanUrls'), done: true },
        { text: tN('aiCmd.stepDupFound', dups.length), done: true },
      ],
      actionCard: {
        type: 'dedup',
        title: t('aiCmd.dedupCardTitle'),
        desc: tN('aiCmd.dedupCardDesc', dupCount, { groups: dups.length, count: dupCount }),
        buttonText: t('aiCmd.dedupCardButton'),
        actionName: 'merge_dedup',
      },
      reply: lines.join('\n'),
    }
  }

  // ── 6.5 主题工作台生成 (/pack <主题名>, 帮我搭建XX工作台) ──
  const packSlashMatch = query.match(/^\/pack(?:\s+(.+))?$/i)
  const packNlMatch = query.match(
    /^(?:请?帮?我?)?(?:搭建|整理|创建|生成|建一个|建立)(?:一套|个)?(.+?)(?:工作台|工具链|工具箱|聚合组|合集)$/i,
  )
  if (packSlashMatch || packNlMatch) {
    const rawTopic = packSlashMatch
      ? packSlashMatch[1]?.trim()
      : packNlMatch
        ? packNlMatch[1]?.trim()
        : ''
    if (!rawTopic) {
      return {
        handled: true,
        action: 'pack_workspace',
        steps: [{ text: t('aiCmd.stepPackHint'), done: true }],
        reply: [
          t('aiCmd.packHelpTitle'),
          '',
          t('aiCmd.packHelpUsage'),
          t('aiCmd.packHelpExamplesLabel'),
          t('aiCmd.packHelpExample1'),
          t('aiCmd.packHelpExample2'),
          t('aiCmd.packHelpExample3'),
          '',
          t('aiCmd.packHelpDesc'),
        ].join('\n'),
      }
    }

    const topicName = rawTopic
    const candidates = await searchWebsitesByIntent(topicName, [], ds.categories, ds.customAttributes)
    const previewList = candidates.slice(0, 5)

    const lines = [
      tN('aiCmd.packPlan', candidates.length, { topic: topicName }),
      '',
    ]
    for (let i = 0; i < previewList.length; i++) {
      const c = previewList[i]
      lines.push(t('aiCmd.packItem', { i: i + 1, title: c.title, desc: c.notes || c.url }))
    }
    if (candidates.length > 5) {
      lines.push(tN('aiCmd.packMore', candidates.length - 5))
    }
    lines.push('')
    lines.push(t('aiCmd.packCta'))

    const cleanTopic =
      topicName.endsWith('工作台') || topicName.endsWith('工具箱')
        ? topicName
        : `${topicName} 工作台`

    return {
      handled: true,
      action: 'pack_workspace',
      steps: [
        { text: tN('aiCmd.stepPackSelect', candidates.length, { topic: topicName }), done: true },
        { text: t('aiCmd.stepPackPlan'), done: true },
      ],
      reply: lines.join('\n'),
      actionCard: {
        type: 'custom',
        actionName: 'create_topic_workspace',
        title: t('aiCmd.packCardTitle', { name: cleanTopic }),
        desc: tN('aiCmd.packCardDesc', candidates.length),
        buttonText: t('aiCmd.packCardButton'),
        payload: {
          topic: cleanTopic,
          candidates,
        },
      },
    }
  }

  // ── 7. 死链检测与自愈 (/deadlink, 检查死链, 死链自愈) ──
  if (
    /^\/deadlinks?(?:\s+(?:heal|check|fix))?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:检查死链|死链检测|死链巡检|检测失效链接|检测死链|修复死链|死链自愈)$/i.test(
      query,
    )
  ) {
    const deadBookmarks = ds.bookmarks.filter(
      (b: Bookmark) =>
        !b.deletedAt && b.attributes?.['dead-link'] && !b.attributes?.['dead-link-ignored'],
    )

    if (deadBookmarks.length === 0) {
      ui.overlays.deadLinks = true
      return {
        handled: true,
        action: 'deadlinks',
        steps: [{ text: t('aiCmd.stepScanDeadlinks'), done: true }],
        reply: t('aiCmd.deadNone'),
      }
    }

    const firstDead = deadBookmarks[0]
    const alts = await findSimilarWebsites(
      firstDead.url,
      firstDead.title,
      [],
      ds.categories,
      ds.customAttributes,
    )
    const bestAlt = alts[0]

    const lines = [
      tN('aiCmd.deadReport', deadBookmarks.length),
      '',
    ]
    for (let i = 0; i < Math.min(3, deadBookmarks.length); i++) {
      const b = deadBookmarks[i]
      const wbUrl = `https://web.archive.org/web/*/${encodeURIComponent(b.url)}`
      lines.push(t('aiCmd.deadItem', { i: i + 1, title: b.title || t('aiCmd.untitled'), url: b.url }))
      lines.push(t('aiCmd.deadSnapshot', { url: wbUrl }))
    }
    if (deadBookmarks.length > 3) {
      lines.push(tN('aiCmd.deadMore', deadBookmarks.length - 3))
    }

    if (bestAlt) {
      lines.push('')
      lines.push(t('aiCmd.deadAltIntro', { title: firstDead.title }))
      lines.push(t('aiCmd.deadAltRec', { title: bestAlt.title, url: bestAlt.url }))
      lines.push(
        t('aiCmd.deadAltHighlight', {
          desc: bestAlt.notes || bestAlt.highlight || t('aiCmd.deadAltDefaultHighlight'),
        }),
      )
      lines.push('')
      lines.push(t('aiCmd.deadCta'))
    }

    let actionCard: ChatActionCard | undefined
    if (bestAlt) {
      actionCard = {
        type: 'custom',
        actionName: 'heal_deadlink',
        title: t('aiCmd.healCardTitle', { from: firstDead.title, to: bestAlt.title }),
        desc: t('aiCmd.healCardDesc', { alt: bestAlt.title }),
        buttonText: t('aiCmd.healCardButton'),
        payload: {
          deadBmId: firstDead.id,
          replacement: bestAlt,
        },
      }
    }

    return {
      handled: true,
      action: 'deadlinks',
      steps: [
        { text: tN('aiCmd.stepDeadFound', deadBookmarks.length), done: true },
        { text: t('aiCmd.stepDeadSearchAlt', { title: firstDead.title }), done: true },
      ],
      reply: lines.join('\n'),
      actionCard,
    }
  }

  // ── 8. 数据导出备份 (/export, 导出数据) ──
  if (
    /^\/export(?:\s+data)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:导出数据|备份书签|导出备份|全量备份|下载备份)$/i.test(query)
  ) {
    exportData()
    return {
      handled: true,
      action: 'export',
      steps: [
        { text: t('aiCmd.stepExportSnapshot'), done: true },
        { text: t('aiCmd.stepExportDownload'), done: true },
      ],
      reply: t('aiCmd.exportDone'),
    }
  }

  // ── 9. 全库统计 (/stats, 书签统计) ──
  if (
    /^\/stats$/i.test(query) ||
    /^(?:请?帮?我?)?(?:书签统计|数据统计|库状态|书签总数|有多少书签)$/i.test(query) ||
    /^(?:vault\s+stats|bookmark\s+stats|statistics)$/i.test(query.trim())
  ) {
    const topBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    const subBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && b.parentId).length
    const groups = ds.siblingGroups.filter((g) => !g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => !c.deletedAt).length
    const uncat = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    const trashTotal =
      ds.bookmarks.filter((b) => b.deletedAt).length +
      ds.siblingGroups.filter((g) => g.deletedAt).length +
      ds.categories.filter((c: Category) => c.deletedAt).length

    const reply = [
      t('aiCmd.statsTitle'),
      '',
      t('aiCmd.statsTop', { n: topBookmarks }),
      t('aiCmd.statsSub', { n: subBookmarks }),
      t('aiCmd.statsGroups', { n: groups }),
      t('aiCmd.statsCats', { n: cats }),
      t('aiCmd.statsUncat', { n: uncat }),
      t('aiCmd.statsTrash', { n: trashTotal }),
      '',
      t('aiCmd.statsTidiness') +
        (uncat === 0 && trashTotal === 0 ? t('aiCmd.statsTidinessGood') : t('aiCmd.statsTidinessFair')),
    ].join('\n')

    return {
      handled: true,
      action: 'stats',
      steps: [{ text: t('aiCmd.stepStats'), done: true }],
      reply,
    }
  }

  // ── 9.1 全库资产体检中心 (/health, 资产体检) ──
  if (
    /^\/health$/i.test(query) ||
    /^(?:请?帮?我?)?(?:资产体检|健康体检|全库体检|资产健康度|体检报告|健康诊断|书签体检|全面体检)$/i.test(
      query,
    ) ||
    /^(?:health\s+check|vault\s+audit|audit\s+vault|check\s+health)$/i.test(query.trim())
  ) {
    const groupedIds = new Set<string>()
    for (const g of ds.siblingGroups || []) {
      if (!g.deletedAt && g.bookmarkIds?.length) {
        for (const id of g.bookmarkIds) groupedIds.add(id)
      }
    }

    const healthStats = calculateVaultHealth(
      ds.bookmarks,
      ds.categories,
      groupedIds,
      ds.siblingGroups,
    )

    const activeBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && !isOfficialBookmark(b))
    const totalCount = activeBookmarks.length

    const tagCoveredCount = activeBookmarks.filter(
      (b) => b.attributes && Object.keys(b.attributes).length > 0,
    ).length
    const tagCoverage = totalCount > 0 ? Math.round((tagCoveredCount / totalCount) * 100) : 100

    const trashTotal =
      ds.bookmarks.filter((b) => b.deletedAt).length +
      ds.siblingGroups.filter((g) => g.deletedAt).length +
      ds.categories.filter((c: Category) => c.deletedAt).length

    // 计算综合健康指数 (0 ~ 100)
    let score = 100
    if (totalCount > 0) {
      score -= Math.min(30, healthStats.uncategorizedCount * 3)
      score -= Math.min(25, healthStats.duplicateCount * 5)
      if (tagCoverage < 50) score -= 15
      else if (tagCoverage < 75) score -= 5
      if (trashTotal > 15) score -= 10
      score = Math.max(10, Math.min(100, score))
    }

    const level =
      score >= 90
        ? t('aiCmd.levelExcellent')
        : score >= 75
          ? t('aiCmd.levelGood')
          : score >= 60
            ? t('aiCmd.levelFair')
            : t('aiCmd.levelPoor')

    const reply = [
      t('aiCmd.healthTitle'),
      '',
      t('aiCmd.healthScore', { score, level }),
      '',
      t('aiCmd.healthDetail'),
      t('aiCmd.healthTotal', { n: totalCount }),
      t('aiCmd.healthUncat', {
        n: healthStats.uncategorizedCount,
        hint: healthStats.uncategorizedCount > 0 ? t('aiCmd.healthUncatHint') : t('aiCmd.healthUncatOk'),
      }),
      t('aiCmd.healthDup', {
        n: healthStats.duplicateCount,
        hint: healthStats.duplicateCount > 0 ? t('aiCmd.healthDupHint') : t('aiCmd.healthDupOk'),
      }),
      t('aiCmd.healthTagCoverage', {
        pct: tagCoverage,
        hint: tagCoverage < 60 ? t('aiCmd.healthTagHint') : t('aiCmd.healthTagOk'),
      }),
      t('aiCmd.healthTrash', {
        n: trashTotal,
        hint: trashTotal > 10 ? t('aiCmd.healthTrashHint') : '',
      }),
      '',
      healthStats.uncategorizedCount > 0
        ? t('aiCmd.healthAdviceInbox')
        : healthStats.duplicateCount > 0
          ? t('aiCmd.healthAdviceDedup')
          : t('aiCmd.healthPraise'),
    ].join('\n')

    let actionCard: ChatActionCard | undefined
    if (healthStats.uncategorizedCount > 0) {
      actionCard = {
        type: 'custom',
        actionName: 'inbox_zero',
        title: tN('aiCmd.healthInboxCardTitle', healthStats.uncategorizedCount),
        desc: t('aiCmd.healthInboxCardDesc'),
        buttonText: t('aiCmd.healthInboxCardButton'),
      }
    } else if (healthStats.duplicateCount > 0) {
      actionCard = {
        type: 'dedup',
        actionName: 'merge_dedup',
        title: tN('aiCmd.healthDedupCardTitle', healthStats.duplicateCount),
        desc: t('aiCmd.healthDedupCardDesc'),
        buttonText: t('aiCmd.healthDedupCardButton'),
      }
    } else if (trashTotal > 0) {
      actionCard = {
        type: 'trash',
        actionName: 'trash_clear',
        title: tN('aiCmd.healthTrashCardTitle', trashTotal),
        desc: t('aiCmd.healthTrashCardDesc'),
        buttonText: t('aiCmd.healthTrashCardButton'),
      }
    }

    return {
      handled: true,
      action: 'health',
      steps: [
        { text: t('aiCmd.stepHealthScan'), done: true },
        { text: t('aiCmd.stepHealthScore'), done: true },
      ],
      reply,
      actionCard,
    }
  }

  // ── 9.2 收件箱清零与智能归拢 (/inbox, 智能归类) ──
  if (
    /^\/inbox(?:\s+(?:zero|clean|organize))?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:收件箱清零|智能归类|整理未分类|归拢未分类|未分类整理|清空未分类|归类书签)$/i.test(
      query,
    ) ||
    /^(?:inbox\s+zero|clean\s+inbox|organize\s+inbox)$/i.test(query.trim())
  ) {
    const groupedIds = new Set<string>()
    for (const g of ds.siblingGroups || []) {
      if (!g.deletedAt && g.bookmarkIds?.length) {
        for (const id of g.bookmarkIds) groupedIds.add(id)
      }
    }

    // 同站子页从属关系：识别「同一站点下的子页」，归入其主页面下
    const uncatIds = new Set(
      ds.bookmarks.filter((b) => isUncategorized(b, groupedIds)).map((b) => b.id),
    )
    const relations = detectParentChildRelations(ds.bookmarks).filter((r) => uncatIds.has(r.childId))
    const nestedChildIds = new Set(relations.map((r) => r.childId))

    const clusters = clusterUncategorizedBookmarks(
      ds.bookmarks.filter((b) => !nestedChildIds.has(b.id)),
      ds.categories,
      groupedIds,
    )
    const assignableClusters = clusters.filter(
      (c) => c.suggestedCategoryId && c.suggestedCategoryId !== CAT_UNCATEGORIZED && c.id !== 'cluster_unassigned',
    )

    const totalToMove = assignableClusters.reduce((acc, c) => acc + c.bookmarks.length, 0)

    if (totalToMove === 0 && relations.length === 0) {
      return {
        handled: true,
        action: 'inbox_zero',
        steps: [{ text: t('aiCmd.stepScanUncat'), done: true }],
        reply: t('aiCmd.inboxZeroDone'),
      }
    }

    const lines: string[] = [
      t('aiCmd.inboxPlanHeader'),
      '',
    ]
    for (const c of assignableClusters) {
      const titles = c.bookmarks.slice(0, 3).map((b) => b.title || b.url).join(t('msg.listSeparator'))
      const more =
        c.bookmarks.length > 3
          ? t('aiCmd.inboxPlanMore', { n: c.bookmarks.length })
          : tN('aiCmd.inboxPlanCount', c.bookmarks.length)
      lines.push(t('aiCmd.inboxPlanLine', { cat: c.suggestedCategoryName, titles, more }))
    }
    if (relations.length > 0) {
      lines.push(tN('aiCmd.inboxNestPlanLine', relations.length))
    }
    lines.push('')
    lines.push(t('aiCmd.inboxCta'))

    const inboxSteps = [
      { text: tN('aiCmd.stepInboxDetected', totalToMove + relations.length), done: true },
      { text: t('aiCmd.stepInboxClustered'), done: true },
    ]
    if (relations.length > 0) {
      inboxSteps.push({ text: t('aiCmd.stepInboxNested'), done: true })
    }

    return {
      handled: true,
      action: 'inbox_zero',
      steps: inboxSteps,
      reply: lines.join('\n'),
      actionCard: {
        type: 'custom',
        actionName: 'apply_inbox_zero',
        title: tN('aiCmd.inboxCardTitle', totalToMove + relations.length),
        desc: t('aiCmd.inboxCardDesc'),
        buttonText: t('aiCmd.inboxCardButton'),
      },
    }
  }

  // ── 10. 上下文感知：批量移动选中的书签 ──
  const batchMoveMatch = query.match(
    /^(?:把|将)?(?:选中的|这些)?(?:书签)?(?:全部)?(?:移动到?|移到|放到|归入|归到)\s*[:：]?\s*(.+)$/i,
  )
  if (batchMoveMatch && ui.batchMode && ui.batchSelected && ui.batchSelected.length > 0) {
    const targetName = batchMoveMatch[1].trim().replace(/^到\s*/, '')
    const targetCat = ds.categories.find(
      (c: Category) =>
        !c.deletedAt &&
        (c.name === targetName || c.name.toLowerCase() === targetName.toLowerCase()),
    )
    if (!targetCat) {
      return {
        handled: true,
        action: 'batch_move',
        success: false,
        reply: t('aiCmd.batchMoveCatNotFound', { name: targetName }),
      }
    }

    const selectedIds = [...ui.batchSelected]
    const previousMap: Array<{ id: string; prevCatId?: string }> = []
    let movedCount = 0

    for (const id of selectedIds) {
      const bm = ds.bookmarkMap[id]
      if (bm && !bm.deletedAt) {
        previousMap.push({ id, prevCatId: bm.categoryId })
        ds.updateBookmark(id, { categoryId: targetCat.id })
        movedCount++
      }
    }

    if (movedCount > 0) {
      app.save()
      ui.batchMode = false
      ui.batchSelected = []

      pushUndoAction({
        type: 'batch_move',
        description: tN('aiCmd.undoBatchMoveDesc', movedCount, { cat: targetCat.name }),
        revert: () => {
          for (const item of previousMap) {
            ds.updateBookmark(item.id, { categoryId: item.prevCatId })
          }
          app.save()
          return tN('aiCmd.undoMoveRevert', previousMap.length)
        },
      })

      return {
        handled: true,
        action: 'batch_move',
        success: true,
        steps: [
          { text: tN('aiCmd.stepBatchDetected', movedCount), done: true },
          { text: t('aiCmd.stepBatchMove', { cat: targetCat.name }), done: true },
        ],
        reply: tN('aiCmd.batchMoveDone', movedCount, { cat: targetCat.name }),
      }
    }
  }

  // ── 11. 批量整理未分类 (/move uncategorized <分类名>, 把未分类移动到 [分类名]) ──
  const moveSlashMatch = query.match(/^\/move\s+uncategorized\s+(.+)$/i)
  const moveNlMatch = query.match(
    /^(?:把|将)?(?:所有)?未分类(?:书签)?(?:全部)?(?:移动到?|移到|放到|归入|归到)\s*[:：]?\s*(.+)$/i,
  )
  const targetCategoryRaw = moveSlashMatch
    ? moveSlashMatch[1]?.trim().replace(/^到\s*/, '')
    : moveNlMatch
      ? moveNlMatch[1]?.trim().replace(/^到\s*/, '')
      : null

  if (targetCategoryRaw) {
    const targetCat = ds.categories.find(
      (c: Category) =>
        !c.deletedAt &&
        (c.name === targetCategoryRaw || c.name.toLowerCase() === targetCategoryRaw.toLowerCase()),
    )
    if (!targetCat) {
      return {
        handled: true,
        action: 'move_uncategorized',
        success: false,
        reply: t('aiCmd.moveCatNotFound', { name: targetCategoryRaw }),
      }
    }

    const uncatBms = ds.bookmarks.filter(
      (b) =>
        !b.deletedAt &&
        (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) &&
        !b.parentId &&
        !isOfficialBookmark(b),
    )

    if (uncatBms.length === 0) {
      return {
        handled: true,
        action: 'move_uncategorized',
        success: true,
        reply: t('aiCmd.moveNone'),
      }
    }

    // 若未分类数量较大（例如 > 5 个），进行二次确认保护
    if (uncatBms.length > 5) {
      const confirmed = await showConfirm(
        tN('aiCmd.moveConfirm', uncatBms.length, { cat: targetCat.name }),
      )
      if (context?.signal?.aborted) {
        return { handled: true, action: 'move_uncategorized', success: false, reply: '' }
      }
      if (!confirmed) {
        return {
          handled: true,
          action: 'move_uncategorized',
          success: false,
          steps: [{ text: t('aiCmd.stepUserCancelMove'), done: true }],
          reply: t('aiCmd.moveCancelled'),
        }
      }
    }

    const previousMap = uncatBms.map((b) => ({ id: b.id, prevCatId: b.categoryId }))
    for (const b of uncatBms) {
      ds.updateBookmark(b.id, { categoryId: targetCat.id })
    }
    app.save()

    pushUndoAction({
      type: 'move_uncategorized',
      description: tN('aiCmd.undoMoveUncatDesc', uncatBms.length, { cat: targetCat.name }),
      revert: () => {
        for (const item of previousMap) {
          ds.updateBookmark(item.id, { categoryId: item.prevCatId })
        }
        app.save()
        return tN('aiCmd.undoMoveRevert', previousMap.length)
      },
    })

    return {
      handled: true,
      action: 'move_uncategorized',
      success: true,
      steps: [
        { text: tN('aiCmd.stepFilterUncat', uncatBms.length), done: true },
        { text: t('aiCmd.stepMoveUncat', { cat: targetCat.name }), done: true },
      ],
      reply: tN('aiCmd.moveDone', uncatBms.length, { cat: targetCat.name }),
    }
  }

  // ── 12. 上下文感知：当前分类查询 ──
  if (/^(?:当前在看什么分类|当前分类|当前分类有多少书签|所在分类)$/i.test(query)) {
    if (ui.curCat && ui.curCat !== CAT_ALL) {
      const cat = ds.categories.find((c: Category) => c.id === ui.curCat)
      const catName = cat ? cat.name : (ui.curCat === CAT_UNCATEGORIZED ? t('aiCmd.catListUncategorized') : ui.curCat)
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === ui.curCat).length
      return {
        handled: true,
        action: 'current_cat',
        steps: [{ text: t('aiCmd.stepReadContext'), done: true }],
        reply: tN('aiCmd.currentCat', count, { name: catName }),
      }
    }
    const totalCount = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    return {
      handled: true,
      action: 'current_cat',
      steps: [{ text: t('aiCmd.stepReadGlobalContext'), done: true }],
      reply: tN('aiCmd.currentAll', totalCount),
    }
  }

  // ── 13. 对话式撤销 (/undo, 撤销操作, 恢复原样) ──
  if (
    /^\/(?:undo|revert)$/i.test(query) ||
    /^(?:请?帮?我?)?(?:撤销|撤销操作|撤销刚才的操作|撤销上一步|恢复原样|回退|回退上一步|undo)$/i.test(
      query,
    )
  ) {
    // 「停止生成」后不再执行撤销副作用（popUndoAction 会改状态，必须前置校验）
    if (context?.signal?.aborted) {
      return { handled: true, action: 'undo', success: false, reply: '' }
    }
    const actionToRevert = popUndoAction()
    if (actionToRevert) {
      const msg = await actionToRevert.revert()
      const remaining = getUndoStackDepth()
      const suffix = remaining > 0 ? tN('aiCmd.undoRemaining', remaining) : ''
      return {
        handled: true,
        action: 'undo',
        success: true,
        steps: [{ text: t('aiCmd.stepRevertAction', { desc: actionToRevert.description }), done: true }],
        reply: `${msg}${suffix}`,
      }
    }

    try {
      const toastStore = useToastStore()
      if (toastStore.undoToast) {
        const msg = toastStore.undoToast.msg
        toastStore.undoToast.undoFn()
        toastStore.dismissUndo()
        return {
          handled: true,
          action: 'undo',
          success: true,
          steps: [{ text: t('aiCmd.stepGlobalUndo'), done: true }],
          reply: t('aiCmd.undoGlobalDone', { msg }),
        }
      }
    } catch {
      // Pinia 未初始化
    }

    return {
      handled: true,
      action: 'undo',
      success: false,
      reply: t('aiCmd.undoNone'),
    }
  }

  // ── 14. 孤儿与无效引用自检清理 (/clean, 清理孤立数据) ──
  if (
    /^\/clean(?:\s+orphans)?$/i.test(query) ||
    /^(?:请?帮?我?)?(?:清理孤立数据|清理孤儿|数据自检|自检清理)$/i.test(query)
  ) {
    let fixedGroupRefs = 0
    let fixedParentRefs = 0

    // 检查组内的失效 bookmarkIds
    for (const grp of ds.siblingGroups) {
      if (!grp.bookmarkIds || grp.bookmarkIds.length === 0) continue
      const validIds = grp.bookmarkIds.filter(
        (id: string) => !!ds.bookmarkMap[id] && !ds.bookmarkMap[id].deletedAt,
      )
      if (validIds.length !== grp.bookmarkIds.length) {
        fixedGroupRefs += grp.bookmarkIds.length - validIds.length
        ds.updateGroup(grp.id, { bookmarkIds: validIds })
      }
    }

    // 检查书签中的失效 parentId
    for (const bm of ds.bookmarks) {
      if (bm.parentId && (!ds.bookmarkMap[bm.parentId] || ds.bookmarkMap[bm.parentId].deletedAt)) {
        fixedParentRefs++
        ds.updateBookmark(bm.id, { parentId: undefined })
      }
    }

    if (fixedGroupRefs > 0 || fixedParentRefs > 0) {
      app.save()
      return {
        handled: true,
        action: 'clean_orphans',
        steps: [
          { text: t('aiCmd.stepAuditGroupRefs'), done: true },
          { text: t('aiCmd.stepFixOrphans'), done: true },
        ],
        reply: t('aiCmd.cleanFixed', { grp: fixedGroupRefs, par: fixedParentRefs }),
      }
    }

    return {
      handled: true,
      action: 'clean_orphans',
      steps: [{ text: t('aiCmd.stepConsistencyOk'), done: true }],
      reply: t('aiCmd.cleanOk'),
    }
  }

  // ── 15. 打开设置面板 (/settings, 打开设置) ──
  if (
    /^\/settings$/i.test(query) ||
    /^(?:请?帮?我?)?(?:打开设置|查看设置|设置面板|进入设置)$/i.test(query)
  ) {
    ui.panels.settings = true
    return {
      handled: true,
      action: 'settings',
      steps: [{ text: t('aiCmd.stepOpenSettings'), done: true }],
      reply: t('aiCmd.settingsOpened'),
    }
  }

  return { handled: false, reply: '' }
}
