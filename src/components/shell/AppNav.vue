<template>
  <nav class="icon-rail" :class="{ open: uiStore.panels.rail }" aria-label="导航">
    <div class="rail-logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
      <span class="rail-logo-text" :data-space="uiStore.curSpace">{{ isVault ? '私密' : 'Link' }}<span v-if="!isVault">Vault</span></span>
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
      <button v-if="isVault" class="rail-item" data-testid="btnBackToMain" @click="onBackToMain">
        <span aria-hidden="true" v-html="I.back"></span>
        返回主页
      </button>
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
import { useVault } from '../../composables/domain/useVault.js'
import { toggleTheme as _toggleTheme } from '../../lib/theme.js'
import { openCatModal } from '../../composables/ui/useUI.js'
import { I, getCategoryIcon } from '../../config/icons.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { storageBarColorFor } from './storageBarColor.js'

const store = useAppStore()
const dataStore = useDataStore()
const uiStore = useUIStore()
const vault = useVault()

// 当前是否在私密空间（数据集）；入口/返回按钮与 logo 切换依此
const isVault = computed(() => uiStore.curSpace === 'vault')

// B-11：按 order 升序渲染，pull 后字段已更新但数组位置可能仍是本地旧序。
// 置顶护栏：全部/未分类是虚拟分类，恒排最前，不参与 order 排序——云端存量
// order 可能是 B-12 修复前的毫秒戳（超界），pull assign 直接覆盖本地 0/1 会让
// 这两项穿插进真实分类之间；渲染层置顶后 order 数据异常不再影响显示顺序。
const categories = computed(() => {
  const all = dataStore.categories
  const virtual = all.filter(c => !c.deletedAt && (c.id === CAT_ALL || c.id === CAT_UNCATEGORIZED))
  const rest = all
    .filter(c => !c.deletedAt && c.id !== CAT_ALL && c.id !== CAT_UNCATEGORIZED)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return [...virtual, ...rest]
})
const curCat = computed(() => uiStore.curCat)
const cardCounts = computed(() => dataStore.cardCounts)

const storageInfo = computed(() => {
  try { return store.getStorageInfo() } catch { return null }
})

const storageBarColor = computed(() => storageBarColorFor(storageInfo.value?.percent))

function selectCat(id: string) {
  uiStore.curCat = id
  uiStore.focusedGroupId = null
  // A4-006：移动端点分类后关 rail，避免遮罩残留
  if (uiStore.isMobile) uiStore.panels.rail = false
}


/** 退出私密空间：锁保险柜并切回主页数据集 */
async function onBackToMain() {
  vault.lockVault()
  await dataStore.switchSpace('main')
}

function toggleTheme() {
  _toggleTheme()
  if (uiStore.themeMode === 'auto') {
    uiStore.themeMode = 'manual'
  }
}
function openCatModalNav() { openCatModal() }
</script>