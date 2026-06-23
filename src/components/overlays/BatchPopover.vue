<template>
  <div id="batchMovePopover" class="batch-move-popover" :class="{ visible: isVisible }">
    <div class="bmp-header">移动到分类</div>
    <div id="batchMoveList" class="bmp-list">
      <button v-for="cat in categories" :key="cat.id" class="bmp-item"
              @click="onMoveToCat(cat.id)">
        <span class="bmp-item-icon" :style="{ color: cat.color || 'var(--accent)' }">
          <span v-html="getCategoryIcon(cat.icon)"></span>
        </span>
        <span>{{ cat.name }}</span>
      </button>
    </div>
    <div class="bmp-new">
      <input type="text" class="bmp-new-input" v-model="newCatName"
             placeholder="新建分类名称…" aria-label="新建分类名称" @keydown.enter="onAddNewCat">
      <button class="bmp-new-btn" @click="onAddNewCat">+</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { setBatchMoveAPI } from '../../composables/bridge.js'
import { getCategoryIcon } from '../../config/icons.js'
import { addNewCategory } from '../../utils.js'
import { batchMoveToCat } from '../../composables/domain/useBatch.js'

const store = useAppStore()
const isVisible = ref(false)
const newCatName = ref('')

const categories = computed(() => store.selectableCategories)

function onMoveToCat(catId: string) {
  batchMoveToCat(catId)
  newCatName.value = ''
  hide()
}

function onAddNewCat() {
  const cat = addNewCategory(newCatName.value, store)
  if (cat) {
    batchMoveToCat(cat.id)
    newCatName.value = ''
    hide()
  }
}

function show() {
  isVisible.value = true
  newCatName.value = ''
  setTimeout(() => {
    document.addEventListener('click', _closeOnOutsideClick)
  }, 0)
}

function hide() {
  isVisible.value = false
  document.removeEventListener('click', _closeOnOutsideClick)
}

function _closeOnOutsideClick(e: MouseEvent) {
  const pop = document.getElementById('batchMovePopover')
  if (pop && !pop.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-action="batchMove"]')) {
    hide()
  }
}

onMounted(() => {
  setBatchMoveAPI({ show, hide })
})

onUnmounted(() => {
  hide()
  setBatchMoveAPI(null)
})
</script>

<!-- Bug #14 fix: removed scoped styles that conflicted with global batch.css positioning -->
<!-- Global CSS (batch.css) handles all .batch-move-popover positioning: position:fixed, centered -->
