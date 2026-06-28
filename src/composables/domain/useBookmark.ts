import { reactive } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { favicon, domain, fixUrl } from '../../utils.js'
import { toast, toastWithUndo } from '../../lib/toast.js'
import { pushNavState } from '../interaction/useKeyboardOps.js'
import { previewIconUrl as previewIconUrlBase, clearIcon as clearIconBase } from '../ui/useIconPreview.js'
import { suggestCategory, suggestAttributes } from '../../lib/ai-classify.js'
import { safeDecodePassword } from '../../crypto.js'
import type { Bookmark } from '../../types.js'

interface BmFormState {
  id: string
  title: string
  url: string
  username: string
  password: string
  notes: string
  icon: string
  categoryId: string
  parentId: string | null
  attributes: Record<string, boolean>
  isOpen: boolean
  isEdit: boolean
  addToGroupMode: boolean
  showPassword: boolean
  logoPreviewVisible: boolean
  logoPreviewUrl: string
  logoPreviewText: string
  iconPreviewVisible: boolean
  iconPreviewUrl: string
  clearIconVisible: boolean
  aiSuggestCatId: string | null
  aiSuggestAttrIds: string[]
  aiApplied: boolean
  _fetchTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Reactive form state for BookmarkModal.
 * Replaces all DOM getElementById/readElementById operations.
 */
export const bmForm = reactive<BmFormState>({
  id: '',
  title: '',
  url: '',
  username: '',
  password: '',
  notes: '',
  icon: '',
  categoryId: '',
  parentId: null,
  attributes: {},
  isOpen: false,
  isEdit: false,
  addToGroupMode: false,
  showPassword: false,
  logoPreviewVisible: false,
  logoPreviewUrl: '',
  logoPreviewText: '',
  iconPreviewVisible: false,
  iconPreviewUrl: '',
  clearIconVisible: false,
  aiSuggestCatId: null,
  aiSuggestAttrIds: [],
  aiApplied: false,
  _fetchTimer: null,
})

export function openBookmark(bm: Bookmark) {
  if (!bm?.url) return
  const ds = useDataStore()
  ds.updateBookmark(bm.id, { useCount: (bm.useCount || 0) + 1 })
  debouncedSaveAppData()
  window.open(fixUrl(bm.url), '_blank')
}

export function visit(e: Event | null, id?: string) {
  if (e?.target && (e.target as HTMLElement).closest?.('button, input, .btn-xs, .card-actions, .group-body, [contenteditable="true"]')) return
  const bmId = id || (e?.target as HTMLElement)?.closest?.('.card[data-id]')?.getAttribute('data-id')
  if (!bmId) return
  const ds = useDataStore()
  openBookmark(ds.bookmarkMap[bmId])
}

let _opening = false
export function openBmModal(editId?: string) {
  if (_opening) return
  _opening = true
  try {
    const ds = useDataStore()
    const ui = useUIStore()
    const bm = editId ? ds.bookmarkMap[editId] : null

    bmForm.id = bm?.id || ''
    bmForm.title = bm?.title || ''
    bmForm.url = bm?.url || ''
    bmForm.username = bm?.username || ''
    bmForm.notes = bm?.notes || ''
    bmForm.icon = bm?.icon || ''
    bmForm.categoryId = bm?.categoryId || ''
    bmForm.parentId = bm?.parentId || null
    bmForm.attributes = bm?.attributes ? { ...bm.attributes } : {}
    bmForm.isEdit = !!editId
    bmForm.showPassword = false
    bmForm.logoPreviewVisible = false
    bmForm.logoPreviewUrl = ''
    bmForm.logoPreviewText = ''
    bmForm.iconPreviewVisible = !!bm?.icon
    bmForm.iconPreviewUrl = bm?.icon || ''
    bmForm.clearIconVisible = !!bm?.icon

    bmForm.password = safeDecodePassword(bm?.password || '')

    bmForm.aiSuggestCatId = null
    bmForm.aiSuggestAttrIds = []
    bmForm.aiApplied = false
    bmForm._fetchTimer = null

    ui.editingId = editId || null
    ui.lastFocusedEl = document.activeElement as HTMLElement
    pushNavState()
    ui.modals.bookmark = true
    bmForm.isOpen = true
  } finally { _opening = false }
}

export function closeBmModal() {
  bmForm.isOpen = false
  bmForm.addToGroupMode = false
  if (bmForm._fetchTimer) { clearTimeout(bmForm._fetchTimer); bmForm._fetchTimer = null }
  const ui = useUIStore()
  ui.modals.bookmark = false
  ui.editingId = null
  if (ui.lastFocusedEl) ui.lastFocusedEl.focus()
  ui.lastFocusedEl = null
}

export function saveBm() {
  const ds = useDataStore()
  const url = fixUrl(bmForm.url)
  if (!url) { toast('请填写网址', false); return }

  const title = bmForm.title.trim() || domain(url)

  const storedPassword = bmForm.password ? btoa(bmForm.password) : ''

  const data: Partial<Bookmark> = {
    title, url,
    username: bmForm.username.trim(),
    password: storedPassword,
    notes: bmForm.notes.trim(),
    icon: bmForm.icon.trim(),
    categoryId: bmForm.categoryId,
    parentId: bmForm.parentId || null,
    attributes: { ...bmForm.attributes },
  }

  if (bmForm.id) {
    ds.updateBookmark(bmForm.id, data)
    toast('书签已更新')
  } else {
    const newBm = data as Bookmark
    newBm.id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    newBm.order = ds.bookmarks.length
    newBm.useCount = 0
    newBm.isExpanded = false
    newBm.createdAt = Date.now()
    newBm.updatedAt = newBm.createdAt
    ds.addBookmark(newBm)
    const ui = useUIStore()
    if (ui.saveToGroup) {
      const targetGid = ui.saveToGroup
      ui.saveToGroup = null
      const sg = ds.groupMap[targetGid]
      if (sg && sg.bookmarkIds.indexOf(newBm.id) === -1) {
        ds.updateGroup(targetGid, { bookmarkIds: [...sg.bookmarkIds, newBm.id] })
      }
    }
    saveAppData()
    toast('书签已添加')
  }
  if (bmForm.id) saveAppData()
  closeBmModal()
}

export function addSub(parentId: string) {
  useUIStore().saveToGroup = null
  openBmModal()
  bmForm.parentId = parentId
  bmForm.categoryId = ''
  bmForm.username = ''
  bmForm.password = ''
  bmForm.icon = ''
  bmForm.clearIconVisible = false
  bmForm.iconPreviewVisible = false
}

export function previewLogo() {
  const url = bmForm.url
  const fixed = url.startsWith('http') ? url : 'https://' + url
  if (url && url.length > 3) {
    bmForm.logoPreviewVisible = true
    bmForm.logoPreviewUrl = favicon(fixed)
    bmForm.logoPreviewText = domain(fixed)
  } else {
    bmForm.logoPreviewVisible = false
  }
}

/**
 * 快速收藏：从 URL 自动填充标题、图标、分类建议、属性建议
 * URL 输入防抖后自动调用
 */
export function autoFetchFromUrl() {
  if (bmForm._fetchTimer) { clearTimeout(bmForm._fetchTimer); bmForm._fetchTimer = null }
  const raw = bmForm.url.trim()
  if (!raw || raw.length < 4) return

  bmForm._fetchTimer = setTimeout(() => {
    const url = fixUrl(raw)
    const dm = domain(url)

    // 标题：仅在为空时自动填充
    if (!bmForm.title.trim()) {
      bmForm.title = dm.replace(/^www\./, '').split('.')[0]
        .charAt(0).toUpperCase() + dm.replace(/^www\./, '').split('.')[0].slice(1)
    }

    // 图标：仅在为空时自动填充
    if (!bmForm.icon) {
      bmForm.icon = favicon(url)
      bmForm.iconPreviewVisible = true
      bmForm.iconPreviewUrl = bmForm.icon
      bmForm.clearIconVisible = true
    }

    // Logo 预览
    previewLogo()

    // AI 分类 + 属性建议（仅新建模式）
    if (!bmForm.isEdit && !bmForm.aiApplied) {
      const ds = useDataStore()
      const catId = suggestCategory(url, bmForm.title, ds.categories)
      if (catId && !bmForm.categoryId) {
        bmForm.aiSuggestCatId = catId
      }
      const attrIds = suggestAttributes(url, bmForm.title, ds.customAttributes)
      if (attrIds.length) {
        bmForm.aiSuggestAttrIds = attrIds.filter(id => !bmForm.attributes[id])
      }
    }
  }, 500)
}

/** 应用 AI 建议的分类 */
export function applyAiCategory() {
  if (bmForm.aiSuggestCatId) {
    bmForm.categoryId = bmForm.aiSuggestCatId
    bmForm.aiSuggestCatId = null
    bmForm.aiApplied = true
  }
}

/** 应用 AI 建议的属性 */
export function applyAiAttributes() {
  for (const id of bmForm.aiSuggestAttrIds) {
    bmForm.attributes[id] = true
  }
  bmForm.aiSuggestAttrIds = []
  bmForm.aiApplied = true
}

/** 忽略所有 AI 建议 */
export function dismissAiSuggestions() {
  bmForm.aiSuggestCatId = null
  bmForm.aiSuggestAttrIds = []
  bmForm.aiApplied = true
}

export function previewIconUrl() { previewIconUrlBase(bmForm) }

export function clearIcon() { clearIconBase(bmForm) }

/** Collect all sub-bookmark IDs recursively */
function collectSubIds(id: string): string[] {
  const ds = useDataStore()
  const cm = ds.childrenMap
  if (cm && Object.keys(cm).length > 0) {
    const ids: string[] = [id]
    const stack = [id]
    while (stack.length) {
      const pid = stack.pop()!
      const children = cm[pid]
      if (children) {
        for (const c of children) { ids.push(c.id); stack.push(c.id) }
      }
    }
    return ids
  }
  // Fallback for when childrenMap is not available (e.g. in tests)
  let ids = [id]
  ds.bookmarks.filter(b => b.parentId === id).forEach(c => {
    ids = ids.concat(collectSubIds(c.id))
  })
  return ids
}

export function deleteBookmarkWithUndo(id: string) {
  const ds = useDataStore()
  const ids = collectSubIds(id)
  const removedFromGroups: Record<string, string[]> = {}
  ids.forEach(bid => {
    ds.siblingGroups.forEach(g => {
      const bi = g.bookmarkIds.indexOf(bid)
      if (bi > -1) {
        if (!removedFromGroups[bid]) removedFromGroups[bid] = []
        removedFromGroups[bid].push(g.id)
        ds.updateGroup(g.id, { bookmarkIds: g.bookmarkIds.filter((_, i) => i !== bi) })
      }
    })
  })
  ids.forEach(bid => ds.deleteBookmark(bid))
  debouncedSaveAppData()
  toastWithUndo('书签已删除', () => {
    ids.forEach(bid => ds.restoreBookmark(bid))
    Object.keys(removedFromGroups).forEach(bid => {
      removedFromGroups[bid].forEach(gid => {
        const sg = ds.groupMap[gid]
        if (sg && sg.bookmarkIds.indexOf(bid) === -1) {
          ds.updateGroup(gid, { bookmarkIds: [...sg.bookmarkIds, bid] })
        }
      })
    })
    debouncedSaveAppData()
    toast('已恢复')
  })
}
