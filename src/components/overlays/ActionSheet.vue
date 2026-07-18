<template>
  <div v-show="store.visible" class="as-overlay show" @click="store.hide()"></div>
  <div class="action-sheet" :class="{ show: store.visible, dragging: store.isDragging }" role="dialog" aria-modal="true" aria-label="操作"
       :style="store.isDragging ? { transform: `translateY(${store.dragY}px)` } : {}"
       @touchstart.passive="store.onTouchStart" @touchmove.passive="store.onTouchMove" @touchend="store.onTouchEnd">
    <!-- Category picker mode -->
    <template v-if="store.mode === 'category'">
      <div class="bmp-header">移动到分类</div>
      <div class="bmp-list">
        <button v-for="cat in store.categories" :key="cat.id" class="bmp-item" @click="store.onPickCategory(cat.id)">
          <span class="bmp-item-icon" :style="{ color: cat.color || 'var(--accent)' }" v-html="getCategoryIcon(cat.icon)"></span>
          <span>{{ cat.name }}</span>
        </button>
      </div>
      <div class="bmp-new">
        <input type="text" class="bmp-new-input" v-model="store.newCatName" placeholder="新建分类名称…" aria-label="新建分类名称" @keydown.enter="onAddNewCat">
        <button class="bmp-new-btn" @click="onAddNewCat" title="添加" v-html="I.plus"></button>
      </div>
    </template>
    <!-- Generic action items mode -->
    <template v-else-if="store.mode === 'actions'">
      <div class="as-list">
        <button v-for="(item, idx) in store.items" :key="idx" class="as-item" :class="{ danger: item.danger }"
                @click="store.onAction(item)">{{ item.label }}</button>
      </div>
    </template>
    <button class="as-cancel" @click="store.hide()">取消</button>
  </div>
</template>

<script setup lang="ts">
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { useAppStore } from '../../stores/app.js'
import { I, getCategoryIcon } from '../../config/icons.js'
import { addNewCategory } from '../../utils.js'

const store = useActionSheetStore()

function onAddNewCat() {
  const cat = addNewCategory(store.newCatName, useAppStore())
  if (cat) store.onPickCategory(cat.id)
}
</script>
