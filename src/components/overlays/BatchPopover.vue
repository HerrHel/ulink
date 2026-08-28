<template>
  <div id="batchMovePopover" class="batch-move-popover" :class="{ visible: bmStore.open }">
    <div class="bmp-header">{{ t('batch.moveToCategory') }}</div>
    <div id="batchMoveList" class="bmp-list">
      <button v-for="cat in categories" :key="cat.id" class="bmp-item"
              @click="onMoveToCat(cat.id)">
        <span class="bmp-item-icon" :style="{ color: cat.color || 'var(--accent)' }">
          <span v-html="getCategoryIcon(cat.icon)"></span>
        </span>
        <span>{{ cat.name }}</span>
      </button>
      <button v-if="showVaultOption" class="bmp-item bmp-item-vault"
              @click="onMoveToVault">
        <span class="bmp-item-icon" style="color: var(--vault-color, #9b59b6)">
          <span v-html="I.lock"></span>
        </span>
        <span>{{ t('vault.privateSpace') }}</span>
      </button>
    </div>
    <div class="bmp-new">
      <input type="text" class="bmp-new-input" v-model="newCatName"
             :placeholder="t('batch.newCategoryPlaceholder')" :aria-label="t('batch.newCategoryPlaceholder')" @keydown.enter="onAddNewCat">
      <button class="bmp-new-btn" @click="onAddNewCat">+</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import { useVaultStore } from '../../stores/vault.js'
import { useBatchMoveStore } from '../../stores/overlay.js'
import { I, getCategoryIcon } from '../../config/icons.js'
import { addNewCategory } from '../../utils.js'
import { batchMoveToCat } from '../../composables/domain/useBatch.js'
import { moveBatchSelectedToVault } from '../../composables/domain/useSpaceMove.js'
import { t } from '../../i18n/index.js'

const store = useAppStore()
const uiStore = useUIStore()
const vaultStore = useVaultStore()
const bmStore = useBatchMoveStore()
const newCatName = ref('')

const categories = computed(() => store.selectableCategories)
const showVaultOption = computed(() => vaultStore.isVaultEnabled && uiStore.curSpace === 'main')

function onMoveToCat(catId: string) {
  batchMoveToCat(catId)
  newCatName.value = ''
  bmStore.hide()
}

async function onMoveToVault() {
  await moveBatchSelectedToVault([...uiStore.batchSelected])
  bmStore.hide()
}

function onAddNewCat() {
  const cat = addNewCategory(newCatName.value, store)
  if (cat) {
    batchMoveToCat(cat.id)
    newCatName.value = ''
    bmStore.hide()
  }
}

// M14：不重写 store action；watch open 同步 document 监听，卸载时移除，避免重挂叠层
function _closeOnOutsideClick(e: MouseEvent) {
  const pop = document.getElementById('batchMovePopover')
  if (pop && !pop.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-action="batchMove"]')) {
    bmStore.hide()
  }
}

// FIX(repro): 多选模式「移动到」列表看不到最新分类——新分类 order=分类计数恒排列表
// 末尾，分类多时（>8 个）被 280px 折叠区裁掉，打开弹层停留在顶部看不到。
// 打开时滚动到列表底部，让最新分类（末尾）立即可见；分类少时无滚动不受影响。
function _scrollNewestIntoView() {
  nextTick(() => {
    const list = document.getElementById('batchMoveList')
    if (list) list.scrollTop = list.scrollHeight
  })
}

watch(() => bmStore.open, (open) => {
  if (open) {
    newCatName.value = ''
    _scrollNewestIntoView()
    document.addEventListener('click', _closeOnOutsideClick)
  } else {
    document.removeEventListener('click', _closeOnOutsideClick)
  }
})

onUnmounted(() => {
  document.removeEventListener('click', _closeOnOutsideClick)
  if (bmStore.open) bmStore.hide()
})
</script>

<!-- Bug #14 fix: removed scoped styles that conflicted with global batch.css positioning -->
<!-- Global CSS (batch.css) handles all .batch-move-popover positioning: position:fixed, centered -->
