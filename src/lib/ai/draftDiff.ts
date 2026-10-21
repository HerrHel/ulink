/**
 * draftDiff.ts — 虚拟演练草稿层 (Draft Diff Sandbox)
 * 职责：
 * 1. 在执行批量移动、归类、查重合并等知识治理操作前，生成结构化虚拟差异草稿 (Draft Diff)；
 * 2. 精确标记变更类型：新增(+)、修改(~)、嵌套(↳)、移除(-)；
 * 3. 支持用户单项勾选 (Cherry-pick) 与全选切换；
 * 4. 仅应用用户确认勾选的差异项，并自动向 siteUndoStack 注册可撤销事务。
 */

import type { Bookmark, Category } from '../../types.js'
import type { DuplicateCluster } from './localClustering.js'
import { pushUndoAction } from './siteUndoStack.js'
import { t, tN } from '../../i18n/index.js'
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
  bookmarkMap?: Record<string, Bookmark>
  categoryMap?: Record<string, Category>
}): DraftDiffPayload {
  const { assignableClusters, relations, bookmarkMap = {}, categoryMap = {} } = params
  const items: DraftDiffItem[] = []

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

  for (const item of selectedItems) {
    // 提取真实的实体 ID（去掉 `diff-move-` / `diff-nest-` / `diff-dup-` 前缀）
    const entityId = item.id.replace(/^diff-(move|nest|dup)-/, '')

    if (item.changeType === 'modify') {
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
        for (const item of revertMap) {
          if (item.action === 'restore_delete') {
            ds.restoreBookmark(item.id)
          } else {
            ds.updateBookmark(item.id, {
              categoryId: item.prevCatId,
              parentId: item.prevParentId,
            })
          }
        }
        app.save()
        return tN('ai.undoDraftDiffRevert', revertMap.length)
      },
    })
  }

  payload.applied = true

  return {
    appliedCount,
    message: tN('ai.draftDiffApplyDone', appliedCount),
  }
}
