import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { useAppStore } from '../stores/app.js'
import { mergeDuplicateBookmarks } from '../lib/ai/siteActions.js'
import { executeManageBookmarks } from '../lib/ai/universalAgent.js'
import { popUndoAction, clearUndoStack } from '../lib/ai/siteUndoStack.js'
import { searchWithHighlights, _buildGroupSearchItems, _fallbackGrpIds } from '../lib/search.js'
import { applyDraftDiff, type DraftDiffPayload } from '../lib/ai/draftDiff.js'
import { candidateToBookmark } from '../lib/ai/candidateSave.js'
import { useDeadLinkChecker } from '../composables/domain/useDeadLinkChecker.js'
import * as toastMod from '../lib/toast.js'
import { safeBtoa, safeDecodePassword } from '../crypto.js'
import { CAT_UNCATEGORIZED } from '../config/constants.js'
import type { Bookmark, Category, SiblingGroup } from '../types.js'

function makeBm(overrides: Partial<Bookmark> & { id: string; title: string; url: string }): Bookmark {
  return {
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: 'uncategorized',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('audit-fixes-batch-8: 8项隐患与稳定性修复验证', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearUndoStack()
    vi.restoreAllMocks()
  })

  describe('1. siteActions: mergeDuplicateBookmarks 子书签自动重挂载与撤销', () => {
    it('合并重复项时，挂在被删副本下的子书签自动改挂至主书签，撤销时恢复原父级', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      const app = useAppStore()

      // 质量分相同时按 updatedAt 新者为主书签：显式给定时间，避免两次 Date.now() 跨毫秒导致主副颠倒（CI 偶发红）
      const primary = makeBm({ id: 'primary-1', title: 'GitHub', url: 'https://github.com', updatedAt: 2_000 })
      const dup = makeBm({ id: 'dup-1', title: 'GitHub Clone', url: 'https://github.com', updatedAt: 1_000 })
      const child = makeBm({ id: 'child-1', title: 'GitHub Repo', url: 'https://github.com/repo', parentId: 'dup-1' })

      ds.bookmarks = [primary, dup, child]
      ds._syncMaps()

      // 允许 HITL 确认
      vi.spyOn(toastMod, 'showConfirm').mockResolvedValue(true)

      const res = await mergeDuplicateBookmarks({ ds, ui, app })
      expect(res.mergedCount).toBe(1)
      expect(ds.bookmarkMap['dup-1'].deletedAt).toBeDefined()
      // child 应该已被 reparent 到 primary-1
      expect(ds.bookmarkMap['child-1'].parentId).toBe('primary-1')

      // 执行撤销
      const undoAction = popUndoAction()
      expect(undoAction).toBeDefined()
      await undoAction!.revert()

      // dup-1 恢复，child-1 的 parentId 重新指回 dup-1
      expect(ds.bookmarkMap['dup-1'].deletedAt).toBeUndefined()
      expect(ds.bookmarkMap['child-1'].parentId).toBe('dup-1')
    })
  })

  describe('2. universalAgent: manage_bookmarks delete 级联删除子书签与祖先优先恢复', () => {
    it('AI 指令删除父书签时，级联删除其子孙书签，并在撤销时按祖先优先顺序还原', async () => {
      const ds = useDataStore()
      const ui = useUIStore()
      const app = useAppStore()

      const parent = makeBm({ id: 'p-1', title: 'Parent Portal', url: 'https://portal.com' })
      const child = makeBm({ id: 'c-1', title: 'Child Page', url: 'https://portal.com/child', parentId: 'p-1' })
      const grandchild = makeBm({ id: 'gc-1', title: 'Grandchild Page', url: 'https://portal.com/child/sub', parentId: 'c-1' })

      ds.bookmarks = [parent, child, grandchild]
      ds._syncMaps()

      const res = await executeManageBookmarks(
        { action: 'delete', target: 'p-1' },
        { ds, ui, app },
      )
      expect(res.success).toBe(true)

      // 父、子、孙全部应被移入回收站 (deletedAt)
      expect(ds.bookmarkMap['p-1'].deletedAt).toBeDefined()
      expect(ds.bookmarkMap['c-1'].deletedAt).toBeDefined()
      expect(ds.bookmarkMap['gc-1'].deletedAt).toBeDefined()

      // 执行撤销
      const undoAction = popUndoAction()
      expect(undoAction).toBeDefined()
      await undoAction!.revert()

      // 撤销后全部恢复存活，且层级关系保持完整
      expect(ds.bookmarkMap['p-1'].deletedAt).toBeUndefined()
      expect(ds.bookmarkMap['c-1'].deletedAt).toBeUndefined()
      expect(ds.bookmarkMap['gc-1'].deletedAt).toBeUndefined()
      expect(ds.bookmarkMap['c-1'].parentId).toBe('p-1')
      expect(ds.bookmarkMap['gc-1'].parentId).toBe('c-1')
    })
  })

  describe('3. search: forceRebuild 强制重建与组内软删书签过滤', () => {
    it('searchWithHighlights 在传入 forceRebuild 时即便 version 相同也强制重建索引', () => {
      const b1 = makeBm({ id: 'b1', title: 'Alpha', url: 'https://alpha.com' })
      const map: Record<string, Bookmark> = { b1 }
      const groups: SiblingGroup[] = []

      // 首次搜索建立缓存
      const res1 = searchWithHighlights([b1], groups, 'Alpha', map, [], 8, 10, false, false)
      expect(res1.length).toBe(1)
      expect(res1[0].id).toBe('b1')

      // 在相同 version=10 下更新书签对象，使用 forceRebuild=true 强制感知新数据
      const b2 = makeBm({ id: 'b1', title: 'Beta Modified', url: 'https://alpha.com' })
      const map2: Record<string, Bookmark> = { b1: b2 }
      const res2 = searchWithHighlights([b2], groups, 'Beta', map2, [], 8, 10, true, false)
      expect(res2.length).toBe(1)
      expect(res2[0].id).toBe('b1')
    })

    it('组内包含已软删除的书签时不将其标题纳入组索引与 fallback 搜索', () => {
      const activeBm = makeBm({ id: 'b-active', title: 'Alive Docs', url: 'https://docs.com' })
      const deletedBm = makeBm({ id: 'b-del', title: 'Secret Stash', url: 'https://secret.com', deletedAt: Date.now() })
      const map: Record<string, Bookmark> = { 'b-active': activeBm, 'b-del': deletedBm }

      const group: SiblingGroup = {
        id: 'grp-1',
        name: 'Work Project',
        categoryId: 'uncategorized',
        icon: '',
        order: 0,
        isExpanded: false,
        attributes: {},
        bookmarkIds: ['b-active', 'b-del'],
        notes: '',
        updatedAt: Date.now(),
        useCount: 0,
        isPublic: false,
      }

      const items = _buildGroupSearchItems([group], map, [])
      expect(items[0].childTitle).toContain('Alive Docs')
      expect(items[0].childTitle).not.toContain('Secret Stash')

      const fallbackMatches = _fallbackGrpIds([group], 'Secret', map, [])
      expect(fallbackMatches.has('grp-1')).toBe(false)
    })
  })

  describe('4. draftDiff: applyDraftDiff 合并时子级重挂载与有序还原', () => {
    it('应用查重草稿合并时，被移除副本的子书签转挂到保留项，撤销时安全恢复', async () => {
      const ds = useDataStore()
      const app = useAppStore()

      const canonical = makeBm({ id: 'canon-1', title: 'Docs Canon', url: 'https://docs.org' })
      const dup = makeBm({ id: 'dup-1', title: 'Docs Dup', url: 'https://docs.org' })
      const child = makeBm({ id: 'child-sub', title: 'Docs Subpage', url: 'https://docs.org/sub', parentId: 'dup-1' })

      ds.bookmarks = [canonical, dup, child]
      ds._syncMaps()

      const payload: DraftDiffPayload = {
        diffId: 'diff-test-1',
        actionName: 'apply_dedup_diff',
        title: '测试去重草稿',
        summary: '1项合并',
        items: [
          {
            id: 'diff-dup-dup-1',
            itemType: 'bookmark',
            changeType: 'remove',
            title: 'Docs Dup',
            mergeIntoId: 'canon-1',
            selected: true,
          },
        ],
        stats: { total: 1, toModify: 0, toNest: 0, toRemove: 1, toAdd: 0 },
        applied: false,
      }

      const result = await applyDraftDiff(payload, { ds, app })
      expect(result.appliedCount).toBe(1)
      expect(ds.bookmarkMap['dup-1'].deletedAt).toBeDefined()
      expect(ds.bookmarkMap['child-sub'].parentId).toBe('canon-1')

      // 执行撤销
      const undoAction = popUndoAction()
      expect(undoAction).toBeDefined()
      await undoAction!.revert()

      // 撤销后 dup-1 存活且 child-sub 恢复其 parentId 为 dup-1
      expect(ds.bookmarkMap['dup-1'].deletedAt).toBeUndefined()
      expect(ds.bookmarkMap['child-sub'].parentId).toBe('dup-1')
    })
  })

  describe('5. candidateSave: candidateToBookmark 虚假或已软删分类兜底', () => {
    it('候选网站所带 categoryId 若不存在或已软删，安全回退到 CAT_UNCATEGORIZED', () => {
      const ds = useDataStore()
      const validCat: Category = { id: 'cat-valid', name: '常用', icon: '', color: '', order: 0 }
      const deletedCat: Category = { id: 'cat-deleted', name: '已废弃', icon: '', color: '', order: 1, deletedAt: Date.now() }
      ds.categories = [validCat, deletedCat]
      ds._syncMaps()

      // 1. 传入不存在的分类
      const bm1 = candidateToBookmark(ds, {
        title: 'Site 1',
        url: 'https://site1.com',
        notes: '',
        categoryId: 'ghost-category-id',
      })
      expect(bm1.categoryId).toBe(CAT_UNCATEGORIZED)

      // 2. 传入已软删的分类
      const bm2 = candidateToBookmark(ds, {
        title: 'Site 2',
        url: 'https://site2.com',
        notes: '',
        categoryId: 'cat-deleted',
      })
      expect(bm2.categoryId).toBe(CAT_UNCATEGORIZED)

      // 3. 传入有效的存活分类
      const bm3 = candidateToBookmark(ds, {
        title: 'Site 3',
        url: 'https://site3.com',
        notes: '',
        categoryId: 'cat-valid',
      })
      expect(bm3.categoryId).toBe('cat-valid')
    })
  })

  describe('6. useDeadLinkChecker: autoCheck 模块级单例共享与缓存重置', () => {
    it('多处调用 useDeadLinkChecker 共享同一 autoCheckEnabled 与 autoCheckAllowed 状态', () => {
      const c1 = useDeadLinkChecker()
      const c2 = useDeadLinkChecker()

      c1.autoCheckAllowed.value = true
      c1.autoCheckEnabled.value = true

      expect(c2.autoCheckAllowed.value).toBe(true)
      expect(c2.autoCheckEnabled.value).toBe(true)

      c1._resetDeadLinkCache()
      expect(c2.autoCheckAllowed.value).toBe(false)
      expect(c2.autoCheckEnabled.value).toBe(false)
    })
  })

  describe('7. ChildBookmarkEditModal: safeBtoa 对含非 ASCII / 中文密码编码不崩溃', () => {
    it('safeBtoa 正确编码中文字符串并经 safeDecodePassword 完整解码，绝不抛 DOMException', () => {
      const testPw = '密码123!@#中文测试🚀'
      expect(() => {
        const encoded = safeBtoa(testPw)
        expect(encoded).toBeTruthy()
        const decoded = safeDecodePassword(encoded)
        expect(decoded).toBe(testPw)
      }).not.toThrow()
    })
  })

  describe('8. dataActionsCategories: 分类删除、恢复与永久删除更新搜索版本与脏标记', () => {
    it('deleteCategory、restoreCategory 与 permanentDeleteCategory 触发 _searchIndexDirty 并防抖更新版本', async () => {
      const ds = useDataStore()
      const cat: Category = { id: 'cat-dyn', name: '动态分类', icon: '', color: '', order: 0 }
      ds.categories = [cat]
      ds._syncMaps()

      ds._searchIndexDirty = false
      const prevVer = ds._searchVersion

      // 软删除分类
      ds.deleteCategory('cat-dyn')
      expect(ds._searchIndexDirty).toBe(true)

      await new Promise(r => setTimeout(r, 5))
      expect(ds._searchVersion).toBeGreaterThan(prevVer)

      // 恢复分类
      const verAfterDel = ds._searchVersion
      ds._searchIndexDirty = false
      ds.restoreCategory('cat-dyn')
      expect(ds._searchIndexDirty).toBe(true)

      await new Promise(r => setTimeout(r, 5))
      expect(ds._searchVersion).toBeGreaterThan(verAfterDel)

      // 永久删除分类
      const verAfterRestore = ds._searchVersion
      ds._searchIndexDirty = false
      ds.permanentDeleteCategory('cat-dyn')
      expect(ds._searchIndexDirty).toBe(true)

      await new Promise(r => setTimeout(r, 5))
      expect(ds._searchVersion).toBeGreaterThan(verAfterRestore)
    })
  })
})
