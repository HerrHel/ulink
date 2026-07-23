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
            <div class="card-name" :data-group-name="group.id">{{ group.name || '未命名组' }}<span v-if="isPinned" class="pinned-badge" title="已置顶" v-html="I.pin"></span></div>
            <div class="card-domain group-domain"></div>
          </div>
        </div>
      </div>
      <div class="card-body" :class="{'grp-scroll-body':ui.layoutMode!=='list'}">
        <div class="card-scroll-wrap">
          <div class="card-tags" v-if="tagNames.length">
            <span class="card-tag tag-custom" v-for="t in tagNames" :key="t">{{ t }}</span>
          </div>
          <!-- 聚焦态始终挂编辑器 -->
          <GroupEditor :groupId="group.id" />
        </div>
      </div>
    </div>
    <div class="focus-toolbar-side">
      <button class="ft-sb-btn" :class="{ active: fmt.bold }" title="加粗" @click="fmtToggle('bold')"><strong>B</strong></button>
      <button class="ft-sb-btn" :class="{ active: fmt.underline }" title="下划线" @click="fmtToggle('underline')">
        <span aria-hidden="true" v-html="I.underline"></span>
      </button>
      <span class="ft-color-wrap">
        <button ref="colorBtnRef" class="ft-sb-btn ft-color-btn" :class="{ active: !!fmt.color }" :style="fmt.color ? { '--ft-color': fmt.color } : {}" title="文字颜色" @click.stop="toggleColorPalette">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M9.5 4L5 16h1.8l1-3h8.3l1 3h1.8L14.5 4z"/></svg>
        </button>
      </span>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn" :class="{ active: fmt.h1 }" title="大标题" @click="fmtToggle('h1')">H1</button>
      <button class="ft-sb-btn" :class="{ active: fmt.h2 }" title="中标题" @click="fmtToggle('h2')">H2</button>
      <button class="ft-sb-btn" :class="{ active: fmt.h3 }" title="小标题" @click="fmtToggle('h3')">H3</button>
      <div class="ft-sb-sep"></div>
      <button class="ft-sb-btn" :class="{ active: fmt.ol }" title="有序列表" @click="fmtToggle('ol')" v-html="I.ol"></button>
      <button class="ft-sb-btn" :class="{ active: fmt.ul }" title="无序列表" @click="fmtToggle('ul')" v-html="I.ul"></button>
      <button class="ft-sb-btn" :class="{ active: fmt.task }" title="待办清单" @click="fmtToggle('task')" v-html="I.taskList"></button>
    </div>
  </div>
  <div v-else :ref="setCardEl" class="card group-card" :class="{ 'group-expanded': isExpanded, 'batch-mode': ui.batchMode }"
       role="listitem" :aria-label="group.name || '未命名组'"
       :data-group-id="group.id" :draggable="true"
       :tabindex="listKeyboardNav ? 0 : undefined"
       @click="onCardClick" @keydown="onCardKeydown">
    <div class="group-card-accent"></div>
    <input v-if="ui.batchMode" type="checkbox" class="batch-chk"
           :id="'batchChk_group:' + group.id" :checked="isSelected"
           @change.stop @click.stop="toggleSelect">
    <div class="group-card-head">
      <div class="card-logo group-card-icon" title="聚焦组" @click.stop="onFocusClick">
        <img v-if="group.icon" :src="group.icon" alt="">
        <span v-else v-html="noteIcon" class="display-contents"></span>
      </div>
      <div class="card-titlewrap" title="聚焦组" @click.stop="onFocusClick">
        <div class="card-titlewrap-text">
          <div class="card-name" :data-group-name="group.id">{{ group.name || '未命名组' }}<span v-if="isPinned" class="pinned-badge" title="已置顶" v-html="I.pin"></span></div>
          <div class="card-domain group-domain"></div>
        </div>
      </div>
      <div class="card-tags" v-if="tagNames.length && ui.layoutMode === 'list' && !detailMode">
        <span class="card-tag tag-custom" v-for="t in tagNames" :key="t" @click.stop="filterByTagName(t)">{{ t }}</span>
      </div>
      <div class="group-head-actions" v-if="!ui.batchMode">
        <button class="btn-undo-group" :class="{ disabled: !hasUndo }" @click.stop="undo" title="撤销" v-html="I.undo"></button>
        <button class="btn-redo-group" :class="{ disabled: !hasRedo }" @click.stop="redo" title="重做" v-html="I.redo"></button>
      </div>
    </div>
    <div class="card-body" :class="{'grp-scroll-body':showFullBody}">
      <div class="card-scroll-wrap">
        <div class="card-tags" v-if="tagNames.length && showFullBody">
          <span class="card-tag tag-custom" v-for="t in tagNames" :key="t" @click.stop="filterByTagName(t)">{{ t }}</span>
        </div>
        <!-- 辅助栏：只读 HTML（避免与主网格 GroupEditor 抢同一 groupId 注册表） -->
        <div v-if="detailMode" class="group-body group-body-readonly" v-html="safeNotesHtml"></div>
        <!-- grid 折叠态 / list 展开态挂 TipTap；mini-grid 用纯文本摘要 -->
        <GroupEditor v-else-if="showEditor" :groupId="group.id" />
        <div class="card-preview" v-else-if="previewText">{{ previewText }}</div>
      </div>
    </div>
    <div class="card-foot">
      <span class="card-stat">{{ group.bookmarkIds?.length || 0 }} 个书签</span>
      <span class="card-actions">
        <button class="btn-xs" @click.stop="addToGrp" title="添加书签或组" v-html="I.plus"></button>
        <button class="btn-xs" @click.stop="editGrp" title="编辑组" v-html="I.edit"></button>
        <button class="btn-xs btn-danger" @click.stop="delGrp" title="删除组" v-html="I.trash"></button>
      </span>
    </div>
    <button v-if="hasBody && ui.layoutMode === 'list' && !detailMode && !ui.batchMode && !ui.isMobile" class="list-expand-btn" @click.stop="toggleExpand" :title="isExpanded ? '收起' : '展开'" :aria-label="isExpanded ? '收起' : '展开'" :aria-expanded="isExpanded" v-html="I.chevronDown"></button>
    <button v-if="ui.layoutMode === 'list' && !detailMode && !ui.batchMode && ui.isMobile" class="card-menu-btn" @click.stop="openMenu" title="详情" v-html="I.dotsV"></button>
    <div v-if="ui.batchMode && ui.isMobile" class="batch-drag-handle" v-html="I.grip"></div>
  </div>
  <Teleport to="body">
    <Transition name="cpalette">
      <ColorPalette v-if="colorOpen && isFocused" class="cp-fixed" :style="paletteStyle" :activeColor="fmt.color" @apply="applyColor" />
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, defineAsyncComponent } from 'vue'
import { getTagNames, isMobile, stripEntranceAnim, sanitizeHTML } from '../../utils.js'
// PERF-1/5：异步分包 TipTap 编辑器，折叠态不加载
const GroupEditor = defineAsyncComponent(() => import('../editor/GroupEditor.vue'))
import ColorPalette from '../editor/ColorPalette.vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useUndoStore } from '../../stores/undo.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { useCardOverflow } from '../../composables/ui/useCardOverflow.js'
import { I } from '../../config/icons.js'
import { EditorManager } from '../../lib/editor.js'
import { groupPreview } from '../../lib/preview.js'
import { editGroup as _editGroup, toggleGroupFocus, saveGroupBody, deleteGroup as _deleteGroup } from '../../composables/domain/useGroup.js'
import { openDetail } from '../../composables/ui/useUI.js'
import { toggleAttrFilter } from '../../composables/domain/useAttrFilter.js'
import { performUndo, performRedo } from '../../composables/domain/useUndo.js'
import { useEditorFormat, type FormatKey } from '../../composables/ui/useEditorFormat.js'
import { handleListCardKeydown } from '../../composables/interaction/listCardKeyboard.js'
import type { SiblingGroup } from '../../types.js'

const props = defineProps({
  group: { type: Object as () => SiblingGroup, required: true },
  // 辅助栏内复用：主网格可能是 list，但辅助栏强制 grid-view 样式；
  // 若不强制挂编辑器，GroupEditor 条件失败 + .grid-view .card-preview{display:none} → 空白
  detailMode: { type: Boolean, default: false },
})
const ui = useUIStore()
const ds = useDataStore()

const cardEl = ref<HTMLElement | null>(null)
let _entranceCleanup: (() => void) | null = null
function setCardEl(el: any) {
  if (_entranceCleanup) { _entranceCleanup(); _entranceCleanup = null }
  cardEl.value = el as HTMLElement | null
  if (el) _entranceCleanup = stripEntranceAnim(el as HTMLElement)
}
// useCardOverflow 副作用：给 .card-body 加 .card-overflow 类驱动淡出遮罩，返回值此处不消费
useCardOverflow(cardEl)

const isFocused = computed(() => !props.detailMode && ui.focusedGroupId === props.group.id)
const isExpanded = computed(() => ui.layoutMode === 'list' && props.group.isExpanded && !ui.batchMode)
const isSelected = computed(() => (ui.batchSelected ?? []).includes('group:' + props.group.id))
const noteIcon = I.note
const hasBody = computed(() => !!(props.group.notes && props.group.notes.trim()))
// 辅助栏用只读 HTML；主网格宫格/列表展开挂 TipTap
const showEditor = computed(() => !props.detailMode && (isExpanded.value || ui.layoutMode === 'grid'))
const showFullBody = computed(() => props.detailMode || ui.layoutMode !== 'list')
const safeNotesHtml = computed(() => sanitizeHTML(props.group.notes || ''))

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
function toggleExpand() { ds.updateGroup(props.group.id, { isExpanded: !props.group.isExpanded }); debouncedSaveAppData() }
function onFocusClick() {
  if (ui.batchMode) { toggleSelect(); return }
  toggleFocus()
}
// 完整分区：PC 列表可键盘聚焦；Enter 聚焦组，Space/→ 展开；空白单击开详情（辅助栏内关闭）
const listKeyboardNav = computed(() => !props.detailMode && ui.layoutMode === 'list' && !ui.isMobile && !ui.batchMode)
const LIST_INTERACTIVE_SEL = 'button, input, .btn-xs, .card-actions, .card-logo, .card-titlewrap, [contenteditable="true"], .gic-btn, .gic-remove, .gic-name, .list-expand-btn, .card-menu-btn, .group-body, .card-tag, .group-head-actions'

function onCardClick(e: MouseEvent) {
  if (props.detailMode) return
  if (ui.batchMode) { toggleSelect(); return }
  if (ui.layoutMode === 'mini-grid') { toggleFocus(); return }
  if (ui.layoutMode !== 'list') return
  if ((e.target as HTMLElement).closest(LIST_INTERACTIVE_SEL)) return
  if (isMobile()) {
    // 移动端：非交互区单击聚焦（详情由「⋯」触发）
    toggleFocus()
    return
  }
  // PC 列表：空白单击打开右侧详情（管理器模式，不聚焦/不跳转）
  openDetail('group:' + props.group.id)
  cardEl.value?.focus({ preventScroll: true })
}

function onCardKeydown(e: KeyboardEvent) {
  if (!listKeyboardNav.value) return
  const action = handleListCardKeydown(e, cardEl.value, {
    canExpand: hasBody.value,
    expanded: isExpanded.value,
  })
  if (action.type === 'primary') toggleFocus()
  else if (action.type === 'detail') openDetail('group:' + props.group.id)
  else if (action.type === 'expand' || action.type === 'collapse' || action.type === 'toggleExpand') toggleExpand()
}
</script>
