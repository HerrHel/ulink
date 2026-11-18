<template>
  <div class="settings-tab-panel" data-testid="settings-panel-ai">
    <div class="sp-tab-header">
      <h3 class="sp-tab-title">{{ t('settings.tabAi') }}</h3>
      <p class="sp-tab-desc">{{ t('settings.tabAiDesc') }}</p>
    </div>

    <div class="sp-card" data-testid="lv-search-fill-section">
      <div class="sp-card-head">{{ t('settings.smartFeaturesWorkflow') }}</div>
      <div class="sp-card-row" @click="onToggleAiEnabled" style="cursor: pointer;" data-testid="lv-ai-enabled-toggle">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.aiEnabled') }}</span>
          <span class="sp-row-desc">{{ t('settings.aiEnabledHint') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-toggle-pill" :class="{ active: uiStore.aiEnabled }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
      <div class="sp-card-row" @click="onToggleAiRail" style="cursor: pointer;">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.aiRail') }}</span>
          <span class="sp-row-desc">{{ t('settings.aiRailHint') }}</span>
        </div>
        <div class="sp-row-ctrl" data-testid="lv-ai-rail-toggle">
          <div class="sp-toggle-pill" :class="{ active: uiStore.aiRailEnabled }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
      <div class="sp-card-row" @click="onToggleSmartFill" style="cursor: pointer;">
        <div class="sp-row-meta">
          <span class="sp-row-title">
          {{ t('settings.smartFill') }}
          <span class="sp-pro-tag">PRO</span>
        </span>
          <span class="sp-row-desc">{{ t('settings.smartFillHint') }}</span>
        </div>
        <div class="sp-row-ctrl" data-testid="lv-smart-fill-toggle">
          <div class="sp-toggle-pill" :class="{ active: uiStore.smartFillEnabled && isPro }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
      <div class="sp-card-row" @click="onToggleSemanticSearch" style="cursor: pointer;">
        <div class="sp-row-meta">
          <span class="sp-row-title">
            {{ t('settings.semanticSearch') }}
            <span class="sp-pro-tag">PRO</span>
          </span>
          <span class="sp-row-desc">{{ t('settings.semanticSearchHint') }}</span>
        </div>
        <div class="sp-row-ctrl" data-testid="lv-semantic-search-toggle">
          <div class="sp-toggle-pill" :class="{ active: uiStore.semanticSearchEnabled && isPro }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
/** 设置面板 ·「AI 与智能（总开关 / 智能预填 / 语义搜索 / AI 侧栏）」标签页。共享实例经 settingsContext 注入，见该文件说明。 */
import { useUIStore } from '../../../stores/ui.js'
import { toast } from '../../../lib/toast.js'
import { t } from '../../../i18n/index.js'
import { useSettingsContext } from './settingsContext.js'

const { showPurchase, entService, auth } = useSettingsContext()

const uiStore = useUIStore()

const isPro = entService.isPro

function onToggleSmartFill() {
  if (!auth.isLoggedIn) {
    toast(t('settings.smartFillNeedsLogin'), false)
    auth.authModalOpen = true
    return
  }
  if (!isPro.value) {
    toast(t('settings.smartFillNeedsPro'), false)
    showPurchase.value = true
    return
  }
  uiStore.smartFillEnabled = !uiStore.smartFillEnabled
  uiStore.saveUIState()
  toast(uiStore.smartFillEnabled ? t('settings.smartFillOnToast') : t('settings.smartFillOffToast'), true)
}

function onToggleSemanticSearch() {
  if (!auth.isLoggedIn) {
    toast(t('settings.semanticSearchNeedsLogin'), false)
    auth.authModalOpen = true
    return
  }
  if (!isPro.value) {
    toast(t('settings.semanticSearchNeedsPro'), false)
    showPurchase.value = true
    return
  }
  uiStore.semanticSearchEnabled = !uiStore.semanticSearchEnabled
  uiStore.saveUIState()
  toast(uiStore.semanticSearchEnabled ? t('settings.semanticSearchOnToast') : t('settings.semanticSearchOffToast'), true)
}

function onToggleAiEnabled() {
  uiStore.aiEnabled = !uiStore.aiEnabled
  // 关闭总开关时若正处于 AI 视图，退回书签视图（否则会留下一个无法发请求的空工作台）
  if (!uiStore.aiEnabled && uiStore.activeView === 'ai') {
    uiStore.activeView = 'bookmarks'
  }
  uiStore.saveUIState()
  toast(uiStore.aiEnabled ? t('settings.aiEnabledOnToast') : t('settings.aiEnabledOffToast'), true)
}

function onToggleAiRail() {
  uiStore.aiRailEnabled = !uiStore.aiRailEnabled
  if (!uiStore.aiRailEnabled && uiStore.activeView === 'ai') {
    uiStore.activeView = 'bookmarks'
  }
  uiStore.saveUIState()
  toast(uiStore.aiRailEnabled ? t('settings.aiRailOnToast') : t('settings.aiRailOffToast'), true)
}
</script>
