/**
 * siteActions.ts — 站内指令命令执行层（自 siteCommander.ts 纯搬运拆出）
 * 职责：
 * 1. 查重合并（mergeDuplicateBookmarks）；
 * 2. 收件箱清零聚类（applyInboxZeroClustering）；
 * 3. 主题工作台装配（createTopicWorkspace）；
 * 4. 死链平替自愈（healDeadlink）。
 * 危险操作经 siteHitl 统一二次确认（HITL），可撤销动作登记进 siteUndoStack。
 * 行为与拆分前逐字一致，禁止改动任何逻辑与文案。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { esc, gid, favicon } from '../../utils.js'
import {
  findDuplicateCandidates,
  isUncategorized,
  clusterUncategorizedBookmarks,
  detectParentChildRelations,
  normalizeUrlForDedup,
} from './localClustering.js'
import { CAT_UNCATEGORIZED, CAT_ALL, ATTR_IS_GROUP } from '../../config/constants.js'
import { candidateToBookmark } from './candidateSave.js'
import { inlineCardHTML } from '../../composables/useInlineCard.js'
import { searchWebsitesByIntent } from './cloudAiClient.js'
import {
  askConfirm,
  buildMergeConfirmMessage,
  buildInboxZeroConfirmMessage,
  buildHealConfirmMessage,
} from './siteHitl.js'
import { pushUndoAction } from './siteUndoStack.js'
import { toastWithUndo } from '../toast.js'
import { attrSlug } from '../../composables/domain/attrSlug.js'
import { t, tN } from '../../i18n/index.js'
import type { Bookmark, Category, SiblingGroup } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'

export interface SiteCommanderContext {
  ds?: ReturnType<typeof useDataStore>
  ui?: ReturnType<typeof useUIStore>
  app?: ReturnType<typeof useAppStore>
  /** 中止信号：「停止生成」后不再执行命令副作用（确认弹窗/网络等待之后的写操作） */
  signal?: AbortSignal
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
  const confirmed = await askConfirm(buildMergeConfirmMessage(totalDupCount, dups.length))
  if (context?.signal?.aborted) return { mergedCount: 0, message: '' }
  if (!confirmed) {
    return { mergedCount: 0, message: t('aiCmd.mergeCancelled') }
  }

  let mergedCount = 0
  const deletedIds: string[] = []
  const revertPrimaryMap = new Map<string, { notes?: string; attributes?: Record<string, any>; useCount?: number }>()
  const revertGroupMap = new Map<string, string[]>()

  for (const cluster of dups) {
    const primary = ds.bookmarkMap[cluster.primary.id] || cluster.primary
    if (!primary || primary.deletedAt) continue

    let primaryUpdated = false
    const origPrimaryNotes = primary.notes
    const origPrimaryAttrs = { ...(primary.attributes || {}) }
    const origPrimaryUseCount = primary.useCount

    let newNotes = primary.notes || ''
    const newAttrs = { ...(primary.attributes || {}) }
    let addUseCount = 0

    for (const dup of cluster.duplicates) {
      if (dup.id && !dup.deletedAt) {
        // 1. 元数据智能汇聚：将副本中独特的备注与标签汇入主书签
        if (dup.notes && !newNotes.includes(dup.notes)) {
          newNotes = newNotes ? `${newNotes}\n${dup.notes}` : dup.notes
          primaryUpdated = true
        }
        if (dup.attributes) {
          for (const [k, v] of Object.entries(dup.attributes)) {
            if (newAttrs[k] === undefined) {
              newAttrs[k] = v
              primaryUpdated = true
            }
          }
        }
        if (dup.useCount && dup.useCount > 0) {
          addUseCount += dup.useCount
        }

        // 2. 避免制造笔记孤立引用：若副本存在于某个笔记组，自动将组内引用切换至主书签
        for (const grp of ds.siblingGroups || []) {
          if (!grp.deletedAt && grp.bookmarkIds?.includes(dup.id)) {
            if (!revertGroupMap.has(grp.id)) {
              revertGroupMap.set(grp.id, [...grp.bookmarkIds])
            }
            const updatedIds = grp.bookmarkIds.map((id) => (id === dup.id ? primary.id : id))
            const uniqueIds = Array.from(new Set(updatedIds))
            ds.updateGroup(grp.id, { bookmarkIds: uniqueIds })
          }
        }

        ds.deleteBookmark(dup.id)
        deletedIds.push(dup.id)
        mergedCount++
      }
    }

    if (primaryUpdated || addUseCount > 0) {
      revertPrimaryMap.set(primary.id, {
        notes: origPrimaryNotes,
        attributes: origPrimaryAttrs,
        useCount: origPrimaryUseCount,
      })
      ds.updateBookmark(primary.id, {
        notes: newNotes,
        attributes: newAttrs,
        useCount: (primary.useCount || 0) + addUseCount,
      })
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
        for (const [pid, orig] of revertPrimaryMap.entries()) {
          ds.updateBookmark(pid, orig)
        }
        for (const [gid, origIds] of revertGroupMap.entries()) {
          ds.updateGroup(gid, { bookmarkIds: origIds })
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
  const confirmed = await askConfirm(buildInboxZeroConfirmMessage(totalMoveCount, relations.length))
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

/** 主题工作台名称后缀识别 token（含英文变体，仅用于避免重复追加，不作输出文案） */
const WS_TOPIC_SUFFIX_TOKENS = ['工作台', '工具箱', 'Workspace', 'Toolbox']

/**
 * 规范化主题工作台名称：已带「工作台/工具箱」等后缀（含英文变体）则原样返回，
 * 否则按当前语言追加本地化后缀（zh：「前端开发 工作台」/ en：「Frontend Workspace」）。
 */
export function normalizeWorkspaceTopic(topicName: string): string {
  const name = topicName || ''
  const lower = name.toLowerCase()
  const hasSuffix = WS_TOPIC_SUFFIX_TOKENS.some((s) => lower.endsWith(s.toLowerCase()))
  return hasSuffix ? name : `${name} ${t('ai.wsTopicSuffix')}`
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

  const cleanName = normalizeWorkspaceTopic(topicName)

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

  const confirmed = await askConfirm(
    buildHealConfirmMessage(bm.title, replacement.title || replacement.url),
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

export interface BatchTagBookmarksResult {
  success: boolean
  taggedCount: number
  message: string
  details: Array<{ title: string; url: string; tags: string[] }>
}

/**
 * 批量为指定书签打标签/更新标签属性（落地闭环：带 Undo 事务与轻提示）
 */
export async function batchTagBookmarks(
  items: Array<{ bookmarkId?: string; url?: string; title?: string; tags: string[] }>,
  context?: SiteCommanderContext,
): Promise<BatchTagBookmarksResult> {
  const ds = context?.ds ?? useDataStore()
  const app = context?.app ?? useAppStore()

  if (!items || !items.length) {
    return { success: false, taggedCount: 0, message: '未提供待打标书签列表', details: [] }
  }

  const activeBookmarks = ds.bookmarks.filter((b) => !b.deletedAt)
  const origAttrsMap = new Map<string, Record<string, boolean>>()
  const details: Array<{ title: string; url: string; tags: string[] }> = []

  // 1. 现有属性名 → 属性 id 快速映射
  const attrNameMap = new Map<string, string>()
  for (const a of ds.customAttributes) {
    if (a && !a.deletedAt && a.name) {
      attrNameMap.set(a.name.toLowerCase().trim(), a.id)
    }
  }

  for (const item of items) {
    if (context?.signal?.aborted) break
    const validTags = (item.tags || []).map((t) => String(t).trim()).filter(Boolean)
    if (validTags.length === 0) continue

    // 精准定位目标书签
    let target = item.bookmarkId ? activeBookmarks.find((b) => b.id === item.bookmarkId) : undefined
    if (!target && item.url) {
      const cleanUrl = item.url.trim()
      target = activeBookmarks.find((b) => b.url === cleanUrl)
      if (!target) {
        const norm = normalizeUrlForDedup(cleanUrl)
        target = activeBookmarks.find((b) => normalizeUrlForDedup(b.url) === norm)
      }
    }
    if (!target && item.title) {
      const cleanTitle = item.title.trim().toLowerCase()
      target = activeBookmarks.find((b) => b.title?.trim().toLowerCase() === cleanTitle)
    }

    if (!target) continue

    // 记录原始属性用于撤销
    if (!origAttrsMap.has(target.id)) {
      origAttrsMap.set(target.id, { ...(target.attributes || {}) })
    }

    const nextAttrs: Record<string, boolean> = { ...(target.attributes || {}) }
    const appliedTags: string[] = []

    for (const tag of validTags) {
      const tagLower = tag.toLowerCase()
      let attrId = attrNameMap.get(tagLower)
      if (!attrId) {
        // 创建新属性
        attrId = attrSlug(tag) || gid()
        if (ds.attributeMap[attrId]) {
          attrId = `attr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        }
        ds.addAttribute({
          id: attrId,
          name: tag,
          type: 'boolean',
        })
        attrNameMap.set(tagLower, attrId)
      }
      nextAttrs[attrId] = true
      appliedTags.push(tag)
    }

    ds.updateBookmark(target.id, { attributes: nextAttrs })
    details.push({
      title: target.title || '无标题',
      url: target.url,
      tags: appliedTags,
    })
  }

  const taggedCount = details.length
  if (taggedCount === 0) {
    return { success: false, taggedCount: 0, message: '未能匹配到库内有效书签', details: [] }
  }

  app.save?.()

  // 登记撤销事务
  pushUndoAction({
    type: 'batch_tag_bookmarks',
    description: `批量为 ${taggedCount} 个书签打标签`,
    revert: () => {
      for (const [bmId, prevAttrs] of origAttrsMap.entries()) {
        ds.updateBookmark(bmId, { attributes: prevAttrs })
      }
      app.save?.()
      return `已撤销 ${taggedCount} 个书签的标签变更。`
    },
  })

  // 触发带撤销的轻提示
  toastWithUndo(`已为 ${taggedCount} 个书签应用标签`, () => {
    for (const [bmId, prevAttrs] of origAttrsMap.entries()) {
      ds.updateBookmark(bmId, { attributes: prevAttrs })
    }
    app.save?.()
  })

  return {
    success: true,
    taggedCount,
    message: `已成功为 ${taggedCount} 个书签写入标签。`,
    details,
  }
}
