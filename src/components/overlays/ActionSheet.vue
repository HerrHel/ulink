<template>
  <div v-show="visible" class="as-overlay show" @click="hide"></div>
  <div class="action-sheet" :class="{ show: visible, dragging: isDragging }" role="dialog" aria-modal="true" aria-label="操作"
       :style="isDragging ? { transform: `translateY(${dragY}px)` } : {}"
       @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend="onTouchEnd">
    <!-- Category picker mode -->
    <template v-if="mode === 'category'">
      <div class="bmp-header">移动到分类</div>
      <div class="bmp-list">
        <button v-for="cat in categories" :key="cat.id" class="bmp-item" @click="onPickCategory(cat.id)">
          <span class="bmp-item-icon" :style="{ color: cat.color || 'var(--accent)' }">{{ getCategoryIcon(cat.icon) }}</span>
          <span>{{ cat.name }}</span>
        </button>
      </div>
      <div class="bmp-new">
        <input type="text" class="bmp-new-input" v-model="newCatName" placeholder="新建分类名称…" aria-label="新建分类名称" @keydown.enter="onAddNewCat">
        <button class="bmp-new-btn" @click="onAddNewCat" title="添加" v-html="I.plus"></button>
      </div>
    </template>
    <!-- Generic action items mode -->
    <template v-else-if="mode === 'actions'">
      <div class="as-list">
        <button v-for="(item, idx) in items" :key="idx" class="as-item" :class="{ danger: item.danger }"
                @click="onAction(item)">{{ item.label }}</button>
      </div>
    </template>
    <button class="as-cancel" @click="hide">取消</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { setActionSheetAPI } from '../../composables/bridge.js'
import { I, getCategoryIcon } from '../../config/icons.js'
import { addNewCategory } from '../../utils.js'
import { toast } from '../../lib/toast.js'

const store = useAppStore()
const visible = ref(false)
const mode = ref('actions') // 'actions' | 'category'
const items = ref([])
const newCatName = ref('')
const isDragging = ref(false)
const dragY = ref(0)
let startY = 0
let catTargetId = null
let catTargetType = null // 'group' | 'bm'

const categories = computed(() => store.selectableCategories)

const _actionRegistry = {}
function registerAction(id, fn) { _actionRegistry[id] = fn }

function showActionSheet(actionItems) {
  mode.value = 'actions'
  items.value = actionItems
  visible.value = true
}

function showCategoryPicker(targetId, targetType) {
  mode.value = 'category'
  catTargetId = targetId
  catTargetType = targetType
  newCatName.value = ''
  visible.value = true
}

function hide() {
  visible.value = false
  isDragging.value = false
  dragY.value = 0
}

function onAction(item) {
  hide()
  if (typeof item.action === 'function') item.action()
  else if (typeof item.action === 'string' && _actionRegistry[item.action]) _actionRegistry[item.action]()
}

function onPickCategory(catId) {
  hide()
  if (catTargetType === 'group') {
    const g = store.groupMap[catTargetId]
    if (g) { g.categoryId = catId; g.updatedAt = Date.now(); store.save() }
  } else {
    const b = store.bookmarkMap[catTargetId]
    if (b) { b.categoryId = catId; store.save() }
  }
  const cat = store.categories.find(c => c.id === catId)
  toast('已移动到 ' + (cat ? cat.name : ''))
}

function onAddNewCat() {
  const cat = addNewCategory(newCatName.value, store)
  if (cat) onPickCategory(cat.id)
}

// Touch handlers for swipe-down to dismiss
function onTouchStart(e) {
  if (!visible.value) return
  startY = e.touches[0].clientY
  isDragging.value = false
}
function onTouchMove(e) {
  if (!startY) return
  const dy = e.touches[0].clientY - startY
  if (dy > 0) { isDragging.value = true; dragY.value = dy }
}
function onTouchEnd() {
  if (!isDragging.value) { startY = 0; return }
  if (dragY.value > 80) hide()
  else { isDragging.value = false; dragY.value = 0 }
  startY = 0
}

// Bridge: expose API for legacy code
onMounted(() => {
  const api = {
    show: showActionSheet,
    hide,
    registerAction,
    showCategoryPicker: (bmId) => showCategoryPicker(bmId, 'bm'),
    showGroupCategoryPicker: (gid) => showCategoryPicker(gid, 'group'),
    moveGroupToCat: (gid, catId) => { catTargetId = gid; catTargetType = 'group'; onPickCategory(catId) },
    moveBmToCat: (bmId, catId) => { catTargetId = bmId; catTargetType = 'bm'; onPickCategory(catId) },
  }
  setActionSheetAPI(api)
})
</script>
