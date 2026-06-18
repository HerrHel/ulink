<template>
  <div class="ctx-menu" id="ctxMenu" v-show="visible" role="menu" aria-label="操作菜单"
       :style="{ left: x + 'px', top: y + 'px' }">
    <template v-for="item in visibleItems" :key="item.action">
      <div v-if="item.divider" class="ctx-divider" role="separator"></div>
      <button v-else class="ctx-item" :class="{ 'ctx-danger': item.danger }"
              role="menuitem" :data-action="item.action" @click="onItemClick(item.action)">
        {{ item.text }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { ACTIONS } from '../../config/constants.js'
import { actionSheetAPI, setCtxMenuAPI } from '../../composables/bridge.js'
import { visit, openBmModal, deleteBookmarkWithUndo } from '../../composables/domain/useBookmark.js'
import { openDetail, deleteCategory, deleteAttribute, openCatModal, openAttrModal } from '../../composables/ui/useUI.js'
import { editGroup, deleteGroup, removeBmFromGroup, createGroup } from '../../composables/domain/useGroup.js'
import { shareGroup } from '../../composables/domain/useDataIO.js'

const store = useAppStore()
const visible = ref(false)
const x = ref(0)
const y = ref(0)
const ctxType = ref('')
const ctxTarget = ref('')

// Context menu items with visibility rules per type
const allItems = [
  { action: ACTIONS.VISIT, text: '打开网站' },
  { action: ACTIONS.EDIT, text: '编辑' },
  { action: ACTIONS.DELETE, text: '删除', danger: true },
  { action: ACTIONS.MOVE_TO_CAT, text: '移动到' },
  { action: ACTIONS.SHARE_GROUP, text: '分享组' },
  { action: ACTIONS.ADD_BOOKMARK, text: '添加书签' },
  { action: ACTIONS.ADD_GROUP, text: '添加组' },
  { action: ACTIONS.ADD_CAT, text: '添加分类' },
  { action: ACTIONS.MULTI_SELECT, text: '多选' },
]

const RULES = {
  card:         { show: [ACTIONS.VISIT, ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MOVE_TO_CAT, ACTIONS.MULTI_SELECT], text: {} },
  sub:          { show: [ACTIONS.VISIT, ACTIONS.EDIT, ACTIONS.DELETE], text: { [ACTIONS.VISIT]: '查看详情' } },
  cat:          { show: [ACTIONS.EDIT, ACTIONS.DELETE], text: { [ACTIONS.EDIT]: '重命名' } },
  attr:         { show: [ACTIONS.EDIT, ACTIONS.DELETE], text: {} },
  group:        { show: [ACTIONS.EDIT, ACTIONS.DELETE, ACTIONS.MOVE_TO_CAT, ACTIONS.SHARE_GROUP], text: { [ACTIONS.EDIT]: '编辑组名', [ACTIONS.DELETE]: '删除组', [ACTIONS.SHARE_GROUP]: '分享组' } },
  'group-card': { show: [ACTIONS.VISIT, ACTIONS.DELETE], text: { [ACTIONS.VISIT]: '查看详情', [ACTIONS.DELETE]: '从组移除' } },
  'rail-empty': { show: [ACTIONS.ADD_CAT], text: {} },
  'grid-empty': { show: [ACTIONS.ADD_BOOKMARK, ACTIONS.ADD_GROUP, ACTIONS.MULTI_SELECT], text: {} },
}

const DEFAULT_TEXT = { [ACTIONS.VISIT]: '打开网站', [ACTIONS.EDIT]: '编辑', [ACTIONS.DELETE]: '删除' }

const visibleItems = computed(() => {
  const rule = RULES[ctxType.value] || { show: [], text: {} }
  const showSet = new Set(rule.show)
  const textMap = { ...DEFAULT_TEXT, ...rule.text }
  const items = []
  for (const item of allItems) {
    if (!showSet.has(item.action)) continue
    items.push({ ...item, text: textMap[item.action] || item.text })
  }
  return items
})

function show(e, type, targetId) {
  e.preventDefault()
  ctxType.value = type
  ctxTarget.value = targetId
  // Position: clamp to viewport
  x.value = Math.min(e.clientX, window.innerWidth - 170)
  y.value = Math.min(e.clientY, window.innerHeight - 200)
  visible.value = true
}

function hide() {
  visible.value = false
}

function onItemClick(action) {
  const tid = ctxTarget.value
  const ttype = ctxType.value
  hide()
  // Dispatch to store/UI actions via dynamic imports
  _dispatchAction(ttype, action, tid)
}

function _dispatchAction(type, action, id) {
  if (type === 'card') {
    if (action === ACTIONS.VISIT) visit(null, id)
    if (action === ACTIONS.EDIT) openBmModal(id)
    if (action === ACTIONS.DELETE) deleteBookmarkWithUndo(id, true)
    if (action === ACTIONS.MOVE_TO_CAT) actionSheetAPI?.showCategoryPicker(id)
  } else if (type === 'sub') {
    if (action === ACTIONS.VISIT) openDetail(id)
    if (action === ACTIONS.EDIT) openBmModal(id)
    if (action === ACTIONS.DELETE) deleteBookmarkWithUndo(id, true)
  } else if (type === 'cat') {
    if (action === ACTIONS.EDIT) openCatModal()
    if (action === ACTIONS.DELETE) deleteCategory(id)
  } else if (type === 'attr') {
    if (action === ACTIONS.EDIT) openAttrModal()
    if (action === ACTIONS.DELETE) deleteAttribute(id)
  } else if (type === 'group') {
    if (action === ACTIONS.EDIT) editGroup(id)
    if (action === ACTIONS.DELETE) deleteGroup(id)
    if (action === ACTIONS.MOVE_TO_CAT) actionSheetAPI?.showGroupCategoryPicker(id)
    if (action === ACTIONS.SHARE_GROUP) shareGroup(id)
  } else if (type === 'group-card') {
    if (action === ACTIONS.VISIT) openDetail(id)
    if (action === ACTIONS.DELETE) removeBmFromGroup(id, store.ctxGid)
  } else if (type === 'grid-empty') {
    if (action === ACTIONS.ADD_BOOKMARK) openBmModal()
    if (action === ACTIONS.ADD_GROUP) createGroup()
  } else if (type === 'rail-empty') {
    if (action === ACTIONS.ADD_CAT) { openCatModal(); setTimeout(() => document.getElementById('newCatName')?.focus(), 200) }
  }
}

function _onDocClick(e) { if (!e.target.closest('#ctxMenu')) hide() }

onMounted(() => {
  setCtxMenuAPI({ show, hide })
  document.addEventListener('click', _onDocClick)
})

onUnmounted(() => {
  document.removeEventListener('click', _onDocClick)
  setCtxMenuAPI(null)
})

defineExpose({ show, hide, visible })
</script>
