<template>
  <div v-if="isFocused" class="focus-card-wrap">
    <div class="card group-card group-card-focus" :data-group-id="group.id">
      <div class="group-card-accent"></div>
      <div class="group-card-head">
        <div class="card-logo group-card-icon" @click.stop="toggleFocus">
          <img v-if="group.icon" :src="group.icon" alt="">
          <span v-else v-html="noteIcon" class="display-contents"></span>
        </div>
        <div class="card-titlewrap" @dblclick.stop="onDblClick">
          <div class="card-titlewrap-text">
            <div class="card-name" :data-group-name="group.id">{{ displayText(group.name) || t('cards.unnamedGroup') }}<span v-if="isPinned" class="pinned-badge" :title="t('cards.pinned')" v-html="I.pin"></span></div>
            <div class="card-domain group-domain"></div>
          </div>
        </div>
      </div>
      <div class="card-body" :class="{'grp-scroll-body':ui.layoutMode!=='list'}">
        <div class="card-scroll-wrap">
          <div class="card-tags" v-if="tagNames.length">
            <span class="card-tag tag-custom" v-for="(tag, i) in tagNames" :key="tag + '-' + i">{{ tag }}</span>
          </div>
          <!-- 聚焦态始终挂编辑器（分享态下 GroupEditor 以 editable:false 只读渲染） -->
          <GroupEditor :groupId="group.id" />
          <!-- 分享态兜底：笔记里没有内联书签卡片、但组确实有书签 → 列表展示，避免空白分享页 -->
          <div v-if="isShareReadonly && fallbackEntries.length" class="share-fallback-list">
            <a v-for="entry in fallbackEntries" :key="entry.b.id"
               :href="entry.safeUrl || '#'" :target="entry.safeUrl ? '_blank' : '_self'"
               :rel="entry.safeUrl ? 'noopener' : undefined"
               :class="['share-fallback-item', { 'is-disabled': !entry.safeUrl }]"
               @click="!entry.safeUrl ? $event.preventDefault() : null">
              <span class="share-fallback-ic">
                <span class="share-fallback-fb">{{ (displayText(entry.b.title) || entry.urlDomain || '?')[0].toUpperCase() }}</span>
                <img v-if="entry.icon" :src="entry.icon" alt="" referrerpolicy="no-referrer" loading="lazy" @error="markFbIconError" />
              </span>
              <span class="share-fallback-title">{{ displayText(entry.b.title) || entry.urlDomain }}</span>
              <span class="share-fallback-url">{{ entry.urlDomain }}</span>
            </a>
          </div>
        </div>
      </div>
    </div>
    <div v-if="!isShareReadonly" class="focus-toolbar-side">
      <button class="ft-sb-btn" :class="{ active: fmt.bold }" :title="t('editor.bold')" @click="fmtToggle('bold')"><strong>B</strong></button>
      <button class="ft-sb-btn" :class="{ active: fmt.underline }" :title="t('editor.underline')" @click="fmtToggle('underline')">
        <span aria-hidden="true" v-html="I.underline"></span>
      </button>
      <span class="ft-color-wrap">
        <button ref="colorBtnRef" class="ft-sb-btn ft-color-btn" :class="{ active: !!fmt.color }" :style="fmt.color ? { '--ft-color': fmt.color } : {}" :title="t('editor.textColor')" @click.stop="toggleColorPalette">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M9.5 4L5 16h1.8l1-3h8.3l1 3h1.8L14.5 4z"/></svg>
        </button>
      </span>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn" :class="{ active: fmt.h1 }" :title="t('editor.h1')" @click="fmtToggle('h1')">H1</button>
      <button class="ft-sb-btn" :class="{ active: fmt.h2 }" :title="t('editor.h2')" @click="fmtToggle('h2')">H2</button>
      <button class="ft-sb-btn" :class="{ active: fmt.h3 }" :title="t('editor.h3')" @click="fmtToggle('h3')">H3</button>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn" :class="{ active: fmt.ol }" :title="t('editor.ol')" @click="fmtToggle('ol')" v-html="I.ol"></button>
      <button class="ft-sb-btn" :class="{ active: fmt.ul }" :title="t('editor.ul')" @click="fmtToggle('ul')" v-html="I.ul"></button>
      <button class="ft-sb-btn" :class="{ active: fmt.task }" :title="t('editor.taskList')" @click="fmtToggle('task')" v-html="I.taskList"></button>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn" :title="t('editor.insertImage')" @click="pickImage" v-html="I.image"></button>
      <input ref="fileInputRef" type="file" accept="image/*" multiple hidden @change="onPickImage" />
    </div>
  </div>
  <div v-else :ref="setCardEl" class="card group-card" :class="{ 'group-expanded': isExpanded, 'batch-mode': ui.batchMode }"
       role="listitem" :aria-label="group.name || t('cards.unnamedGroup')"
       :data-group-id="group.id" :draggable="!ui.isMobile"
       :tabindex="listKeyboardNav ? 0 : undefined"
       @click="onCardClick" @keydown="onCardKeydown">
    <div class="group-card-accent"></div>
    <input v-if="ui.batchMode" type="checkbox" class="batch-chk"
           :id="'batchChk_group:' + group.id" :checked="isSelected"
           @change.stop @click.stop="toggleSelect">
    <div class="group-card-head">
      <div class="card-logo group-card-icon" :title="t('cards.focusGroup')" @click.stop="onFocusClick">
        <img v-if="group.icon" :src="group.icon" alt="">
        <span v-else v-html="noteIcon" class="display-contents"></span>
      </div>
      <div class="card-titlewrap" :title="t('cards.focusGroup')" @click.stop="onFocusClick">
        <div class="card-titlewrap-text">
          <div class="card-name" :data-group-name="group.id">{{ displayText(group.name) || t('cards.unnamedGroup') }}<span v-if="isPinned" class="pinned-badge" :title="t('cards.pinned')" v-html="I.pin"></span></div>
          <div class="card-domain group-domain"></div>
        </div>
      </div>
      <div class="card-tags" v-if="tagNames.length && ui.layoutMode === 'list' && !detailMode">
        <span class="card-tag tag-custom" v-for="(tag, i) in tagNames" :key="tag + '-' + i" @click.stop="filterByTagName(tag)">{{ tag }}</span>
      </div>
      <div class="group-head-actions" v-if="!ui.batchMode && !isShareReadonly">
        <button class="btn-undo-group" :class="{ disabled: !hasUndo }" @click.stop="undo" :title="t('common.undo')" v-html="I.undo"></button>
        <button class="btn-redo-group" :class="{ disabled: !hasRedo }" @click.stop="redo" :title="t('common.redo')" v-html="I.redo"></button>
      </div>
    </div>
    <div class="card-body" :class="{'grp-scroll-body':showFullBody}">
      <div class="card-scroll-wrap">
        <div class="card-tags" v-if="tagNames.length && showFullBody">
          <span class="card-tag tag-custom" v-for="(tag, i) in tagNames" :key="tag + '-' + i" @click.stop="filterByTagName(tag)">{{ tag }}</span>
        </div>
        <!-- 辅助栏 / 分享只读态：只读 HTML（分享态不挂可编辑 TipTap，避免写本地库） -->
        <div v-if="detailMode || (isShareReadonly && hasBody)" class="group-body group-body-readonly" v-html="safeNotesHtml"></div>
        <!-- grid 折叠态 / list 展开态挂 TipTap；mini-grid 用纯文本摘要 -->
        <GroupEditor v-else-if="showEditor" :groupId="group.id" />
        <div class="card-preview" v-else-if="previewText">{{ previewText }}</div>
      </div>
    </div>
    <div class="card-foot">
      <span class="card-stat">{{ tN('count.bookmarks', group.bookmarkIds?.length || 0) }}</span>
      <span class="card-actions" v-if="!isShareReadonly">
        <button class="btn-xs" @click.stop="addToGrp" :title="t('filter.addBookmarkOrGroup')" v-html="I.plus"></button>
        <button class="btn-xs" @click.stop="editGrp" :title="t('cards.editGroup')" v-html="I.edit"></button>
        <button class="btn-xs btn-danger" @click.stop="delGrp" :title="t('cards.deleteGroup')" v-html="I.trash"></button>
      </span>
    </div>
    <button v-if="hasBody && ui.layoutMode === 'list' && !detailMode && !ui.batchMode && !ui.isMobile" class="list-expand-btn" @click.stop="toggleExpand" :title="isExpanded ? t('cards.collapse') : t('cards.expand')" :aria-label="isExpanded ? t('cards.collapse') : t('cards.expand')" :aria-expanded="isExpanded" v-html="I.chevronDown"></button>
    <button v-if="ui.layoutMode === 'list' && !detailMode && !ui.batchMode && ui.isMobile" class="card-menu-btn" @click.stop="openMenu" :title="t('cards.details')" v-html="I.dotsV"></button>
    <div v-if="ui.batchMode && ui.isMobile && ui.layoutMode !== 'mini-grid'" class="batch-drag-handle" v-html="I.grip"></div>
  </div>
  <Teleport to="body">
    <Transition name="cpalette">
      <ColorPalette v-if="colorOpen && isFocused" class="cp-fixed" :style="paletteStyle" :activeColor="fmt.color" @apply="applyColor" />
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { getTagNames, stripEntranceAnim, sanitizeReadonlyHTML, displayText } from '../../utils.js'
import { isThreePartCipher } from '../../crypto.js'
// PERF-1/5：异步分包 TipTap 编辑器，折叠态不加载
const GroupEditor = defineAsyncComponent(() => import('../editor/GroupEditor.vue'))
import ColorPalette from '../editor/ColorPalette.vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useUndoStore } from '../../stores/undo.js'
import { useCardOverflow } from '../../composables/ui/useCardOverflow.js'
import { I } from '../../config/icons.js'
import { EditorManager } from '../../lib/editor.js'
import { groupPreview } from '../../lib/preview.js'
import { buildShareEntries } from '../../views/buildShareEntries.js'
import { editGroup as _editGroup, toggleGroupFocus, saveGroupBody, deleteGroup as _deleteGroup } from '../../composables/domain/useGroup.js'
import { openDetail } from '../../composables/ui/useUI.js'
import { toggleAttrFilter } from '../../composables/domain/useAttrFilter.js'
import { performUndo, performRedo } from '../../composables/domain/useUndo.js'
import { useEditorFormat, type FormatKey } from '../../composables/ui/useEditorFormat.js'
import { uploadAndInsertImages } from '../../composables/domain/useImageUpload.js'
import { handleListCardKeydown } from '../../composables/interaction/listCardKeyboard.js'
import { useListNav } from '../../composables/useListNav.js'
import { t, tN } from '../../i18n/index.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

const props = defineProps({
  group: { type: Object as () => SiblingGroup, required: true },
  // 辅助栏内复用：主网格可能是 list，但辅助栏强制 grid-view 样式；
  // 若不强制挂编辑器，GroupEditor 条件失败 + .grid-view .card-preview{display:none} → 空白
  detailMode: { type: Boolean, default: false },
})
const ui = useUIStore()
const ds = useDataStore()
const listNav = useListNav()

const cardEl = ref<HTMLElement | null>(null)
let _entranceCleanup: (() => void) | null = null
function setCardEl(el: Element | null) {
  if (_entranceCleanup) { _entranceCleanup(); _entranceCleanup = null }
  cardEl.value = el as HTMLElement | null
  if (el) _entranceCleanup = stripEntranceAnim(el as HTMLElement)
}
// useCardOverflow 副作用：给 .card-body 加 .card-overflow 类驱动淡出遮罩，返回值此处不消费
useCardOverflow(cardEl)

const isFocused = computed(() => !props.detailMode && ui.focusedGroupId === props.group.id)
/** 分享只读态：任何分享态下组卡一律只读（组分享聚焦 / 分类分享网格内聚焦） */
const isShareReadonly = computed(() => !!ui.shareMode)
const isExpanded = computed(() => ui.layoutMode === 'list' && ui.expandedIds.includes(props.group.id) && !ui.batchMode)
const isSelected = computed(() => (ui.batchSelected ?? []).includes('group:' + props.group.id))
const noteIcon = I.note
const hasBody = computed(() => !!(props.group.notes && props.group.notes.trim()))
// 辅助栏用只读 HTML；主网格宫格/列表展开挂 TipTap（分享态不挂可编辑编辑器）
const showEditor = computed(() => !props.detailMode && !isShareReadonly.value && (isExpanded.value || ui.layoutMode === 'grid'))
const showFullBody = computed(() => props.detailMode || ui.layoutMode !== 'list')
const safeNotesHtml = computed(() => {
  const n = props.group.notes || ''
  // E2E 锁定态遗留密文（整字段加密 → 整串三段 salt.iv.data）：不渲染，避免 v-html 显示
  // 乱码长串；解锁后 decryptStoreItems 还原明文自动恢复。明文 HTML 不受影响。
  if (isThreePartCipher(n)) return ''
  return sanitizeReadonlyHTML(n)
})

/**
 * 分享态兜底（决策：严格照搬聚焦态 + 仅笔记为空时兜底）：
 * 笔记正文里没有任何内联书签卡片、但组的 bookmarkIds 非空 → 把组内书签以只读
 * 列表渲染在笔记下方。否则分享者「只往组里塞书签、没拖进笔记」时分享页会是空白。
 */
const notesHaveInlineCards = computed(() => /group-inline-card/.test(props.group.notes || ''))
const fallbackBookmarks = computed(() => {
  if (!isShareReadonly.value || notesHaveInlineCards.value) return []
  return (props.group.bookmarkIds || [])
    .map((id) => ds.bookmarkMap[id])
    .filter((b): b is Bookmark => !!b && !b.deletedAt)
})
/** 预计算安全 URL / 域名 / favicon（与分享页同口径，跨用户 url/icon 不可信） */
const fallbackEntries = computed(() => buildShareEntries(fallbackBookmarks.value))
function markFbIconError(e: Event) {
  const el = e.target as HTMLElement | null
  el?.classList?.add('img-error')
}

const tagNames = computed(() => getTagNames(props.group, ds.customAttributes))
const isPinned = computed(() => !!props.group.pinnedAt)

const previewText = computed(() => groupPreview(props.group))

const undoStore = useUndoStore()
const hasUndo = computed(() => !!undoStore.canUndo(props.group.id))
const hasRedo = computed(() => !!undoStore.canRedo(props.group.id))

const colorBtnRef = ref<HTMLElement | null>(null)
const paletteStyle = ref<Record<string, string>>({})
const { fmt, colorOpen, syncFmt, fmtToggle: _fmtToggle, applyColor: _applyColor } = useEditorFormat(() => EditorManager.get(props.group.id))

function toggleColorPalette() {
  if (colorOpen.value) { colorOpen.value = false; return }
  const btn = colorBtnRef.value
  if (!btn) return
  const r = btn.getBoundingClientRect()
  paletteStyle.value = { position: 'fixed', top: r.top + 'px', right: (window.innerWidth - r.left + 4) + 'px' }
  colorOpen.value = true
}

function fmtToggle(f: FormatKey) { _fmtToggle(f); saveGroupBody(props.group.id) }
function applyColor(hex: string) { _applyColor(hex); saveGroupBody(props.group.id) }

const fileInputRef = ref<HTMLInputElement | null>(null)

function pickImage() {
  fileInputRef.value?.click()
}

function onPickImage(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  if (files.length) void uploadAndInsertImages(props.group.id, files)
  input.value = '' // 允许重复选择同一文件
}

let _selHandler: (() => void) | null = null
function _attach() {
  _detach()
  const ed = EditorManager.get(props.group.id)
  if (!ed) return
  _selHandler = () => syncFmt()
  ed.on('selectionUpdate', _selHandler)
  syncFmt()
}
function _detach() {
  if (_selHandler) {
    const ed = EditorManager.get(props.group.id)
    if (ed) ed.off('selectionUpdate', _selHandler)
    _selHandler = null
  }
}

watch(isFocused, (v) => { v ? _attach() : _detach() }, { immediate: true })
onBeforeUnmount(() => _detach())

function toggleFocus() { toggleGroupFocus(props.group.id) }
function onDblClick(e: MouseEvent) { if ((e.target as HTMLElement).closest('button, input, [contenteditable], .gic-btn, .gic-remove')) return; toggleGroupFocus(props.group.id) }
function addToGrp(e: MouseEvent) { ui.addToGid = props.group.id; const btn = e.currentTarget as HTMLElement; if (btn) { const r = btn.getBoundingClientRect(); ui._addPopoverTrigger = { top: r.bottom, left: r.left, width: r.width } } else { ui._addPopoverTrigger = null } ui.overlays.addPopover = true }
function editGrp() { _editGroup(props.group.id) }
function delGrp() { _deleteGroup(props.group.id) }
function undo() { performUndo(props.group.id) }
function redo() { performRedo(props.group.id) }
function toggleSelect() { const id = 'group:' + props.group.id; const sel = ui.batchSelected; const idx = sel.indexOf(id); if (idx > -1) sel.splice(idx, 1); else sel.push(id) }
function filterByTagName(name: string) {
  const attr = ds.attributeByName[name]
  if (attr) toggleAttrFilter(attr.id)
}
function openMenu() { openDetail('group:' + props.group.id) }
function toggleExpand() { ui.toggleExpanded(props.group.id) }
function onFocusClick() {
  if (ui.batchMode) { toggleSelect(); return }
  toggleFocus()
}
// 完整分区：PC 列表可键盘聚焦；Enter 聚焦组，Space 详情，→/← 展开收起；空白单击主操作（辅助栏内关闭）
const listKeyboardNav = computed(() => !props.detailMode && ui.layoutMode === 'list' && !ui.isMobile && !ui.batchMode)
const LIST_INTERACTIVE_SEL = 'button, input, .btn-xs, .card-actions, .card-logo, .card-titlewrap, [contenteditable="true"], .gic-btn, .gic-remove, .gic-name, .list-expand-btn, .card-menu-btn, .group-body, .card-tag, .group-head-actions'

function onCardClick(e: MouseEvent) {
  if (props.detailMode) return
  if (ui.batchMode) { toggleSelect(); return }
  if (ui.layoutMode === 'mini-grid') { toggleFocus(); return }
  if (ui.layoutMode !== 'list') return
  if ((e.target as HTMLElement).closest(LIST_INTERACTIVE_SEL)) return
  // 列表（PC/移动端一致）：展开态点空白收起；折叠态点空白 = 主操作（聚焦组）。
  // 与 mini-grid / 移动端行为对齐，详情改由「⋯」/右键/键盘 Space 显式触发。
  if (isExpanded.value) { toggleExpand(); return }
  toggleFocus()
  cardEl.value?.focus({ preventScroll: true })
}

function onCardKeydown(e: KeyboardEvent) {
  if (!listKeyboardNav.value) return
  const action = handleListCardKeydown(e, cardEl.value, {
    canExpand: hasBody.value,
    expanded: isExpanded.value,
  }, listNav.value ?? undefined)
  if (action.type === 'primary') toggleFocus()
  else if (action.type === 'detail') openDetail('group:' + props.group.id)
  else if (action.type === 'expand' || action.type === 'collapse' || action.type === 'toggleExpand') toggleExpand()
}
</script>

<style scoped>
/* 分享态兜底书签列表（聚焦视图内，笔记下方） */
.share-fallback-list {
  display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding-top: 12px;
  border-top: 1px dashed var(--border, #e5e7eb);
}
.share-fallback-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px;
  border: 1px solid var(--border, #e5e7eb); border-radius: 10px;
  text-decoration: none; color: inherit;
  transition: border-color 0.15s, background 0.15s;
}
.share-fallback-item:hover { border-color: var(--accent, #3B82F6); background: var(--bg-alt, #f7f2ec); }
.share-fallback-item.is-disabled { opacity: 0.55; cursor: default; }
.share-fallback-ic {
  position: relative; width: 24px; height: 24px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-alt, #f3f4f6); border-radius: 6px; overflow: hidden;
}
.share-fallback-ic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.share-fallback-ic img.img-error { display: none; }
.share-fallback-ic:has(img:not(.img-error)) .share-fallback-fb { display: none; }
.share-fallback-fb { font-size: 12px; font-weight: 700; color: var(--accent, #3B82F6); text-transform: uppercase; }
.share-fallback-title {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-fallback-url {
  flex-shrink: 0; max-width: 40%; font-size: 11px; color: var(--text-secondary, #888);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
</style>
