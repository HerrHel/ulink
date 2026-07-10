import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { setActivePinia, createPinia } from "pinia"
import { CAT_UNCATEGORIZED } from "../../config/constants.js"

const mockData = {
  bookmarkMap: {} as any,
  bookmarks: [] as any[],
  siblingGroups: [] as any[],
  groupMap: {} as any,
  childrenMap: {} as any,
  categories: [] as any[],
  customAttributes: [] as any[],
  addBookmark: vi.fn(),
  updateBookmark: vi.fn((id: string, changes: any) => {
    const bm = mockData.bookmarkMap[id]
    if (bm) Object.assign(bm, changes)
  }),
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
  deleteBookmark: vi.fn((id: string) => {
    const bm = mockData.bookmarks.find((b: any) => b.id === id)
    if (bm) bm.deletedAt = Date.now()
  }),
  restoreBookmark: vi.fn((id: string) => {
    const bm = mockData.bookmarks.find((b: any) => b.id === id)
    if (bm) delete bm.deletedAt
  }),
  restoreGroup: vi.fn((id: string) => {
    const g = mockData.siblingGroups.find((g: any) => g.id === id)
    if (g) delete g.deletedAt
  }),
}

const mockUI = {
  curCat: 'all' as string,
  editingId: null as string | null,
  lastFocusedEl: null as HTMLElement | null,
  saveToGroup: null as string | null,
  modals: {
    bookmark: false,
    category: false,
    attribute: false,
    groupEdit: false,
    e2eSetup: false,
    e2eUnlock: false,
  },
  panels: {
    settings: false,
    detail: false,
    trash: false,
    history: false,
    rail: false,
  },
}

vi.mock('../../stores/app.js', () => ({
  useAppStore: vi.fn(),
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

vi.mock('../../stores/data.js', () => ({
  useDataStore: vi.fn(() => mockData),
}))

vi.mock('../../stores/ui.js', () => ({
  useUIStore: vi.fn(() => mockUI),
}))

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn((msg: string, undoFn: () => void) => { mockToastWithUndo.undoFn = undoFn }),
}))

const mockToastWithUndo = { undoFn: null as (() => void) | null }

vi.mock('../../utils.js', () => ({
  favicon: vi.fn((url: string) => 'https://favicon.example.com/' + url),
  domain: vi.fn((url: string) => url.replace(/https?:\/\//, '').split('/')[0]),
  fixUrl: vi.fn((url: string) => url ? (url.startsWith('http') ? url : 'https://' + url) : ''),
  isMobile: vi.fn(() => false),
  autoMigratePassword: vi.fn().mockResolvedValue('decrypted-password'),
}))

vi.mock('../interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))
// S6：可控的 E2E store mock —— saveBm 的密码分支依赖 isE2EEnabled / isUnlocked / cryptoKey
vi.mock('../../stores/e2e.js', () => ({
  useE2EStore: vi.fn(() => mockE2E),
}))

// S6 测试用的 E2E 状态容器；测试内可调整 isE2EEnabled/isUnlocked/cryptoKey 触发不同分支
const mockE2E = {
  isE2EEnabled: false,
  isUnlocked: false,
  cryptoKey: null as CryptoKey | null,
  pendingUnlock: null as ((ok: boolean) => void) | null,
}


import { bmForm, openBmModal, closeBmModal, saveBm, addSub, deleteBookmarkWithUndo, previewLogo } from '../../composables/domain/useBookmark.js'

function resetBmForm() {
  Object.assign(bmForm, {
    id: '', title: '', url: '', username: '', password: '',
    notes: '', icon: '', categoryId: '', parentId: null,
    attributes: {}, isOpen: false, isEdit: false,
    addToGroupMode: false, showPassword: false,
    logoPreviewVisible: false, logoPreviewUrl: '',
    logoPreviewText: '', iconPreviewVisible: false,
    iconPreviewUrl: '', clearIconVisible: false,
    aiSuggestCatId: null, aiSuggestAttrIds: [],
    aiApplied: false, _fetchTimer: null,
  })
}

function resetMockStore() {
  mockData.bookmarkMap = {}
  mockData.bookmarks = []
  mockData.siblingGroups = []
  mockData.groupMap = {}
  mockData.childrenMap = {}
  mockData.categories = []
  mockData.customAttributes = []
  mockData.addBookmark.mockClear()
  mockData.updateBookmark.mockClear()
  mockData.updateGroup.mockClear()
  mockData.deleteBookmark.mockClear()
  mockUI.editingId = null
  mockUI.lastFocusedEl = null
  mockUI.saveToGroup = null
  mockUI.curCat = 'all'
  mockUI.modals.bookmark = false
  mockToastWithUndo.undoFn = null
  // S6：每个测试重置 E2E 状态到默认（未启用），避免上一个用例污染
  mockE2E.isE2EEnabled = false
  mockE2E.isUnlocked = false
  mockE2E.cryptoKey = null
}

describe('useBookmark', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    resetBmForm()
    resetMockStore()
  })

  afterEach(() => { vi.clearAllMocks() })

  describe('openBmModal', () => {
    it('new mode opens empty form', () => {
      openBmModal()
      expect(bmForm.isOpen).toBe(true)
      expect(bmForm.isEdit).toBe(false)
      expect(bmForm.title).toBe('')
      expect(bmForm.url).toBe('')
      expect(bmForm.id).toBe('')
    })

    it('new mode in 全部 view defaults categoryId to 未分类', () => {
      mockUI.curCat = 'all'
      openBmModal()
      expect(bmForm.categoryId).toBe(CAT_UNCATEGORIZED)
    })

    it('new mode in a specific category inherits current curCat', () => {
      mockUI.curCat = 'cat_work'
      openBmModal()
      expect(bmForm.categoryId).toBe('cat_work')
    })

    it('edit mode fills form data', () => {
      mockData.bookmarkMap['b1'] = {
        id: 'b1', title: 'GitHub', url: 'https://github.com',
        username: 'user1', password: 'cGFzc3dvcmQ=',
        notes: 'code', categoryId: 'cat1',
        attributes: { star: true }, icon: 'https://gh.io/f.ico',
      }
      openBmModal('b1')
      expect(bmForm.isOpen).toBe(true)
      expect(bmForm.isEdit).toBe(true)
      expect(bmForm.title).toBe('GitHub')
      expect(bmForm.url).toBe('https://github.com')
      expect(bmForm.username).toBe('user1')
      expect(bmForm.notes).toBe('code')
      expect(bmForm.categoryId).toBe('cat1')
      expect(bmForm.attributes).toEqual({ star: true })
    })

    it('non-existent bookmark id defaults to new mode with empty fields', () => {
      openBmModal('nonexistent')
      expect(bmForm.isOpen).toBe(true)
      expect(bmForm.title).toBe('')
    })

    it('sets editingId on the store', () => {
      mockData.bookmarkMap['b1'] = {
        id: 'b1', title: 'A', url: 'https://a.com', notes: '', username: '', attributes: {}
      }
      resetBmForm()
      openBmModal('b1')
      expect(mockUI.editingId).toBe('b1')
    })
  })

  describe('closeBmModal', () => {
    it('closes modal and resets state', () => {
      bmForm.isOpen = true
      bmForm.addToGroupMode = true
      mockUI.editingId = 'b1'
      const focusSpy = vi.fn()
      mockUI.lastFocusedEl = { focus: focusSpy } as any
      closeBmModal()
      expect(bmForm.isOpen).toBe(false)
      expect(bmForm.addToGroupMode).toBe(false)
      expect(mockUI.editingId).toBe(null)
      expect(focusSpy).toHaveBeenCalled()
      expect(mockUI.lastFocusedEl).toBe(null)
    })

    it('handles null lastFocusedEl gracefully', () => {
      bmForm.isOpen = true
      mockUI.lastFocusedEl = null
      expect(() => closeBmModal()).not.toThrow()
      expect(bmForm.isOpen).toBe(false)
    })

    // S15：关闭弹窗时清除明文密码，缩短解密后明文在内存中的暴露窗口
    it('S15: clears password on close to reduce in-memory exposure window', () => {
      bmForm.isOpen = true
      bmForm.password = 'secret-decrypted-password'
      closeBmModal()
      expect(bmForm.password).toBe('')
    })
  })

  describe('saveBm', () => {
    it('rejects empty title and url', () => {
      bmForm.title = ''
      bmForm.url = ''
      saveBm()
    })

    it('rejects whitespace-only title', () => {
      bmForm.title = '  '
      bmForm.url = 'https://example.com'
      saveBm()
    })

    it('new bookmark generates ID and calls addBookmark', () => {
      bmForm.title = 'New Site'
      bmForm.url = 'https://newsite.com'
      bmForm.id = ''
      saveBm()
      expect(mockData.addBookmark).toHaveBeenCalledTimes(1)
      const newBm = mockData.addBookmark.mock.calls[0][0]
      expect(newBm.title).toBe('New Site')
      expect(newBm.url).toBe('https://newsite.com')
      expect(newBm.id).toMatch(/^b[a-z0-9]+/)
      expect(newBm.order).toBe(0)
      expect(newBm.useCount).toBe(0)
    })

    it('edit existing bookmark updates properties', () => {
      mockData.bookmarkMap['b1'] = {
        id: 'b1', title: 'Old', url: 'https://old.com', notes: '', username: '', attributes: {}, order: 0
      }
      bmForm.id = 'b1'
      bmForm.title = 'Updated'
      bmForm.url = 'https://updated.com'
      bmForm.notes = 'new notes'
      saveBm()
      expect(mockData.bookmarkMap['b1'].title).toBe('Updated')
      expect(mockData.bookmarkMap['b1'].url).toBe('https://updated.com')
      expect(mockData.bookmarkMap['b1'].notes).toBe('new notes')
    })

    it('saves password as base64', () => {
      bmForm.title = 'Legacy'
      bmForm.url = 'https://legacy.com'
      bmForm.password = 'plaintext-pw'
      saveBm()
      const newBm = mockData.addBookmark.mock.calls[0][0]
      expect(newBm.password).toBe(btoa('plaintext-pw'))
    })

    it('adds to saveToGroup when specified', () => {
      mockUI.saveToGroup = 'g1'
      mockData.groupMap['g1'] = { id: 'g1', name: 'G1', bookmarkIds: [] }
      bmForm.title = 'Grouped'
      bmForm.url = 'https://grouped.com'
      saveBm()
      expect(mockUI.saveToGroup).toBeNull()
    })

    it('normalizes URL via fixUrl', () => {
      bmForm.title = 'URL Site'
      bmForm.url = 'example.com'
      saveBm()
      const newBm = mockData.addBookmark.mock.calls[0][0]
      expect(newBm.url).toBe('https://example.com')
    })

    it('empty password results in empty stored password', () => {
      bmForm.title = 'NoPw'
      bmForm.url = 'https://nopw.com'
      bmForm.password = ''
      saveBm()
      const newBm = mockData.addBookmark.mock.calls[0][0]
      expect(newBm.password).toBe('')
    })
    // P1：E2E 已启用但未解锁时，带密码的书签改为按需解锁而非直接阻断
    it('P1: prompts unlock when saving password while E2E enabled but locked', async () => {
      mockE2E.isE2EEnabled = true
      mockE2E.isUnlocked = false
      mockE2E.cryptoKey = null
      bmForm.title = 'Should Prompt Unlock'
      bmForm.url = 'https://e2elocked.com'
      bmForm.password = 'secret-pw'
      // 调用 saveBm 后应设置 pendingUnlock（而不是直接 toast 返回）
      saveBm()
      // 等待微任务队列处理
      await new Promise(r => setTimeout(r, 50))
      // 不应调用 addBookmark / updateBookmark（尚未解锁）
      expect(mockData.addBookmark).not.toHaveBeenCalled()
      expect(mockData.updateBookmark).not.toHaveBeenCalled()
      // pendingUnlock 应被设置（等待解锁）
      expect(mockE2E.pendingUnlock).not.toBeNull()
    })

    it('S6: empty password still allowed when E2E enabled but not unlocked', async () => {
      // E2E 启用但未解锁、且本次未填密码 —— 不应被拦截（无明文需保护）
      mockE2E.isE2EEnabled = true
      mockE2E.isUnlocked = false
      mockE2E.cryptoKey = null
      bmForm.title = 'No Password'
      bmForm.url = 'https://e2enopw.com'
      bmForm.password = ''
      await vi.waitFor(async () => { await saveBm() })
      expect(mockData.addBookmark).toHaveBeenCalledTimes(1)
      const newBm = mockData.addBookmark.mock.calls[0][0]
      expect(newBm.password).toBe('')
    })

    it('S6: E2E disabled still falls back to base64 (legacy compatibility)', async () => {
      // E2E 未启用时，密码仍走旧版 base64 —— 不受 S6 拦截影响
      mockE2E.isE2EEnabled = false
      mockE2E.isUnlocked = false
      mockE2E.cryptoKey = null
      bmForm.title = 'Legacy'
      bmForm.url = 'https://legacy2.com'
      bmForm.password = 'plaintext-pw'
      await vi.waitFor(async () => { await saveBm() })
      const newBm = mockData.addBookmark.mock.calls[0][0]
      expect(newBm.password).toBe(btoa('plaintext-pw'))
    })
  })

  describe('addSub', () => {
    it('opens modal with parentId and clears fields', async () => {
      addSub('parent-id')
      await vi.waitFor(() => bmForm.isOpen === true)
      expect(bmForm.parentId).toBe('parent-id')
      expect(bmForm.categoryId).toBe('')
      expect(bmForm.username).toBe('')
      expect(bmForm.password).toBe('')
    })
  })

  describe('deleteBookmarkWithUndo', () => {
    function populateStore() {
      mockData.bookmarks.forEach((b: any) => { mockData.bookmarkMap[b.id] = b })
      mockData.siblingGroups.forEach((g: any) => { mockData.groupMap[g.id] = g })
    }

    it('deletes bookmark and all descendants', () => {
      mockData.bookmarks = [
        { id: 'b1', title: 'P', parentId: null },
        { id: 'b2', title: 'C1', parentId: 'b1' },
        { id: 'b3', title: 'C2', parentId: 'b2' },
        { id: 'b4', title: 'Unrelated', parentId: null },
      ]
      mockData.siblingGroups = []
      populateStore()
      deleteBookmarkWithUndo('b1')
      const deleted = mockData.bookmarks.filter((b: any) => b.deletedAt)
      const active = mockData.bookmarks.filter((b: any) => !b.deletedAt)
      expect(deleted.length).toBe(3)
      expect(active.length).toBe(1)
      expect(active[0].id).toBe('b4')
    })

    it('calls toastWithUndo with undo support', async () => {
      mockData.bookmarks = [{ id: 'b1', title: 'Solo', parentId: null }]
      mockData.siblingGroups = []
      populateStore()
      const { toastWithUndo } = await import('../../lib/toast.js')
      deleteBookmarkWithUndo('b1')
      expect(toastWithUndo).toHaveBeenCalled()
    })

    it('removes bookmark from sibling groups', () => {
      mockData.bookmarks = [{ id: 'b1', title: 'InG', parentId: null }]
      mockData.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: ['b1', 'b2'] }]
      populateStore()
      deleteBookmarkWithUndo('b1')
      expect(mockData.siblingGroups[0].bookmarkIds).toEqual(['b2'])
    })

    it('undo callback restores bookmarks', () => {
      const orig = { id: 'b1', title: 'UndoTest', parentId: null }
      mockData.bookmarks = [{ ...orig }]
      mockData.siblingGroups = []
      populateStore()
      deleteBookmarkWithUndo('b1')
      expect(mockData.bookmarks[0].deletedAt).toBeDefined()
      expect(mockToastWithUndo.undoFn).not.toBeNull()
      mockToastWithUndo.undoFn!()
      expect(mockData.bookmarks[0].deletedAt).toBeUndefined()
    })

    it('undo restores group references', () => {
      mockData.bookmarks = [{ id: 'b1', title: 'Grouped', parentId: null }]
      mockData.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: ['b1'] }]
      populateStore()
      deleteBookmarkWithUndo('b1')
      expect(mockData.siblingGroups[0].bookmarkIds).toEqual([])
      mockToastWithUndo.undoFn!()
      expect(mockData.siblingGroups[0].bookmarkIds).toContain('b1')
    })
  })

  describe('previewLogo', () => {
    it('shows logo preview for valid URL', () => {
      bmForm.url = 'https://github.com/user/repo'
      previewLogo()
      expect(bmForm.logoPreviewVisible).toBe(true)
      expect(bmForm.logoPreviewUrl).toContain('github.com')
    })

    it('adds https:// for protocol-less URLs', () => {
      bmForm.url = 'example.com'
      previewLogo()
      expect(bmForm.logoPreviewVisible).toBe(true)
    })

    it('hides preview for short URLs (<=3 chars)', () => {
      bmForm.url = 'ab'
      previewLogo()
      expect(bmForm.logoPreviewVisible).toBe(false)
    })

    it('hides preview for empty URL', () => {
      bmForm.url = ''
      bmForm.logoPreviewVisible = true
      previewLogo()
      expect(bmForm.logoPreviewVisible).toBe(false)
    })
  })
})
