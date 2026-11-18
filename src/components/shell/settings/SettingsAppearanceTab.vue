<template>
  <div class="settings-tab-panel" data-testid="settings-panel-appearance">
    <div class="sp-tab-header">
      <h3 class="sp-tab-title">{{ t('settings.tabAppearance') }}</h3>
      <p class="sp-tab-desc">{{ t('settings.tabAppearanceDesc') }}</p>
    </div>

    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.colorAndTheme') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.theme') }}</span>
          <span class="sp-row-desc">{{ t('settings.themeDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-seg">
            <button class="sp-seg-btn" :class="{ active: uiStore.themeColor === 'light' }" @click.stop="onSetThemeColor('light', $event)">
              <span aria-hidden="true" v-html="I.sun" class="sp-icon"></span>{{ t('settings.themeLight') }}
            </button>
            <button class="sp-seg-btn" :class="{ active: uiStore.themeColor === 'dark' }" @click.stop="onSetThemeColor('dark', $event)">
              <span aria-hidden="true" v-html="I.moon" class="sp-icon"></span>{{ t('settings.themeDark') }}
            </button>
          </div>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.designStyle') }}</span>
          <span class="sp-row-desc">{{ t('settings.designStyleDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-seg">
            <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'premium' }" @click.stop="onSetThemeStyle('premium')">{{ t('settings.themePremium') }}</button>
            <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'comfortable' }" @click.stop="onSetThemeStyle('comfortable')">{{ t('settings.themeComfortable') }}</button>
          </div>
        </div>
      </div>
      <div class="sp-card-row" @click.stop="onToggleAutoTheme" style="cursor: pointer;">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.followSystem') }}</span>
          <span class="sp-row-desc">{{ t('settings.followSystemDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-toggle-pill" :class="{ active: uiStore.themeMode === 'auto' }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.viewAndSort') }}</div>
      <div class="sp-card-row" v-if="!uiStore.isMobile">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.layout') }}</span>
          <span class="sp-row-desc">{{ t('settings.layoutDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-seg">
            <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'grid' }" @click="onSetLayout('grid')" :title="t('settings.gridView')"><span aria-hidden="true" v-html="I.grid"></span> {{ t('settings.gridView') }}</button>
            <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'list' }" @click="onSetLayout('list')" :title="t('settings.listView')"><span aria-hidden="true" v-html="I.list"></span> {{ t('settings.listView') }}</button>
            <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'mini-grid' }" @click="onSetLayout('mini-grid')" :title="t('settings.miniGridView')"><span aria-hidden="true" v-html="I.miniGrid"></span> {{ t('settings.miniGridView') }}</button>
          </div>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.sort') }}</span>
          <span class="sp-row-desc">{{ t('settings.sortDesc') }}</span>
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
          <span class="sp-row-desc">{{ t('settings.groupsOnTopDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-toggle-pill" :class="{ active: uiStore.groupsOnTop }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-card" data-testid="lv-lang-switch">
      <div class="sp-card-head">{{ t('settings.language') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.language') }}</span>
          <span class="sp-row-desc">{{ t('settings.languageDesc') }}</span>
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

function onToggleAutoTheme() {
  uiStore.toggleAutoTheme()
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
