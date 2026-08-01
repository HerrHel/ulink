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
  nextBookmarkOrder: vi.fn(() => mockData.bookmarks.reduce((m: number, b: any) => b.order > m ? b.order : m, -1) + 1),
  addBookmark: vi.fn(),
  updateBookmark: vi.fn((id: string, changes: any) => {
    const bm = mockData.bookmarkMap[id]
    if (bm) Object.assign(bm, changes)
  }),
  updateGroup: vi.fn((id: string, changes: any) => {
    const g = mockData.groupMap[id]
    if (g) Object.assign(g, changes)
  }),
  _deletedGroupMemberships: new Map<string, string[]>(),
  deleteBookmark: vi.fn((id: string) => {
    const bm = mockData.bookmarks.find((b: any) => b.id === id)
    if (bm) bm.deletedAt = Date.now()
    // 与 data store 对齐：剔组并记 memberships，供 restoreBookmark 恢复组关系
    const groupIds: string[] = []
    mockData.siblingGroups.forEach((g: any) => {
      const bi = g.bookmarkIds.indexOf(id)
      if (bi >= 0) {
        groupIds.push(g.id)
        g.bookmarkIds = g.bookmarkIds.filter((_: string, i: number) => i !== bi)
      }
    })
    if (groupIds.length) mockData._deletedGroupMemberships.set(id, groupIds)
  }),
  restoreBookmark: vi.fn((id: string) => {
    const bm = mockData.bookmarks.find((b: any) => b.id === id)
    if (bm) delete bm.deletedAt
    const groupIds = mockData._deletedGroupMemberships.get(id)
    if (groupIds) {
      for (const gid of groupIds) {
        const g = mockData.siblingGroups.find((x: any) => x.id === gid)
        if (g && g.bookmarkIds.indexOf(id) === -1) g.bookmarkIds = [...g.bookmarkIds, id]
      }
      mockData._deletedGroupMemberships.delete(id)
    }
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
    shortcutHelp: false,
  },
  overlays: {
    addDropdown: false,
    addPopover: false,
    deadLinks: false,
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
  showConfirm: vi.fn(() => Promise.resolve(true)),
  showChoice: vi.fn(() => Promise.resolve(null)),
}))

const mockToastWithUndo = { undoFn: null as (() => void) | null }

vi.mock('../../utils.js', () => ({
  favicon: vi.fn((url: string) => 'https://favicon.example.com/' + url),
  domain: vi.fn((url: string) => url.replace(/https?:\/\//, '').split('/')[0]),
  fixUrl: vi.fn((url: string) => url ? (url.startsWith('http') ? url : 'https://' + url) : ''),
  isMobile: vi.fn(() => false),
  autoMigratePassword: vi.fn().mockResolvedValue('decrypted-password'),
}))

// d1-78：可控的 ai-classify mock —— autoFetchFromUrl 编排护栏要锁住守卫链/防抖/字段变换
// 契约，而非 ai-classify 内部关键词命中（后者自有 ai-classify.test.ts）；用可注入返回值容器
// 供用例切换 suggestCategory/suggestAttributes 的输出
const mockAi = {
  suggestedCatId: null as string | null,
  suggestedAttrIds: [] as string[],
}
vi.mock('../../lib/ai-classify.js', () => ({
  suggestCategory: vi.fn(() => mockAi.suggestedCatId),
  suggestAttributes: vi.fn(() => mockAi.suggestedAttrIds),
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
  pendingUnlock: [] as ((ok: boolean) => void)[],
}


import { bmForm, openBmModal, closeBmModal, saveBm, addSub, deleteBookmarkWithUndo, previewLogo, applyAiCategory, applyAiAttributes, dismissAiSuggestions, autoFetchFromUrl, openBookmark, visit } from '../../composables/domain/useBookmark.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { suggestCategory as mockSuggestCategory, suggestAttributes as mockSuggestAttributes } from '../../lib/ai-classify.js'

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
  mockData.restoreBookmark.mockClear()
  mockData._deletedGroupMemberships = new Map()
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
  // d1-78：每个用例重置 ai-classify 注入返回值到「无建议」默认态
  mockAi.suggestedCatId = null
  mockAi.suggestedAttrIds = []
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
      // pendingUnlock 应被 push 了 resolve（等待解锁）
      expect(mockE2E.pendingUnlock.length).toBeGreaterThan(0)
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

    // M20：E2E 解锁态 password 应被 encrypt 成 EncryptedPassword 对象
    it('M20: E2E unlocked encrypts password into EncryptedPassword object', async () => {
      const { deriveKey } = await import('../../crypto.js')
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey('m20-test-master', salt)
      mockE2E.isE2EEnabled = true
      mockE2E.isUnlocked = true
      mockE2E.cryptoKey = key
      bmForm.title = 'E2E Encrypted'
      bmForm.url = 'https://e2e-enc.com'
      bmForm.password = 'super-secret-pw'
      await vi.waitFor(async () => { await saveBm() })
      expect(mockData.addBookmark).toHaveBeenCalledTimes(1)
      const newBm = mockData.addBookmark.mock.calls[0][0]
      const pw = newBm.password
      expect(pw).toEqual(expect.objectContaining({
        encrypted: true,
        salt: expect.any(String),
        iv: expect.any(String),
        data: expect.any(String),
      }))
      expect(pw.salt && pw.iv && pw.data).toBeTruthy()
      // 不是明文、也不是单纯 base64(明文)
      expect(pw).not.toBe('super-secret-pw')
      expect(pw).not.toBe(btoa('super-secret-pw'))
    }, 15000)
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

    it('does not trigger duplicate detection when adding sub bookmark to parent with same domain', async () => {
      // 准备已有父书签
      mockData.bookmarks = [{
        id: 'parent-bm',
        title: '父书签',
        url: 'https://example.com',
        deletedAt: undefined,
        parentId: null,
      }]
      mockData.bookmarkMap = { 'parent-bm': mockData.bookmarks[0] }

      // 调用 addSub 设置 parentId
      addSub('parent-bm')
      await vi.waitFor(() => bmForm.isOpen === true)

      // 设置子书签表单（同域名不同路径）
      bmForm.url = 'https://example.com/page'
      bmForm.title = '子书签'

      // 尝试保存
      await saveBm()

      // 不应该显示选择弹窗（父书签应被排除在重复检测之外）
      const { showChoice } = await import('../../lib/toast.js')
      expect(showChoice).not.toHaveBeenCalled()

      // 应该直接添加书签
      expect(mockData.addBookmark).toHaveBeenCalled()
      const newBm = mockData.addBookmark.mock.calls[0][0]
      expect(newBm.parentId).toBe('parent-bm')
    })
  })

  describe('deleteBookmarkWithUndo', () => {
    function populateStore() {
      mockData.bookmarks.forEach((b: any) => { mockData.bookmarkMap[b.id] = b })
      mockData.siblingGroups.forEach((g: any) => { mockData.groupMap[g.id] = g })
    }

    it('deletes bookmark and all descendants', async () => {
      mockData.bookmarks = [
        { id: 'b1', title: 'P', parentId: null },
        { id: 'b2', title: 'C1', parentId: 'b1' },
        { id: 'b3', title: 'C2', parentId: 'b2' },
        { id: 'b4', title: 'Unrelated', parentId: null },
      ]
      mockData.siblingGroups = []
      populateStore()
      await deleteBookmarkWithUndo('b1')
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
      await deleteBookmarkWithUndo('b1')
      expect(toastWithUndo).toHaveBeenCalled()
    })

    it('removes bookmark from sibling groups', async () => {
      mockData.bookmarks = [{ id: 'b1', title: 'InG', parentId: null }]
      mockData.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: ['b1', 'b2'] }]
      populateStore()
      await deleteBookmarkWithUndo('b1')
      expect(mockData.siblingGroups[0].bookmarkIds).toEqual(['b2'])
    })

    it('undo callback restores bookmarks', async () => {
      const orig = { id: 'b1', title: 'UndoTest', parentId: null }
      mockData.bookmarks = [{ ...orig }]
      mockData.siblingGroups = []
      populateStore()
      await deleteBookmarkWithUndo('b1')
      expect(mockData.bookmarks[0].deletedAt).toBeDefined()
      expect(mockToastWithUndo.undoFn).not.toBeNull()
      mockToastWithUndo.undoFn!()
      expect(mockData.bookmarks[0].deletedAt).toBeUndefined()
    })

    it('undo restores group references', async () => {
      mockData.bookmarks = [{ id: 'b1', title: 'Grouped', parentId: null }]
      mockData.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: ['b1'] }]
      populateStore()
      await deleteBookmarkWithUndo('b1')
      expect(mockData.siblingGroups[0].bookmarkIds).toEqual([])
      expect(mockData._deletedGroupMemberships.get('b1')).toEqual(['g1'])
      mockToastWithUndo.undoFn!()
      expect(mockData.siblingGroups[0].bookmarkIds).toContain('b1')
    })

    it('trash restore via restoreBookmark recovers group membership without toast undo', async () => {
      mockData.bookmarks = [{ id: 'b1', title: 'Grouped', parentId: null }]
      mockData.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: ['b1'] }]
      populateStore()
      await deleteBookmarkWithUndo('b1')
      // 不调用 toast undo，模拟进回收站恢复
      expect(mockData._deletedGroupMemberships.get('b1')).toEqual(['g1'])
      mockData.restoreBookmark('b1')
      expect(mockData.bookmarks[0].deletedAt).toBeUndefined()
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

  describe('duplicate detection', () => {
    it('should prevent adding exact duplicate URL', async () => {
      // 准备已有书签
      mockData.bookmarks = [{
        id: 'existing-bm',
        title: '已有书签',
        url: 'https://example.com',
        deletedAt: undefined,
      }]
      mockData.bookmarkMap = { 'existing-bm': mockData.bookmarks[0] }

      // 设置新书签表单
      bmForm.url = 'https://example.com'
      bmForm.title = '新书签'

      // 尝试保存
      await saveBm()

      // 应该显示toast提示并阻止添加
      const { toast } = await import('../../lib/toast.js')
      expect(toast).toHaveBeenCalledWith('该网址已存在书签「已有书签」', false)
      expect(mockData.addBookmark).not.toHaveBeenCalled()
    })

    it('should show choice dialog for suffix variant URL', async () => {
      // 准备已有书签
      mockData.bookmarks = [{
        id: 'existing-bm',
        title: '已有书签',
        url: 'https://example.com',
        deletedAt: undefined,
      }]
      mockData.bookmarkMap = { 'existing-bm': mockData.bookmarks[0] }

      // 设置新书签表单
      bmForm.url = 'https://example.com/page'
      bmForm.title = '新书签'

      // 模拟用户选择"成为子书签"
      const { showChoice } = await import('../../lib/toast.js')
      vi.mocked(showChoice).mockResolvedValueOnce('child')

      // 保存
      await saveBm()

      // 应该显示选择弹窗
      expect(showChoice).toHaveBeenCalled()

      // 应该将parentId设置为已有书签的id
      expect(bmForm.parentId).toBe('existing-bm')

      // 应该添加书签
      expect(mockData.addBookmark).toHaveBeenCalled()
    })

    it('should add as sibling when user chooses sibling option', async () => {
      // 准备已有书签
      mockData.bookmarks = [{
        id: 'existing-bm',
        title: '已有书签',
        url: 'https://example.com',
        deletedAt: undefined,
      }]
      mockData.bookmarkMap = { 'existing-bm': mockData.bookmarks[0] }

      // 设置新书签表单
      bmForm.url = 'https://example.com/page'
      bmForm.title = '新书签'

      // 模拟用户选择"作为独立书签添加"
      const { showChoice } = await import('../../lib/toast.js')
      vi.mocked(showChoice).mockResolvedValueOnce('sibling')

      // 保存
      await saveBm()

      // 应该显示选择弹窗
      expect(showChoice).toHaveBeenCalled()

      // parentId应该保持为null（顶级书签）
      expect(bmForm.parentId).toBeNull()

      // 应该添加书签
      expect(mockData.addBookmark).toHaveBeenCalled()
    })

    it('should cancel when user chooses cancel option', async () => {
      // 准备已有书签
      mockData.bookmarks = [{
        id: 'existing-bm',
        title: '已有书签',
        url: 'https://example.com',
        deletedAt: undefined,
      }]
      mockData.bookmarkMap = { 'existing-bm': mockData.bookmarks[0] }

      // 设置新书签表单
      bmForm.url = 'https://example.com/page'
      bmForm.title = '新书签'

      // 模拟用户选择"取消"
      const { showChoice } = await import('../../lib/toast.js')
      vi.mocked(showChoice).mockResolvedValueOnce(null)

      // 保存
      await saveBm()

      // 应该显示选择弹窗
      expect(showChoice).toHaveBeenCalled()

      // 不应该添加书签
      expect(mockData.addBookmark).not.toHaveBeenCalled()
    })

    it('should allow editing existing bookmark even with duplicate URL', async () => {
      // 准备已有书签
      mockData.bookmarks = [{
        id: 'existing-bm',
        title: '已有书签',
        url: 'https://example.com',
        deletedAt: undefined,
      }]
      mockData.bookmarkMap = { 'existing-bm': mockData.bookmarks[0] }

      // 设置编辑模式
      bmForm.id = 'existing-bm'
      bmForm.url = 'https://example.com'
      bmForm.title = '更新的书签'

      // 保存
      await saveBm()

      // 编辑模式下不应该检测重复
      expect(mockData.updateBookmark).toHaveBeenCalled()
    })
  })
})

// D1-77 useBookmark.ts:475/484/493 — AI 建议采纳/忽略三函数护栏
// BookmarkModal.vue:204/205/207 用户点击「采纳建议分类 / 采纳建议属性 / 忽略 AI 建议」三按钮唯一承载。
// 三函数纯函数级：仅读/写模块级 reactive bmForm（aiSuggestCatId/aiSuggestAttrIds/aiApplied/categoryId/attributes），
// 无 store、无 IO、无 timer、无网络。直接复用既有 bmForm + resetBmForm（useBookmark.test.ts:137/138 处已就位）。
describe('AI 建议采纳/忽略（applyAiCategory/applyAiAttributes/dismissAiSuggestions）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetBmForm()
  })

  describe('applyAiCategory 应用建议分类', () => {
    it('正路径：aiSuggestCatId 有值 → categoryId 被建议值覆盖 + 清建议 + 置 aiApplied=true', () => {
      bmForm.categoryId = 'old-cat'
      bmForm.aiSuggestCatId = 'new-cat'
      bmForm.aiApplied = false

      applyAiCategory()

      expect(bmForm.categoryId).toBe('new-cat')
      expect(bmForm.aiSuggestCatId).toBeNull()
      expect(bmForm.aiApplied).toBe(true)
    })

    it('无值守卫：aiSuggestCatId=null → 三赋值全不执行（categoryId 保持原值 + aiApplied 保持 false）', () => {
      bmForm.categoryId = 'old-cat'
      bmForm.aiSuggestCatId = null
      bmForm.aiApplied = false

      applyAiCategory()

      expect(bmForm.categoryId).toBe('old-cat')
      expect(bmForm.aiSuggestCatId).toBeNull()
      expect(bmForm.aiApplied).toBe(false)
    })

    it('空串守卫：aiSuggestCatId=""（falsy）→ 守卫隐式 truthy 判定不执行（非 === null 判定）', () => {
      bmForm.categoryId = 'keep-cat'
      bmForm.aiSuggestCatId = ''
      bmForm.aiApplied = false

      applyAiCategory()

      expect(bmForm.categoryId).toBe('keep-cat')
      expect(bmForm.aiSuggestCatId).toBe('')
      expect(bmForm.aiApplied).toBe(false)
    })

    it('categoryId 被覆盖语义：原值被建议值整个替换非保留', () => {
      bmForm.categoryId = 'original'
      bmForm.aiSuggestCatId = 'suggested'

      applyAiCategory()

      expect(bmForm.categoryId).toBe('suggested')
    })

    it('aiApplied 已 true 时再应用仍 true（幂等）', () => {
      bmForm.aiSuggestCatId = 'cat1'
      bmForm.aiApplied = true

      applyAiCategory()

      expect(bmForm.aiApplied).toBe(true)
      expect(bmForm.categoryId).toBe('cat1')
    })

    it('连续两次应用：第二次 aiSuggestCatId 已清 null → 守卫不执行零副作用', () => {
      bmForm.aiSuggestCatId = 'first-cat'
      applyAiCategory()
      expect(bmForm.categoryId).toBe('first-cat')
      expect(bmForm.aiApplied).toBe(true)

      // 第二次 aiSuggestCatId 已 null，守卫不动 categoryId
      bmForm.aiSuggestCatId = null
      applyAiCategory()
      expect(bmForm.categoryId).toBe('first-cat')
      expect(bmForm.aiSuggestCatId).toBeNull()
    })
  })

  describe('applyAiAttributes 应用建议属性', () => {
    it('正路径：aiSuggestAttrIds=[a1,a2] + attributes={} → 两属性置 true + 清建议 + 置 aiApplied', () => {
      bmForm.attributes = {}
      bmForm.aiSuggestAttrIds = ['a1', 'a2']
      bmForm.aiApplied = false

      applyAiAttributes()

      expect(bmForm.attributes).toEqual({ a1: true, a2: true })
      expect(bmForm.aiSuggestAttrIds).toEqual([])
      expect(bmForm.aiApplied).toBe(true)
    })

    it('既有属性保留：应用新建议不覆盖既有 attribute=true（for 追加非整体替换）', () => {
      bmForm.attributes = { existing: true }
      bmForm.aiSuggestAttrIds = ['new1']

      applyAiAttributes()

      expect(bmForm.attributes).toEqual({ existing: true, new1: true })
    })

    it('空建议数组：aiSuggestAttrIds=[] → for 不迭代 + attributes 不变 + 清空仍 []（幂等）', () => {
      bmForm.attributes = { keep: true }
      bmForm.aiSuggestAttrIds = []
      bmForm.aiApplied = false

      applyAiAttributes()

      expect(bmForm.attributes).toEqual({ keep: true })
      expect(bmForm.aiSuggestAttrIds).toEqual([])
      expect(bmForm.aiApplied).toBe(true)
    })

    it('重复 id 不报错：[a1,a1] → attributes.a1 末次覆盖仍 true', () => {
      bmForm.attributes = {}
      bmForm.aiSuggestAttrIds = ['a1', 'a1']

      applyAiAttributes()

      expect(bmForm.attributes).toEqual({ a1: true })
    })

    it('attributes 字段为空对象 {}：for 内 attributes[id]=true 不抛 TypeError', () => {
      bmForm.attributes = {}
      bmForm.aiSuggestAttrIds = ['x']

      expect(() => applyAiAttributes()).not.toThrow()
      expect(bmForm.attributes.x).toBe(true)
    })

    it('aiApplied 已 true 时再应用仍 true（幂等）', () => {
      bmForm.attributes = {}
      bmForm.aiSuggestAttrIds = ['a']
      bmForm.aiApplied = true

      applyAiAttributes()

      expect(bmForm.aiApplied).toBe(true)
    })
  })

  describe('dismissAiSuggestions 忽略所有 AI 建议', () => {
    it('正路径：有建议时 dismiss → 清 cat 建议 + 清 attr 建议数组 + 置 aiApplied=true', () => {
      bmForm.aiSuggestCatId = 'cat1'
      bmForm.aiSuggestAttrIds = ['a1', 'a2']
      bmForm.aiApplied = false

      dismissAiSuggestions()

      expect(bmForm.aiSuggestCatId).toBeNull()
      expect(bmForm.aiSuggestAttrIds).toEqual([])
      expect(bmForm.aiApplied).toBe(true)
    })

    it('恒执行无守卫：无建议（cat=null + attrs=[]）时 dismiss 仍执行三赋值（与 applyAiCategory 的 if 守卫不同）', () => {
      bmForm.aiSuggestCatId = null
      bmForm.aiSuggestAttrIds = []
      bmForm.aiApplied = false

      dismissAiSuggestions()

      expect(bmForm.aiSuggestCatId).toBeNull()
      expect(bmForm.aiSuggestAttrIds).toEqual([])
      expect(bmForm.aiApplied).toBe(true)
    })

    it('dismiss 只清建议队列不还原已应用的 categoryId/attributes（防误改撤销已采纳）', () => {
      // 模拟「先 applyAiCategory 采纳了 cat=suggested 后 dismiss 忽略属性」场景
      bmForm.categoryId = 'suggested'
      bmForm.attributes = { adopted: true }
      bmForm.aiSuggestCatId = 'extra-cat'
      bmForm.aiSuggestAttrIds = ['extra-attr']

      dismissAiSuggestions()

      // dismiss 清了建议队列，但不应撤销已应用的 categoryId/attributes
      expect(bmForm.categoryId).toBe('suggested')
      expect(bmForm.attributes).toEqual({ adopted: true })
      expect(bmForm.aiSuggestCatId).toBeNull()
      expect(bmForm.aiSuggestAttrIds).toEqual([])
    })

    it('aiApplied 已 true 时 dismiss 仍 true（幂等）', () => {
      bmForm.aiApplied = true

      dismissAiSuggestions()

      expect(bmForm.aiApplied).toBe(true)
    })
  })

  describe('aiApplied 标志位跨三函数一致（防漏置致重复建议）', () => {
    it('applyAiCategory 正路径置 aiApplied=true', () => {
      bmForm.aiApplied = false
      bmForm.aiSuggestCatId = 'c'
      applyAiCategory()
      expect(bmForm.aiApplied).toBe(true)
    })

    it('applyAiAttributes 正路径置 aiApplied=true', () => {
      bmForm.aiApplied = false
      bmForm.aiSuggestAttrIds = ['a']
      applyAiAttributes()
      expect(bmForm.aiApplied).toBe(true)
    })

    it('dismissAiSuggestions 恒置 aiApplied=true（即使无建议）', () => {
      bmForm.aiApplied = false
      dismissAiSuggestions()
      expect(bmForm.aiApplied).toBe(true)
    })
  })

  // d1-78: autoFetchFromUrl 编排护栏 —— 唯一生产消费方 BookmarkModal.vue onUrlInput 触发，
  // 决定「输入 url 后自动填的 title/icon/AI 建议」用户可见行为。锁守卫链 + 500ms 防抖 +
  // 字段变换隐特性 + AI 守卫 `!isEdit && !aiApplied` + aiSuggestCatId 仅 !categoryId 时写 +
  // aiSuggestAttrIds 过滤 !attributes[id]（已采纳不重复建议）。ai-classify 本体已自有
  // ai-classify.test.ts，本块 mock 其返回值锁编排契约而非耦合关键词命中。
  describe('autoFetchFromUrl', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('空 url 早退：不布 timer 且 _fetchTimer 仍为 null', () => {
      bmForm.url = '   '
      autoFetchFromUrl()
      expect(bmForm._fetchTimer).toBeNull()
      expect(mockSuggestCategory).not.toHaveBeenCalled()
    })

    it('url 长度 <4 早退：不布 timer（trim 后 raw.length 守卫）', () => {
      bmForm.url = 'abc'
      autoFetchFromUrl()
      expect(bmForm._fetchTimer).toBeNull()
      // 4 字符以下直接 return，不进 setTimeout 编排
      expect(mockSuggestCategory).not.toHaveBeenCalled()
    })

    it('合法 url 布防抖 timer：500ms 未到不执行编排（title 仍空）', () => {
      bmForm.url = 'https://github.com'
      autoFetchFromUrl()
      expect(bmForm._fetchTimer).not.toBeNull()
      expect(bmForm.title).toBe('')
      vi.advanceTimersByTime(499)
      expect(bmForm.title).toBe('')
      expect(mockSuggestCategory).not.toHaveBeenCalled()
    })

    it('到 500ms 触发编排：title 空则填充经去 www + 取首段 + 首字母大写变换', () => {
      bmForm.url = 'www.github.com'
      mockAi.suggestedCatId = null
      mockAi.suggestedAttrIds = []
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      // 真实隐特性直锁：replace(/^www\./) → 'github.com'，split('.')[0] → 'github'，
      // charAt(0).toUpperCase() → 'G'，slice(1) → 'ithub'，拼 'Github'
      expect(bmForm.title).toBe('Github')
    })

    it('到 500ms：title 已存在不被自动覆盖（仅空时填）', () => {
      bmForm.url = 'https://github.com'
      bmForm.title = 'My Existing Title'
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      expect(bmForm.title).toBe('My Existing Title')
    })

    it('到 500ms：icon 空时填 favicon(url) 且同步置 iconPreviewVisible/Url/clearIconVisible', () => {
      bmForm.url = 'https://example.com'
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      // favicon mock 返回 'https://favicon.example.com/<url>'
      expect(bmForm.icon).toBe('https://favicon.example.com/https://example.com')
      expect(bmForm.iconPreviewVisible).toBe(true)
      expect(bmForm.iconPreviewUrl).toBe(bmForm.icon)
      expect(bmForm.clearIconVisible).toBe(true)
    })

    it('到 500ms：icon 已存在不被覆盖（仅空时填，iconPreviewUrl 不被改）', () => {
      bmForm.url = 'https://example.com'
      bmForm.icon = 'existing-icon-url'
      bmForm.iconPreviewUrl = 'existing-preview'
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      expect(bmForm.icon).toBe('existing-icon-url')
      expect(bmForm.iconPreviewUrl).toBe('existing-preview')
    })

    it('AI 守卫：isEdit=true 时 500ms 后不调 suggestCategory/suggestAttributes', () => {
      bmForm.url = 'https://github.com'
      bmForm.isEdit = true
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      expect(mockSuggestCategory).not.toHaveBeenCalled()
      expect(mockSuggestAttributes).not.toHaveBeenCalled()
    })

    it('AI 守卫：aiApplied=true 时 500ms 后不调 suggest（防重复建议）', () => {
      bmForm.url = 'https://github.com'
      bmForm.aiApplied = true
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      expect(mockSuggestCategory).not.toHaveBeenCalled()
      expect(mockSuggestAttributes).not.toHaveBeenCalled()
    })

    it('新建未应用：suggestCategory 非空且 categoryId 空时写入 aiSuggestCatId', () => {
      bmForm.url = 'https://github.com'
      mockAi.suggestedCatId = 'cat_dev'
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      // 编排顺序真实特性：title 填充分支先于 AI 建议分支执行，故 suggestCategory 入参的 title
      // 是已填好的 'Github'（github.com → 去首段首字母大写）而非初始空串
      expect(mockSuggestCategory).toHaveBeenCalledWith('https://github.com', 'Github', mockData.categories)
      expect(bmForm.aiSuggestCatId).toBe('cat_dev')
    })

    it('新建未应用 + categoryId 已有：suggestCategory 仍调但不覆盖 categoryId（不写 aiSuggestCatId）', () => {
      bmForm.url = 'https://github.com'
      bmForm.categoryId = 'existing-cat'
      mockAi.suggestedCatId = 'cat_dev'
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      // suggestCategory 照调（编辑模式/已应用才在外层守卫拦截，categoryId 是否已有在内层判定）
      expect(mockSuggestCategory).toHaveBeenCalled()
      // 但 categoryId 已有，catId 不写入 aiSuggestCatId
      expect(bmForm.aiSuggestCatId).toBeNull()
    })

    it('suggestAttributes 非空：写入 aiSuggestAttrIds 且过滤掉已采纳（!attributes[id]）', () => {
      bmForm.url = 'https://github.com'
      bmForm.attributes = { 'attr_kept': true }  // 已采纳的不应重复建议
      mockAi.suggestedAttrIds = ['attr_kept', 'attr_new1', 'attr_new2']
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      // 编排顺序：title 已先被填成 'Github'，故 suggestAttributes 入参 title='Github'
      expect(mockSuggestAttributes).toHaveBeenCalledWith('https://github.com', 'Github', mockData.customAttributes)
      expect(bmForm.aiSuggestAttrIds).toEqual(['attr_new1', 'attr_new2'])
    })

    it('suggestAttributes 返回空数组：aiSuggestAttrIds 仍被赋空数组（length 守卫不写入）', () => {
      bmForm.url = 'https://github.com'
      bmForm.aiSuggestAttrIds = ['stale']  // 旧残留应被本轮清掉
      mockAi.suggestedAttrIds = []
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      // 源码 `if (attrIds.length)` 守卫：空数组不进赋值分支，故 stale 不被清
      expect(bmForm.aiSuggestAttrIds).toEqual(['stale'])
    })

    it('再次输入先 clearTimeout 旧 timer：旧编排不再触发（new url 编排覆盖）', () => {
      bmForm.url = 'https://first.com'
      autoFetchFromUrl()
      const firstTimer = bmForm._fetchTimer
      expect(firstTimer).not.toBeNull()
      // 第二次输入不同 url，先清旧 timer
      bmForm.url = 'https://second.com'
      autoFetchFromUrl()
      expect(bmForm._fetchTimer).not.toBe(firstTimer)
      // 仅推进 500ms：旧 timer 已被清，新 timer 触发，title 反映第二个 url
      vi.advanceTimersByTime(500)
      expect(bmForm.title).toBe('Second')
    })

    it('previewLogo 在编排中被调：设置 logoPreviewVisible/Url/Text（favicon+domain 经 previewLogo）', () => {
      bmForm.url = 'https://example.com'
      autoFetchFromUrl()
      vi.advanceTimersByTime(500)
      // previewLogo 用 mock favicon/domain 设 logoPreview 字段（domain mock 去协议取 host）
      expect(bmForm.logoPreviewVisible).toBe(true)
      expect(bmForm.logoPreviewUrl).toBe('https://favicon.example.com/https://example.com')
      expect(bmForm.logoPreviewText).toBe('example.com')
    })
  })
})

// D1-79 useBookmark.ts:170 — openBookmark 打开书签弹新窗口编排护栏
// BookmarkCard.vue visit/visitSub(line 183/192)、CommandPalette.vue(line 118)、SearchSuggest.vue(line 90)
// 活跃生产消费方，「打开书签弹新窗口」用户可见行为唯一承载。
// 编排含 S1 安全守卫（fixUrl 对 javascript:/data: 危险 scheme 返空串→早退阻止弹窗并 toast 提示）
// + !bm?.url 空守卫 + useCount 递增持久化 + window.open。
describe('openBookmark 打开书签弹新窗口编排', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    resetMockStore()
    // openBookmark 调 window.open（jsdom 提供），置 spy 便于断言调用并阻真实弹窗
    vi.spyOn(window, 'open').mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('A：bm=null 空守卫→早退零副作用（不 updateBookmark/不 save/不 open/不 toast）', () => {
    openBookmark(null as any)

    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(debouncedSaveAppData).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('B-S1：fixUrl 返空串（javascript:/data: 危险 scheme）→toast 阻止打开且不 updateBookmark/不 open', async () => {
    const bm: any = { id: 'b1', url: 'javascript:alert(1)', useCount: 3 }
    // mockData.bookmarkMap 让真实路径可触；fixUrl mock 已默认对非 http 补 https，此处覆写返空触发安全守卫
    const { fixUrl } = await import('../../utils.js')
    ;(fixUrl as any).mockReturnValueOnce('')

    openBookmark(bm)

    const { toast } = await import('../../lib/toast.js')
    expect(toast).toHaveBeenCalledWith('该链接地址不安全，已阻止打开', false)
    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(debouncedSaveAppData).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('C：正路径合法 https url→updateBookmark(useCount+1)+debouncedSaveAppData+window.open(safeUrl) 各一次', () => {
    const bm: any = { id: 'b1', url: 'https://github.com/x/y', useCount: 5 }
    mockData.bookmarkMap['b1'] = bm

    openBookmark(bm)

    expect(mockData.updateBookmark).toHaveBeenCalledTimes(1)
    expect(mockData.updateBookmark).toHaveBeenCalledWith('b1', { useCount: 6 })
    expect(debouncedSaveAppData).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledWith('https://github.com/x/y', '_blank')
    // 正路径不弹 toast
  })

  it('D：useCount 缺省(undefined)→走 `||0` 兜底递增至 1（防 NaN 塌陷）', () => {
    const bm: any = { id: 'b1', url: 'https://a.com', useCount: undefined }
    mockData.bookmarkMap['b1'] = bm

    openBookmark(bm)

    expect(mockData.updateBookmark).toHaveBeenCalledWith('b1', { useCount: 1 })
  })

  it('E：useCount=0 走 `||0` 兜底递增至 1（0 falsy 也走兜底而非 0+1=1 巧合同值但语义锁住）', () => {
    const bm: any = { id: 'b1', url: 'https://a.com', useCount: 0 }
    mockData.bookmarkMap['b1'] = bm

    openBookmark(bm)

    // 0 是合法值||(0) → 0+1=1；若误改成 `??0`(只不 null/undefined) 则 0 仍 0+1=1 同值，但边界直锁
    expect(mockData.updateBookmark).toHaveBeenCalledWith('b1', { useCount: 1 })
  })

  it('F：协议前缀 url(example.com)经 fixUrl 补 https→window.open 收到补全后的 safeUrl 非原 url', async () => {
    const bm: any = { id: 'b1', url: 'example.com', useCount: 2 }
    mockData.bookmarkMap['b1'] = bm
    // fixUrl mock 默认：非 http 开头 → 补 'https://' → 'https://example.com'
    openBookmark(bm)

    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank')
    // 直锁 open 用的是 fixUrl 后的 safeUrl，「安全过滤后才弹窗」核心契约
    const { fixUrl } = await import('../../utils.js')
    expect(fixUrl).toHaveBeenCalledWith('example.com')
  })

  it('G：危险 scheme 安全守卫早退在 updateBookmark 之前（守卫顺序敏感：useCount 不被递增）', async () => {
    const bm: any = { id: 'b1', url: 'data:text/html,evil', useCount: 7 }
    mockData.bookmarkMap['b1'] = bm
    const { fixUrl } = await import('../../utils.js')
    ;(fixUrl as any).mockReturnValueOnce('')

    openBookmark(bm)

    // 关键：守卫 return 在 updateBookmark 之前，故危险 scheme 不递增 useCount
    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(mockData.updateBookmark).not.toHaveBeenCalledWith('b1', expect.anything())
  })

  it('H：bm.url 空串→!bm?.url 早退（空守卫优先于 fixUrl，不弹 toast 不递增）', async () => {
    const bm: any = { id: 'b1', url: '', useCount: 2 }
    // fixUrl('') 返 '' 也会进安全守卫分支；但 bm.url 空时更早在 if(!bm?.url) return 早退
    // 直锁：空 url 不进 fixUrl 分支（更早 return），故连 toast「不安全」都不弹（守卫顺序）
    openBookmark(bm)

    const { toast } = await import('../../lib/toast.js')
    expect(toast).not.toHaveBeenCalled()
    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })
})

// D1-81 useBookmark.ts:184 — visit 卡片点击分流到 openBookmark 的编排护栏
// 活跃生产消费方：BookmarkCard.vue（卡片主体点击 → visit 打开书签）。
// 「点卡片主体开书签 / 点卡片内编辑按钮·输入·contenteditable 区域不误开」用户可见交互分流唯一承载。
// 编排含 4 守卫：① 可交互元素短路（e.target.closest 命中 button/input/.btn-xs/.card-actions/.group-body/
// [contenteditable="true"]→return 不调 openBookmark）② bmId 取值优先级 id||DOM-data-id
// ③ bmId 无效 return ④ 委托 openBookmark(bookmarkMap[bmId])（缺键→undefined→openBookmark 内 !url 早退兜底）
describe('visit 卡片点击分流到 openBookmark', () => {
  // 构造 jsdom 假元素 + 假事件：target.closest 行为可控，命中指定选择器返该元素否则 null。
  // 多套内容：closest 命中可交互选择器返该元素 / 命中 .card[data-id] 返带 data-id 的卡片元素 / 未命中返 null。
  function makeFakeEvent(target: { closest: (sel: string) => any } | null): any {
    return { target }
  }
  function makeTargetWithInteractive(selector: string): { closest: (sel: string) => any } {
    const el = { tagName: 'DIV' } as any
    return {
      closest(sel: string) {
        // 命中传入的可交互选择器串即返该元素（模拟落在 button/input/contenteditable 等内）
        return sel.includes(selector) ? el : null
      },
    } as any
  }
  function makeCardTarget(dataId: string | null): { closest: (sel: string) => any } {
    const cardEl = { getAttribute: () => dataId } as any
    return {
      closest(sel: string) {
        // 仅命中 .card[data-id] 选择器（卡片主体），其它（可交互）一律不命中
        return sel.includes('.card') && sel.includes('data-id') ? cardEl : null
      },
    } as any
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    resetMockStore()
    vi.spyOn(window, 'open').mockReturnValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('A：e=null + id 参数正路径→委托 openBookmark（updateBookmark+save+window.open 各一次）', () => {
    mockData.bookmarkMap['b1'] = { id: 'b1', url: 'https://a.com', useCount: 0 } as any
    visit(null, 'b1')

    expect(mockData.updateBookmark).toHaveBeenCalledTimes(1)
    expect(mockData.updateBookmark).toHaveBeenCalledWith('b1', { useCount: 1 })
    expect(debouncedSaveAppData).toHaveBeenCalledTimes(1)
    expect(window.open).toHaveBeenCalledWith('https://a.com', '_blank')
  })

  it('B：DOM 取 data-id 正路径（无 id 参数）→委托 openBookmark 传 bookmarkMap 命中对象', () => {
    mockData.bookmarkMap['b2'] = { id: 'b2', url: 'https://b.com', useCount: 4 } as any
    visit(makeFakeEvent(makeCardTarget('b2')), undefined)

    expect(mockData.updateBookmark).toHaveBeenCalledWith('b2', { useCount: 5 })
    expect(window.open).toHaveBeenCalledWith('https://b.com', '_blank')
  })

  it('C：e.target 落在 button（可交互元素）→短路不调 openBookmark（零副作用）', () => {
    mockData.bookmarkMap['b1'] = { id: 'b1', url: 'https://a.com', useCount: 0 } as any
    visit(makeFakeEvent(makeTargetWithInteractive('button')), 'b1')

    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(debouncedSaveAppData).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('D：e.target 落在 [contenteditable="true"]→短路不调 openBookmark', () => {
    mockData.bookmarkMap['b1'] = { id: 'b1', url: 'https://a.com', useCount: 0 } as any
    visit(makeFakeEvent(makeTargetWithInteractive('contenteditable')), 'b1')

    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('E：可交互短路命中 .card-actions / .group-body 卡片内编辑/操作区→短路（点操作区不误开书签）', () => {
    mockData.bookmarkMap['b1'] = { id: 'b1', url: 'https://a.com', useCount: 0 } as any
    visit(makeFakeEvent(makeTargetWithInteractive('card-actions')), 'b1')

    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('F：bmId 取到但 bookmarkMap 缺键→委托 openBookmark(undefined)→openBookmark 内 !bm?.url 早退兜底零副作用（visit 不崩）', () => {
    visit(null, 'missing')

    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(debouncedSaveAppData).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('G：无 id 参数 + DOM 无 data-id（e.target.closest 返 null）→bmId 取不到早退零副作用', () => {
    const noDataIdCard = { getAttribute: () => null } as any
    const target = {
      closest(sel: string) {
        return sel.includes('.card') && sel.includes('data-id') ? noDataIdCard : null
      },
    } as any
    visit(makeFakeEvent(target), undefined)

    expect(mockData.updateBookmark).not.toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
  })

  it('H：id 参数优先于 DOM data-id（id|| 短路逻辑，防误改 DOM 覆盖显式 id）', () => {
    mockData.bookmarkMap['b2'] = { id: 'b2', url: 'https://b.com', useCount: 1 } as any
    // e.target.closest('.card[data-id]') 取到 'b1'，但传入 id='b2' 应优先
    visit(makeFakeEvent(makeCardTarget('b1')), 'b2')

    expect(mockData.updateBookmark).toHaveBeenCalledWith('b2', { useCount: 2 })
    expect(window.open).toHaveBeenCalledWith('https://b.com', '_blank')
  })

  it('I：e.target 无 closest 方法（如文本节点经 ?. 链短路）→不抛且走 id 参数路径', () => {
    mockData.bookmarkMap['b1'] = { id: 'b1', url: 'https://a.com', useCount: 2 } as any
    // target 无 closest 属性：?.closest?. 返 undefined（falsy），不进可交互短路，bmId 走 id 参数
    const targetWithoutClosest = {} as any
    visit(makeFakeEvent(targetWithoutClosest), 'b1')

    expect(mockData.updateBookmark).toHaveBeenCalledWith('b1', { useCount: 3 })
    expect(window.open).toHaveBeenCalledWith('https://a.com', '_blank')
  })
})
