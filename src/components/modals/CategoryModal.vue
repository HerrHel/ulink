<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="分类管理" id="catModal" :class="{ open: store.modals.category }" @click.self="onClose">
    <div class="modal">
      <div class="modal-head"><h2>管理分类</h2><button class="modal-close" @click="onClose" title="关闭" aria-label="关闭" v-html="I.close"></button></div>
      <div class="modal-body">
        <div class="flex-center gap-2 mb-3">
          <input type="text" class="form-input flex-1" v-model="newName" ref="newNameRef" placeholder="新分类名称" aria-label="新分类名称" @keydown.enter="onAddCat">
          <button class="btn btn-primary btn-sm" @click="onAddCat">添加</button>
        </div>
        <div class="cat-sort-list" ref="catListRef">
          <div class="cat-list-item cat-no-drag">
            <span class="flex-1">{{ uncategorizedCat.name }}</span>
          </div>
          <div v-for="cat in sortableList" :key="cat.id" class="cat-list-item" :data-cat-id="cat.id">
            <span class="cat-drag-handle" aria-hidden="true" v-html="I.grip"></span>
            <template v-if="editingId === cat.id">
              <input class="form-input flex-1 form-input-sm" v-model="editingName" aria-label="分类名称" @keydown.enter="confirmRename" @keydown.escape="cancelRename" :ref="setEditInputRef">
              <button class="btn btn-primary btn-sm" @click="confirmRename" title="确认重命名">✓</button>
            </template>
            <template v-else>
              <span class="flex-1">{{ cat.name }}</span>
              <button class="btn-xs icon-xs" @click="startRename(cat)" title="编辑" v-html="I.edit"></button>
              <button class="btn-xs btn-danger icon-xs" @click="onDelete(cat.id)" title="删除" v-html="I.trash"></button>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { addNewCategory } from '../../utils.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { I } from '../../config/icons.js'
import { useInlineRename } from '../../composables/ui/useInlineRename.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Category } from '../../types.js'

const store = useAppStore()
const dataStore = useDataStore()
const newName = ref('')
const newNameRef = ref<HTMLInputElement | null>(null)
const { editingId, editingName, setEditInputRef, startRename, confirmRename, cancelRename } = useInlineRename(store, 'renameCategory')
const catListRef = ref<HTMLElement | null>(null)

const uncategorizedCat = computed(() => dataStore.categories.find(c => c.id === CAT_UNCATEGORIZED) || { id: CAT_UNCATEGORIZED, name: '未分类' })

const sortableList = ref<Category[]>([])

watch(() => store.modals.category, (open) => {
  if (open) nextTick(() => newNameRef.value?.focus())
})

watch(() => dataStore.selectableCategories, (val) => {
  sortableList.value = val.filter(c => c.id !== CAT_UNCATEGORIZED).map(c => ({ ...c }))
}, { immediate: true, deep: true })

// ── 拖拽排序 ──
const EDGE = 50
const SPEED = 10

interface DragState {
  el: HTMLElement
  placeholder: HTMLElement
  startY: number
  initialTop: number
  lastY: number
  itemHeight: number
  currentIndex: number
  pointerId: number
}

let drag: DragState | null = null
let scrollRaf: number | null = null

function getSortableItems(): HTMLElement[] {
  if (!catListRef.value) return []
  return Array.from(catListRef.value.querySelectorAll('.cat-list-item[data-cat-id]'))
}

function onPointerDown(e: PointerEvent) {
  const handle = (e.target as HTMLElement).closest('.cat-drag-handle')
  if (!handle) return
  const item = handle.closest('.cat-list-item[data-cat-id]') as HTMLElement | null
  if (!item || !catListRef.value) return

  e.preventDefault()
  item.setPointerCapture(e.pointerId)

  const rect = item.getBoundingClientRect()
  const allItems = getSortableItems()
  const idx = allItems.indexOf(item)

  const ph = document.createElement('div')
  ph.className = 'cat-list-item cat-placeholder'
  ph.style.height = rect.height + 'px'
  catListRef.value.insertBefore(ph, item)

  document.body.appendChild(item)
  item.classList.add('cat-dragging')
  item.style.position = 'fixed'
  item.style.left = rect.left + 'px'
  item.style.top = rect.top + 'px'
  item.style.width = rect.width + 'px'
  item.style.margin = '0'
  item.style.zIndex = '9999'
  item.style.transition = 'none'

  drag = {
    el: item,
    placeholder: ph,
    startY: e.clientY,
    initialTop: rect.top,
    lastY: e.clientY,
    itemHeight: rect.height,
    currentIndex: idx,
    pointerId: e.pointerId
  }

  document.addEventListener('pointermove', onPointerMove, { passive: false })
}

function onPointerMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return
  e.preventDefault()
  drag.lastY = e.clientY

  const top = drag.initialTop + (drag.lastY - drag.startY)
  drag.el.style.top = top + 'px'

  const allItems = getSortableItems().filter(c => c !== drag!.el)
  let newIndex = allItems.length
  for (let i = 0; i < allItems.length; i++) {
    if (allItems[i] === drag!.placeholder) continue
    const r = allItems[i].getBoundingClientRect()
    if (top + drag!.itemHeight / 2 < r.top + r.height / 2) {
      newIndex = i
      break
    }
  }
  if (newIndex !== drag.currentIndex) {
    drag.currentIndex = newIndex
    const refEl = allItems[newIndex]
    if (refEl) catListRef.value!.insertBefore(drag.placeholder, refEl)
    else catListRef.value!.appendChild(drag.placeholder)
  }

  // 边缘滚动
  const scrollEl = catListRef.value!
  const scrollRect = scrollEl.getBoundingClientRect()
  let delta = 0
  if (drag.lastY - scrollRect.top < EDGE && scrollEl.scrollTop > 0) {
    delta = -Math.round(SPEED * (1 - Math.max(0, drag.lastY - scrollRect.top) / EDGE))
  } else if (scrollRect.bottom - drag.lastY < EDGE) {
    const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop
    if (maxScroll > 0) delta = Math.min(Math.round(SPEED * (1 - Math.max(0, scrollRect.bottom - drag.lastY) / EDGE)), maxScroll)
  }
  if (delta) scrollEl.scrollTop += delta
}

function onPointerUp(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.pointerId) return
  document.removeEventListener('pointermove', onPointerMove)

  const d = drag
  drag = null

  d.el.classList.remove('cat-dragging')
  d.el.style.position = ''
  d.el.style.left = ''
  d.el.style.top = ''
  d.el.style.width = ''
  d.el.style.margin = ''
  d.el.style.zIndex = ''
  d.el.style.transition = ''

  d.placeholder.parentNode!.insertBefore(d.el, d.placeholder)
  d.placeholder.remove()

  // 重建顺序
  const allItems = getSortableItems()
  const newOrder: Category[] = []
  allItems.forEach(item => {
    const catId = item.dataset.catId
    if (catId) {
      const found = sortableList.value.find(c => c.id === catId)
      if (found) newOrder.push(found)
    }
  })
  if (newOrder.length === sortableList.value.length) {
    sortableList.value = newOrder
    const special = dataStore.categories.filter(c => c.id === CAT_ALL || c.id === CAT_UNCATEGORIZED)
    const reordered = [...special, ...newOrder]
    // 标记所有分类为 dirty（顺序变更）
    for (const cat of reordered) {
      dataStore._markDirty(cat.id)
      dataStore._trackChange(cat.id, 'order')
    }
    dataStore.categories = reordered
    store.debouncedSave()
    toast('分类顺序已更新')
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, { passive: false })
  document.addEventListener('pointerup', onPointerUp)
  document.addEventListener('pointercancel', onPointerUp)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointercancel', onPointerUp)
  document.removeEventListener('pointermove', onPointerMove)
})

function onClose() { store.modals.category = false }

function onAddCat() {
  if (addNewCategory(newName.value, store)) newName.value = ''
}

function onDelete(id: string) {
  const cat = dataStore.categories.find(c => c.id === id)
  const catName = cat?.name || '此分类'
  const bmCount = dataStore.bookmarks.filter(b => b.categoryId === id).length
  const msg = bmCount > 0
    ? `删除「${catName}」后，其中 ${bmCount} 个书签将移至"未分类"，确定删除吗？`
    : `确定删除「${catName}」吗？`
  showConfirm(msg).then(ok => {
    if (!ok) return
    store.deleteCategory(id)
    store.save()
    toast('分类已删除')
  })
}
</script>


