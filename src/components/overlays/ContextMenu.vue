<template>
  <div class="ctx-menu" id="ctxMenu" v-show="ctx.open" role="menu" aria-label="操作菜单"
       :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
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
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { ACTIONS } from '../../config/constants.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { visit, openBmModal, deleteBookmarkWithUndo } from '../../composables/domain/useBookmark.js'
import { openDetail, deleteCategory, deleteAttribute, openCatModal } from '../../composables/ui/useUI.js'
import { editGroup, deleteGroup, removeBmFromGroup, createGroup } from '../../composables/domain/useGroup.js'
import { shareGroup } from '../../composables/domain/useDataShare.js'

const store = useAppStore()
const ctx = useContextMenuStore()

// 视口边缘 clamp：contextMenu.show 用 e.clientX/Y 作 left/top，右/下边缘右键时菜单
// 固定定位会溢出视口（右下 1/3 区域高频）。菜单高度随 type 动态（card=6 项、rail-empty=1 项），
// 故在 open 切为 true 后 nextTick 读 #ctxMenu 实际 offsetWidth/Height 反算 clamp，比硬编码更准。
// 对照 AddPopover(useMention 同样 Math.min(innerWidth-innerHeight - 预估)) 做法一致。
const pos = ref({ x: 0, y: 0 })
watch(() => ctx.open, async (open) => {
  if (!open) return
  // 先按原始 clientX/Y 摆位（菜单可见后才能测尺寸）
  pos.value = { x: ctx.x, y: ctx.y }
  await nextTick()
  const el = document.getElementById('ctxMenu')
  if (!el) return
  const w = el.offsetWidth, h = el.offsetHeight
  const margin = 8
  pos.value = {
    x: Math.min(ctx.x, window.innerWidth - w - margin),
    y: Math.min(ctx.y, window.innerHeight - h - margin),
  }
})

const allItems = [
  { action: ACTIONS.VISIT, text: '打开网站' },
  { action: ACTIONS.EDIT, text: '编辑' },
  { action: ACTIONS.HISTORY, text: '版本历史' },
  { action: ACTIONS.DELETE, text: '删除', danger: true },
  { action: ACTIONS.MOVE_TO_CAT, text: '移动到' },
  { action: ACTIONS.SHARE_GROUP, text: '分享组' },
  { action: ACTIONS.ADD_BOOKMARK, text: '添加书签' },
  { action: ACTIONS.ADD_GROUP, text: '添加组' },
  { action: ACTIONS.ADD_CAT, text: '添加分类' },
  { action: ACTIONS.MULTI_SELECT, text: '多选' },
  { action: ACTIONS.RENAME_ATTR, text: '重命名' },
  { action: ACTIONS.DETAIL, text: '查看详情' },
]

const RULES: Record<string, { show: string[]; text: Record<string, string> }> = {
  card:         { show: [ACTIONS.DETAIL, ACTIONS.VISIT, ACTIONS.EDIT, ACTIONS.HISTORY, ACTIONS.DELETE, ACTIONS.MOVE_TO_CAT, ACTIONS.MULTI_SELECT], text: {} },
  sub:          { show: [ACTIONS.VISIT, ACTIONS.EDIT, ACTIONS.DELETE], text: { [ACTIONS.VISIT]: '查看详情' } },
  cat:          { show: [ACTIONS.EDIT, ACTIONS.DELETE], text: { [ACTIONS.EDIT]: '重命名' } },
  attr:         { show: [ACTIONS.RENAME_ATTR, ACTIONS.DELETE], text: { [ACTIONS.RENAME_ATTR]: '重命名' } },
  group:        { show: [ACTIONS.DETAIL, ACTIONS.EDIT, ACTIONS.HISTORY, ACTIONS.DELETE, ACTIONS.MOVE_TO_CAT, ACTIONS.SHARE_GROUP], text: { [ACTIONS.EDIT]: '编辑组名', [ACTIONS.DELETE]: '删除组', [ACTIONS.SHARE_GROUP]: '分享组' } },
  'group-card': { show: [ACTIONS.VISIT, ACTIONS.EDIT, ACTIONS.DELETE], text: { [ACTIONS.VISIT]: '查看详情', [ACTIONS.EDIT]: '编辑书签', [ACTIONS.DELETE]: '从组移除' } },
  'rail-empty': { show: [ACTIONS.ADD_CAT], text: {} },
  'grid-empty': { show: [ACTIONS.ADD_BOOKMARK, ACTIONS.ADD_GROUP, ACTIONS.MULTI_SELECT], text: {} },
}

const DEFAULT_TEXT: Record<string, string> = { [ACTIONS.VISIT]: '打开网站', [ACTIONS.EDIT]: '编辑', [ACTIONS.DELETE]: '删除' }

const visibleItems = computed(() => {
  const rule = RULES[ctx.type] || { show: [], text: {} }
  const showSet = new Set(rule.show)
  const textMap = { ...DEFAULT_TEXT, ...rule.text }
  const items: Array<{ action: string; text: string; danger?: boolean; divider?: boolean }> = []
  for (const item of allItems) {
    if (!showSet.has(item.action)) continue
    items.push({ ...item, text: textMap[item.action] || item.text })
  }
  return items
})

function onItemClick(action: string) {
  const tid = ctx.id
  const ttype = ctx.type
  ctx.hide()
  _dispatchAction(ttype, action, tid)
}

function _dispatchAction(type: string, action: string, id: string) {
  if (type === 'card') {
    if (action === ACTIONS.DETAIL) openDetail(id)
    if (action === ACTIONS.VISIT) visit(null, id)
    if (action === ACTIONS.EDIT) openBmModal(id)
    if (action === ACTIONS.DELETE) deleteBookmarkWithUndo(id)
    if (action === ACTIONS.HISTORY) { store.historyItemId = id; store.historyItemType = 'bookmark'; store.panels.history = true }
  } else if (type === 'sub') {
    if (action === ACTIONS.VISIT) openDetail(id)
    if (action === ACTIONS.EDIT) openBmModal(id)
    if (action === ACTIONS.DELETE) deleteBookmarkWithUndo(id)
  } else if (type === 'cat') {
    if (action === ACTIONS.EDIT) openCatModal()
    if (action === ACTIONS.DELETE) deleteCategory(id)
  } else if (type === 'attr') {
    if (action === ACTIONS.RENAME_ATTR) {
      const dataStore = useDataStore()
      const attr = store.customAttributes.find(a => a.id === id)
      if (attr) {
        const input = window.prompt('重命名属性', attr.name)
        if (input && input.trim() && input.trim() !== attr.name) {
          dataStore.renameAttribute(id, input.trim())
          store.save()
        }
      }
    }
    if (action === ACTIONS.DELETE) deleteAttribute(id)
  } else if (type === 'group') {
    if (action === ACTIONS.DETAIL) openDetail('group:' + id)
    if (action === ACTIONS.EDIT) editGroup(id)
    if (action === ACTIONS.DELETE) deleteGroup(id)
    if (action === ACTIONS.MOVE_TO_CAT) useActionSheetStore().showGroupCategoryPicker(id)
    if (action === ACTIONS.SHARE_GROUP) shareGroup(id)
    if (action === ACTIONS.HISTORY) { store.historyItemId = id; store.historyItemType = 'group'; store.panels.history = true }
  } else if (type === 'group-card') {
    if (action === ACTIONS.VISIT) openDetail(id)
    if (action === ACTIONS.EDIT) openBmModal(id)
    if (action === ACTIONS.DELETE) removeBmFromGroup(id, store.ctxGid!)
  } else if (type === 'grid-empty') {
    if (action === ACTIONS.ADD_BOOKMARK) openBmModal()
    if (action === ACTIONS.ADD_GROUP) createGroup()
  } else if (type === 'rail-empty') {
    if (action === ACTIONS.ADD_CAT) { openCatModal(); setTimeout(() => document.getElementById('newCatName')?.focus(), 200) }
  }
}

function _onDocClick(e: MouseEvent) { if (!(e.target as HTMLElement).closest('#ctxMenu')) ctx.hide() }

onMounted(() => {
  document.addEventListener('click', _onDocClick)
})

onUnmounted(() => {
  document.removeEventListener('click', _onDocClick)
})
</script>
