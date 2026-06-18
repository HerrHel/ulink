<template>
  <div v-if="isFocused" class="focus-card-wrap">
    <div class="card group-card group-card-focus" :data-group-id="group.id">
      <div class="group-card-accent"></div>
      <div class="card-body">
        <div class="group-card-head">
          <div class="card-logo group-card-icon" @click.stop="toggleFocus">
            <img v-if="group.icon" :src="group.icon" alt="">
            <span v-else v-html="noteIcon" class="display-contents"></span>
          </div>
          <div class="card-titlewrap" @dblclick.stop="onDblClick">
            <div class="card-name" :data-group-name="group.id">{{ group.name || '未命名组' }}</div>
            <div class="card-domain group-domain"></div>
          </div>
        </div>
        <div class="card-tags" v-if="tagNames.length">
          <span class="card-tag tag-custom" v-for="t in tagNames" :key="t">{{ t }}</span>
        </div>
        <GroupEditor :groupId="group.id" />
        <div class="card-preview" v-if="previewText">{{ previewText }}</div>
      </div>
    </div>
    <div class="focus-toolbar-side">
      <button class="ft-sb-btn" :class="{ active: fmt.bold }" title="加粗" @click="fmtToggle('bold')"><strong>B</strong></button>
      <button class="ft-sb-btn" :class="{ active: fmt.underline }" title="下划线" @click="fmtToggle('underline')">
        <span v-html="I.underline"></span>
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
  <div v-else :ref="setCardEl" class="card group-card" :class="{ 'group-expanded': isExpanded, 'batch-mode': store.batchMode }"
       role="article" :aria-label="group.name || '未命名组'"
       :data-group-id="group.id" :draggable="true" @click="onCardClick">
    <div class="group-card-accent"></div>
    <input v-if="store.batchMode" type="checkbox" class="batch-chk"
           :id="'batchChk_group:' + group.id" :checked="isSelected"
           @change.stop @click.stop="toggleSelect">
    <div class="card-body">
      <div class="group-card-head">
        <div class="card-logo group-card-icon" @click.stop="toggleFocus">
          <img v-if="group.icon" :src="group.icon" alt="">
          <span v-else v-html="noteIcon" class="display-contents"></span>
        </div>
        <div class="card-titlewrap">
          <div class="card-name" :data-group-name="group.id">{{ group.name || '未命名组' }}</div>
          <div class="card-domain group-domain"></div>
        </div>
        <div class="group-head-actions" v-if="!store.batchMode">
          <button class="btn-undo-group" :class="{ disabled: !hasUndo }" @click.stop="undo" title="撤销" v-html="I.undo"></button>
          <button class="btn-redo-group" :class="{ disabled: !hasRedo }" @click.stop="redo" title="重做" v-html="I.redo"></button>
        </div>
      </div>
      <div class="card-tags" v-if="tagNames.length">
        <span class="card-tag tag-custom" v-for="t in tagNames" :key="t" @click.stop="filterByTagName(t)">{{ t }}</span>
      </div>
      <GroupEditor :groupId="group.id" />
      <div class="card-preview" v-if="previewText">{{ previewText }}</div>
    </div>
    <div class="card-foot">
      <span class="card-stat">{{ group.bookmarkIds?.length || 0 }} 个书签</span>
      <span class="card-actions">
        <button class="btn-xs" @click.stop="addToGrp" title="添加书签或组" v-html="I.plus"></button>
        <button class="btn-xs" @click.stop="editGrp" title="编辑组" v-html="I.edit"></button>
        <button class="btn-xs btn-danger" @click.stop="delGrp" title="删除组" v-html="I.trash"></button>
      </span>
    </div>
    <button v-if="hasBody && store.layoutMode === 'list'" class="list-expand-btn" @click.stop="toggleExpand" title="展开" v-html="I.chevronDown"></button>
    <div v-if="store.batchMode && isMobile()" class="batch-drag-handle" v-html="I.grip"></div>
  </div>
  <Teleport to="body">
    <Transition name="cpalette">
      <ColorPalette v-if="colorOpen && isFocused" class="cp-fixed" :style="paletteStyle" :activeColor="fmt.color" @apply="applyColor" />
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { sanitizeHTML, getTagNames, isMobile, stripEntranceAnim } from '../../utils.js'
import GroupEditor from '../editor/GroupEditor.vue'
import ColorPalette from '../editor/ColorPalette.vue'
import { useAppStore } from '../../stores/app.js'
import { useUndoStore } from '../../stores/undo.js'
import { I } from '../../config/icons.js'
import { EditorManager } from '../../lib/editor.js'
import { editGroup as _editGroup, toggleGroupFocus, saveGroupBody, deleteGroup as _deleteGroup } from '../../composables/domain/useGroup.js'
import { toggleAttrFilter } from '../../composables/domain/useAttrFilter.js'
import { performUndo, performRedo } from '../../composables/domain/useUndo.js'
import { useEditorFormat } from '../../composables/ui/useEditorFormat.js'

const props = defineProps({ group: { type: Object, required: true } })
const store = useAppStore()

let _cardEl = null
let _entranceCleanup = null
function setCardEl(el) {
  if (_entranceCleanup) { _entranceCleanup(); _entranceCleanup = null }
  _cardEl = el
  _entranceCleanup = stripEntranceAnim(el)
}

const isFocused = computed(() => store.focusedGroupId === props.group.id)
const isExpanded = computed(() => store.layoutMode === 'list' && props.group.isExpanded)
const isSelected = computed(() => { try { return (store.batchSelected || []).indexOf('group:' + props.group.id) !== -1 } catch { return false } })
const hasBody = computed(() => !!(props.group.notes && props.group.notes.trim()))
const noteIcon = I.note

const tagNames = computed(() => getTagNames(props.group, store.customAttributes))

const previewText = computed(() => {
  const notes = props.group.notes || ''
  if (!notes) return ''
  const tmp = document.createElement('div'); tmp.innerHTML = sanitizeHTML(notes)
  tmp.querySelectorAll('.gic-btn, .gic-remove, .gic-domain').forEach(el => el.remove())
  return tmp.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || ''
})

const undoStore = useUndoStore()
const hasUndo = computed(() => !!undoStore.canUndo(props.group.id))
const hasRedo = computed(() => !!undoStore.canRedo(props.group.id))

const colorBtnRef = ref(null)
const paletteStyle = ref({})
const { fmt, colorOpen, syncFmt, fmtToggle: _fmtToggle, applyColor: _applyColor } = useEditorFormat(() => EditorManager.get(props.group.id))

function toggleColorPalette() {
  if (colorOpen.value) { colorOpen.value = false; return }
  const btn = colorBtnRef.value
  if (!btn) return
  const r = btn.getBoundingClientRect()
  paletteStyle.value = { position: 'fixed', top: r.top + 'px', right: (window.innerWidth - r.left + 4) + 'px' }
  colorOpen.value = true
}

function fmtToggle(f) { _fmtToggle(f); saveGroupBody(props.group.id) }
function applyColor(hex) { _applyColor(hex); saveGroupBody(props.group.id) }

let _selHandler = null
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
function onDblClick(e) { if (e.target.closest('button, input, [contenteditable], .gic-btn, .gic-remove')) return; toggleGroupFocus(props.group.id) }
function addToGrp(e) { store.addToGid = props.group.id; const btn = e.currentTarget; if (btn) { const r = btn.getBoundingClientRect(); store._addPopoverTrigger = { top: r.bottom, left: r.left, width: r.width } } else { store._addPopoverTrigger = null } store.addBmPopoverOpen = true }
function editGrp() { _editGroup(props.group.id) }
function delGrp() { _deleteGroup(props.group.id) }
function undo() { performUndo(props.group.id) }
function redo() { performRedo(props.group.id) }
function toggleSelect() { const id = 'group:' + props.group.id; const sel = store.batchSelected; const idx = sel.indexOf(id); if (idx > -1) sel.splice(idx, 1); else sel.push(id) }
function filterByTagName(name) {
  const attr = store.customAttributes.find(a => a.name === name)
  if (attr) toggleAttrFilter(attr.id)
}
function toggleExpand() { props.group.isExpanded = !props.group.isExpanded; store.debouncedSave() }
function onCardClick(e) {
  if (store.batchMode) { toggleSelect(); return }
  if (store.layoutMode !== 'list') return
  if (e.target.closest('button, input, .btn-xs, .card-actions, .card-logo, .card-titlewrap, [contenteditable="true"], .gic-btn, .gic-remove, .gic-name, .list-expand-btn, .group-body')) return
  toggleExpand()
}
</script>
