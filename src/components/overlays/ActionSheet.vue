<template>
  <div v-show="store.visible" class="as-overlay show" @click="store.hide()"></div>
  <div class="action-sheet" :class="{ show: store.visible, dragging: store.isDragging }" role="dialog" aria-modal="true" :aria-label="t('sheet.actions')"
       :style="store.isDragging ? { transform: `translateY(${store.dragY}px)` } : {}"
       @touchstart.passive="store.onTouchStart" @touchmove.passive="store.onTouchMove" @touchend="store.onTouchEnd">
    <!-- Category picker mode -->
    <template v-if="store.mode === 'category'">
      <div class="bmp-header">{{ t('batch.moveToCategory') }}</div>
      <div class="bmp-list">
        <button v-for="cat in store.categories" :key="cat.id" class="bmp-item" @click="store.onPickCategory(cat.id)">
          <span class="bmp-item-icon" :style="{ color: cat.color || 'var(--accent)' }" v-html="getCategoryIcon(cat.icon)"></span>
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
        <input type="text" class="bmp-new-input" v-model="store.newCatName" :placeholder="t('batch.newCategoryPlaceholder')" :aria-label="t('batch.newCategoryPlaceholder')" @keydown.enter="onAddNewCat">
        <button class="bmp-new-btn" @click="onAddNewCat" :title="t('common.add')" v-html="I.plus"></button>
      </div>
    </template>
    <!-- Generic action items mode -->
    <template v-else-if="store.mode === 'actions'">
      <div class="as-list">
        <button v-for="(item, idx) in store.items" :key="idx" class="as-item" :class="{ danger: item.danger }"
                @click="store.onAction(item)">{{ item.label }}</button>
      </div>
    </template>
    <button class="as-cancel" @click="store.hide()">{{ t('common.cancel') }}</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { useAppStore } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import { useVaultStore } from '../../stores/vault.js'
import { I, getCategoryIcon } from '../../config/icons.js'
import { addNewCategory } from '../../utils.js'
import { moveBatchSelectedToVault } from '../../composables/domain/useSpaceMove.js'
import { t } from '../../i18n/index.js'

const store = useActionSheetStore()
const uiStore = useUIStore()
const vaultStore = useVaultStore()

const showVaultOption = computed(() => vaultStore.isVaultEnabled && uiStore.curSpace === 'main')

function onAddNewCat() {
  const cat = addNewCategory(store.newCatName, useAppStore())
  if (cat) store.onPickCategory(cat.id)
}

async function onMoveToVault() {
  await moveBatchSelectedToVault([...uiStore.batchSelected])
  store.hide()
}
</script>
