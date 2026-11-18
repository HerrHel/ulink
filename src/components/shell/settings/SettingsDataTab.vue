<template>
  <div class="settings-tab-panel" data-testid="settings-panel-data">
    <div class="sp-tab-header">
      <h3 class="sp-tab-title">{{ t('settings.tabData') }}</h3>
      <p class="sp-tab-desc">{{ t('settings.tabDataDesc') }}</p>
    </div>

    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.storageAndSnapshots') }}</div>
      <div v-if="storageInfo" class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.storageOccupied') }}</span>
          <span class="sp-row-desc">{{ t('settings.storageOccupiedDesc', { used: storageInfo.label, percent: storageInfo.percent }) }}</span>
        </div>
        <div class="sp-row-ctrl sp-storage-ctrl">
          <div class="sp-storage-track">
            <div class="sp-storage-bar" :style="{ width: storageInfo.percent + '%', background: storageBarColor }"></div>
          </div>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.trash') }}</span>
          <span class="sp-row-desc">{{ t('settings.trashDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button class="btn btn-secondary btn-sm" @click.stop="onOpenTrash">
            <span aria-hidden="true" v-html="trashIcon"></span>
            {{ t('settings.trash') }}
          </button>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.historyMax') }}</span>
          <span class="sp-row-desc">{{ t('settings.historyMaxDesc', { n: uiStore.historyMax }) }}</span>
        </div>
        <div class="sp-row-ctrl sp-range-ctrl">
          <input type="range" class="sp-range" min="5" max="30" step="1" v-model.number="uiStore.historyMax" @change="onHistoryMaxChange" />
          <span class="sp-range-hint">{{ uiStore.historyMax }}</span>
        </div>
      </div>
    </div>

    <div class="sp-card sp-overflow-visible">
      <div class="sp-card-head">{{ t('settings.backupAndMigration') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.import') }}</span>
          <span class="sp-row-desc">{{ t('settings.importDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button class="btn btn-secondary btn-sm" @click.stop="onTriggerImport">
            <span aria-hidden="true" v-html="I.import"></span>
            {{ t('settings.import') }}
          </button>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.export') }}</span>
          <span class="sp-row-desc">{{ t('settings.exportDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-export-dropdown" @click.stop>
            <button class="btn btn-secondary btn-sm" @click="exportMenuOpen = !exportMenuOpen">
              <span aria-hidden="true" v-html="I.export"></span>
              {{ t('settings.export') }}
              <span class="sp-caret" :class="{ open: exportMenuOpen }">›</span>
            </button>
            <div v-if="exportMenuOpen" class="sp-export-menu">
              <button class="sp-export-item" @click="onExport('json')">
                <span class="sp-export-name">{{ t('settings.exportJson') }}</span>
                <span class="sp-export-hint">{{ t('settings.exportJsonHint') }}</span>
              </button>
              <button class="sp-export-item" @click="onExport('html')">
                <span class="sp-export-name">{{ t('settings.exportHtml') }}</span>
                <span class="sp-export-hint">{{ t('settings.exportHtmlHint') }}</span>
              </button>
              <button class="sp-export-item" @click="onExport('csv')">
                <span class="sp-export-name">{{ t('settings.exportCsv') }}</span>
                <span class="sp-export-hint">{{ t('settings.exportCsvHint') }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="sp-card-row" @click="onToggleExportKeepSensitive" style="cursor: pointer;" data-testid="lv-export-sensitive-toggle">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.exportKeepSensitive') }}</span>
          <span class="sp-row-desc">{{ t('settings.exportKeepSensitiveHint') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-toggle-pill" :class="{ active: exportKeepSensitive }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
/** 设置面板 ·「数据与备份（导入导出 / 回收站 / 历史保留 / 存储用量）」标签页。共享实例经 settingsContext 注入，见该文件说明。 */
import { computed, onMounted, ref, onBeforeUnmount } from 'vue'
import { useUIStore } from '../../../stores/ui.js'
import { useDataStore } from '../../../stores/data.js'
import { useAppStore } from '../../../stores/app.js'
import { storageBarColorFor } from '../storageBarColor.js'
import { exportData, exportHTML, exportCSV, getExportKeepSensitive, setExportKeepSensitive } from '../../../composables/domain/useDataIO.js'
import { pushNavState } from '../../../composables/interaction/useKeyboardOps.js'
import { I } from '../../../config/icons.js'
import { toast } from '../../../lib/toast.js'
import { t } from '../../../i18n/index.js'

const uiStore = useUIStore()

const dataStore = useDataStore()

function triggerImport() { const el = document.getElementById('importFile') as HTMLInputElement | null; if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() } }

const appStore = useAppStore()

const storageInfo = computed(() => {
  try { return appStore.getStorageInfo() } catch { return null }
})

const storageBarColor = computed(() => storageBarColorFor(storageInfo.value?.percent))

const trashCount = computed(() => dataStore.trashCount)

const trashIcon = computed(() => trashCount.value > 0 ? I.trashFull : I.trash)

function onHistoryMaxChange() {
  uiStore.historyMax = Math.min(30, Math.max(5, uiStore.historyMax))
  uiStore.saveUIState()
}

function onOpenTrash() { pushNavState(); uiStore.panels.trash = true; uiStore.panels.settings = false }

function onTriggerImport() { triggerImport(); uiStore.panels.settings = false }

const exportMenuOpen = ref(false)

function onExport(fmt: 'json' | 'html' | 'csv') {
  if (fmt === 'json') exportData()
  else if (fmt === 'html') exportHTML()
  else if (fmt === 'csv') exportCSV()
  exportMenuOpen.value = false
  uiStore.panels.settings = false
}

// 导出是否保留敏感内容（username/password）：默认关闭，分类导出/完整备份按此开关清洗
const exportKeepSensitive = ref(getExportKeepSensitive())

function onToggleExportKeepSensitive() {
  exportKeepSensitive.value = !exportKeepSensitive.value
  setExportKeepSensitive(exportKeepSensitive.value)
  toast(exportKeepSensitive.value ? t('settings.exportSensitiveOn') : t('settings.exportSensitiveOff'))
}

function _closeExportMenu(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (!t.closest('.sp-export-dropdown')) exportMenuOpen.value = false
}

// 导出下拉菜单：点击外部收起
onMounted(() => document.addEventListener('click', _closeExportMenu))

onBeforeUnmount(() => document.removeEventListener('click', _closeExportMenu))
</script>
