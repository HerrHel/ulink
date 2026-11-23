<template>
  <div class="settings-tab-panel" data-testid="settings-panel-appearance">
    <div class="sp-tab-header">
      <h3 class="sp-tab-title">{{ t('settings.tabAppearance') }}</h3>
    </div>

    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.colorAndTheme') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.theme') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-seg">
            <button class="sp-seg-btn" data-testid="lv-theme-light" :class="{ active: uiStore.themeMode !== 'auto' && uiStore.themeColor === 'light' }" @click.stop="onSetThemeColor('light', $event)">
              <span aria-hidden="true" v-html="I.sun" class="sp-icon"></span>{{ t('settings.themeLight') }}
            </button>
            <button class="sp-seg-btn" data-testid="lv-theme-dark" :class="{ active: uiStore.themeMode !== 'auto' && uiStore.themeColor === 'dark' }" @click.stop="onSetThemeColor('dark', $event)">
              <span aria-hidden="true" v-html="I.moon" class="sp-icon"></span>{{ t('settings.themeDark') }}
            </button>
            <button class="sp-seg-btn" data-testid="lv-theme-auto" :class="{ active: uiStore.themeMode === 'auto' }" @click.stop="onSetThemeAuto">
              <span aria-hidden="true" v-html="I.monitor" class="sp-icon"></span>{{ t('settings.themeAuto') }}
            </button>
          </div>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.designStyle') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-seg">
            <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'premium' }" @click.stop="onSetThemeStyle('premium')">{{ t('settings.themePremium') }}</button>
            <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'comfortable' }" @click.stop="onSetThemeStyle('comfortable')">{{ t('settings.themeComfortable') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.viewAndSort') }}</div>
      <!-- 移动端无大宫格，只给列表 / 小宫格两档 -->
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.layout') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-seg">
            <button v-if="!uiStore.isMobile" class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'grid' }" @click="onSetLayout('grid')" :title="t('settings.gridView')"><span aria-hidden="true" v-html="I.grid"></span> {{ t('settings.gridView') }}</button>
            <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'list' }" @click="onSetLayout('list')" :title="t('settings.listView')"><span aria-hidden="true" v-html="I.list"></span> {{ t('settings.listView') }}</button>
            <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'mini-grid' }" @click="onSetLayout('mini-grid')" :title="t('settings.miniGridView')"><span aria-hidden="true" v-html="I.miniGrid"></span> {{ t('settings.miniGridView') }}</button>
          </div>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.sort') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-seg sp-seg-wrap">
            <button v-for="s in sortModes" :key="s.id" class="sp-seg-btn" :class="{ active: uiStore.sortMode === s.id }" @click="onSetSortMode(s.id)">{{ t(s.labelKey) }}</button>
          </div>
        </div>
      </div>
      <div class="sp-card-row" @click="onToggleGroupsOnTop" style="cursor: pointer;">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.groupsOnTop') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-toggle-pill" :class="{ active: uiStore.groupsOnTop }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-card" data-testid="lv-lang-switch">
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.language') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-seg">
            <button class="sp-seg-btn" :class="{ active: locale === 'zh-CN' }" @click="setLocale('zh-CN')">简体中文</button>
            <button class="sp-seg-btn" :class="{ active: locale === 'en-US' }" @click="setLocale('en-US')">English</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 设置面板 ·「外观与视图（主题 / 布局 / 排序 / 语言）」标签页。共享实例经 settingsContext 注入，见该文件说明。 */
import { useUIStore, type ThemeStyle, type SortMode, type LayoutMode } from '../../../stores/ui.js'
import { setThemeStyle as themeSetStyle } from '../../../lib/theme.js'
import { I } from '../../../config/icons.js'
import { t, useI18n } from '../../../i18n/index.js'

const uiStore = useUIStore()

const { locale, setLocale } = useI18n()

const sortModes: { id: SortMode; labelKey: string }[] = [
  { id: 'order', labelKey: 'settings.sortCustom' },
  { id: 'title', labelKey: 'settings.sortTitle' },
  { id: 'dateDesc', labelKey: 'settings.sortDateDesc' },
  { id: 'dateAsc', labelKey: 'settings.sortDateAsc' },
  { id: 'useCount', labelKey: 'settings.sortUseCount' },
]

function onSetThemeColor(val: 'light' | 'dark', e?: MouseEvent) {
  uiStore.setThemeColor(val, e)
}

function onSetThemeStyle(style: ThemeStyle) {
  themeSetStyle(style)
  uiStore.themeStyle = style
}

/** 三选一的「自动」：已是自动则不动（toggleAutoTheme 是开关语义，重复点击会切回手动） */
function onSetThemeAuto() {
  if (uiStore.themeMode !== 'auto') uiStore.toggleAutoTheme()
}

function onSetLayout(mode: LayoutMode) {
  if (uiStore.focusedGroupId) return
  // 移动端不可用 grid：拦截
  if (uiStore.isMobile && mode === 'grid') return
  uiStore.layoutMode = mode
  if (uiStore.isMobile && (mode === 'list' || mode === 'mini-grid')) {
    uiStore._mobileLayoutMode = mode
  }
  // A4-005：即时落盘，不依赖 beforeunload
  uiStore.saveUIState()
}

function onSetSortMode(mode: SortMode) {
  uiStore.sortMode = mode
  uiStore.saveUIState()
}

function onToggleGroupsOnTop() {
  uiStore.groupsOnTop = !uiStore.groupsOnTop
  uiStore.saveUIState()
}
</script>
