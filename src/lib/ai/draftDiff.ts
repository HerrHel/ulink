/**
 * draftDiff.ts — 虚拟演练草稿层 (Draft Diff Sandbox)
 * 职责：
 * 1. 在执行批量移动、归类、查重合并等知识治理操作前，生成结构化虚拟差异草稿 (Draft Diff)；
 * 2. 精确标记变更类型：新增(+)、修改(~)、嵌套(↳)、移除(-)；
 * 3. 支持用户单项勾选 (Cherry-pick) 与全选切换；
 * 4. 仅应用用户确认勾选的差异项，并自动向 siteUndoStack 注册可撤销事务。
 */

import type { Bookmark, Category, SiblingGroup } from '../../types.js'
import type { DuplicateCluster } from './localClustering.js'
import { pushUndoAction } from './siteUndoStack.js'
import { t, tN } from '../../i18n/index.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { useDataStore } from '../../stores/data.js'
import type { useAppStore } from '../../stores/app.js'

export type DiffChangeType = 'add' | 'modify' | 'remove' | 'nest'

export interface DraftDiffItem {
  id: string
  itemType: 'bookmark' | 'group' | 'category'
  changeType: DiffChangeType
  title: string
  url?: string
  detail?: string
  before?: {
    categoryId?: string
    categoryName?: string
    parentId?: string | null
    parentTitle?: string
  }
  after?: {
    categoryId?: string
    categoryName?: string
    parentId?: string | null
    parentTitle?: string
  }
  selected: boolean
  /** remove 项的合并目标（保留项）：应用时先把备注/属性/组引用并入该条，再软删本条 */
  mergeIntoId?: string
}

export interface DraftDiffStats {
  total: number
  toModify: number
  toNest: number
  toRemove: number
  toAdd: number
}

export interface DraftDiffPayload {
  diffId: string
  actionName: string
  title: string
  summary: string
  items: DraftDiffItem[]
  stats: DraftDiffStats
  applied?: boolean
}

/**
 * 计算草稿统计信息
 */
export function calculateDiffStats(items: DraftDiffItem[]): DraftDiffStats {
  let toModify = 0
  let toNest = 0
  let toRemove = 0
  let toAdd = 0

  for (const item of items) {
    if (item.changeType === 'modify') toModify++
    else if (item.changeType === 'nest') toNest++
    else if (item.changeType === 'remove') toRemove++
    else if (item.changeType === 'add') toAdd++
  }

  return {
    total: items.length,
    toModify,
    toNest,
    toRemove,
    toAdd,
  }
}

/**
 * 为收件箱清零 (Inbox Zero) 生成虚拟演练草稿
 */
export function createInboxZeroDraftDiff(params: {
  assignableClusters: Array<{
    suggestedCategoryId?: string
    suggestedCategoryName?: string
    bookmarks: Bookmark[]
  }>
  relations: Array<{ parentId: string; childId: string }>
  /** 未分类笔记组的归类建议（id 前缀 diff-gmove-，应用时改组的 categoryId） */
  groupMoves?: Array<{ group: SiblingGroup; categoryId: string; categoryName?: string }>
  bookmarkMap?: Record<string, Bookmark>
  categoryMap?: Record<string, Category>
}): DraftDiffPayload {
  const { assignableClusters, relations, groupMoves = [], bookmarkMap = {}, categoryMap = {} } = params
  const items: DraftDiffItem[] = []

  // 0. 笔记组分类调整项 (modify, itemType: group)
  for (const { group: g, categoryId, categoryName } of groupMoves) {
    if (!g || g.deletedAt || !categoryId) continue
    items.push({
      id: `diff-gmove-${g.id}`,
      itemType: 'group',
      changeType: 'modify',
      title: g.name || t('cat.uncategorized'),
      before: { categoryId: g.categoryId, categoryName: t('cat.uncategorized') },
      after: { categoryId, categoryName: categoryName || categoryMap[categoryId]?.name },
      selected: true,
    })
  }

  // 1. 分类调整项 (modify)
  for (const cluster of assignableClusters) {
    const targetCatId = cluster.suggestedCategoryId
    const targetCatName = cluster.suggestedCategoryName || (targetCatId ? categoryMap[targetCatId]?.name : undefined)

    for (const bm of cluster.bookmarks) {
      if (!bm || !bm.id || bm.deletedAt) continue
      const currentCatName = bm.categoryId ? categoryMap[bm.categoryId]?.name || t('cat.uncategorized') : t('cat.uncategorized')

      items.push({
        id: `diff-move-${bm.id}`,
        itemType: 'bookmark',
        changeType: 'modify',
        title: bm.title || bm.url,
        url: bm.url,
        before: {
          categoryId: bm.categoryId,
          categoryName: currentCatName,
        },
        after: {
          categoryId: targetCatId,
          categoryName: targetCatName,
        },
        selected: true,
      })
    }
  }

  // 2. 子链从属嵌套项 (nest)
  for (const rel of relations) {
    const parent = bookmarkMap[rel.parentId]
    const child = bookmarkMap[rel.childId]
    if (!parent || parent.deletedAt || !child || child.deletedAt) continue

    const currentParent = child.parentId ? bookmarkMap[child.parentId] : null
    const parentCat = parent.categoryId ? categoryMap[parent.categoryId] : null

    items.push({
      id: `diff-nest-${child.id}`,
      itemType: 'bookmark',
      changeType: 'nest',
      title: child.title || child.url,
      url: child.url,
      before: {
        parentId: child.parentId,
        parentTitle: currentParent?.title,
        categoryId: child.categoryId,
      },
      after: {
        parentId: parent.id,
        parentTitle: parent.title || parent.url,
        categoryId: parent.categoryId || child.categoryId,
        categoryName: parentCat?.name,
      },
      selected: true,
    })
  }

  const stats = calculateDiffStats(items)
  const diffId = `diff-inbox-${Date.now()}`

  return {
    diffId,
    actionName: 'apply_inbox_zero_diff',
    title: t('ai.draftDiffInboxTitle'),
    summary: t('ai.draftDiffInboxSummary', {
      total: stats.total,
      modify: stats.toModify,
      nest: stats.toNest,
    }),
    items,
    stats,
    applied: false,
  }
}

/**
 * 为查重合并生成虚拟演练草稿
 */
export function createDedupDraftDiff(params: {
  duplicates: DuplicateCluster[]
}): DraftDiffPayload {
  const { duplicates } = params
  const items: DraftDiffItem[] = []

  for (const group of duplicates) {
    const canonical = group.primary
    for (const dup of group.duplicates) {
      if (!dup || !dup.id || dup.deletedAt) continue
      items.push({
        id: `diff-dup-${dup.id}`,
        itemType: 'bookmark',
        changeType: 'remove',
        title: dup.title || dup.url,
        url: dup.url,
        detail: t('ai.draftDiffMergeTo', { canonical: canonical.title || canonical.url }),
        mergeIntoId: canonical.id,
        before: {
          categoryId: dup.categoryId,
        },
        selected: true,
      })
    }
  }

  const stats = calculateDiffStats(items)
  const diffId = `diff-dedup-${Date.now()}`

  return {
    diffId,
    actionName: 'apply_dedup_diff',
    title: t('ai.draftDiffDedupTitle'),
    summary: t('ai.draftDiffDedupSummary', { total: stats.total }),
    items,
    stats,
    applied: false,
  }
}

/**
 * 执行并应用虚拟演练草稿中用户选中的项目
 */
export async function applyDraftDiff(
  payload: DraftDiffPayload,
  context: {
    ds: ReturnType<typeof useDataStore>
    app: ReturnType<typeof useAppStore>
  },
): Promise<{ appliedCount: number; message: string }> {
  const { ds, app } = context
  const selectedItems = payload.items.filter((item) => item.selected)

  if (selectedItems.length === 0) {
    return { appliedCount: 0, message: t('ai.draftDiffNoneSelected') }
  }

  let appliedCount = 0
  const revertMap: Array<{
    id: string
    action: 'restore_delete' | 'restore_move' | 'restore_nest'
    prevCatId?: string
    prevParentId?: string | null
  }> = []
  // remove 项合并到保留项时，记录主书签原字段与组引用，供撤销恢复
  const revertPrimaryMap = new Map<string, {
    notes: string
    attributes: Record<string, boolean>
    useCount: number
    categoryId: string
  }>()
  const revertGroupMap = new Map<string, string[]>()
  const revertChildParentMap = new Map<string, string | null>()
  const revertGroupCatMap = new Map<string, string>()

  for (const item of selectedItems) {
    // 提取真实的实体 ID（去掉 `diff-move-` / `diff-gmove-` / `diff-nest-` / `diff-dup-` 前缀）
    const entityId = item.id.replace(/^diff-(move|gmove|nest|dup)-/, '')

    if (item.changeType === 'modify' && item.itemType === 'group') {
      const g = ds.groupMap?.[entityId] ?? (ds.siblingGroups || []).find((x) => x.id === entityId)
      if (g && !g.deletedAt && item.after?.categoryId) {
        if (!revertGroupCatMap.has(g.id)) revertGroupCatMap.set(g.id, g.categoryId)
        ds.updateGroup(g.id, { categoryId: item.after.categoryId })
        appliedCount++
      }
    } else if (item.changeType === 'modify') {
      const bm = ds.bookmarkMap[entityId]
      if (bm && !bm.deletedAt && item.after?.categoryId) {
        revertMap.push({
          id: bm.id,
          action: 'restore_move',
          prevCatId: bm.categoryId,
          prevParentId: bm.parentId,
        })
        ds.updateBookmark(bm.id, { categoryId: item.after.categoryId })
        appliedCount++
      }
    } else if (item.changeType === 'nest') {
      const child = ds.bookmarkMap[entityId]
      if (child && !child.deletedAt && item.after?.parentId) {
        revertMap.push({
          id: child.id,
          action: 'restore_nest',
          prevCatId: child.categoryId,
          prevParentId: child.parentId,
        })
        ds.updateBookmark(child.id, {
          parentId: item.after.parentId,
          categoryId: item.after.categoryId || child.categoryId,
        })
        appliedCount++
      }
    } else if (item.changeType === 'remove') {
      const bm = ds.bookmarkMap[entityId]
      if (bm && !bm.deletedAt) {
        // 查重合并：先把重复项真正并入保留项（备注/属性/使用次数/分类/组引用），再软删。
        // 旧实现只 deleteBookmark，导致 user 看到的「合并到 X」实际丢备注和标签、工作台留悬空 id。
        const canonical = item.mergeIntoId ? ds.bookmarkMap[item.mergeIntoId] : undefined
        if (canonical && canonical.id !== bm.id && !canonical.deletedAt) {
          if (!revertPrimaryMap.has(canonical.id)) {
            revertPrimaryMap.set(canonical.id, {
              notes: canonical.notes || '',
              attributes: { ...(canonical.attributes || {}) },
              useCount: canonical.useCount || 0,
              categoryId: canonical.categoryId,
            })
          }
          let newNotes = canonical.notes || ''
          if (bm.notes && !newNotes.includes(bm.notes)) {
            newNotes = newNotes ? `${newNotes}\n${bm.notes}` : bm.notes
          }
          const newAttrs = { ...(canonical.attributes || {}) }
          for (const [k, v] of Object.entries(bm.attributes || {})) {
            if (newAttrs[k] === undefined) newAttrs[k] = v
          }
          let categoryId = canonical.categoryId
          if ((!categoryId || categoryId === CAT_UNCATEGORIZED) &&
              bm.categoryId && bm.categoryId !== CAT_UNCATEGORIZED) {
            categoryId = bm.categoryId
          }
          // 组引用改写到保留项，避免工作台里留空卡位
          for (const grp of ds.siblingGroups || []) {
            if (!grp.deletedAt && grp.bookmarkIds?.includes(bm.id)) {
              if (!revertGroupMap.has(grp.id)) revertGroupMap.set(grp.id, [...grp.bookmarkIds])
              const ids = Array.from(new Set(grp.bookmarkIds.map((id) => (id === bm.id ? canonical.id : id))))
              ds.updateGroup(grp.id, { bookmarkIds: ids })
            }
          }
          // 子书签引用改写到保留项，避免父软删后沦为孤儿
          for (const b of ds.bookmarks || []) {
            if (!b.deletedAt && b.parentId === bm.id && b.id !== canonical.id) {
              if (!revertChildParentMap.has(b.id)) {
                revertChildParentMap.set(b.id, b.parentId)
              }
              ds.updateBookmark(b.id, { parentId: canonical.id })
            }
          }
          ds.updateBookmark(canonical.id, {
            notes: newNotes,
            attributes: newAttrs,
            useCount: (canonical.useCount || 0) + (bm.useCount || 0),
            ...(categoryId !== canonical.categoryId ? { categoryId } : {}),
          })
        }
        revertMap.push({
          id: bm.id,
          action: 'restore_delete',
        })
        ds.deleteBookmark(bm.id)
        appliedCount++
      }
    }
  }

  if (appliedCount > 0) {
    app.save()
    pushUndoAction({
      type: 'draft_diff_apply',
      description: tN('ai.undoDraftDiffDesc', appliedCount),
      revert: () => {
        // 1. 先恢复所有已删书签，确保后续恢复子级关系时父书签已处于存活态
        for (const item of revertMap) {
          if (item.action === 'restore_delete') {
            ds.restoreBookmark(item.id)
          }
        }
        // 2. 恢复移动/嵌套修改项
        for (const item of revertMap) {
          if (item.action !== 'restore_delete') {
            ds.updateBookmark(item.id, {
              categoryId: item.prevCatId,
              parentId: item.prevParentId,
            })
          }
        }
        // 3. 恢复子书签归属
        for (const [cid, prevPid] of revertChildParentMap.entries()) {
          ds.updateBookmark(cid, { parentId: prevPid })
        }
        // 4. 撤销合并：恢复保留项被并入的备注/属性/使用次数/分类，以及组内引用
        for (const [pid, prev] of revertPrimaryMap.entries()) {
          ds.updateBookmark(pid, prev)
        }
        for (const [gid, ids] of revertGroupMap.entries()) {
          ds.updateGroup(gid, { bookmarkIds: ids })
        }
        // 5. 恢复笔记组原分类
        for (const [gid, catId] of revertGroupCatMap.entries()) {
          ds.updateGroup(gid, { categoryId: catId })
        }
        app.save()
        return tN('ai.undoDraftDiffRevert', revertMap.length + revertGroupCatMap.size)
      },
    })
  }

  payload.applied = true

  return {
    appliedCount,
    message: tN('ai.draftDiffApplyDone', appliedCount),
  }
}
