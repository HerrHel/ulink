<template>
  <nav class="icon-rail" :class="{ open: uiStore.panels.rail }" aria-label="导航">
    <div class="rail-logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
      <span class="rail-logo-text">Link<span>Vault</span></span>
    </div>
    <div class="rail-section-label">分类</div>
    <div class="rail-nav" id="railNav">
      <!-- Phase 2: Vue 模板渲染替代 innerHTML -->
      <button
        v-for="cat in categories"
        :key="cat.id"
        class="rail-item"
        :class="{ active: curCat === cat.id }"
        :data-cat-id="cat.id"
        :draggable="cat.id !== CAT_ALL && cat.id !== CAT_UNCATEGORIZED"
        @click="selectCat(cat.id)"
      >
        <span v-html="getCategoryIcon(cat.icon)"></span>
        {{ cat.name }}
        <span class="rail-count">{{ cardCounts[cat.id] || 0 }}</span>
      </button>
    </div>
    <div class="rail-storage" id="railStorage">
      <div v-if="storageInfo" class="flex-1">
        <div class="rail-storage-track">
          <div class="rail-storage-bar" :style="{ width: storageInfo.percent + '%', background: storageBarColor }"></div>
        </div>
      </div>
      <span v-if="storageInfo" class="rail-storage-text">
        {{ storageInfo.label }}
        <span class="rail-storage-pct">({{ storageInfo.percent }}%)</span>
      </span>
    </div>
    <div class="rail-bottom">
      <button class="rail-item" id="btnManageCats" @click="openCatModalNav">
        <span aria-hidden="true" v-html="I.settings"></span>
        管理分类
      </button>
      <button class="theme-toggle" @click="toggleTheme" aria-label="切换深浅色主题">
        <span class="icon-sun" aria-hidden="true" v-html="I.sun"></span>
        <span class="icon-moon" aria-hidden="true" v-html="I.moon"></span>
        切换主题
      </button>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { toggleTheme as _toggleTheme } from '../../lib/theme.js'
import { openCatModal } from '../../composables/ui/useUI.js'
import { I, getCategoryIcon } from '../../config/icons.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'

const store = useAppStore()
const dataStore = useDataStore()
const uiStore = useUIStore()

// B-11：按 order 升序渲染，pull 后字段已更新但数组位置可能仍是本地旧序
const categories = computed(() =>
  dataStore.categories.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
)
const curCat = computed(() => uiStore.curCat)
const cardCounts = computed(() => dataStore.cardCounts)

const storageInfo = computed(() => {
  try { return store.getStorageInfo() } catch { return null }
})

const storageBarColor = computed(() => {
  if (!storageInfo.value) return 'var(--accent)'
  const p = storageInfo.value.percent
  return p > 90 ? 'var(--danger)' : p > 70 ? 'var(--warn)' : 'var(--accent)'
})

function selectCat(id: string) {
  uiStore.curCat = id
  uiStore.focusedGroupId = null
  // A4-006：移动端点分类后关 rail，避免遮罩残留
  if (uiStore.isMobile) uiStore.panels.rail = false
}

function toggleTheme() {
  _toggleTheme()
  if (uiStore.themeMode === 'auto') {
    uiStore.themeMode = 'manual'
  }
}
function openCatModalNav() { openCatModal() }
</script>