import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  executeManageCategories,
  executeManageTags,
  executeManageBookmarks,
  executeManageWorkspaces,
  executeManageSettings,
} from '../../lib/ai/universalAgent.js'
import { popUndoAction, clearUndoStack } from '../../lib/ai/siteUndoStack.js'
import { createAiAgentToolRunner } from '../../composables/domain/useAiChatAgent.js'
import type { Bookmark, Category, SiblingGroup, CustomAttribute } from '../../types.js'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

describe('Universal Agent Operations & Undo Stack (universalAgent.ts)', () => {
  let mockDs: any
  let mockApp: any
  let mockUi: any

  beforeEach(() => {
    clearUndoStack()
    vi.clearAllMocks()

    const categories: Category[] = [
      { id: 'cat-dev', name: '开发技术', order: 1, color: '#3b82f6', icon: 'code' },
      { id: 'cat-media', name: '媒体娱乐', order: 2, color: '#ec4899', icon: 'video' },
    ]

    const customAttributes: CustomAttribute[] = [
      { id: 'attr-frontend', name: '前端', type: 'boolean' },
      { id: 'attr-backend', name: '后端', type: 'boolean' },
    ]

    const bookmarks: Bookmark[] = [
      {
        id: 'bm-1',
        title: 'Vue 官网',
        url: 'https://vuejs.org',
        username: '',
        password: '',
        notes: '渐进式 JavaScript 框架',
        icon: '',
        categoryId: 'cat-dev',
        parentId: null,
        order: 1,
        useCount: 20,
        attributes: { 'attr-frontend': true },
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-2',
        title: 'Vite 官网',
        url: 'https://vite.dev',
        username: '',
        password: '',
        notes: '下一代前端工具链',
        icon: '',
        categoryId: 'cat-dev',
        parentId: null,
        order: 2,
        useCount: 15,
        attributes: { 'attr-frontend': true },
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-3',
        title: 'Node.js',
        url: 'https://nodejs.org',
        username: '',
        password: '',
        notes: 'JS 运行时',
        icon: '',
        categoryId: 'cat-dev',
        parentId: null,
        order: 3,
        useCount: 10,
        attributes: { 'attr-backend': true },
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]

    const siblingGroups: SiblingGroup[] = [
      {
        id: 'grp-vue',
        name: 'Vue 生态工作台',
        notes: '# Vue 生态笔记',
        categoryId: 'cat-dev',
        icon: 'folder',
        order: 1,
        isExpanded: false,
        attributes: {},
        bookmarkIds: [],
        updatedAt: 1000,
        useCount: 0,
      },
    ]

    mockDs = {
      categories,
      categoryMap: Object.fromEntries(categories.map((c) => [c.id, c])),
      customAttributes,
      attributeMap: Object.fromEntries(customAttributes.map((a) => [a.id, a])),
      bookmarks,
      bookmarkMap: Object.fromEntries(bookmarks.map((b) => [b.id, b])),
      siblingGroups,
      groupMap: Object.fromEntries(siblingGroups.map((g) => [g.id, g])),

      addCategory: vi.fn((cat: Category) => {
        mockDs.categories.push(cat)
        mockDs.categoryMap[cat.id] = cat
      }),
      updateCategory: vi.fn((id: string, patch: Partial<Category>) => {
        const cat = mockDs.categoryMap[id]
        if (cat) Object.assign(cat, patch)
      }),
      deleteCategory: vi.fn((id: string) => {
        const cat = mockDs.categoryMap[id]
        if (cat) cat.deletedAt = Date.now()
      }),
      renameCategory: vi.fn((id: string, name: string) => {
        const cat = mockDs.categoryMap[id]
        if (cat) cat.name = name
      }),
      restoreCategory: vi.fn((id: string) => {
        const cat = mockDs.categoryMap[id]
        if (cat) delete cat.deletedAt
      }),

      addAttribute: vi.fn((attr: CustomAttribute) => {
        mockDs.customAttributes.push(attr)
        mockDs.attributeMap[attr.id] = attr
      }),
      updateAttribute: vi.fn((id: string, patch: Partial<CustomAttribute>) => {
        const attr = mockDs.attributeMap[id]
        if (attr) Object.assign(attr, patch)
      }),
      deleteAttribute: vi.fn((id: string) => {
        const attr = mockDs.attributeMap[id]
        if (attr) attr.deletedAt = Date.now()
      }),
      renameAttribute: vi.fn((id: string, name: string) => {
        const attr = mockDs.attributeMap[id]
        if (attr) attr.name = name
      }),
      restoreAttribute: vi.fn((id: string) => {
        const attr = mockDs.attributeMap[id]
        if (attr) delete attr.deletedAt
      }),

      addBookmark: vi.fn((bm: Bookmark) => {
        mockDs.bookmarks.push(bm)
        mockDs.bookmarkMap[bm.id] = bm
      }),
      updateBookmark: vi.fn((id: string, patch: Partial<Bookmark>) => {
        const bm = mockDs.bookmarkMap[id]
        if (bm) Object.assign(bm, patch)
      }),
      deleteBookmark: vi.fn((id: string) => {
        const bm = mockDs.bookmarkMap[id]
        if (bm) bm.deletedAt = Date.now()
      }),
      restoreBookmark: vi.fn((id: string) => {
        const bm = mockDs.bookmarkMap[id]
        if (bm) delete bm.deletedAt
      }),

      addGroup: vi.fn((grp: SiblingGroup) => {
        mockDs.siblingGroups.push(grp)
        mockDs.groupMap[grp.id] = grp
      }),
      updateGroup: vi.fn((id: string, patch: Partial<SiblingGroup>) => {
        const grp = mockDs.groupMap[id]
        if (grp) Object.assign(grp, patch)
      }),
      deleteGroup: vi.fn((id: string) => {
        const grp = mockDs.groupMap[id]
        if (grp) grp.deletedAt = Date.now()
      }),
      restoreGroup: vi.fn((id: string) => {
        const grp = mockDs.groupMap[id]
        if (grp) delete grp.deletedAt
      }),

      togglePin: vi.fn((entityType: 'bookmark' | 'group', id: string) => {
        if (entityType === 'bookmark') {
          const bm = mockDs.bookmarkMap[id]
          if (bm) bm.pinnedAt = bm.pinnedAt ? undefined : Date.now()
        } else {
          const grp = mockDs.groupMap[id]
          if (grp) grp.pinnedAt = grp.pinnedAt ? undefined : Date.now()
        }
      }),

      emptyTrash: vi.fn(() => {
        mockDs.bookmarks = mockDs.bookmarks.filter((b: Bookmark) => !b.deletedAt)
        mockDs.siblingGroups = mockDs.siblingGroups.filter((g: SiblingGroup) => !g.deletedAt)
        mockDs.categories = mockDs.categories.filter((c: Category) => !c.deletedAt)
      }),
    }

    mockApp = {
      save: vi.fn(),
    }

    mockUi = {
      app: mockApp,
      curCat: 'cat-dev',
      focusedGroupId: null,
      layoutMode: 'grid',
      themeMode: 'manual',
      themeColor: 'light',
      panels: {
        trash: false,
        settings: false,
        detail: false,
        history: false,
        rail: false,
        shortcutHelp: false,
      },
      modals: {
        bookmark: false,
        category: false,
        attribute: false,
        groupEdit: false,
        e2eSetup: false,
        e2eUnlock: false,
        e2eCanaryConflict: false,
        e2eCanaryConflictUpgraded: false,
        vaultSetup: false,
        vaultUnlock: false,
        setupGuide: false,
        share: false,
        aiFinder: false,
        aiEnrich: false,
        quickLook: false,
      },
      saveUIState: vi.fn(),
      setThemeColor: vi.fn((color: 'light' | 'dark') => {
        mockUi.themeColor = color
        mockUi.themeMode = 'manual'
      }),
      toggleAutoTheme: vi.fn(() => {
        mockUi.themeMode = 'auto'
      }),
    }
  })

  describe('1. 分类管理 (manage_categories)', () => {
    it('能够创建新分类，并支持通过事务栈完整撤销', async () => {
      const res = await executeManageCategories(
        { action: 'create', name: '人工智能', color: '#10b981', icon: 'cpu' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )

      expect(res.success).toBe(true)
      expect(res.message).toContain('已成功为您创建分类「人工智能」')
      const created = mockDs.categories.find((c: Category) => c.name === '人工智能')
      expect(created).toBeDefined()
      expect(created?.color).toBe('#10b981')

      // 测试撤销
      const undoAction = popUndoAction()
      expect(undoAction).not.toBeNull()
      const undoMsg = await undoAction?.revert()
      expect(undoMsg).toContain('已撤销新建分类「人工智能」')
      expect(created?.deletedAt).toBeDefined()
    })

    it('能够重命名分类并可撤销', async () => {
      const res = await executeManageCategories(
        { action: 'rename', categoryId: 'cat-dev', newName: '研发与工程' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      expect(mockDs.categoryMap['cat-dev'].name).toBe('研发与工程')

      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(mockDs.categoryMap['cat-dev'].name).toBe('开发技术')
    })

    it('能够软删除分类并撤销恢复', async () => {
      const res = await executeManageCategories(
        { action: 'delete', categoryId: 'cat-media' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      expect(mockDs.categoryMap['cat-media'].deletedAt).toBeDefined()

      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(mockDs.categoryMap['cat-media'].deletedAt).toBeUndefined()
    })
  })

  describe('2. 标签管理 (manage_tags)', () => {
    it('能够创建标签并可撤销', async () => {
      const res = await executeManageTags(
        { action: 'create', name: '微服务' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      const tag = mockDs.customAttributes.find((a: CustomAttribute) => a.name === '微服务')
      expect(tag).toBeDefined()

      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(tag?.deletedAt).toBeDefined()
    })

    it('能够重命名标签并可撤销', async () => {
      const res = await executeManageTags(
        { action: 'rename', tagId: 'attr-frontend', newName: '前沿Web' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      expect(mockDs.attributeMap['attr-frontend'].name).toBe('前沿Web')

      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(mockDs.attributeMap['attr-frontend'].name).toBe('前端')
    })
  })

  describe('3. 书签治理 (manage_bookmarks)', () => {
    it('能够新增书签且自动匹配或创建标签', async () => {
      const res = await executeManageBookmarks(
        {
          action: 'add',
          url: 'https://react.dev',
          title: 'React 官方网站',
          notes: 'React 现代文档',
          category: '开发技术',
          tags: ['前端', '新标签React'],
        },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      const createdBm = mockDs.bookmarks.find((b: Bookmark) => b.url === 'https://react.dev')
      expect(createdBm).toBeDefined()
      expect(createdBm?.title).toBe('React 官方网站')
      expect(createdBm?.attributes['attr-frontend']).toBe(true)

      // 验证撤销
      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(createdBm?.deletedAt).toBeDefined()
    })

    it('支持建立与解除父子书签层级关联 (set_parent / remove_parent)', async () => {
      // 将 Vite 设置为 Vue 的子书签
      const res = await executeManageBookmarks(
        { action: 'set_parent', bookmarkId: 'bm-2', parentId: 'bm-1' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      expect(mockDs.bookmarkMap['bm-2'].parentId).toBe('bm-1')

      // 撤销变回顶级书签
      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(mockDs.bookmarkMap['bm-2'].parentId).toBeNull()

      // 解除父子书签
      mockDs.bookmarkMap['bm-2'].parentId = 'bm-1'
      const resRemove = await executeManageBookmarks(
        { action: 'remove_parent', bookmarkId: 'bm-2' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(resRemove.success).toBe(true)
      expect(mockDs.bookmarkMap['bm-2'].parentId).toBeNull()
    })

    it('支持切换置顶状态 (toggle_pin)', async () => {
      const res = await executeManageBookmarks(
        { action: 'toggle_pin', bookmarkId: 'bm-1' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      expect(mockDs.bookmarkMap['bm-1'].pinnedAt).toBeDefined()

      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(mockDs.bookmarkMap['bm-1'].pinnedAt).toBeUndefined()
    })
  })

  describe('4. 工作台治理 (manage_workspaces)', () => {
    it('能够新建工作台并挂载初始书签', async () => {
      const res = await executeManageWorkspaces(
        {
          action: 'create',
          name: '前端全家桶工作台',
          notes: '## 包含 Vue 与 Vite',
          category: '开发技术',
          bookmarkIds: ['bm-1', 'bm-2'],
        },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      const grp = mockDs.siblingGroups.find((g: SiblingGroup) => g.name === '前端全家桶工作台')
      expect(grp).toBeDefined()
      // 验证工作台已关联书签列表
      expect(grp?.bookmarkIds).toEqual(['bm-1', 'bm-2'])

      // 撤销工作台创建
      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(grp?.deletedAt).toBeDefined()
    })

    it('能够向工作台动态加入与移出书签', async () => {
      // 加入 Node.js
      const resAdd = await executeManageWorkspaces(
        { action: 'add_bookmarks', workspaceId: 'grp-vue', bookmarkIds: ['bm-3'] },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(resAdd.success).toBe(true)
      expect(mockDs.groupMap['grp-vue'].bookmarkIds).toContain('bm-3')

      // 移出 Node.js
      const resRemove = await executeManageWorkspaces(
        { action: 'remove_bookmarks', workspaceId: 'grp-vue', bookmarkIds: ['bm-3'] },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(resRemove.success).toBe(true)
      expect(mockDs.groupMap['grp-vue'].bookmarkIds).not.toContain('bm-3')
    })
  })

  describe('5. 偏好与系统调度 (manage_settings)', () => {
    it('支持切换暗色与亮色模式且可撤销', async () => {
      const res = await executeManageSettings(
        { action: 'toggle_theme', themeMode: 'dark' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      expect(mockUi.setThemeColor).toHaveBeenCalledWith('dark')

      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(mockUi.setThemeColor).toHaveBeenCalledWith('light')
    })

    it('支持切换大宫格、列表与紧凑小宫格 (mini-grid)', async () => {
      const res = await executeManageSettings(
        { action: 'change_view', viewLayout: 'compact' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      expect(mockUi.layoutMode).toBe('mini-grid')

      const undoAction = popUndoAction()
      await undoAction?.revert()
      expect(mockUi.layoutMode).toBe('grid')
    })

    it('支持跳转分类、聚焦工作台与展开回收站/偏好面板', async () => {
      const resCat = await executeManageSettings(
        { action: 'navigate', navigateTarget: 'category', targetName: '媒体娱乐' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(resCat.success).toBe(true)
      expect(mockUi.curCat).toBe('cat-media')

      const resGrp = await executeManageSettings(
        { action: 'navigate', navigateTarget: 'workspace', targetName: 'Vue 生态' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(resGrp.success).toBe(true)
      expect(mockUi.focusedGroupId).toBe('grp-vue')

      const resTrash = await executeManageSettings(
        { action: 'navigate', navigateTarget: 'trash' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(resTrash.success).toBe(true)
      expect(mockUi.panels.trash).toBe(true)
    })

    it('清空回收站支持统计被删除项总数并彻底清除', async () => {
      mockDs.bookmarks[0].deletedAt = Date.now()
      const res = await executeManageSettings(
        { action: 'empty_trash' },
        { ds: mockDs, app: mockApp, ui: mockUi },
      )
      expect(res.success).toBe(true)
      expect(res.message).toContain('共永久抹除了 1 个暂存项目')
      expect(mockDs.emptyTrash).toHaveBeenCalled()
    })
  })

  describe('6. createAiAgentToolRunner 统一调度各管家工具', () => {
    it('成功调度 manage_bookmarks 并挂载执行卡片', async () => {
      const runner = createAiAgentToolRunner({
        ds: mockDs,
        ui: mockUi,
        t: (k: string) => k,
        tN: (_k: string, n: number) => String(n),
      })

      const assistantTurn: any = { id: 'turn-bm', role: 'assistant', steps: [] }
      const controller = new AbortController()

      const result = await runner(assistantTurn, controller, {
        name: 'manage_bookmarks',
        arguments: {
          action: 'add',
          url: 'https://pinia.vuejs.org',
          title: 'Pinia 状态库',
          category: '开发技术',
        },
      })

      expect(result).toContain('已成功为您添加书签')
      expect(assistantTurn.steps.length).toBeGreaterThan(0)
      expect(assistantTurn.actionCard).toBeDefined()
      expect(assistantTurn.actionCard.completed).toBe(true)
      expect(assistantTurn.actionCard.actionName).toBe('manage_bookmarks')
    })
  })
})
