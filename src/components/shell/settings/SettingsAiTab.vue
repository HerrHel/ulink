<template>
  <div class="settings-tab-panel" data-testid="settings-panel-ai">
    <div class="sp-tab-header">
      <h3 class="sp-tab-title">{{ t('settings.tabAi') }}</h3>
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
      <div class="sp-card-row" @click="onToggleAiStyleAdapt" style="cursor: pointer;" data-testid="lv-ai-style-adapt-toggle">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.aiStyleAdapt') }}</span>
          <span class="sp-row-desc">{{ t('settings.aiStyleAdaptHint') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-toggle-pill" :class="{ active: uiStore.aiStyleAdapt }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
      <!-- AI 学到了什么：逐条查看 / 删除修正记录，一键清空（归纳规则随数据变化，只读） -->
      <div v-if="uiStore.aiStyleAdapt" class="sp-card-row sp-habits-row" data-testid="lv-ai-habits">
        <div class="sp-row-meta" style="width: 100%;">
          <button type="button" class="btn btn-ghost btn-sm" data-testid="lv-ai-habits-toggle" @click="habitsOpen = !habitsOpen">
            {{ habitsOpen ? t('settings.aiHabitsHide') : t('settings.aiHabitsShow', { n: learned.length }) }}
          </button>
          <div v-if="habitsOpen" class="sp-habits-list">
            <p v-if="learned.length === 0" class="sp-row-desc">{{ t('settings.aiHabitsEmpty') }}</p>
            <div v-for="item in learned" :key="item.id" class="sp-habit-item" data-testid="lv-ai-habit-item">
              <span class="sp-habit-text">{{ item.text }}</span>
              <button v-if="item.removable" type="button" class="btn btn-ghost btn-xs" :aria-label="t('common.delete')" data-testid="lv-ai-habit-remove" @click="onRemoveHabit(item.id)">{{ t('common.delete') }}</button>
              <span v-else class="sp-habit-tag">{{ t('settings.aiHabitsAuto') }}</span>
            </div>
            <button v-if="learned.some((i) => i.removable)" type="button" class="btn btn-ghost btn-sm" data-testid="lv-ai-habits-clear" @click="onClearHabits">{{ t('settings.aiHabitsClear') }}</button>
          </div>
        </div>
      </div>
      <div class="sp-card-row" @click="onToggleSemanticSearch" style="cursor: pointer;">
        <div class="sp-row-meta">
          <span class="sp-row-title">
            {{ t('settings.semanticSearch') }}
            <span class="sp-pro-tag">PRO</span>
          </span>
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
import { ref, computed } from 'vue'
import { useUIStore } from '../../../stores/ui.js'
import { useDataStore } from '../../../stores/data.js'
import { toast } from '../../../lib/toast.js'
import { t, isZh } from '../../../i18n/index.js'
import { listLearnedHabits, removeCorrection, clearHabits } from '../../../lib/ai/habitProfile.js'
import { useSettingsContext } from './settingsContext.js'

const { showPurchase, entService, auth } = useSettingsContext()

const uiStore = useUIStore()
const ds = useDataStore()

// 「AI 学到了什么」：数据来自 localStorage，删除后用 habitsRev 触发重算
const habitsOpen = ref(false)
const habitsRev = ref(0)
const learned = computed(() => {
  void habitsRev.value
  return listLearnedHabits({ groups: ds.siblingGroups, categories: ds.categories, isZh: isZh.value })
})
function onRemoveHabit(id: string) {
  removeCorrection(id)
  habitsRev.value++
}
function onClearHabits() {
  clearHabits()
  habitsRev.value++
  toast(t('settings.aiHabitsCleared'), true)
}

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

function onToggleAiStyleAdapt() {
  uiStore.aiStyleAdapt = !uiStore.aiStyleAdapt
  uiStore.saveUIState()
  toast(uiStore.aiStyleAdapt ? t('settings.aiStyleAdaptOnToast') : t('settings.aiStyleAdaptOffToast'), true)
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

<style scoped>
.sp-habits-list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.sp-habit-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: var(--fs-sm); }
.sp-habit-text { color: var(--text-secondary); line-height: 1.5; min-width: 0; overflow-wrap: anywhere; }
.sp-habit-tag { flex: none; font-size: var(--fs-xs, 0.75rem); color: var(--text-tertiary, var(--text-secondary)); }
</style>
