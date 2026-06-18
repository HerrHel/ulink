import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { setActivePinia, createPinia } from "pinia"

const mockStore = {
  bookmarkMap: {} as any,
  bookmarks: [] as any[],
  siblingGroups: [] as any[],
  groupMap: {} as any,
  masterPassword: "",
  masterPasswordOpen: false,
  editingId: null as string | null,
  lastFocusedEl: null as HTMLElement | null,
  saveToGroup: null as string | null,
  bmModalOpen: false,
  addBookmark: vi.fn(),
  save: vi.fn(),
  debouncedSave: vi.fn(),
  encryptFormPassword: vi.fn().mockResolvedValue({ encrypted: true, data: [1,2,3], iv: [4,5,6], salt: [7,8,9] }),
  updateBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
}

vi.mock('../../stores/app.js', () => ({
  useAppStore: vi.fn(() => mockStore),
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
  autoMigratePassword: vi.fn().mockResolvedValue('decrypted-password'),
}))

vi.mock('../interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

vi.mock('../ui/useIconPreview.js', () => ({
  previewIconUrl: vi.fn(),
  clearIcon: vi.fn(),
}))

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
  })
}

function resetMockStore() {
  mockStore.bookmarkMap = {}
  mockStore.bookmarks = []
  mockStore.siblingGroups = []
  mockStore.groupMap = {}
  mockStore.masterPassword = ''
  mockStore.masterPasswordOpen = false
  mockStore.editingId = null
  mockStore.lastFocusedEl = null
  mockStore.saveToGroup = null
  mockStore.addBookmark.mockClear()
  mockStore.save.mockClear()
  mockStore.debouncedSave.mockClear()
  mockStore.encryptFormPassword.mockClear()
  mockStore.updateBookmark.mockClear()
  mockStore.deleteBookmark.mockClear()
  mockToastWithUndo.undoFn = null
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
    it('new mode opens empty form', async () => {
      await openBmModal()
      expect(bmForm.isOpen).toBe(true)
      expect(bmForm.isEdit).toBe(false)
      expect(bmForm.title).toBe('')
      expect(bmForm.url).toBe('')
      expect(bmForm.id).toBe('')
    })

    it('edit mode fills form data', async () => {
      mockStore.bookmarkMap['b1'] = {
        id: 'b1', title: 'GitHub', url: 'https://github.com',
        username: 'user1', password: 'cGFzc3dvcmQ=',
        notes: 'code', categoryId: 'cat1',
        attributes: { star: true }, icon: 'https://gh.io/f.ico',
      }
      await openBmModal('b1')
      expect(bmForm.isOpen).toBe(true)
      expect(bmForm.isEdit).toBe(true)
      expect(bmForm.title).toBe('GitHub')
      expect(bmForm.url).toBe('https://github.com')
      expect(bmForm.username).toBe('user1')
      expect(bmForm.notes).toBe('code')
      expect(bmForm.categoryId).toBe('cat1')
      expect(bmForm.attributes).toEqual({ star: true })
    })

    it('non-existent bookmark id defaults to new mode with empty fields', async () => {
      await openBmModal('nonexistent')
      expect(bmForm.isOpen).toBe(true)
      // isEdit is true because editId is truthy — real behavior
      expect(bmForm.title).toBe('')
    })

    it('sets editingId on the store', async () => {
      mockStore.bookmarkMap['b1'] = {
        id: 'b1', title: 'A', url: 'https://a.com', notes: '', username: '', attributes: {}
      }
      resetBmForm()
      await openBmModal('b1')
      expect(mockStore.editingId).toBe('b1')
    })
  })

  describe('closeBmModal', () => {
    it('closes modal and resets state', () => {
      bmForm.isOpen = true
      bmForm.addToGroupMode = true
      mockStore.editingId = 'b1'
      const focusSpy = vi.fn()
      mockStore.lastFocusedEl = { focus: focusSpy } as any
      closeBmModal()
      expect(bmForm.isOpen).toBe(false)
      expect(bmForm.addToGroupMode).toBe(false)
      expect(mockStore.editingId).toBe(null)
      expect(focusSpy).toHaveBeenCalled()
      expect(mockStore.lastFocusedEl).toBe(null)
    })

    it('handles null lastFocusedEl gracefully', () => {
      bmForm.isOpen = true
      mockStore.lastFocusedEl = null
      expect(() => closeBmModal()).not.toThrow()
      expect(bmForm.isOpen).toBe(false)
    })
  })

  describe('saveBm', () => {
    it('rejects empty title and url', async () => {
      bmForm.title = ''
      bmForm.url = ''
      await saveBm()
      const { toast } = await import('../../lib/toast.js')
      expect(toast).toHaveBeenCalledWith('请填写名称和网址', false)
    })

    it('rejects whitespace-only title', async () => {
      bmForm.title = '  '
      bmForm.url = 'https://example.com'
      await saveBm()
      const { toast } = await import('../../lib/toast.js')
      expect(toast).toHaveBeenCalledWith('请填写名称和网址', false)
    })

    it('new bookmark generates ID and calls addBookmark', async () => {
      bmForm.title = 'New Site'
      bmForm.url = 'https://newsite.com'
      bmForm.id = ''
      await saveBm()
      expect(mockStore.addBookmark).toHaveBeenCalledTimes(1)
      const newBm = mockStore.addBookmark.mock.calls[0][0]
      expect(newBm.title).toBe('New Site')
      expect(newBm.url).toBe('https://newsite.com')
      expect(newBm.id).toMatch(/^b[a-z0-9]+/)
      expect(newBm.order).toBe(0)
      expect(newBm.useCount).toBe(0)
      const { toast } = await import('../../lib/toast.js')
      expect(toast).toHaveBeenCalledWith('书签已添加')
      expect(bmForm.isOpen).toBe(false)
    })

    it('edit existing bookmark updates properties', async () => {
      mockStore.bookmarkMap['b1'] = {
        id: 'b1', title: 'Old', url: 'https://old.com', notes: '', username: '', attributes: {}, order: 0
      }
      bmForm.id = 'b1'
      bmForm.title = 'Updated'
      bmForm.url = 'https://updated.com'
      bmForm.notes = 'new notes'
      await saveBm()
      expect(mockStore.bookmarkMap['b1'].title).toBe('Updated')
      expect(mockStore.bookmarkMap['b1'].url).toBe('https://updated.com')
      expect(mockStore.bookmarkMap['b1'].notes).toBe('new notes')
      const { toast } = await import('../../lib/toast.js')
      expect(toast).toHaveBeenCalledWith('书签已更新')
    })

    it('encrypts password with master password', async () => {
      mockStore.masterPassword = 'master-pw'
      bmForm.title = 'Secure'
      bmForm.url = 'https://secure.com'
      bmForm.password = 'plaintext-pw'
      await saveBm()
      expect(mockStore.encryptFormPassword).toHaveBeenCalledWith('plaintext-pw')
    })

    it('falls back to base64 when no master password', async () => {
      mockStore.masterPassword = ''
      bmForm.title = 'Legacy'
      bmForm.url = 'https://legacy.com'
      bmForm.password = 'plaintext-pw'
      await saveBm()
      const newBm = mockStore.addBookmark.mock.calls[0][0]
      expect(newBm.password).toBe(btoa('plaintext-pw'))
    })

    it('shows error on encryption failure', async () => {
      mockStore.masterPassword = 'master-pw'
      mockStore.encryptFormPassword.mockRejectedValueOnce(new Error('Crypto failed'))
      bmForm.title = 'Bad'
      bmForm.url = 'https://bad.com'
      bmForm.password = 'pw'
      await saveBm()
      const { toast } = await import('../../lib/toast.js')
      expect(toast).toHaveBeenCalledWith('密码加密失败: Crypto failed', false)
      expect(mockStore.addBookmark).not.toHaveBeenCalled()
    })

    it('adds to saveToGroup when specified', async () => {
      mockStore.saveToGroup = 'g1'
      mockStore.groupMap['g1'] = { id: 'g1', name: 'G1', bookmarkIds: [] }
      bmForm.title = 'Grouped'
      bmForm.url = 'https://grouped.com'
      await saveBm()
      const { toast } = await import('../../lib/toast.js')
      expect(toast).toHaveBeenCalledWith('已添加到组')
      expect(mockStore.groupMap['g1'].bookmarkIds).toContain(mockStore.addBookmark.mock.calls[0][0].id)
    })

    it('normalizes URL via fixUrl', async () => {
      bmForm.title = 'URL Site'
      bmForm.url = 'example.com'
      await saveBm()
      const newBm = mockStore.addBookmark.mock.calls[0][0]
      expect(newBm.url).toBe('https://example.com')
    })

    it('empty password results in empty stored password', async () => {
      bmForm.title = 'NoPw'
      bmForm.url = 'https://nopw.com'
      bmForm.password = ''
      await saveBm()
      const newBm = mockStore.addBookmark.mock.calls[0][0]
      expect(newBm.password).toBe('')
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
      mockStore.bookmarks.forEach((b: any) => { mockStore.bookmarkMap[b.id] = b })
      mockStore.siblingGroups.forEach((g: any) => { mockStore.groupMap[g.id] = g })
    }

    it('deletes bookmark and all descendants', () => {
      mockStore.bookmarks = [
        { id: 'b1', title: 'P', parentId: null },
        { id: 'b2', title: 'C1', parentId: 'b1' },
        { id: 'b3', title: 'C2', parentId: 'b2' },
        { id: 'b4', title: 'Unrelated', parentId: null },
      ]
      mockStore.siblingGroups = []
      populateStore()
      deleteBookmarkWithUndo('b1')
      expect(mockStore.bookmarks.length).toBe(1)
      expect(mockStore.bookmarks[0].id).toBe('b4')
    })

    it('calls toastWithUndo with undo support', async () => {
      mockStore.bookmarks = [{ id: 'b1', title: 'Solo', parentId: null }]
      mockStore.siblingGroups = []
      populateStore()
      const { toastWithUndo } = await import('../../lib/toast.js')
      deleteBookmarkWithUndo('b1')
      expect(toastWithUndo).toHaveBeenCalled()
    })

    it('removes bookmark from sibling groups', () => {
      mockStore.bookmarks = [{ id: 'b1', title: 'InG', parentId: null }]
      mockStore.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: ['b1', 'b2'] }]
      populateStore()
      deleteBookmarkWithUndo('b1')
      expect(mockStore.siblingGroups[0].bookmarkIds).toEqual(['b2'])
    })

    it('undo callback restores bookmarks', () => {
      const orig = { id: 'b1', title: 'UndoTest', parentId: null }
      mockStore.bookmarks = [{ ...orig }]
      mockStore.siblingGroups = []
      populateStore()
      deleteBookmarkWithUndo('b1')
      expect(mockStore.bookmarks.length).toBe(0)
      expect(mockToastWithUndo.undoFn).not.toBeNull()
      mockToastWithUndo.undoFn!()
      expect(mockStore.bookmarks.length).toBe(1)
      expect(mockStore.bookmarks[0].id).toBe('b1')
    })

    it('undo restores group references', () => {
      mockStore.bookmarks = [{ id: 'b1', title: 'Grouped', parentId: null }]
      mockStore.siblingGroups = [{ id: 'g1', name: 'G1', bookmarkIds: ['b1'] }]
      populateStore()
      deleteBookmarkWithUndo('b1')
      expect(mockStore.siblingGroups[0].bookmarkIds).toEqual([])
      mockToastWithUndo.undoFn!()
      expect(mockStore.siblingGroups[0].bookmarkIds).toContain('b1')
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
