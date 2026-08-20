<template>
  <div ref="cardEl" class="card" :class="{ 'card-expanded': isExpanded, 'acct-open': acctOpen, 'batch-mode': uiStore.batchMode }"
       role="listitem" :aria-label="bookmark.title"
       :data-id="bookmark.id" :draggable="!uiStore.isMobile"
       :tabindex="listKeyboardNav ? 0 : undefined"
       @click="onCardClick" @keydown="onCardKeydown">
     <input v-if="uiStore.batchMode" type="checkbox" class="batch-chk"
            :id="'batchChk_' + bookmark.id" :checked="isSelected"
            @change.stop @click.stop="toggleSelect">
    <div class="card-topline">
      <div class="card-toprow">
        <div class="card-logo" title="打开链接" @click.stop="onOpenClick">
          <img v-if="iconSrc" :src="iconSrc" alt="" @error="onImgError">
          <span class="card-logo-fallback">{{ displayText(bookmark.title).charAt(0) || '?' }}</span>
        </div>
        <div class="card-titlewrap" title="打开链接" @click.stop="onOpenClick">
          <div class="card-titlewrap-text">
            <div class="card-name">
              <span v-if="searchQuery" v-html="hlTitle"></span>
              <template v-else>{{ displayText(bookmark.title) }}</template>
              <span v-if="isDeadLink" class="dead-link-badge" title="链接已失效">失效</span>
              <span v-if="isGfwBlocked" class="gfw-blocked-badge" title="疑似被墙">被墙</span>
              <span v-if="isUnconfirmed" class="unconfirmed-badge" title="本次检测未能确认（离线/超时/信号冲突）">未确认</span>
              <span v-if="isPinned" class="pinned-badge" title="已置顶" v-html="I.pin"></span>
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
        <span class="card-tag tag-custom" v-for="(t, i) in tagNames" :key="t + '-' + i" @click.stop="filterByTagName(t)">{{ t }}</span>
      </div>
    </div>
    <div class="card-body">
      <div class="card-tags" v-if="tagNames.length && uiStore.layoutMode !== 'list'">
        <span class="card-tag tag-custom" v-for="(t, i) in tagNames" :key="t + '-' + i" @click.stop="filterByTagName(t)">{{ t }}</span>
      </div>
      <div class="card-notes" v-if="bookmark.notes" @dblclick.stop="uiStore.layoutMode !== 'list' && editNotes($event)">
        <span v-if="searchQuery" v-html="hlNotes"></span>
        <template v-else>{{ displayText(bookmark.notes) }}</template>
      </div>
      <template v-if="displayText(bookmark.username) || bookmark.password">
          <button class="card-acct-toggle" :class="{ open: acctOpen || isExpanded }" @click.stop="acctOpen = !acctOpen">
            <span aria-hidden="true" v-html="I.chevronDown"></span> 账户信息
          </button>
        <div class="card-acct-body" :class="{ show: acctOpen || isExpanded }">
          <div class="acct-row" v-if="displayText(bookmark.username)">
            <span class="acct-label">账户</span><span class="acct-val">{{ displayText(bookmark.username) }}</span>
            <button class="acct-copy-btn" @click.stop="copyUser" title="复制" v-html="I.copy"></button>
          </div>
          <div class="acct-row" v-if="bookmark.password">
            <span class="acct-label">密码</span><span class="acct-val">{{ isVisible(bookmark.id) ? decodedPw : '••••••' }}</span>
            <button class="acct-show-pw" @click.stop="onTogglePw" :title="isVisible(bookmark.id) ? '隐藏密码' : '显示密码'" :aria-label="isVisible(bookmark.id) ? '隐藏密码' : '显示密码'" v-html="isVisible(bookmark.id) ? I.eyeOff : I.eye"></button>
            <button class="acct-copy-btn" @click.stop="copyPw" title="复制" v-html="I.copy"></button>
          </div>
        </div>
      </template>
      <div class="sub-sites" v-if="children.length">
        <span class="group-inline-card" v-for="sub in children" :key="sub.id" contenteditable="false" :data-bm-id="sub.id" :draggable="!uiStore.isMobile" @click.stop="visitSub(sub)">
          <img :src="favicon(sub.url, sub.icon)" alt="" @error="onSubImgError($event, sub.title)">
          <span class="gic-name">{{ sub.title }}</span>
          <span class="gic-btn" @click.stop="doOpenDetail(sub.id)">详</span>
        </span>
      </div>
      <div class="card-preview" v-if="previewText">{{ previewText }}</div>
    </div>
    <div class="card-foot">
      <span class="card-stat"><span aria-hidden="true" v-html="I.click"></span> {{ bookmark.useCount || 0 }}次</span>
      <span class="card-actions">
        <button v-if="!bookmark.parentId" class="btn-xs" @click.stop="doAddSub" title="添加子网站" v-html="I.plus"></button>
        <button class="btn-xs" @click.stop="edit" title="编辑" v-html="I.edit"></button>
        <button class="btn-xs btn-danger" @click.stop="del" title="删除" v-html="I.trash"></button>
      </span>
    </div>
    <button v-if="hasExpandableContent && uiStore.layoutMode === 'list' && !uiStore.isMobile" class="list-expand-btn" @click.stop="toggleExpand" :title="isExpanded ? '收起' : '展开'" :aria-label="isExpanded ? '收起' : '展开'" :aria-expanded="isExpanded" v-html="I.chevronDown"></button>
    <button v-if="uiStore.layoutMode === 'list' && !uiStore.batchMode && uiStore.isMobile" class="card-menu-btn" @click.stop="openMenu" title="详情" v-html="I.dotsV"></button>
    <div v-if="uiStore.batchMode && uiStore.isMobile && uiStore.layoutMode !== 'mini-grid'" class="batch-drag-handle" v-html="I.grip"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { favicon, getTagNames, copyToClipboard, domain, displayText, stripEntranceAnim, faviconInitials } from '../../utils.js'
import { I } from '../../config/icons.js'
import { decryptPasswordWithKey } from '../../crypto.js'
import { highlight } from './highlight.js'
import { usePasswordVisibility } from '../../composables/ui/usePasswordVisibility.js'
import { useCardOverflow } from '../../composables/ui/useCardOverflow.js'
import { openBmModal, deleteBookmarkWithUndo, addSub, openBookmark } from '../../composables/domain/useBookmark.js'
import { toggleAttrFilter } from '../../composables/domain/useAttrFilter.js'
import { openDetail } from '../../composables/ui/useUI.js'
import { toast } from '../../lib/toast.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useE2EStore } from '../../stores/e2e.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { useInlineEdit } from '../../composables/ui/useInlineEdit.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { bookmarkPreview } from '../../lib/preview.js'
import { handleListCardKeydown } from '../../composables/interaction/listCardKeyboard.js'
import type { Bookmark } from '../../types.js'

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
})
const dataStore = useDataStore()
const uiStore = useUIStore()
const cardEl = ref(null)
// useCardOverflow 副作用：给 .card-body 加 .card-overflow 类驱动淡出遮罩，返回值此处不消费
useCardOverflow(cardEl)
const acctOpen = ref(props.defaultAcctOpen)
const decodedPw = ref('')
const { isVisible, toggle: togglePw } = usePasswordVisibility()
const e2eStore = useE2EStore()
const deadLinkChecker = useDeadLinkChecker()

// 密码展示用：string 形态（E2E 未启 / 旧 base64）走 safeDecodePassword（同步）；
// EncryptedPassword 对象形态（E2E 解锁时 saveBm 存的对象）需用已就绪的 e2e cryptoKey 解密。
// 旧实现仅判 typeof === 'string'，对象态直接落空串 → 小眼睛点开后密码区显示空白，
// 原本 '••••••' 占位也没了，看上去像「点眼睛把点删了」。此处按形态分支解密。
async function decodePassword() {
  // A1-004：E2E 锁定时禁止 decode 旧 base64/string 明文路径
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
// E2E 解锁后会补解密 store 密文条目（decryptStoreItems），但 password 是 EncryptedPassword
// 对象态不在 ENCRYPT_FIELDS 里、不会被补解密扫到。解锁瞬间 key 入内存，重算一次 decodedPw，
// 此后点眼睛才能看到对象态密码的明文；未解锁时 cryptoKey 仍空，decodePassword 安全返回 ''。
watch(() => e2eStore.isUnlocked, decodePassword)
watch(() => e2eStore.isE2EEnabled, decodePassword)

const domainStr = computed(() => domain(props.bookmark.url))
const iconSrc = computed(() => favicon(props.bookmark.url, props.bookmark.icon))
const tagNames = computed(() => getTagNames(props.bookmark, dataStore.customAttributes))
const children = computed(() => dataStore.childrenMap[props.bookmark.id] || [])
const hasExpandableContent = computed(() => !!(displayText(props.bookmark.username) || props.bookmark.password || children.value.length))
const previewText = computed(() => bookmarkPreview(props.bookmark))
const isExpanded = computed(() => uiStore.layoutMode === 'list' && uiStore.expandedIds.includes(props.bookmark.id) && !uiStore.batchMode)
const isSelected = computed(() => (uiStore.batchSelected ?? []).includes(props.bookmark.id))
const isDeadLink = computed(() => !!props.bookmark.attributes?.['dead-link'])
const isGfwBlocked = computed(() => !!props.bookmark.attributes?.['gfw-blocked'])
// 未确认：只有本次检测结果为 inconclusive 时出现，不读 attributes（attributes 不存 inconclusive）
const isUnconfirmed = computed(() => deadLinkChecker.isUnconfirmed(props.bookmark.id))
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
function doOpenDetail(bmId: string) { openDetail(bmId) }
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
  })
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
  // E2E 密文（未解锁/解不开）复制无意义，提示解锁而非把空/密文写进剪贴板
  if (v && !displayText(v)) { toast('该字段已加密，请先解锁主密码', false); return }
  copyToClipboard(v, '账户')
}
// 未解锁时 password 为 EncryptedPassword 对象、decryptPasswordWithKey 解不开返 ''；
// 旧实现照常 copyToClipboard('') → utils toast「密码 已复制」误导用户以为复制成功，
// 实则剪贴板是空串。先判 decodedPw 非空再复制，空就提示无法复制、不污染剪贴板。
function copyPw() {
  // A1-004：锁定态禁止复制
  if (e2eStore.isE2EEnabled && !e2eStore.isUnlocked) {
    toast('请先解锁主密码', false)
    return
  }
  if (!decodedPw.value) { toast('密码未解锁，无法复制', false); return }
  copyToClipboard(decodedPw.value, '密码')
}

function onTogglePw() {
  if (e2eStore.isE2EEnabled && !e2eStore.isUnlocked) {
    toast('请先解锁主密码', false)
    return
  }
  togglePw(props.bookmark.id)
}

const { startEditing } = useInlineEdit()

function editNotes(e: Event) {
  const v = props.bookmark.notes ?? ''
  // E2E 密文不进入内联编辑：编辑会拿密文当明文覆盖（saveAppData/push 回写），数据风险
  if (v && !displayText(v)) { toast('该字段已加密，请先解锁主密码', false); return }
  startEditing(e.currentTarget as HTMLElement, v, {
    multiline: true,
    onSave(newNotes) {
      if (newNotes !== (props.bookmark.notes ?? '')) {
        dataStore.updateBookmark(props.bookmark.id, { notes: newNotes })
        debouncedSaveAppData()
        toast('备注已更新')
      }
    },
  })
}
</script>