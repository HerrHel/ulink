import { reactive } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useE2EStore } from '../../stores/e2e.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { favicon, domain, fixUrl } from '../../utils.js'
import { incrementStat } from '../../lib/stats.js'
import { toast, toastWithUndo } from '../../lib/toast.js'
import { pushNavState } from '../interaction/useKeyboardOps.js'
import { previewIconUrl as previewIconUrlBase, clearIcon as clearIconBase } from '../ui/useIconPreview.js'
import { suggestCategory, suggestAttributes } from '../../lib/ai-classify.js'
import { safeDecodePassword, encrypt, decrypt } from '../../crypto.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Bookmark, EncryptedPassword } from '../../types.js'

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
  // S1：fixUrl 对 javascript:/data: 等危险 scheme 返回空串，此时阻止弹窗导航并提示。
  const safeUrl = fixUrl(bm.url)
  if (!safeUrl) {
    toast('该链接地址不安全，已阻止打开', false)
    return
  }
  const ds = useDataStore()
  ds.updateBookmark(bm.id, { useCount: (bm.useCount || 0) + 1 })
  debouncedSaveAppData()
  window.open(safeUrl, '_blank')
}

export function visit(e: Event | null, id?: string) {
  if (e?.target && (e.target as HTMLElement).closest?.('button, input, .btn-xs, .card-actions, .group-body, [contenteditable="true"]')) return
  const bmId = id || (e?.target as HTMLElement)?.closest?.('.card[data-id]')?.getAttribute('data-id')
  if (!bmId) return
  const ds = useDataStore()
  openBookmark(ds.bookmarkMap[bmId])
}

let _opening = false
export async function openBmModal(editId?: string) {
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
    bmForm.categoryId = editId ? (bm?.categoryId || '') : (ui.curCat === CAT_ALL ? CAT_UNCATEGORIZED : ui.curCat)
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

    // 密码：E2E 加密 → 用缓存密钥解密 / 旧版 base64 → 解码 / 空 → 留空
    const pw = bm?.password
    if (pw && typeof pw === 'object' && (pw as EncryptedPassword).encrypted) {
      const e2eStore = useE2EStore()
      if (e2eStore.isUnlocked && e2eStore.cryptoKey) {
        try {
          const ep = pw as EncryptedPassword
          const raw = ep.salt + '.' + ep.iv + '.' + ep.data
          bmForm.password = await decrypt(raw, e2eStore.cryptoKey as CryptoKey)
        } catch {
          bmForm.password = ''
        }
      } else {
        bmForm.password = ''
      }
    } else {
      bmForm.password = safeDecodePassword(bm?.password as string || '')
    }

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
  // S15：关闭弹窗时清除明文密码，缩短解密后明文在内存中的暴露窗口
  bmForm.password = ''
  if (bmForm._fetchTimer) { clearTimeout(bmForm._fetchTimer); bmForm._fetchTimer = null }
  const ui = useUIStore()
  ui.modals.bookmark = false
  ui.editingId = null
  if (ui.lastFocusedEl) ui.lastFocusedEl.focus()
  ui.lastFocusedEl = null
}

export async function saveBm() {
  const ds = useDataStore()
  const url = fixUrl(bmForm.url)
  if (!url) { toast('请填写网址', false); return }

  const title = bmForm.title.trim() || domain(url)

  // 密码处理：
  // - E2E 已启用且已解锁 → AES-256-GCM 加密
  // - E2E 已启用但未解锁 且 密码非空 → S6 阻断：禁止走 btoa(明文) 降级，提示先解锁
  // - E2E 未启用 → base64（旧版兼容，明文非 E2E 场景的预期形态）
  let storedPassword: string | EncryptedPassword = ''
  if (bmForm.password) {
    const e2eStore = useE2EStore()
    if (e2eStore.isUnlocked && e2eStore.cryptoKey) {
      // S6：encrypt 已严格保证输出为 salt.iv.data 三段；这里与之对齐，做契约校验。
      try {
        const raw = await encrypt(bmForm.password, e2eStore.cryptoKey as CryptoKey)
        const parts = raw.split('.')
        if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
          toast('密码加密失败：输出格式异常，已取消保存', false)
          return
        }
        storedPassword = { encrypted: true, salt: parts[0], iv: parts[1], data: parts[2] }
      } catch {
        toast('密码加密失败，请重试或稍后解锁 E2E 后再保存', false)
        return
      }
    } else if (e2eStore.isE2EEnabled) {
      // S6：E2E 启用但未解锁 —— 禁止 btoa 明文降级，守住「已加密」预期
      toast('请先解锁 E2E 再保存带密码的书签', false)
      return
    } else {
      // E2E 未启用：旧版兼容的 base64（非加密场景的预期形态）
      storedPassword = btoa(bmForm.password)
    }
  }

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
    incrementStat('bookmark_edited')
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
    incrementStat('bookmark_created')
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
  incrementStat('bookmark_deleted')
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
