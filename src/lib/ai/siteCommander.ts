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
  calculateVaultHealth,
  clusterUncategorizedBookmarks,
} from './localClustering.js'
import { CAT_UNCATEGORIZED, CAT_ALL, ATTR_IS_GROUP } from '../../config/constants.js'
import { showConfirm } from '../toast.js'
import { candidateToBookmark } from './candidateSave.js'
import { inlineCardHTML } from '../../composables/useInlineCard.js'
import { searchWebsitesByIntent, findSimilarWebsites } from './cloudAiClient.js'
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
 * 查重并一键合并所有重复项
 */
export function mergeDuplicateBookmarks(
  context?: SiteCommanderContext,
): { mergedCount: number; message: string } {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()
  const dups = findDuplicateCandidates(ds.bookmarks)
  if (!dups || dups.length === 0) {
    return { mergedCount: 0, message: '未发现可合并的重复书签。' }
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
      description: `合并 ${mergedCount} 个重复书签`,
      revert: () => {
        for (const id of deletedIds) {
          ds.restoreBookmark(id)
        }
        app.save()
        return `已撤销查重合并，${deletedIds.length} 个书签副本已从回收站还原。`
      },
    })
  }

  return {
    mergedCount,
    message: `已合并 ${mergedCount} 个重复书签副本，数据已移入回收站。`,
  }
}

/**
 * 执行「收件箱清零」：将待整理书签批量移动至推荐的对应分类中
 */
export function applyInboxZeroClustering(
  context?: SiteCommanderContext,
): { movedCount: number; message: string } {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()

  const groupedIds = new Set<string>()
  for (const g of ds.siblingGroups || []) {
    if (!g.deletedAt && g.bookmarkIds?.length) {
      for (const id of g.bookmarkIds) groupedIds.add(id)
    }
  }

  const clusters = clusterUncategorizedBookmarks(ds.bookmarks, ds.categories, groupedIds)
  const assignableClusters = clusters.filter(
    (c) => c.suggestedCategoryId && c.suggestedCategoryId !== CAT_UNCATEGORIZED && c.id !== 'cluster_unassigned',
  )

  if (assignableClusters.length === 0) {
    return { movedCount: 0, message: '未找到可明确归类的未分类书签。' }
  }

  let movedCount = 0
  const revertMap: Array<{ id: string; prevCatId?: string }> = []

  for (const cluster of assignableClusters) {
    const targetCatId = cluster.suggestedCategoryId!
    for (const bm of cluster.bookmarks) {
      if (bm && bm.id && !bm.deletedAt) {
        revertMap.push({ id: bm.id, prevCatId: bm.categoryId })
        ds.updateBookmark(bm.id, { categoryId: targetCatId })
        movedCount++
      }
    }
  }

  if (movedCount > 0) {
    app.save()
    pushUndoAction({
      type: 'inbox_zero',
      description: `智能归拢 ${movedCount} 个未分类书签`,
      revert: () => {
        for (const item of revertMap) {
          ds.updateBookmark(item.id, { categoryId: item.prevCatId })
        }
        app.save()
        return `已撤销智能归类，${revertMap.length} 个书签已还原原分类。`
      },
    })
  }

  return {
    movedCount,
    message: `已将 ${movedCount} 个未分类书签智能归入对应分类，可在下方撤销。`,
  }
}

export interface CreateTopicWorkspaceResult {
  success: boolean
  group: SiblingGroup
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
  }
  if (!items || items.length === 0) {
    items = [
      {
        title: topicName,
        url: 'https://github.com',
        notes: `围绕「${topicName}」构建的主题工作台精选。`,
      },
    ]
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
      if (typeof ds.addBookmark === 'function') {
        ds.addBookmark(bm)
      } else {
        ds.bookmarks.push(bm)
        if (ds.bookmarkMap) ds.bookmarkMap[bm.id] = bm
      }
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

  let initialNotes = `<p><strong>${esc(cleanName)}</strong> 专属主题导航与精选工具：</p><p>`
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

  if (typeof ds.addGroup === 'function') {
    ds.addGroup(group)
  } else {
    ds.siblingGroups.push(group)
    if (ds.groupMap) ds.groupMap[group.id] = group
  }
  app.save?.()

  // 5. 视图平滑联动：切换至目标分类，并进入该组聚焦模式
  ui.curCat = finalCatId
  ui.focusedGroupId = group.id

  // 6. 注册撤销环路 (UndoableAction)
  pushUndoAction({
    type: 'topic_workspace',
    description: `创建主题工作台「${group.name}」`,
    revert: () => {
      if (typeof ds.deleteGroup === 'function') {
        ds.deleteGroup(group.id)
      }
      for (const bid of createdBmIds) {
        if (typeof ds.deleteBookmark === 'function') {
          ds.deleteBookmark(bid)
        }
      }
      if (ui.focusedGroupId === group.id) {
        ui.focusedGroupId = null
      }
      app.save?.()
      return `已撤销创建主题工作台「${group.name}」，新建笔记组与 ${createdBmIds.length} 个书签已清理。`
    },
  })

  return {
    success: true,
    group,
    createdBmIds,
    totalBookmarks: allBookmarkIds.length,
    message: `已为您成功装配「${group.name}」主题工作台（共收纳 ${allBookmarkIds.length} 个工具），并已切换至该工作台。可在下方随时撤销。`,
  }
}

export interface HealDeadlinkResult {
  success: boolean
  message: string
  deadBookmark?: Bookmark
  replacement?: AiCandidateBookmark
}

/**
 * 平替自愈死链：将失效书签的链接、标题、备注替换为现役平替，解除 dead-link 标记并支持撤销
 */
export function healDeadlink(
  deadBmId: string,
  replacement: AiCandidateBookmark,
  context?: SiteCommanderContext,
): HealDeadlinkResult {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()

  const bm =
    (ds.bookmarkMap && ds.bookmarkMap[deadBmId]) ||
    ds.bookmarks.find((b: Bookmark) => b.id === deadBmId)

  if (!bm || bm.deletedAt) {
    return { success: false, message: '未找到指定失效书签或已被删除。' }
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
    description: `平替自愈书签「${prev.title}」->「${replacement.title}」`,
    revert: () => {
      ds.updateBookmark(deadBmId, {
        title: prev.title,
        url: prev.url,
        icon: prev.icon,
        notes: prev.notes,
        attributes: prev.attributes,
      })
      app.save?.()
      return `已撤销平替自愈，书签「${prev.title}」已还原为原链接。`
    },
  })

  return {
    success: true,
    deadBookmark: bm,
    replacement,
    message: `已成功将失效书签「${prev.title}」自愈替换为现役平替「${replacement.title}」(${replacement.url})。可在下方随时撤销。`,
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
      steps: [{ text: '获取支持的站内指令集', done: true }],
      reply: [
        '与链 站内操控指令 (In-App Agent)',
        '',
        '- 资产体检：',
        '  /health 或“资产体检”',
        '',
        '- 收件箱清零：',
        '  /inbox 或“智能归类”、“整理未分类”',
        '',
        '- 主题工作台：',
        '  /pack <主题名> 或“帮我搭建一套 前端开发 工作台”',
        '',
        '- 主题模式：',
        '  /theme dark | light | auto',
        '  （亦可说：“切换深色模式”、“切浅色”）',
        '',
        '- 视图布局：',
        '  /view grid | list | compact',
        '  （亦可说：“切换列表视图”、“网格视图”）',
        '',
        '- 分类管理：',
        '  /cat <名称> 或 /cat list',
        '  （亦可说：“新建分类 影音”、“查看分类”）',
        '',
        '- 回收站：',
        '  /trash clear 或 /trash',
        '  （亦可说：“清空回收站”、“打开回收站”）',
        '',
        '- 查找重复：',
        '  /dedup 或“查找重复书签”',
        '',
        '- 死链检测与自愈：',
        '  /deadlink 或“检查死链”、“死链自愈”',
        '',
        '- 导出备份：',
        '  /export 或“导出数据”、“备份书签”',
        '',
        '- 数据统计：',
        '  /stats 或“书签统计”',
        '',
        '- 批量归类：',
        '  /move uncategorized <分类名>',
        '  （亦可说：“把未分类移动到 工作”）',
        '',
        '- 撤销操作：',
        '  /undo 或“撤销刚才的操作”',
        '',
        '- 清理数据：',
        '  /clean 或“清理孤立数据”',
        '',
        '- 设置面板：',
        '  /settings 或“打开设置”',
        '',
        '提示：输入网址或自然语言需求时，将自动为您检索全网发现与平替。',
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
        steps: [{ text: '切换至深色模式', done: true }],
        reply: '已切换至深色模式。',
      }
    } else if (mode === 'light') {
      ui.setThemeColor('light')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: '切换至浅色模式', done: true }],
        reply: '已切换至浅色模式。',
      }
    } else if (mode === 'auto') {
      if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: '开启跟随系统主题', done: true }],
        reply: '已开启跟随系统主题。',
      }
    } else {
      ui.toggleTheme()
      const current = ui.themeColor === 'dark' ? '深色' : '浅色'
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: '反转主题模式', done: true }],
        reply: `已切换主题（当前为 ${current}）。`,
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
      steps: [{ text: '切换至深色模式', done: true }],
      reply: '已切换至深色模式。',
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
      steps: [{ text: '切换至浅色模式', done: true }],
      reply: '已切换至浅色模式。',
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
      steps: [{ text: '开启跟随系统主题', done: true }],
      reply: '已开启跟随系统主题。',
    }
  }

  if (
    /^(?:请?帮?我?)?(?:切换主题|换个主题|反转主题)$/i.test(query) ||
    /^(?:toggle\s+theme|change\s+theme|switch\s+theme)$/i.test(query.trim())
  ) {
    ui.toggleTheme()
    const current = ui.themeColor === 'dark' ? '深色' : '浅色'
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: '反转主题模式', done: true }],
      reply: `已切换主题（当前为 ${current}）。`,
    }
  }

  // ── 3. 布局视图 (/view, 切换列表/网格/紧凑) ──
  const viewSlashMatch = query.match(/^\/view(?:\s+(grid|list|compact|mini-grid))?$/i)
  if (viewSlashMatch) {
    const rawMode = viewSlashMatch[1]?.toLowerCase() || 'grid'
    const targetMode = rawMode === 'compact' ? 'mini-grid' : (rawMode as 'grid' | 'list' | 'mini-grid')
    ui.layoutMode = targetMode
    ui.saveUIState?.()
    const nameMap = { grid: '宫格视图', list: '列表视图', 'mini-grid': '紧凑视图' }
    return {
      handled: true,
      action: 'view',
      steps: [{ text: `切换至${nameMap[targetMode]}`, done: true }],
      reply: `已切换至${nameMap[targetMode]}。`,
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
      steps: [{ text: '切换至列表视图', done: true }],
      reply: '已切换至列表视图。',
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
      steps: [{ text: '切换至宫格视图', done: true }],
      reply: '已切换至宫格视图。',
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
      steps: [{ text: '切换至紧凑视图', done: true }],
      reply: '已切换至紧凑视图。',
    }
  }

  // ── 4. 分类管理 (/cat, 新建分类) ──
  if (/^\/cat\s+list$/i.test(query) || /^(?:分类列表|查看分类|所有分类)$/i.test(query)) {
    const activeCats = ds.categories.filter((c: Category) => !c.deletedAt)
    const lines = ['当前全部分类：', '']
    for (const cat of activeCats) {
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === cat.id).length
      lines.push(`- ${cat.name} (${count} 个书签)`)
    }
    const uncatCount = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    lines.push(`- 未分类 (${uncatCount} 个书签)`)
    return {
      handled: true,
      action: 'category_list',
      steps: [{ text: '读取全库分类列表', done: true }],
      reply: lines.join('\n'),
    }
  }

  const catSlashMatch = query.match(/^\/cat(?:\s+add)?\s+(.+)$/i)
  const catNlMatch = query.match(/^(?:请?帮?我?)?(?:新建|创建|添加|增加)分类\s*[:：]?\s*(.+)$/i)
  const catName = catSlashMatch ? catSlashMatch[1]?.trim() : catNlMatch ? catNlMatch[1]?.trim() : null
  if (catName) {
    const trimmed = catName.trim()
    if (!trimmed) {
      return { handled: true, action: 'category_add', success: false, reply: '分类名称不能为空。' }
    }
    const exists = ds.categories.some(
      (c: Category) => !c.deletedAt && c.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (exists) {
      return {
        handled: true,
        action: 'category_add',
        success: false,
        steps: [{ text: `检查分类「${trimmed}」是否已存在`, done: true }],
        reply: `分类「${trimmed}」已存在，无需重复创建。`,
      }
    }
    const created = addNewCategory(trimmed, app)
    if (created) {
      pushUndoAction({
        type: 'category_add',
        description: `新建分类「${trimmed}」`,
        revert: () => {
          ds.deleteCategory(created.id)
          app.save()
          return `已撤销新建分类「${trimmed}」。`
        },
      })
      return {
        handled: true,
        action: 'category_add',
        success: true,
        steps: [
          { text: '校验分类名称', done: true },
          { text: `创建分类「${trimmed}」`, done: true },
        ],
        reply: `分类「${trimmed}」创建成功。`,
      }
    }
    return { handled: true, action: 'category_add', success: false, reply: '创建分类失败。' }
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
        steps: [{ text: '检查回收站状态', done: true }],
        reply: '回收站当前为空，无需清理。',
      }
    }

    // Agent 危险操作人机确认 (Human-in-the-Loop)
    const confirmed = await showConfirm(
      `危险操作确认：即将彻底清空回收站，永久删除 ${total} 项数据（书签: ${bms}，笔记组: ${grps}，分类: ${cats}）。\n此操作不可撤销，是否确认执行？`,
    )
    if (!confirmed) {
      return {
        handled: true,
        action: 'trash_clear',
        success: false,
        steps: [{ text: '用户取消清空回收站', done: true }],
        reply: '已取消清空回收站，所有数据均安全保留。',
      }
    }

    ds.emptyTrash()
    app.save()
    return {
      handled: true,
      action: 'trash_clear',
      steps: [
        { text: `核验待清理数据 (${total} 项)`, done: true },
        { text: '通过人机安全确认', done: true },
        { text: '彻底清空回收站', done: true },
      ],
      reply: `已彻底清空回收站，共永久清理 ${total} 项数据（书签: ${bms}，笔记组: ${grps}，分类: ${cats}）。`,
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
      steps: [{ text: '打开回收站面板', done: true }],
      actionCard:
        total > 0
          ? {
              type: 'trash',
              title: '清空回收站',
              desc: `当前积压 ${total} 项待清理数据（书签: ${bms}，组: ${grps}）`,
              buttonText: '彻底清空',
              actionName: 'trash_clear',
            }
          : undefined,
      reply: total > 0 ? `已为您打开回收站面板（当前共有 ${total} 项待清理）。` : '已为您打开回收站面板（当前为空）。',
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
          { text: '扫描书签库全部链接', done: true },
          { text: '比对未发现重复项', done: true },
        ],
        reply: '书签库整洁，未发现重复链接。',
      }
    }
    const dupCount = dups.reduce((acc, d) => acc + d.duplicates.length, 0)
    const lines = [
      `查重检测：发现 ${dups.length} 组重复链接（共 ${dupCount} 个多余副本）：`,
      '',
    ]
    const previewItems = dups.slice(0, 5)
    for (let i = 0; i < previewItems.length; i++) {
      const d = previewItems[i]
      lines.push(`${i + 1}. ${d.primary.title || '无标题'}`)
      lines.push(`   主链接: ${d.normalizedUrl}`)
      lines.push(`   重复副本: ${d.duplicates.length} 个（${d.duplicates.map((dup) => dup.title || '无标题').join(', ')}）`)
    }
    if (dups.length > 5) {
      lines.push(`...其余 ${dups.length - 5} 组已省略。`)
    }

    return {
      handled: true,
      action: 'dedup',
      steps: [
        { text: '扫描书签库全部链接', done: true },
        { text: `比对发现 ${dups.length} 组重复`, done: true },
      ],
      actionCard: {
        type: 'dedup',
        title: '合并重复书签',
        desc: `检测到 ${dups.length} 组重复链接，共 ${dupCount} 个多余副本`,
        buttonText: '一键合并重复项',
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
        steps: [{ text: '提示主题工作台指令用法', done: true }],
        reply: [
          '主题工作台一键生成器 (Topic Workspace Builder)',
          '',
          '用法：/pack <主题名称>',
          '示例：',
          '- /pack 前端开发',
          '- /pack 设计灵感',
          '- 亦可直接对我说：“帮我搭建一套独立开发工作台”',
          '',
          'AI 将为您甄选全套核心工具，并出具一键装配行动卡片，自动建组并写入内嵌卡片导航笔记。',
        ].join('\n'),
      }
    }

    const topicName = rawTopic
    const candidates = await searchWebsitesByIntent(topicName, [], ds.categories, ds.customAttributes)
    const previewList = candidates.slice(0, 5)

    const lines = [
      `已为您规划「${topicName}」主题工作台，甄选到以下 ${candidates.length} 个核心工具：`,
      '',
    ]
    for (let i = 0; i < previewList.length; i++) {
      const c = previewList[i]
      lines.push(`${i + 1}. ${c.title} — ${c.notes || c.url}`)
    }
    if (candidates.length > 5) {
      lines.push(`...其余 ${candidates.length - 5} 个已省略。`)
    }
    lines.push('')
    lines.push(
      '点击下方行动卡片批准执行，即可一键自动入库、创建笔记组并挂载内嵌卡片进入工作台（随时支持 /undo 撤销）。',
    )

    const cleanTopic =
      topicName.endsWith('工作台') || topicName.endsWith('工具箱')
        ? topicName
        : `${topicName} 工作台`

    return {
      handled: true,
      action: 'pack_workspace',
      steps: [
        { text: `全网甄选「${topicName}」核心工具 (${candidates.length} 个)`, done: true },
        { text: '生成主题工作台装配方案与交互卡片', done: true },
      ],
      reply: lines.join('\n'),
      actionCard: {
        type: 'custom',
        actionName: 'create_topic_workspace',
        title: `一键装配「${cleanTopic}」`,
        desc: `包含 ${candidates.length} 个精选工具，自动建组并生成导航笔记`,
        buttonText: '一键装配工作台',
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
        steps: [{ text: '扫描书签库失效链接', done: true }],
        reply: '当前暂未检测到确认失效的死链。已为您打开死链巡检面板，您可在此启动全面在线探测。',
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
      `死链巡检报告：发现 ${deadBookmarks.length} 个失效死链：`,
      '',
    ]
    for (let i = 0; i < Math.min(3, deadBookmarks.length); i++) {
      const b = deadBookmarks[i]
      const wbUrl = `https://web.archive.org/web/*/${encodeURIComponent(b.url)}`
      lines.push(`${i + 1}. ${b.title || '无标题'} (${b.url})`)
      lines.push(`   历史快照: [查看 Wayback Machine 镜像](${wbUrl})`)
    }
    if (deadBookmarks.length > 3) {
      lines.push(`...其余 ${deadBookmarks.length - 3} 个已省略。`)
    }

    if (bestAlt) {
      lines.push('')
      lines.push(`针对首个死链「${firstDead.title}」，AI 已检索到最佳现役平替：`)
      lines.push(`- 推荐平替：${bestAlt.title} (${bestAlt.url})`)
      lines.push(`- 亮点说明：${bestAlt.notes || bestAlt.highlight || '功能高度一致的现役平替'}`)
      lines.push('')
      lines.push(
        '点击下方行动卡片，即可一键将该死链无缝替换为现役平替（组与历史关联完整保留，随时支持 /undo 撤销）。',
      )
    }

    let actionCard: ChatActionCard | undefined
    if (bestAlt) {
      actionCard = {
        type: 'custom',
        actionName: 'heal_deadlink',
        title: `一键平替自愈：${firstDead.title} -> ${bestAlt.title}`,
        desc: `用现役平替「${bestAlt.title}」一键替换失效链接，保留组与历史关联`,
        buttonText: '一键平替替换',
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
        { text: `检测到 ${deadBookmarks.length} 个失效书签`, done: true },
        { text: `为「${firstDead.title}」检索现役平替`, done: true },
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
        { text: '生成全量数据快照', done: true },
        { text: '触发浏览器下载', done: true },
      ],
      reply: '已生成全量 JSON 数据备份并触发下载，请留意浏览器下载提示。',
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
      '与链 书签库运行状态报表：',
      '',
      `- 活跃顶层书签：${topBookmarks} 个`,
      `- 子书签（附属）：${subBookmarks} 个`,
      `- 活跃笔记组：${groups} 组`,
      `- 分类体系：${cats} 个分类`,
      `- 待整理未分类：${uncat} 个`,
      `- 回收站待清理：${trashTotal} 项`,
      '',
      '整洁度评分：' + (uncat === 0 && trashTotal === 0 ? '优（无待处理项）' : '良好'),
    ].join('\n')

    return {
      handled: true,
      action: 'stats',
      steps: [{ text: '统计全库活跃书签与分类体系', done: true }],
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
        ? '极佳（极客级整洁）'
        : score >= 75
          ? '良好（轻度待归拢）'
          : score >= 60
            ? '中等（建议全面治理）'
            : '较乱（亟待整理清零）'

    const reply = [
      '与链 全库资产健康体检诊断报告',
      '',
      `综合健康指数：${score} 分 · ${level}`,
      '',
      '诊断明细指标：',
      `- 活跃书签总数：${totalCount} 个`,
      `- 待整理未分类：${healthStats.uncategorizedCount} 个 ${healthStats.uncategorizedCount > 0 ? '(建议归类)' : '(已清零)'}`,
      `- 重复冗余副本：${healthStats.duplicateCount} 个 ${healthStats.duplicateCount > 0 ? '(可一键合并)' : '(无重复)'}`,
      `- 标签体系覆盖：${tagCoverage}% ${tagCoverage < 60 ? '(建议打标)' : '(良好)'}`,
      `- 回收站暂存项：${trashTotal} 项 ${trashTotal > 10 ? '(建议清空)' : ''}`,
      '',
      healthStats.uncategorizedCount > 0
        ? '管家建议：点击下方行动卡片，开启「收件箱清零」将未分类项一键归入对应分类。'
        : healthStats.duplicateCount > 0
          ? '管家建议：点击下方行动卡片，一键安全合并所有重复书签副本。'
          : '管家评价：书签资产处于极佳状态，无需额外整理！',
    ].join('\n')

    let actionCard: ChatActionCard | undefined
    if (healthStats.uncategorizedCount > 0) {
      actionCard = {
        type: 'custom',
        actionName: 'inbox_zero',
        title: `一键智能归类 ${healthStats.uncategorizedCount} 个未分类书签`,
        desc: '资产管家已基于历史偏好与特征分析出最佳归类方案',
        buttonText: '智能归类',
      }
    } else if (healthStats.duplicateCount > 0) {
      actionCard = {
        type: 'dedup',
        actionName: 'merge_dedup',
        title: `一键合并 ${healthStats.duplicateCount} 个重复副本`,
        desc: '安全移入回收站并保留最佳书签版本',
        buttonText: '合并重复项',
      }
    } else if (trashTotal > 0) {
      actionCard = {
        type: 'trash',
        actionName: 'trash_clear',
        title: `清空回收站 (${trashTotal} 项)`,
        desc: '释放存储空间并清空回收站已删除数据',
        buttonText: '清空回收站',
      }
    }

    return {
      handled: true,
      action: 'health',
      steps: [
        { text: '全库扫描未分类、重复与标签覆盖率', done: true },
        { text: '生成综合健康度评分与治理建议', done: true },
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

    const clusters = clusterUncategorizedBookmarks(ds.bookmarks, ds.categories, groupedIds)
    const assignableClusters = clusters.filter(
      (c) => c.suggestedCategoryId && c.suggestedCategoryId !== CAT_UNCATEGORIZED && c.id !== 'cluster_unassigned',
    )

    const totalToMove = assignableClusters.reduce((acc, c) => acc + c.bookmarks.length, 0)

    if (totalToMove === 0) {
      return {
        handled: true,
        action: 'inbox_zero',
        steps: [{ text: '扫描未分类书签', done: true }],
        reply: '太棒了！当前书签库已实现「收件箱清零（Inbox Zero）」，所有书签均已妥善归类。',
      }
    }

    const lines: string[] = [
      '智能归拢分析完成，已为您生成以下归类预案：',
      '',
    ]
    for (const c of assignableClusters) {
      const titles = c.bookmarks.slice(0, 3).map((b) => b.title || b.url).join('、')
      const more = c.bookmarks.length > 3 ? ` 等 ${c.bookmarks.length} 个` : ` (${c.bookmarks.length} 个)`
      lines.push(`- 归入「${c.suggestedCategoryName}」：${titles}${more}`)
    }
    lines.push('')
    lines.push('点击下方行动卡片批准执行，即可一键批量归拢（随时支持 /undo 撤销）。')

    return {
      handled: true,
      action: 'inbox_zero',
      steps: [
        { text: `检测到 ${totalToMove} 个待归类书签`, done: true },
        { text: '根据历史偏好与域名聚类分析完成', done: true },
      ],
      reply: lines.join('\n'),
      actionCard: {
        type: 'custom',
        actionName: 'apply_inbox_zero',
        title: `批准归类 ${totalToMove} 个未分类书签`,
        desc: '将上述书签批量移入对应的目标分类并落盘',
        buttonText: '执行智能归拢',
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
        reply: `未找到目标分类「${targetName}」。请先输入「/cat ${targetName}」创建该分类。`,
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
        description: `将 ${movedCount} 个选中的书签移入「${targetCat.name}」`,
        revert: () => {
          for (const item of previousMap) {
            ds.updateBookmark(item.id, { categoryId: item.prevCatId })
          }
          app.save()
          return `已撤销批量移动，${previousMap.length} 个书签已还原原分类。`
        },
      })

      return {
        handled: true,
        action: 'batch_move',
        success: true,
        steps: [
          { text: `感知到 ${movedCount} 个勾选书签`, done: true },
          { text: `批量移入「${targetCat.name}」分类`, done: true },
        ],
        reply: `已成功将选中的 ${movedCount} 个书签移入「${targetCat.name}」分类。`,
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
        reply: `未找到分类「${targetCategoryRaw}」。您可以先输入「/cat ${targetCategoryRaw}」创建该分类。`,
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
        reply: `当前没有待整理的未分类书签。`,
      }
    }

    // 若未分类数量较大（例如 > 5 个），进行二次确认保护
    if (uncatBms.length > 5) {
      const confirmed = await showConfirm(
        `即将把 ${uncatBms.length} 个未分类书签批量移动至「${targetCat.name}」分类，是否继续？`,
      )
      if (!confirmed) {
        return {
          handled: true,
          action: 'move_uncategorized',
          success: false,
          steps: [{ text: '用户取消批量归类', done: true }],
          reply: '已取消批量归类操作。',
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
      description: `将 ${uncatBms.length} 个未分类书签移入「${targetCat.name}」`,
      revert: () => {
        for (const item of previousMap) {
          ds.updateBookmark(item.id, { categoryId: item.prevCatId })
        }
        app.save()
        return `已撤销批量移动，${previousMap.length} 个书签已还原原分类。`
      },
    })

    return {
      handled: true,
      action: 'move_uncategorized',
      success: true,
      steps: [
        { text: `筛选未分类书签 (${uncatBms.length} 个)`, done: true },
        { text: `批量移入「${targetCat.name}」`, done: true },
      ],
      reply: `已成功将 ${uncatBms.length} 个未分类书签移入「${targetCat.name}」分类。`,
    }
  }

  // ── 12. 上下文感知：当前分类查询 ──
  if (/^(?:当前在看什么分类|当前分类|当前分类有多少书签|所在分类)$/i.test(query)) {
    if (ui.curCat && ui.curCat !== CAT_ALL) {
      const cat = ds.categories.find((c: Category) => c.id === ui.curCat)
      const catName = cat ? cat.name : (ui.curCat === CAT_UNCATEGORIZED ? '未分类' : ui.curCat)
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === ui.curCat).length
      return {
        handled: true,
        action: 'current_cat',
        steps: [{ text: '读取当前视图上下文', done: true }],
        reply: `当前正处于「${catName}」分类视图，该分类下共有 ${count} 个活跃书签。`,
      }
    }
    const totalCount = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    return {
      handled: true,
      action: 'current_cat',
      steps: [{ text: '读取全库视图上下文', done: true }],
      reply: `当前正处于「全部分类」主视图，共有 ${totalCount} 个顶层书签。`,
    }
  }

  // ── 13. 对话式撤销 (/undo, 撤销操作, 恢复原样) ──
  if (
    /^\/(?:undo|revert)$/i.test(query) ||
    /^(?:请?帮?我?)?(?:撤销|撤销操作|撤销刚才的操作|撤销上一步|恢复原样|回退|回退上一步|undo)$/i.test(
      query,
    )
  ) {
    const actionToRevert = popUndoAction()
    if (actionToRevert) {
      const msg = await actionToRevert.revert()
      const remaining = getUndoStackDepth()
      const suffix = remaining > 0 ? ` (还可撤销 ${remaining} 步操作)` : ''
      return {
        handled: true,
        action: 'undo',
        success: true,
        steps: [{ text: `回退事务「${actionToRevert.description}」`, done: true }],
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
          steps: [{ text: '调用全局撤销动作', done: true }],
          reply: `已成功撤销操作（${msg}）。`,
        }
      }
    } catch {
      // Pinia 未初始化
    }

    return {
      handled: true,
      action: 'undo',
      success: false,
      reply: '当前没有可撤销的站内操作。',
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
          { text: '巡检笔记组引用关系', done: true },
          { text: '修复孤立数据引用', done: true },
        ],
        reply: `数据自检修复完成：修复了 ${fixedGroupRefs} 个笔记组无效引用，修正了 ${fixedParentRefs} 个孤立子书签父级关联。`,
      }
    }

    return {
      handled: true,
      action: 'clean_orphans',
      steps: [{ text: '数据一致性自检通过', done: true }],
      reply: '数据自检完成：所有笔记组与书签关联完整无误，无需修复。',
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
      steps: [{ text: '打开系统设置面板', done: true }],
      reply: '已为您打开设置面板。',
    }
  }

  return { handled: false, reply: '' }
}
