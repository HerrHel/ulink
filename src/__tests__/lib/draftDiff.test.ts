import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createInboxZeroDraftDiff,
  createDedupDraftDiff,
  applyDraftDiff,
  calculateDiffStats,
  type DraftDiffItem,
} from '../../lib/ai/draftDiff.js'
import { getUndoStackDepth, popUndoAction, clearUndoStack } from '../../lib/ai/siteUndoStack.js'

describe('draftDiff.ts — 虚拟演练草稿层', () => {
  beforeEach(() => {
    clearUndoStack()
  })

  describe('calculateDiffStats', () => {
    it('正确统计各类变更数量', () => {
      const items: DraftDiffItem[] = [
        { id: '1', itemType: 'bookmark', changeType: 'modify', title: 'A', selected: true },
        { id: '2', itemType: 'bookmark', changeType: 'modify', title: 'B', selected: true },
        { id: '3', itemType: 'bookmark', changeType: 'nest', title: 'C', selected: true },
        { id: '4', itemType: 'bookmark', changeType: 'remove', title: 'D', selected: true },
        { id: '5', itemType: 'bookmark', changeType: 'add', title: 'E', selected: true },
      ]

      const stats = calculateDiffStats(items)
      expect(stats.total).toBe(5)
      expect(stats.toModify).toBe(2)
      expect(stats.toNest).toBe(1)
      expect(stats.toRemove).toBe(1)
      expect(stats.toAdd).toBe(1)
    })
  })

  describe('createInboxZeroDraftDiff', () => {
    it('为聚类和嵌套关系生成结构化草稿', () => {
      const bm1: any = { id: 'bm1', title: 'React Docs', url: 'https://react.dev', categoryId: 'uncat' }
      const bm2: any = { id: 'bm2', title: 'React Router', url: 'https://react.dev/router', categoryId: 'uncat' }

      const bookmarkMap = { bm1, bm2 }
      const categoryMap: any = {
        cat_fe: { id: 'cat_fe', name: '前端开发' },
      }

      const diff = createInboxZeroDraftDiff({
        assignableClusters: [
          {
            suggestedCategoryId: 'cat_fe',
            suggestedCategoryName: '前端开发',
            bookmarks: [bm1],
          },
        ],
        relations: [
          { parentId: 'bm1', childId: 'bm2' },
        ],
        bookmarkMap,
        categoryMap,
      })

      expect(diff.actionName).toBe('apply_inbox_zero_diff')
      expect(diff.stats.total).toBe(2)
      expect(diff.stats.toModify).toBe(1)
      expect(diff.stats.toNest).toBe(1)
      expect(diff.items[0].changeType).toBe('modify')
      expect(diff.items[0].after?.categoryName).toBe('前端开发')
      expect(diff.items[1].changeType).toBe('nest')
      expect(diff.items[1].after?.parentId).toBe('bm1')
      expect(diff.items.every((i) => i.selected)).toBe(true)
    })
  })

  describe('createDedupDraftDiff', () => {
    it('为重复书签生成标记为 remove 的草稿', () => {
      const primary: any = { id: 'p1', title: 'GitHub', url: 'https://github.com' }
      const dup1: any = { id: 'd1', title: 'GitHub Copy', url: 'https://github.com/' }

      const diff = createDedupDraftDiff({
        duplicates: [
          {
            primary,
            duplicates: [dup1],
            normalizedUrl: 'github.com',
          },
        ],
      })

      expect(diff.actionName).toBe('apply_dedup_diff')
      expect(diff.stats.total).toBe(1)
      expect(diff.stats.toRemove).toBe(1)
      expect(diff.items[0].changeType).toBe('remove')
      expect(diff.items[0].id).toBe('diff-dup-d1')
    })
  })

  describe('applyDraftDiff', () => {
    it('仅应用选中的变更项，并支持原子可撤销', async () => {
      const mockBookmarks: Record<string, any> = {
        bm1: { id: 'bm1', categoryId: 'old_cat', parentId: null },
        bm2: { id: 'bm2', categoryId: 'old_cat', parentId: null },
        bm3: { id: 'bm3', categoryId: 'old_cat', deletedAt: null },
      }

      const ds: any = {
        bookmarkMap: mockBookmarks,
        updateBookmark: vi.fn((id, patch) => {
          Object.assign(mockBookmarks[id], patch)
        }),
        deleteBookmark: vi.fn((id) => {
          mockBookmarks[id].deletedAt = Date.now()
        }),
        restoreBookmark: vi.fn((id) => {
          mockBookmarks[id].deletedAt = null
        }),
      }

      const app: any = {
        save: vi.fn(),
      }

      const payload: any = {
        items: [
          {
            id: 'diff-move-bm1',
            changeType: 'modify',
            after: { categoryId: 'new_cat' },
            selected: true,
          },
          {
            id: 'diff-move-bm2',
            changeType: 'modify',
            after: { categoryId: 'should_not_change' },
            selected: false, // 未勾选
          },
          {
            id: 'diff-dup-bm3',
            changeType: 'remove',
            selected: true,
          },
        ],
      }

      const result = await applyDraftDiff(payload, { ds, app })

      expect(result.appliedCount).toBe(2)
      expect(ds.updateBookmark).toHaveBeenCalledWith('bm1', { categoryId: 'new_cat' })
      expect(ds.updateBookmark).not.toHaveBeenCalledWith('bm2', expect.anything())
      expect(ds.deleteBookmark).toHaveBeenCalledWith('bm3')
      expect(app.save).toHaveBeenCalled()
      expect(payload.applied).toBe(true)

      // 验证撤销栈
      expect(getUndoStackDepth()).toBe(1)
      const undoAction = popUndoAction()
      expect(undoAction).not.toBeNull()

      undoAction?.revert()
      expect(mockBookmarks.bm1.categoryId).toBe('old_cat')
      expect(mockBookmarks.bm3.deletedAt).toBeNull()
    })

    it('remove 项按 mergeIntoId 合并备注/属性/使用次数/分类并改写组引用', async () => {
      const mockBookmarks: Record<string, any> = {
        p1: { id: 'p1', notes: '<p>P</p>', attributes: { a: true }, categoryId: 'uncategorized', useCount: 2, deletedAt: null },
        d1: { id: 'd1', notes: '<p>D</p>', attributes: { b: true }, categoryId: 'cat2', useCount: 3, deletedAt: null },
      }
      const groups: any[] = [{ id: 'g1', bookmarkIds: ['d1', 'x'], deletedAt: null }]
      const ds: any = {
        bookmarkMap: mockBookmarks,
        siblingGroups: groups,
        updateBookmark: vi.fn((id, patch) => { Object.assign(mockBookmarks[id], patch) }),
        deleteBookmark: vi.fn((id) => { mockBookmarks[id].deletedAt = Date.now() }),
        restoreBookmark: vi.fn((id) => { mockBookmarks[id].deletedAt = null }),
        updateGroup: vi.fn((id, patch) => { Object.assign(groups[0], patch) }),
      }
      const app: any = { save: vi.fn() }
      const payload: any = {
        items: [{ id: 'diff-dup-d1', changeType: 'remove', mergeIntoId: 'p1', selected: true }],
      }

      const result = await applyDraftDiff(payload, { ds, app })
      expect(result.appliedCount).toBe(1)
      expect(mockBookmarks.p1.notes).toContain('<p>P</p>')
      expect(mockBookmarks.p1.notes).toContain('<p>D</p>')
      expect(mockBookmarks.p1.attributes).toEqual({ a: true, b: true })
      expect(mockBookmarks.p1.useCount).toBe(5)
      expect(mockBookmarks.p1.categoryId).toBe('cat2')
      expect(groups[0].bookmarkIds).toEqual(['p1', 'x'])
      expect(mockBookmarks.d1.deletedAt).toBeTruthy()
    })

    it('无选中项时优雅取消', async () => {
      const ds: any = { bookmarkMap: {} }
      const app: any = { save: vi.fn() }
      const payload: any = {
        items: [
          { id: '1', selected: false },
        ],
      }

      const result = await applyDraftDiff(payload, { ds, app })
      expect(result.appliedCount).toBe(0)
      expect(app.save).not.toHaveBeenCalled()
    })
  })
})
