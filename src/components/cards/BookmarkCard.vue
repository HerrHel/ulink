<template>
  <div ref="cardEl" class="card" :class="{ 'card-expanded': isExpanded, 'acct-open': acctOpen, 'batch-mode': uiStore.batchMode }"
       role="listitem" :aria-label="bookmark.title"
       :data-id="bookmark.id" :draggable="!uiStore.isMobile && !isShareReadonly"
       :tabindex="listKeyboardNav ? 0 : undefined"
       @click="onCardClick" @keydown="onCardKeydown">
     <input v-if="uiStore.batchMode" type="checkbox" class="batch-chk"
            :id="'batchChk_' + bookmark.id" :checked="isSelected"
            :aria-label="bookmark.title"
            @change.stop @click.stop="toggleSelect">
    <div class="card-topline">
      <div class="card-toprow">
        <div class="card-logo" :title="t('cards.openLink')" @click.stop="onOpenClick">
          <BrandLogo v-if="isOfficialBrand" :size="28" />
          <template v-else>
            <img v-if="iconSrc" :src="iconSrc" alt="" loading="lazy" decoding="async" :class="{ 'img-loaded': imgLoaded, 'dark-invert': isDarkInvert }" @load="onImgLoad" @error="onImgError">
            <span class="card-logo-fallback">{{ displayText(bookmark.title).charAt(0) || '?' }}</span>
          </template>
        </div>
        <div class="card-titlewrap" :title="t('cards.openLink')" @click.stop="onOpenClick">
          <div class="card-titlewrap-text">
            <div class="card-name">
              <span v-if="searchQuery" v-html="hlTitle"></span>
              <template v-else>{{ displayText(bookmark.title) }}</template>
              <span v-if="linkStatus === 'dead'" class="dead-link-badge" :title="t('cards.deadLinkTitle')">{{ t('cards.deadLink') }}</span>
              <span v-else-if="linkStatus === 'gfw'" class="gfw-blocked-badge" :title="t('cards.gfwBlockedTitle')">{{ t('cards.gfwBlocked') }}</span>
              <span v-if="isPinned" class="pinned-badge" :title="t('cards.pinned')" v-html="I.pin"></span>
            </div>
            <div class="card-domain">
              <span v-if="searchQuery" v-html="hlDomain"></span>
              <template v-else>{{ domainStr }}</template>
            </div>
          </div>
          <span class="card-open-hint" aria-hidden="true" v-html="I.external"></span>
        </div>
      </div>
      <div class="card-domain mini-domain" v-if="uiStore.layoutMode === 'mini-grid'">{{ domainStr }}</div>
      <div class="card-tags" v-if="tagNames.length && uiStore.layoutMode === 'list'">
        <span class="card-tag tag-custom" v-for="(tag, i) in tagNames" :key="tag + '-' + i" @click.stop="filterByTagName(tag)">{{ tag }}</span>
      </div>
    </div>
    <div class="card-body">
      <div class="card-tags" v-if="tagNames.length && uiStore.layoutMode !== 'list'">
        <span class="card-tag tag-custom" v-for="(tag, i) in tagNames" :key="tag + '-' + i" @click.stop="filterByTagName(tag)">{{ tag }}</span>
      </div>
      <div class="card-notes" v-if="bookmark.notes" @dblclick.stop="!isShareReadonly && uiStore.layoutMode !== 'list' && editNotes($event)">
        <span v-if="searchQuery" v-html="hlNotes"></span>
        <template v-else>{{ displayText(bookmark.notes) }}</template>
      </div>
      <template v-if="displayText(bookmark.username) || bookmark.password">
          <button class="card-acct-toggle" :class="{ open: acctOpen || isExpanded }" @click.stop="acctOpen = !acctOpen">
            <span aria-hidden="true" v-html="I.chevronDown"></span> {{ t('cards.accountInfo') }}
          </button>
        <div class="card-acct-body" :class="{ show: acctOpen || isExpanded }">
          <div class="acct-row" v-if="displayText(bookmark.username)">
            <span class="acct-label">{{ t('cards.account') }}</span>
            <span class="acct-val">
              <template v-if="e2eStore.isE2EEnabled && !e2eStore.isUnlocked">
                <span class="e2e-locked-inline" :title="t('cards.encryptedFieldLocked')">***</span>
              </template>
              <template v-else>{{ displayText(bookmark.username) }}</template>
            </span>
            <button class="acct-copy-btn" :class="{ copied: userCopied }" @click.stop="copyUser" :title="t('common.copy')" :aria-label="t('common.copy')" v-html="userCopied ? I.check : I.copy"></button>
          </div>
          <div class="acct-row" v-if="bookmark.password">
            <span class="acct-label">{{ t('cards.password') }}</span><span class="acct-val">{{ isVisible(bookmark.id) ? decodedPw : '••••••' }}</span>
            <button class="acct-show-pw" @click.stop="onTogglePw" :title="isVisible(bookmark.id) ? t('cards.hidePassword') : t('cards.showPassword')" :aria-label="isVisible(bookmark.id) ? t('cards.hidePassword') : t('cards.showPassword')" v-html="isVisible(bookmark.id) ? I.eyeOff : I.eye"></button>
            <button class="acct-copy-btn" :class="{ copied: pwCopied }" @click.stop="copyPw" :title="t('common.copy')" :aria-label="t('common.copy')" v-html="pwCopied ? I.check : I.copy"></button>
          </div>
        </div>
      </template>
      <div class="sub-sites" v-if="children.length">
        <span class="group-inline-card" v-for="sub in children" :key="sub.id" contenteditable="false" :data-bm-id="sub.id" :draggable="!uiStore.isMobile" @click.stop="visitSub(sub)">
          <BrandLogo v-if="isOfficialSubBrand(sub)" :size="16" />
          <img v-else :src="subIconSrc(sub)" alt="" :class="{ 'dark-invert': isSubDarkInvert(sub) }" @load="onSubImgLoad($event, sub)" @error="onSubImgError($event, sub.title)">
          <span class="gic-name">{{ displayText(sub.title) }}</span>
          <span v-if="!isShareReadonly" class="gic-btn" @click.stop="doOpenDetail(sub.id)">{{ t('cards.detailBtn') }}</span>
        </span>
      </div>
      <div class="card-preview" v-if="!detailMode && previewText">{{ previewText }}</div>
    </div>
    <div class="card-foot" v-if="!isShareReadonly">
      <span v-if="(bookmark.useCount || 0) > 0" class="card-stat"><span aria-hidden="true" v-html="I.click"></span> {{ tN('cards.useCount', bookmark.useCount || 0) }}</span>
      <span class="card-actions">
        <button v-if="!bookmark.parentId" class="btn-xs" @click.stop="doAddSub" :title="t('cards.addSubSite')" :aria-label="t('cards.addSubSite')" v-html="I.plus"></button>
        <button class="btn-xs" @click.stop="edit" :title="t('common.edit')" :aria-label="t('common.edit')" v-html="I.edit"></button>
        <button class="btn-xs btn-danger" @click.stop="del" :title="t('common.delete')" :aria-label="t('common.delete')" v-html="I.trash"></button>
      </span>
    </div>
    <button v-if="!detailMode && hasExpandableContent && uiStore.layoutMode === 'list' && (!uiStore.isMobile || isShareReadonly)" class="list-expand-btn" @click.stop="toggleExpand" :title="isExpanded ? t('cards.collapse') : t('cards.expand')" :aria-label="isExpanded ? t('cards.collapse') : t('cards.expand')" :aria-expanded="isExpanded" v-html="I.chevronDown"></button>
    <button v-if="!detailMode && uiStore.layoutMode === 'list' && !uiStore.batchMode && uiStore.isMobile" class="card-menu-btn" @click.stop="openMenu" :title="t('cards.details')" :aria-label="t('cards.details')" v-html="I.dotsV"></button>
    <div v-if="uiStore.batchMode && uiStore.isMobile && uiStore.layoutMode !== 'mini-grid'" class="batch-drag-handle" v-html="I.grip"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { favicon, getTagNames, copyToClipboard, domain, displayText, stripEntranceAnim, faviconInitials, isDarkInvertSite, getOfficialDarkIcon } from '../../utils.js'
import { analyzeImageElement } from '../../lib/iconAnalyzer.js'
import { I } from '../../config/icons.js'
import { decryptPasswordWithKey } from '../../crypto.js'
import { highlight } from './highlight.js'
import { usePasswordVisibility } from '../../composables/ui/usePasswordVisibility.js'
import { useCardOverflow } from '../../composables/ui/useCardOverflow.js'
import { openBmModal, deleteBookmarkWithUndo, addSub, openBookmark } from '../../composables/domain/useBookmark.js'
import { toggleAttrFilter } from '../../composables/domain/useAttrFilter.js'
import { openDetail, openQuickLook } from '../../composables/ui/useUI.js'
import { toast } from '../../lib/toast.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useE2EStore } from '../../stores/e2e.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { useInlineEdit } from '../../composables/ui/useInlineEdit.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { bookmarkPreview } from '../../lib/preview.js'
import { handleListCardKeydown } from '../../composables/interaction/listCardKeyboard.js'
import { useListNav } from '../../composables/useListNav.js'
import { t, tN } from '../../i18n/index.js'
import type { Bookmark } from '../../types.js'
import BrandLogo from '../ui/BrandLogo.vue'
import { OFFICIAL_SITE_BM_ID, OFFICIAL_SITE_LANDING_ID, OFFICIAL_SITE_APP_ID } from '../../stores/dataActionsBookmarks.js'

function onImgError(e: Event) {
  (e.target as HTMLImageElement).classList.add('img-error')
}

// 子书签图标加载失败时降级为首字母占位，避免破图
function onSubImgError(e: Event, name?: string) {
  const img = e.target as HTMLImageElement
  if (!img.dataset.fallback) {
    img.dataset.fallback = '1'
    img.src = faviconInitials(name)
  }
}

const props = defineProps({
  bookmark: { type: Object as () => Bookmark, required: true },
  // 辅助栏场景下账户信息默认展开（大宫格/列表仍默认折叠）
  defaultAcctOpen: { type: Boolean, default: false },
  // 详情/抽屉模式（CornerInspector 等场景）：隐藏列表专用的展开收起、⋯更多菜单与纯文本摘要，避免双重 notes 渲染与未受限尺寸图标撑破
  detailMode: { type: Boolean, default: false },
})
const dataStore = useDataStore()
const uiStore = useUIStore()
const listNav = useListNav()
/** 分享只读态：隐藏一切写操作（编辑/删除/加子书签/拖拽/双击改笔记） */
const isShareReadonly = computed(() => !!uiStore.shareMode)
const cardEl = ref(null)
// useCardOverflow 副作用：给 .card-body 加 .card-overflow 类驱动淡出遮罩，返回值此处不消费
useCardOverflow(cardEl)
const acctOpen = ref(props.defaultAcctOpen)
const imgLoaded = ref(false)
const userCopied = ref(false)
const pwCopied = ref(false)
const decodedPw = ref('')
let userTimer: ReturnType<typeof setTimeout> | null = null
let pwTimer: ReturnType<typeof setTimeout> | null = null
const { isVisible, toggle: togglePw } = usePasswordVisibility()
const e2eStore = useE2EStore()
const deadLinkChecker = useDeadLinkChecker()

// 密码展示用：按需解密以降低明文在内存中的暴露面并提升海量列表挂载性能。
async function decodePassword() {
  if (e2eStore.isE2EEnabled && !e2eStore.isUnlocked) {
    decodedPw.value = ''
    return
  }
  decodedPw.value = await decryptPasswordWithKey(
    props.bookmark.password,
    e2eStore.cryptoKey as CryptoKey | null,
  )
}

onMounted(() => {
  decodePassword()
  stripEntranceAnim(cardEl.value)
})
watch(() => props.bookmark.password, decodePassword)
watch(() => e2eStore.isUnlocked, decodePassword)
watch(() => e2eStore.isE2EEnabled, decodePassword)

const domainStr = computed(() => domain(props.bookmark.url))
const isOfficialBrand = computed(() =>
  props.bookmark.id === OFFICIAL_SITE_BM_ID || props.bookmark.icon === '/logo.svg' || props.bookmark.icon === '/favicon.svg'
)
function isOfficialSubBrand(sub: Bookmark): boolean {
  return sub.id === OFFICIAL_SITE_LANDING_ID || sub.id === OFFICIAL_SITE_APP_ID || sub.icon === '/logo.svg' || sub.icon === '/favicon.svg'
}
const isDark = computed(() => uiStore.themeColor === 'dark')
const officialDarkIcon = computed(() => {
  if (!isDark.value) return ''
  return props.bookmark.iconDark || getOfficialDarkIcon(props.bookmark.url) || ''
})
const iconSrc = computed(() => {
  if (officialDarkIcon.value) return officialDarkIcon.value
  return favicon(props.bookmark.url, props.bookmark.icon)
})
const dynamicInvert = ref<boolean | null>(null)
const isDarkInvert = computed(() => {
  // 梯队 1：命中官方原生深色图标时直接呈现原画，绝对不反色
  if (officialDarkIcon.value) return false
  if (dynamicInvert.value !== null) return dynamicInvert.value
  return isDarkInvertSite(props.bookmark.url, iconSrc.value, props.bookmark.attributes)
})

function onImgLoad(e: Event) {
  imgLoaded.value = true
  if (officialDarkIcon.value) return
  const img = e.target as HTMLImageElement
  if (img) {
    analyzeImageElement(img, (shouldInvert) => {
      dynamicInvert.value = shouldInvert
    })
  }
}

function subOfficialDark(sub: Bookmark): string {
  if (!isDark.value) return ''
  return sub.iconDark || getOfficialDarkIcon(sub.url) || ''
}
function subIconSrc(sub: Bookmark): string {
  const dark = subOfficialDark(sub)
  if (dark) return dark
  return favicon(sub.url, sub.icon)
}
const subInvertMap = ref<Record<string, boolean>>({})
function isSubDarkInvert(sub: Bookmark): boolean {
  if (subOfficialDark(sub)) return false
  if (subInvertMap.value[sub.id] !== undefined) return subInvertMap.value[sub.id]
  return isDarkInvertSite(sub.url, sub.icon, sub.attributes)
}
function onSubImgLoad(e: Event, sub: Bookmark) {
  if (subOfficialDark(sub)) return
  const img = e.target as HTMLImageElement
  if (img) {
    analyzeImageElement(img, (shouldInvert) => {
      subInvertMap.value[sub.id] = shouldInvert
    })
  }
}
const tagNames = computed(() => getTagNames(props.bookmark, dataStore.customAttributes))
const children = computed(() => dataStore.childrenMap[props.bookmark.id] || [])
const hasExpandableContent = computed(() => !!(displayText(props.bookmark.username) || props.bookmark.password || children.value.length))
const previewText = computed(() => bookmarkPreview(props.bookmark))
const isExpanded = computed(() => uiStore.layoutMode === 'list' && uiStore.expandedIds.includes(props.bookmark.id) && !uiStore.batchMode)
const isSelected = computed(() => (uiStore.batchSelected ?? []).includes(props.bookmark.id))
const linkStatus = computed<'dead' | 'gfw' | 'normal'>(() => {
  const r = deadLinkChecker.getResult(props.bookmark.id)
  if (r) {
    if (r.verdict === 'dead') return 'dead'
    if (r.verdict === 'gfw') return 'gfw'
    if (r.verdict === 'alive') return 'normal'
    // inconclusive 是内部状态，**不产出任何可见徽标**：
    // 若有持久化的既有标就维持原标，否则等同于「没测出结果」——什么都不显示。
    // 显示「未确认」会把检测的不确定性转嫁给用户，反而降低信任。
    if (props.bookmark.attributes?.['dead-link']) return 'dead'
    if (props.bookmark.attributes?.['gfw-blocked']) return 'gfw'
    return 'normal'
  }
  if (props.bookmark.attributes?.['dead-link']) return 'dead'
  if (props.bookmark.attributes?.['gfw-blocked']) return 'gfw'
  return 'normal'
})
const isPinned = computed(() => !!props.bookmark.pinnedAt)
const searchQuery = computed(() => (uiStore.searchQuery || '').trim())

// 搜索高亮：旧实现模板内直接 v-html="hlText(...)" 非缓存，每次重渲染（滚动/批量切换/
// 账户展开等无关变更）都对 title/domain/notes 各 new RegExp + 正则循环。改用 computed 缓存
// 三个高亮串；regex 提到 searchQuery 级 computed 共用，避免 N 张卡 ×3 字段重复编译正则。
const hlRegex = computed<RegExp | null>(() => {
  const q = searchQuery.value
  if (!q) return null
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, 'gi')
})
const hlTitle = computed(() => hlRegex.value ? highlight(displayText(props.bookmark.title), hlRegex.value) : '')
const hlDomain = computed(() => hlRegex.value ? highlight(domainStr.value, hlRegex.value) : '')
const hlNotes = computed(() => hlRegex.value && props.bookmark.notes ? highlight(displayText(props.bookmark.notes), hlRegex.value) : '')

function visit() { openBookmark(props.bookmark) }
function onOpenClick() {
  if (uiStore.batchMode) { toggleSelect(); return }
  visit()
}
function edit() { openBmModal(props.bookmark.id) }
function del() { deleteBookmarkWithUndo(props.bookmark.id) }
function doAddSub() { addSub(props.bookmark.id) }
function doOpenDetail(bmId: string) { openQuickLook(bmId) }
function visitSub(sub: Bookmark) { openBookmark(sub) }
function openMenu() { openDetail(props.bookmark.id) }
function toggleSelect() { const id = props.bookmark.id; const sel = uiStore.batchSelected; const idx = sel.indexOf(id); if (idx > -1) sel.splice(idx, 1); else sel.push(id) }
function toggleExpand() { uiStore.toggleExpanded(props.bookmark.id) }
// 完整分区：PC 列表可键盘聚焦；Enter 打开，Space 详情，→/← 展开收起；空白单击主操作
const listKeyboardNav = computed(() => uiStore.layoutMode === 'list' && !uiStore.isMobile && !uiStore.batchMode)
// 列表空白区排除：按钮/标签/标题/logo 等已有独立行为
const LIST_INTERACTIVE_SEL = 'button, input, .btn-xs, .card-actions, .card-logo, .card-titlewrap, [contenteditable="true"], .gic-btn, .gic-remove, .gic-name, .acct-copy-btn, .acct-show-pw, .list-expand-btn, .card-menu-btn, .card-tag, .card-acct-toggle, .acct-row'

function onCardClick(e: MouseEvent) {
  if (uiStore.batchMode) { toggleSelect(); return }
  if (uiStore.layoutMode === 'mini-grid') { visit(); return }
  if (uiStore.layoutMode !== 'list') return
  if ((e.target as HTMLElement).closest(LIST_INTERACTIVE_SEL)) return
  // 列表（PC/移动端一致）：展开态点空白收起；折叠态点空白 = 主操作（打开网页）。
  // 与 mini-grid / 移动端行为对齐，详情改由「⋯」/右键/键盘 Space 显式触发。
  if (isExpanded.value) { toggleExpand(); return }
  visit()
  // 便于紧接着用键盘继续操作
  ;(cardEl.value as HTMLElement | null)?.focus({ preventScroll: true })
}

function onCardKeydown(e: KeyboardEvent) {
  if (!listKeyboardNav.value) return
  const action = handleListCardKeydown(e, cardEl.value as HTMLElement | null, {
    canExpand: hasExpandableContent.value,
    expanded: isExpanded.value,
  }, listNav.value ?? undefined)
  if (action.type === 'primary') visit()
  else if (action.type === 'detail') openDetail(props.bookmark.id)
  else if (action.type === 'expand' || action.type === 'collapse' || action.type === 'toggleExpand') toggleExpand()
}
function filterByTagName(name: string) {
  const attr = dataStore.attributeByName[name]
  if (attr) toggleAttrFilter(attr.id)
}
function copyUser() {
  const v = props.bookmark.username || ''
  if (e2eStore.isE2EEnabled && !e2eStore.isUnlocked) { toast(t('cards.encryptedFieldLocked'), false); return }
  // E2E 密文（未解锁/解不开）复制无意义，提示解锁而非把空/密文写进剪贴板
  if (v && !displayText(v)) { toast(t('cards.encryptedFieldLocked'), false); return }
  copyToClipboard(v, t('cards.account'))
  userCopied.value = true
  if (userTimer) clearTimeout(userTimer)
  userTimer = setTimeout(() => { userCopied.value = false }, 1200)
}

async function copyPw() {
  // A1-004：锁定态禁止复制
  if (e2eStore.isE2EEnabled && !e2eStore.isUnlocked) {
    toast(t('cards.unlockMasterPasswordFirst'), false)
    return
  }
  if (!decodedPw.value) await decodePassword()
  if (!decodedPw.value) { toast(t('cards.passwordLockedNoCopy'), false); return }
  copyToClipboard(decodedPw.value, t('cards.password'))
  pwCopied.value = true
  if (pwTimer) clearTimeout(pwTimer)
  pwTimer = setTimeout(() => { pwCopied.value = false }, 1200)
}

function onTogglePw() {
  if (e2eStore.isE2EEnabled && !e2eStore.isUnlocked) {
    toast(t('cards.unlockMasterPasswordFirst'), false)
    return
  }
  togglePw(props.bookmark.id)
  if (isVisible(props.bookmark.id) && !decodedPw.value) {
    void decodePassword()
  }
}

const { startEditing } = useInlineEdit()

function editNotes(e: Event) {
  const v = props.bookmark.notes ?? ''
  // E2E 密文不进入内联编辑：编辑会拿密文当明文覆盖（saveAppData/push 回写），数据风险
  if (v && !displayText(v)) { toast(t('cards.encryptedFieldLocked'), false); return }
  startEditing(e.currentTarget as HTMLElement, v, {
    multiline: true,
    onSave(newNotes) {
      if (newNotes !== (props.bookmark.notes ?? '')) {
        dataStore.updateBookmark(props.bookmark.id, { notes: newNotes })
        debouncedSaveAppData()
        toast(t('cards.notesUpdated'))
      }
    },
  })
}

onBeforeUnmount(() => {
  if (userTimer) {
    clearTimeout(userTimer)
    userTimer = null
  }
  if (pwTimer) {
    clearTimeout(pwTimer)
    pwTimer = null
  }
})
</script>