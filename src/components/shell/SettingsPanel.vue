<template>
  <div class="sp" v-show="store.settingsOpen">
    <!-- Theme -->
    <div class="sp-section">
      <div class="sp-row">
        <span class="sp-row-label">主题</span>
        <div class="sp-seg">
          <button class="sp-seg-btn" :class="{ active: store.themeStyle === 'premium' }" @click="onSetThemeStyle('premium')">效率</button>
          <button class="sp-seg-btn" :class="{ active: store.themeStyle === 'comfortable' }" @click="onSetThemeStyle('comfortable')">舒适</button>
        </div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-toggle-row" :class="{ active: store.themeMode === 'auto' }" @click="onToggleAutoTheme">
        <span v-html="I.sun" class="sp-icon auto-icon-sun"></span>
        <span v-html="I.moon" class="sp-icon auto-icon-moon"></span>
        <span class="sp-toggle-label">跟随系统</span>
        <span class="sp-switch"></span>
      </div>
    </div>
    <!-- Layout -->
    <div class="sp-section sp-section-layout">
      <div class="sp-row">
        <span class="sp-row-label">视图</span>
        <div class="sp-seg">
          <button class="sp-seg-btn" :class="{ active: store.layoutMode === 'grid' }" :disabled="uiStore.isMobile" @click="onSetLayout('grid')" title="网格视图"><span v-html="I.grid"></span></button>
          <button class="sp-seg-btn" :class="{ active: store.layoutMode === 'list' }" :disabled="uiStore.isMobile" @click="onSetLayout('list')" title="列表视图"><span v-html="I.list"></span></button>
        </div>
      </div>
    </div>
    <!-- Sort -->
    <div class="sp-section">
      <div class="sp-row">
        <span class="sp-row-label">排序</span>
        <div class="sp-seg sp-seg-wrap">
          <button v-for="s in sortModes" :key="s.id" class="sp-seg-btn"
                  :class="{ active: store.sortMode === s.id }" @click="onSetSortMode(s.id)">{{ s.label }}</button>
        </div>
      </div>
    </div>
    <!-- Master Password -->
    <div class="sp-section">
      <div class="sp-row">
        <span class="sp-row-label">密码加密</span>
        <button class="btn btn-ghost btn-sm" @click.stop="onOpenMasterPassword">
          {{ store.masterPassword ? '已设置 ✓' : '设置主密码' }}
        </button>
      </div>
      <div v-if="store.masterPassword" class="sp-row pt-1">
        <span class="flex-1"></span>
        <button class="btn btn-ghost btn-sm text-danger" @click.stop="store.clearMasterPassword()">清除</button>
      </div>
    </div>
    <!-- Data -->
    <div class="sp-section">
      <div class="sp-actions">
        <button class="sp-action" @click.stop="onTriggerImport"><span v-html="I.import"></span>导入数据</button>
        <button class="sp-action" @click.stop="onExportData"><span v-html="I.export"></span>导出数据</button>
      </div>
    </div>
    <!-- Danger -->
    <div class="sp-section sp-danger">
      <button class="sp-danger-btn" @click.stop="onResetData">
        <span v-html="I.trash"></span>重置所有数据
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import { toggleAutoTheme as themeToggleAuto, setThemeStyle as themeSetStyle } from '../../lib/theme.js'
import { exportData, resetToDefaults } from '../../composables/domain/useDataIO.js'
import { I } from '../../config/icons.js'

function triggerImport() { const el = document.getElementById('importFile'); if (el) el.click() }

const store = useAppStore()
const uiStore = useUIStore()

const sortModes = [
  { id: 'order', label: '自定义' },
  { id: 'title', label: '名称' },
  { id: 'dateDesc', label: '新→旧' },
  { id: 'dateAsc', label: '旧→新' },
  { id: 'useCount', label: '常用' },
]

function onSetThemeStyle(style) {
  themeSetStyle(style)
  store.themeStyle = style
  if (store.themeMode === 'auto') {
    themeToggleAuto()
    store.themeMode = 'manual'
  }
}

function onToggleAutoTheme() {
  themeToggleAuto()
  store.themeMode = localStorage.getItem('lv_themeMode') === 'auto' ? 'auto' : 'manual'
}

function onSetLayout(mode) {
  if (store.focusedGroupId) return
  if (uiStore.isMobile) return
  store.layoutMode = mode
}

function onSetSortMode(mode) {
  store.sortMode = mode
}

function onOpenMasterPassword() { store.masterPasswordOpen = true; store.settingsOpen = false }
function onTriggerImport() { triggerImport(); store.settingsOpen = false }
function onExportData() { exportData(); store.settingsOpen = false }
function onResetData() { resetToDefaults(); store.settingsOpen = false }
</script>
