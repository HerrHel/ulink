import { reactive } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useE2EStore } from '../../stores/e2e.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { favicon, domain, fixUrl } from '../../utils.js'

import { toast, toastWithUndo, showConfirm, showChoice } from '../../lib/toast.js'
import { collectDescendantIds } from '../../lib/collectSubIds.js'
import { newBookmarkId } from '../../lib/newId.js'
import { pushNavState } from '../interaction/useKeyboardOps.js'
import { previewIconUrl as previewIconUrlBase, clearIcon as clearIconBase } from '../ui/useIconPreview.js'
import { suggestCategory, suggestAttributes } from '../../lib/ai-classify.js'
import { safeDecodePassword, encrypt, decrypt } from '../../crypto.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Bookmark, EncryptedPassword } from '../../types.js'
import { isDataHydrated } from '../../lib/dataReady.js'

/**
 * 检测两个URL是否是后缀变体关系
 * 例如：
 * - https://example.com 和 https://example.com/page
 * - https://example.com/ 和 https://example.com/page
 * 返回true表示newUrl是existingUrl的后缀变体
 */
function isUrlSuffixVariant(existingUrl: string, newUrl: string): boolean {
  try {
    const existing = new URL(existingUrl)
    const newUrlObj = new URL(newUrl)

    // 域名必须相同
    if (existing.hostname !== newUrlObj.hostname) return false

    // 协议必须相同
    if (existing.protocol !== newUrlObj.protocol) return false

    // 获取路径（去除开头的斜杠）
    const existingPath = existing.pathname.replace(/^\//, '')
    const newPath = newUrlObj.pathname.replace(/^\//, '')

    // 如果existingPath为空或根路径，则newPath是它的后缀
    if (!existingPath || existingPath === '/') return true

    // newPath必须以existingPath开头（作为前缀）
    if (newPath.startsWith(existingPath)) {
      // 确保existingPath后面是斜杠或者是字符串结尾
      const rest = newPath.slice(existingPath.length)
      return rest === '' || rest.startsWith('/')
    }

    return false
  } catch {
    // URL解析失败，认为不是后缀变体
    return false
  }
}

/**
 * 检测是否有完全重复的URL
 * 返回true表示存在完全重复
 */
function isExactDuplicate(existingUrl: string, newUrl: string): boolean {
  try {
    const existing = new URL(existingUrl)
    const newUrlObj = new URL(newUrl)

    // 完整比较：协议、主机名、路径、查询参数、哈希
    return existing.href === newUrlObj.href
  } catch {
    return false
  }
}

/**
 * 查找与指定URL重复或后缀变体的书签
 * 返回找到的书签和类型（exact: 完全重复, suffix: 后缀变体）
 * @param excludeIds 要排除的书签ID列表（编辑模式下排除自身等）
 * @param excludeParentId 要排除的父书签ID（添加子书签时排除父书签及其祖先）
 */
function findDuplicateBookmarks(url: string, excludeIds?: string[], excludeParentId?: string): { exact: Bookmark | null; suffix: Bookmark | null } {
  const ds = useDataStore()
  const excludeSet = new Set(excludeIds || [])

  // 如果指定了 excludeParentId，收集其祖先链（包括自身）
  if (excludeParentId) {
    let pid: string | null = excludeParentId
    while (pid) {
      excludeSet.add(pid)
      const parent: Bookmark | undefined = ds.bookmarkMap[pid]
      pid = parent?.parentId || null
    }
  }

  const existingBookmarks = ds.bookmarks.filter(b => !b.deletedAt && !excludeSet.has(b.id))

  let exact: Bookmark | null = null
  let suffix: Bookmark | null = null

  for (const bm of existingBookmarks) {
    if (isExactDuplicate(bm.url, url)) {
      exact = bm
      break
    }
    if (isUrlSuffixVariant(bm.url, url) && !suffix) {
      suffix = bm
    }
  }

  return { exact, suffix }
}

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
        // P1：按需引导 — 编辑已加密书签时自动弹解锁
        const unlocked = await new Promise<boolean>(resolve => {
          e2eStore.pendingUnlock.push(resolve)
        })
        if (unlocked && e2eStore.cryptoKey) {
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

/** A2-004：在途保存锁，防双击产生重复书签 */
let _bmSaving = false
export function isBmSaving(): boolean { return _bmSaving }

export async function saveBm() {
  // A2-004：在途直接 return（解锁递归走同一锁，勿在 await 解锁前 release）
  if (_bmSaving) return
  _bmSaving = true
  try {
    const ds = useDataStore()
    const url = fixUrl(bmForm.url)
    if (!url) { toast('请填写网址', false); return }

    // 新建书签时检测重复
    if (!bmForm.id) {
      // 添加子书签时，排除父书签及其祖先（避免父书签被误判为"后缀变体"）
      const { exact, suffix } = findDuplicateBookmarks(url, undefined, bmForm.parentId || undefined)

      // 完全重复：阻止添加
      if (exact) {
        toast('该网址已存在书签「' + (exact.title || '未命名') + '」', false)
        closeBmModal()
        return
      }

      // 后缀变体：弹窗让用户选择
      if (suffix) {
        const action = await showSuffixVariantDialog(suffix, url)
        if (action === 'cancel') {
          closeBmModal()
          return
        } else if (action === 'child') {
          // 成为已有书签的子书签
          bmForm.parentId = suffix.id
        }
        // action === 'sibling' 时保持顶级，继续保存流程
      }
    }

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
        // P1：按需解锁 — 不再提示「请先解锁 E2E」，改为自动弹锁 + 等待解锁后继续保存
        // 临时释放锁，否则解锁后递归 saveBm 会直接 return
        _bmSaving = false
        const unlocked = await new Promise<boolean>(resolve => {
          e2eStore.pendingUnlock.push(resolve)
        })
        if (!unlocked) {
          toast('保存已取消', false)
          return
        }
        // 解锁后重试加密（递归调用自身，解锁后 isUnlocked=true 走上一分支）
        await saveBm()
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
      toast('书签已更新')
    } else {
      const newBm = data as Bookmark
      newBm.id = newBookmarkId()
      // order 用「现存最大 order + 1」而非 ds.bookmarks.length：length 在永久删除（回收站清空、
      // 数组物理移除）后会缩短，新值可能与现存项 order 重复，自定义排序下两条同 order 抖动。
      // max+1 只取现存项，永久删后仍唯一。与 saveFromExtension 同策略（见其注释）。
      newBm.order = ds.nextBookmarkOrder()
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
  } finally {
    _bmSaving = false
  }
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
    return collectDescendantIds(pid => cm[pid], id)
  }
  // Fallback for when childrenMap is not available (e.g. in tests)
  let ids = [id]
  ds.bookmarks.filter(b => b.parentId === id).forEach(c => {
    ids = ids.concat(collectSubIds(c.id))
  })
  return ids
}

export async function deleteBookmarkWithUndo(id: string, skipConfirm?: boolean) {
  const ds = useDataStore()
  const bm = ds.bookmarkMap[id]
  if (!bm) return
  const doDelete = () => {
    // 仅 deleteBookmark：它会从组 bookmarkIds 剔除并写入 _deletedGroupMemberships。
    // 旧实现先 updateGroup 剔组再 delete，导致 memberships 记空，回收站恢复丢组关系（RE-5/DATA-1）。
    // 与 batchDelete 对齐：undo / 回收站统一走 restoreBookmark。
    const ids = collectSubIds(id)
    ids.forEach(bid => ds.deleteBookmark(bid))
    debouncedSaveAppData()
    toastWithUndo('书签已删除', () => {
      ids.forEach(bid => ds.restoreBookmark(bid))
      debouncedSaveAppData()
      toast('已恢复')
    })
  }
  if (skipConfirm) doDelete()
  else if (await showConfirm('确认删除书签「' + (bm.title || '未命名') + '」？')) doDelete()
}

/**
 * 静默保存书签（扩展/分享目标传入），保存后显示带撤销按钮的 toast。
 * 不打开编辑弹窗，实现一键保存。
 * 调用方须 await whenDataReady() 后再调用（E1-001/E1-002）；未 hydrate 时拒绝写入，
 * 避免空 store 快照覆盖 IDB 或随后被 load 整表冲掉。
 */
export function saveFromExtension(url: string, title?: string, notes?: string): boolean {
  if (!isDataHydrated()) {
    console.warn('[LinkVault] saveFromExtension 在 dataReady 前被调用，已拒绝')
    toast('数据尚未就绪，请稍后重试', false)
    return false
  }
  const ds = useDataStore()
  const safeUrl = fixUrl(url)
  if (!safeUrl) {
    toast('无法保存该链接', false)
    return false
  }

  // 检测完全重复的URL
  const { exact } = findDuplicateBookmarks(safeUrl)
  if (exact) {
    toast('该网址已存在书签「' + (exact.title || '未命名') + '」', false)
    return false
  }

  const id = newBookmarkId()
  const dm = domain(safeUrl)
  const newBm: Bookmark = {
    id,
    title: (title || dm).trim() || dm,
    url: safeUrl,
    username: '',
    password: '',
    notes: notes || '',
    icon: `https://www.google.com/s2/favicons?domain=${dm}&sz=32`,
    categoryId: CAT_UNCATEGORIZED,
    parentId: null,
    // order 用「现存最大 order + 1」保证唯一，而非 ds.bookmarks.length。
    // length 在永久删除（回收站清空，从数组物理移除）后会缩短，新值可能与现存项 order 重复，
    // 导致"自定义"排序模式下两条同 order 抖动/相对顺序不稳。max+1 只取现存项，永久删后仍唯一。
    order: ds.nextBookmarkOrder(),
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  ds.addBookmark(newBm)
  saveAppData()
  toastWithUndo('✓ 已保存到书签', () => {
    ds.deleteBookmark(newBm.id)
    debouncedSaveAppData()
    toast('已撤销')
  })

  return true
}

/**
 * 显示后缀变体URL的选择弹窗
 * 让用户选择：成为已有书签的子书签、作为顶级书签添加、或取消
 */
async function showSuffixVariantDialog(existingBookmark: Bookmark, newUrl: string): Promise<'child' | 'sibling' | 'cancel'> {
  const existingTitle = existingBookmark.title || '未命名'
  const existingDomain = domain(existingBookmark.url)
  const newDomain = domain(newUrl)

  // 构建选项
  const options = [
    {
      id: 'child',
      label: '成为「' + existingTitle + '」的子书签',
      description: '将新书签作为已有书签的子项保存',
    },
    {
      id: 'sibling',
      label: '作为独立书签添加',
      description: '与已有书签平级保存',
    },
  ]

  // 构建消息
  let message = '发现已有书签「' + existingTitle + '」'
  if (existingDomain === newDomain) {
    message += '，网址域名相同但路径不同。'
  } else {
    message += '，网址相似。'
  }
  message += '\n\n如何处理新书签？'

  const result = await showChoice(message, options)

  if (result === 'child') return 'child'
  if (result === 'sibling') return 'sibling'
  return 'cancel'
}
