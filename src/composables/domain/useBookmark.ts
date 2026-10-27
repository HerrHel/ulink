import { reactive } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useE2EStore } from '../../stores/e2e.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { favicon, domain, fixUrl, displayText } from '../../utils.js'

import { toast, toastWithUndo, showConfirm, showChoice } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'
import { collectDescendantIds } from '../../lib/collectSubIds.js'
import { newBookmarkId } from '../../lib/newId.js'
import { pushNavState } from '../interaction/useKeyboardOps.js'
import { previewIconUrl as previewIconUrlBase, clearIcon as clearIconBase } from '../ui/useIconPreview.js'
import { suggestCategory, suggestAttributes } from '../../lib/ai-classify.js'
import { getSmartPrefill } from '../../lib/ai/smartPrefill.js'
import { fetchUrlMetadataAsync } from '../../lib/ai/smartIntake.js'
import { isPrivateUrl } from '../../lib/ai/urlGuard.js'
import { safeDecodePassword, encrypt, decryptPasswordWithKey, isThreePartCipher } from '../../crypto.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Bookmark, EncryptedPassword } from '../../types.js'
import { isDataHydrated } from '../../lib/dataReady.js'
import { isUrlSuffixVariant, isExactDuplicate, findBestParentBookmark } from '../../lib/bookmarkDedup.js'
export { isUrlSuffixVariant, isExactDuplicate, findBestParentBookmark }

/**
 * 查找与指定URL重复或后缀变体的书签
 * 返回找到的书签和类型（exact: 完全重复, suffix: 后缀变体）
 * @param excludeIds 要排除的书签ID列表（编辑模式下排除自身等）
 * @param excludeParentId 要排除的父书签ID（添加子书签时排除父书签及其祖先）
 */
export function findDuplicateBookmarks(url: string, excludeIds?: string[], excludeParentId?: string): { exact: Bookmark | null; suffix: Bookmark | null } {
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
  isAiFetching: boolean
  aiFetchedSuccess: boolean
  candidateUsernames: string[]
  _autoTitle: string
  _autoNotes: string
  _autoIcon: string
  _autoAttrIds: string[]
  _autoCategoryId: string
  _autoParentId: string | null
  _userEditedTitle: boolean
  _userEditedNotes: boolean
  _userEditedAttrs: boolean
  _userEditedCategory: boolean
  _userEditedParent: boolean
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
  isAiFetching: false,
  aiFetchedSuccess: false,
  candidateUsernames: [],
  _autoTitle: '',
  _autoNotes: '',
  _autoIcon: '',
  _autoAttrIds: [],
  _autoCategoryId: '',
  _autoParentId: null,
  _userEditedTitle: false,
  _userEditedNotes: false,
  _userEditedAttrs: false,
  _userEditedCategory: false,
  _userEditedParent: false,
})

export function openBookmark(bm: Bookmark) {
  if (!bm?.url) return
  // S1：fixUrl 对 javascript:/data: 等危险 scheme 返回空串，此时阻止弹窗导航并提示。
  const safeUrl = fixUrl(bm.url)
  if (!safeUrl) {
    toast(t('msg.unsafeUrlBlocked'), false)
    return
  }
  const ds = useDataStore()
  // R-RESURRECT：计数走静默累加（不标脏/不刷 updatedAt）——点开书签不再生成同步
  // op，避免离线积压的存活快照上线后复活远端墓碑。
  ds.bumpBookmarkUseCount(bm.id)
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
    // E2E 密文（未解锁/解不开）不进编辑框：displayText 过滤为空，避免密文长串进表单
    //（保存时 saveBm 的密文检测会阻止覆盖，见 saveBm 原值密文保护）
    bmForm.title = displayText(bm?.title)
    bmForm.url = displayText(bm?.url)
    bmForm.username = displayText(bm?.username)
    bmForm.notes = displayText(bm?.notes)
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
    // 展示链路对齐：解密统一走 decryptPasswordWithKey（与 BookmarkCard 卡片路径一致）。
    // 旧实现此处用 decrypt(raw, cryptoKey)——decrypt 对「三段但 GCM 认证失败」降级返回
    // 原 ciphertext 串，换设备/改主密码后旧 key 加密的密文用新 key 解会把 salt.iv.data
    // 长串回吐进编辑框（用户报的「密码乱码」）。decryptPasswordWithKey 解不开返空串，
    // 与 crypto 的既定展示语义一致，绝不把密文形态泄漏给 UI（其内部已 catch，无需外层 try）。
    const pw = bm?.password
    if (pw && typeof pw === 'object' && (pw as EncryptedPassword).encrypted) {
      const e2eStore = useE2EStore()
      if (e2eStore.isUnlocked && e2eStore.cryptoKey) {
        bmForm.password = await decryptPasswordWithKey(pw, e2eStore.cryptoKey as CryptoKey)
      } else {
        // P1：按需引导 — 编辑已加密书签时自动弹解锁
        const unlocked = await new Promise<boolean>(resolve => {
          e2eStore.pendingUnlock.push(resolve)
        })
        if (unlocked && e2eStore.cryptoKey) {
          bmForm.password = await decryptPasswordWithKey(pw, e2eStore.cryptoKey as CryptoKey)
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
    bmForm.isAiFetching = false
    bmForm.aiFetchedSuccess = false
    bmForm.candidateUsernames = []
    bmForm._autoTitle = ''
    bmForm._autoNotes = ''
    bmForm._autoIcon = ''
    bmForm._autoAttrIds = []
    bmForm._autoCategoryId = ''
    bmForm._autoParentId = null
    bmForm._userEditedTitle = !!editId
    bmForm._userEditedNotes = !!editId
    bmForm._userEditedAttrs = !!editId
    bmForm._userEditedCategory = !!editId
    bmForm._userEditedParent = !!editId || !!bmForm.parentId

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
    if (!url) { toast(t('modal.childBm.needUrl'), false); return }

    // 新建书签时检测重复
    if (!bmForm.id) {
      // 添加子书签时，排除父书签及其祖先（避免父书签被误判为"后缀变体"）
      const { exact, suffix } = findDuplicateBookmarks(url, undefined, bmForm.parentId || undefined)

      // 完全重复：阻止添加
      if (exact) {
        toast(t('msg.urlExistsBookmark', { title: exact.title || t('common.unnamed') }), false)
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
            toast(t('modal.childBm.encryptFail'), false)
            return
          }
          storedPassword = { encrypted: true, salt: parts[0], iv: parts[1], data: parts[2] }
        } catch {
          toast(t('modal.childBm.encryptFailHint'), false)
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
          toast(t('modal.childBm.saveCancelled'), false)
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
      // E2E 密文保护：原书签含加密字段（未解锁 / 解不开保留的密文）时禁止保存——否则
      // 编辑框里 displayText 过滤成的空值会覆盖原密文，并经 saveAppData/push 回写云端
      // 覆盖明文，造成不可逆丢失。须先解锁（decryptStoreItems 解回明文）再编辑。
      const orig = ds.bookmarkMap[bmForm.id]
      if (orig && [orig.url, orig.title, orig.notes, orig.username].some(f => typeof f === 'string' && f && isThreePartCipher(f))) {
        toast(t('modal.childBm.encryptedBlocked'), false)
        return
      }
      ds.updateBookmark(bmForm.id, data)
      toast(t('msg.bookmarkUpdated'))
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
      toast(t('msg.bookmarkAdded'))
    }
    if (bmForm.id) saveAppData()
    closeBmModal()
  } finally {
    _bmSaving = false
  }
}

export function addSub(parentId: string) {
  useUIStore().saveToGroup = null
  const ds = useDataStore()
  const parent = parentId ? ds.bookmarkMap[parentId] : null
  openBmModal()
  bmForm.parentId = parentId
  bmForm._userEditedParent = true
  bmForm.categoryId = parent?.categoryId || ''
  bmForm._userEditedCategory = !!parent?.categoryId
  bmForm.username = ''
  bmForm.password = ''
  bmForm.icon = ''
  bmForm.clearIconVisible = false
  bmForm.iconPreviewVisible = false
  bmForm._autoTitle = ''
  bmForm._autoNotes = ''
  bmForm._autoIcon = ''
  bmForm._userEditedTitle = false
  bmForm._userEditedNotes = false
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

  // 1. 如果用户清空了网址或删减到无效长度（<4），且当前标题/备注是之前自动生成的，顺畅同步清空
  if (!raw || raw.length < 4) {
    if (!bmForm._userEditedTitle && (bmForm.title === bmForm._autoTitle || !bmForm._autoTitle)) {
      bmForm.title = ''
      bmForm._autoTitle = ''
    }
    if (!bmForm._userEditedNotes && (bmForm.notes === bmForm._autoNotes || !bmForm._autoNotes)) {
      bmForm.notes = ''
      bmForm._autoNotes = ''
    }
    if (bmForm.icon === bmForm._autoIcon) {
      bmForm.icon = ''
      bmForm._autoIcon = ''
      bmForm.iconPreviewVisible = false
    }
    if (!bmForm._userEditedAttrs && bmForm._autoAttrIds && bmForm._autoAttrIds.length > 0) {
      for (const aid of bmForm._autoAttrIds) {
        delete bmForm.attributes[aid]
      }
      bmForm._autoAttrIds = []
    }
    if (!bmForm._userEditedCategory) {
      const ui = useUIStore()
      bmForm.categoryId = ui.curCat === CAT_ALL ? CAT_UNCATEGORIZED : ui.curCat
      bmForm._autoCategoryId = ''
    }
    if (!bmForm._userEditedParent && bmForm.parentId === bmForm._autoParentId) {
      bmForm.parentId = null
      bmForm._autoParentId = null
    }
    bmForm.aiSuggestCatId = null
    bmForm.aiSuggestAttrIds = []
    bmForm.logoPreviewVisible = false
    return
  }

  // 2. 纯数字（如 4399、8080）绝对不作为有效域名触发解析，防止被浏览器 DWORD 解析为 0.0.17.47
  if (/^\d+$/.test(raw)) {
    return
  }

  bmForm._fetchTimer = setTimeout(() => {
    const url = fixUrl(raw)
    const dm = domain(url)
    const ds = useDataStore()
    const ui = useUIStore()

    // 智能预填（仅当智能提取与填充开关开启时，精选站点知识库、路径语义化提取、同域名偏好继承、中英文地道匹配）
    const prefill = ui.smartFillEnabled
      ? getSmartPrefill(url, ds.bookmarks, ds.categories, ds.customAttributes)
      : { title: '', notes: '', categoryId: null, suggestedAttrIds: [], suggestedUsername: '', candidateUsernames: [], confidence: 'fallback' as const }

    const candidateTitle = prefill.title || (dm.replace(/^www\./, '').split('.')[0]
      .charAt(0).toUpperCase() + dm.replace(/^www\./, '').split('.')[0].slice(1))

    // 标题：如果当前标题为空，或者当前标题是由上一次自动预填生成且用户未手动修改过，则顺畅替换为新网址标题
    const canUpdateTitle = !bmForm.title.trim() || (!bmForm._userEditedTitle && bmForm.title === bmForm._autoTitle)
    if (canUpdateTitle) {
      bmForm.title = candidateTitle
      bmForm._autoTitle = candidateTitle
    }

    // 简介与备注：如果当前备注为空，或者是由上一次自动预填生成且用户未手动修改过，则顺畅替换为新网址备注
    const canUpdateNotes = !bmForm.notes.trim() || (!bmForm._userEditedNotes && bmForm.notes === bmForm._autoNotes)
    if (canUpdateNotes) {
      bmForm.notes = prefill.notes || ''
      bmForm._autoNotes = prefill.notes || ''
    }
    if (prefill.confidence === 'high' && prefill.title && prefill.notes) {
      bmForm.aiFetchedSuccess = true
    }

    // 常用账号继承：仅在新建且账号为空时自动填入同域名历史账号
    bmForm.candidateUsernames = prefill.candidateUsernames || []
    if (!bmForm.isEdit && !bmForm.username.trim() && prefill.suggestedUsername) {
      bmForm.username = prefill.suggestedUsername
    }

    // 图标：如果未手动指定自定义图标，或与上一自动图标一致，则更新为新图标
    if (!bmForm.icon || bmForm.icon === bmForm._autoIcon) {
      bmForm.icon = favicon(url)
      bmForm._autoIcon = bmForm.icon
      bmForm.iconPreviewVisible = true
      bmForm.iconPreviewUrl = bmForm.icon
      bmForm.clearIconVisible = true
    }

    // Logo 预览
    previewLogo()

    // 智能识别父级书签（新建模式且用户未手动指派父级）
    if (!bmForm.isEdit && !bmForm._userEditedParent) {
      const bestParent = findBestParentBookmark(url, ds.bookmarks, bmForm.id)
      if (bestParent) {
        bmForm.parentId = bestParent.id
        bmForm._autoParentId = bestParent.id

        // 子书签自动继承父书签的分类（用户未手动指派分类时）
        if (!bmForm._userEditedCategory && (!bmForm.categoryId || bmForm.categoryId === CAT_UNCATEGORIZED || bmForm.categoryId === bmForm._autoCategoryId)) {
          if (bestParent.categoryId && bestParent.categoryId !== CAT_UNCATEGORIZED) {
            bmForm.categoryId = bestParent.categoryId
            bmForm._autoCategoryId = bestParent.categoryId
          }
        }
      } else if (bmForm.parentId === bmForm._autoParentId) {
        bmForm.parentId = null
        bmForm._autoParentId = null
      }
    }

    // AI 分类 + 属性建议与真智能预填（仅新建模式）
    if (!bmForm.isEdit && !bmForm.aiApplied) {
      const ruleCatId = suggestCategory(url, bmForm.title, ds.categories)
      const catId = prefill.categoryId || ruleCatId
      if (catId) {
        // 智能选择分类：若当前未手动指派分类，且处于未分类或先前由AI预选的分类
        const canAutoSelectCat = !bmForm._userEditedCategory && (
          !bmForm.categoryId ||
          bmForm.categoryId === CAT_UNCATEGORIZED ||
          bmForm.categoryId === bmForm._autoCategoryId
        )
        if (canAutoSelectCat) {
          bmForm.categoryId = catId
          bmForm._autoCategoryId = catId
          bmForm.aiSuggestCatId = catId
        }
      }
      const attrIds = suggestAttributes(url, bmForm.title, ds.customAttributes)
      const mergedAttrs = [...new Set([...attrIds, ...prefill.suggestedAttrIds])]
      if (mergedAttrs.length) {
        bmForm.aiSuggestAttrIds = mergedAttrs.filter(id => !bmForm.attributes[id])
      }

      // 属性标签真智能预填：用户未手动更改属性时，直接自动勾选匹配到的属性
      if (!bmForm._userEditedAttrs) {
        if (bmForm._autoAttrIds && bmForm._autoAttrIds.length > 0) {
          for (const aid of bmForm._autoAttrIds) {
            delete bmForm.attributes[aid]
          }
        }
        const newAutoAttrs: string[] = []
        for (const aid of mergedAttrs) {
          bmForm.attributes[aid] = true
          newAutoAttrs.push(aid)
        }
        bmForm._autoAttrIds = newAutoAttrs
      }
    }

    // 自动异步发起 Layer 2 真实网页内容与元数据提取（无需用户手动点击）
    if (ui.smartFillEnabled && !bmForm.isEdit) {
      triggerAiFetch(url, false)
    }
  }, 500)
}

let _aiFetchSeq = 0
export async function triggerAiFetch(targetUrl?: string, isManual = false) {
  const raw = targetUrl || bmForm.url.trim()
  if (!raw || raw.length < 4) return
  const url = fixUrl(raw)
  if (!url.startsWith('http') || isPrivateUrl(url)) {
    if (isManual) toast(t('modal.bookmark.aiFetchFail'), false)
    return
  }

  const ds = useDataStore()
  const ui = useUIStore()
  if (!ui.smartFillEnabled) {
    if (isManual) toast(t('modal.bookmark.smartFillDisabledHint'), false)
    return
  }

  const curSeq = ++_aiFetchSeq
  bmForm.isAiFetching = true
  bmForm.aiFetchedSuccess = false

  try {
    const res = await fetchUrlMetadataAsync(url, ds.categories, ds.customAttributes)
    if (curSeq !== _aiFetchSeq || !bmForm.isOpen || fixUrl(bmForm.url.trim()) !== url) {
      return
    }

    if (res.success) {
      bmForm.aiFetchedSuccess = true
      // 真实标题：仅在用户未手动修改过标题时平滑填入
      if (res.title && (!bmForm._userEditedTitle || !bmForm.title.trim() || bmForm.title === bmForm._autoTitle)) {
        bmForm.title = res.title
        bmForm._autoTitle = res.title
      }
      // 真实简介：仅在用户未手动修改过备注时平滑填入真实网页 Description / 摘要
      if (res.notes && (!bmForm._userEditedNotes || !bmForm.notes.trim() || bmForm.notes === bmForm._autoNotes)) {
        bmForm.notes = res.notes
        bmForm._autoNotes = res.notes
      }

      if (!bmForm.isEdit && !bmForm.aiApplied) {
        if (res.categoryId) {
          const canAutoSelectCat = !bmForm._userEditedCategory && (
            !bmForm.categoryId ||
            bmForm.categoryId === CAT_UNCATEGORIZED ||
            bmForm.categoryId === bmForm._autoCategoryId
          )
          if (canAutoSelectCat) {
            bmForm.categoryId = res.categoryId
            bmForm._autoCategoryId = res.categoryId
            bmForm.aiSuggestCatId = res.categoryId
          }
        }
        if (res.suggestedAttrIds && res.suggestedAttrIds.length > 0) {
          const merged = [...new Set([...bmForm.aiSuggestAttrIds, ...res.suggestedAttrIds])]
          bmForm.aiSuggestAttrIds = merged.filter((id) => !bmForm.attributes[id])

          // 属性标签真智能预填更新
          if (!bmForm._userEditedAttrs) {
            if (bmForm._autoAttrIds && bmForm._autoAttrIds.length > 0) {
              for (const aid of bmForm._autoAttrIds) {
                delete bmForm.attributes[aid]
              }
            }
            const newAutoAttrs: string[] = []
            for (const aid of merged) {
              bmForm.attributes[aid] = true
              newAutoAttrs.push(aid)
            }
            bmForm._autoAttrIds = newAutoAttrs
          }
        }
      }
      if (isManual) {
        toast(t('modal.bookmark.aiFetchSuccess'), true)
      }
    } else if (isManual) {
      toast(t('modal.bookmark.aiFetchFail'), false)
    }
  } catch {
    if (isManual) toast(t('modal.bookmark.aiFetchFail'), false)
  } finally {
    if (curSeq === _aiFetchSeq) {
      bmForm.isAiFetching = false
    }
  }
}

/** 应用 AI 建议的分类 */
export function applyAiCategory() {
  if (bmForm.aiSuggestCatId) {
    bmForm.categoryId = bmForm.aiSuggestCatId
    bmForm.aiSuggestCatId = null
    bmForm._userEditedCategory = true
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
    toastWithUndo(t('msg.bookmarkDeleted'), () => {
      ids.forEach(bid => ds.restoreBookmark(bid))
      debouncedSaveAppData()
      toast(t('deadlinks.restored'))
    })
  }
  if (skipConfirm) doDelete()
  else if (await showConfirm(t('msg.confirmDeleteBookmark', { title: bm.title || t('common.unnamed') }))) doDelete()
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
    toast(t('msg.dataNotReady'), false)
    return false
  }
  const ds = useDataStore()
  const safeUrl = fixUrl(url)
  if (!safeUrl) {
    toast(t('msg.cannotSaveLink'), false)
    return false
  }

  // 检测完全重复的URL
  const { exact } = findDuplicateBookmarks(safeUrl)
  if (exact) {
    toast(t('msg.urlExistsBookmark', { title: exact.title || t('common.unnamed') }), false)
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
    icon: favicon(safeUrl),
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
  toastWithUndo(t('msg.savedToBookmarks'), () => {
    ds.deleteBookmark(newBm.id)
    debouncedSaveAppData()
    toast(t('msg.undone'))
  })

  return true
}

/**
 * 显示后缀变体URL的选择弹窗
 * 让用户选择：成为已有书签的子书签、作为顶级书签添加、或取消
 */
async function showSuffixVariantDialog(existingBookmark: Bookmark, newUrl: string): Promise<'child' | 'sibling' | 'cancel'> {
  const existingTitle = existingBookmark.title || t('common.unnamed')
  const existingDomain = domain(existingBookmark.url)
  const newDomain = domain(newUrl)

  // 构建选项
  const options = [
    {
      id: 'child',
      label: t('msg.dupeChildLabel', { title: existingTitle }),
      description: t('msg.dupeChildDesc'),
    },
    {
      id: 'sibling',
      label: t('msg.dupeSiblingLabel'),
      description: t('msg.dupeSiblingDesc'),
    },
  ]

  // 构建消息
  let message = t('msg.dupeFound', { title: existingTitle })
  if (existingDomain === newDomain) {
    message += t('msg.dupeSameDomain')
  } else {
    message += t('msg.dupeSimilar')
  }
  message += t('msg.dupeHowProceed')

  const result = await showChoice(message, options, t('common.cancel'))

  if (result === 'child') return 'child'
  if (result === 'sibling') return 'sibling'
  return 'cancel'
}
