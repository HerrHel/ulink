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
      <!-- AI 学到了什么：三段——你告诉 AI 的（可增删改，始终生效）/ AI 自己学到的（修正可删、归纳只读） -->
      <div class="sp-card-row sp-habits-row" data-testid="lv-ai-habits">
        <div class="sp-row-meta" style="width: 100%;">
          <button type="button" class="btn btn-ghost btn-sm" data-testid="lv-ai-habits-toggle" @click="habitsOpen = !habitsOpen">
            {{ habitsOpen ? t('settings.aiHabitsHide') : t('settings.aiHabitsShow', { n: totalCount }) }}
          </button>
          <div v-if="habitsOpen" class="sp-habits-list">
            <div class="sp-habit-section-title">{{ t('settings.aiHabitsManualTitle') }}</div>
            <p class="sp-row-desc">{{ t('settings.aiHabitsManualHint') }}</p>
            <div v-for="m in manualEntries" :key="m.id" class="sp-habit-item" data-testid="lv-ai-manual-item">
              <template v-if="editingId === m.id">
                <input v-model="editText" class="form-input sp-habit-input" :maxlength="MANUAL_MAX_LEN" data-testid="lv-ai-manual-edit-input" @keydown.enter.prevent="onSaveEdit(m.id)" @keydown.esc.prevent="onCancelEdit">
                <button type="button" class="btn btn-ghost btn-xs" data-testid="lv-ai-manual-edit-save" @click="onSaveEdit(m.id)">{{ t('common.save') }}</button>
              </template>
              <template v-else>
                <span class="sp-habit-text">{{ m.text }}</span>
                <span class="sp-habit-actions">
                  <button type="button" class="btn btn-ghost btn-xs" data-testid="lv-ai-manual-edit" @click="onStartEdit(m.id, m.text)">{{ t('common.edit') }}</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-testid="lv-ai-manual-remove" @click="onRemoveManual(m.id)">{{ t('common.delete') }}</button>
                </span>
              </template>
            </div>
            <div class="sp-habit-add">
              <input v-model="newText" class="form-input sp-habit-input" :maxlength="MANUAL_MAX_LEN" :placeholder="t('settings.aiHabitsManualPlaceholder')" data-testid="lv-ai-manual-input" @keydown.enter.prevent="onAddManual">
              <span class="sp-habit-count">{{ newText.trim().length }}/{{ MANUAL_MAX_LEN }}</span>
              <button type="button" class="btn btn-primary btn-xs" :disabled="!newText.trim()" data-testid="lv-ai-manual-add" @click="onAddManual">{{ t('settings.aiHabitsManualAdd') }}</button>
            </div>

            <template v-if="uiStore.aiStyleAdapt">
              <div class="sp-habit-section-title">{{ t('settings.aiHabitsLearnedTitle') }}</div>
              <p v-if="learned.length === 0" class="sp-row-desc">{{ t('settings.aiHabitsEmpty') }}</p>
              <div v-for="item in learned" :key="item.id" class="sp-habit-item" data-testid="lv-ai-habit-item">
                <span class="sp-habit-text">{{ item.text }}</span>
                <button v-if="item.removable" type="button" class="btn btn-ghost btn-xs" :aria-label="t('common.delete')" data-testid="lv-ai-habit-remove" @click="onRemoveHabit(item.id)">{{ t('common.delete') }}</button>
                <span v-else class="sp-habit-tag">{{ t('settings.aiHabitsAuto') }}</span>
              </div>
              <button v-if="learned.some((i) => i.removable)" type="button" class="btn btn-ghost btn-sm" data-testid="lv-ai-habits-clear" @click="onClearHabits">{{ t('settings.aiHabitsClear') }}</button>
            </template>
            <p v-else class="sp-row-desc">{{ t('settings.aiHabitsLearningOff') }}</p>
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
import { listProfileEntries, addManualEntry, updateProfileEntry, removeProfileEntry, MANUAL_MAX_LEN } from '../../../lib/ai/aiProfile.js'
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
// 「你告诉 AI 的」：个人记忆（与对话里「记住…」同一存储），始终生效、不受学习开关控制
const newText = ref('')
const editingId = ref('')
const editText = ref('')
const manualEntries = computed(() => {
  void habitsRev.value
  return [...listProfileEntries()].sort((a, b) => b.updatedAt - a.updatedAt)
})
const totalCount = computed(() => manualEntries.value.length + (uiStore.aiStyleAdapt ? learned.value.length : 0))
const MANUAL_ERR: Record<string, string> = {
  empty: 'settings.aiHabitsManualEmpty',
  too_long: 'settings.aiHabitsManualTooLong',
  duplicate: 'settings.aiHabitsManualDuplicate',
}
function onAddManual() {
  const r = addManualEntry(newText.value)
  if (!r.ok) {
    toast(t(MANUAL_ERR[r.reason], { n: MANUAL_MAX_LEN }), false)
    return
  }
  newText.value = ''
  habitsRev.value++
  toast(t('settings.aiHabitsManualAdded'), true)
}
function onStartEdit(id: string, text: string) {
  editingId.value = id
  editText.value = text
}
function onCancelEdit() {
  editingId.value = ''
}
function onSaveEdit(id: string) {
  const r = updateProfileEntry(id, editText.value)
  if (!r.ok) {
    toast(t(MANUAL_ERR[r.reason], { n: MANUAL_MAX_LEN }), false)
    return
  }
  editingId.value = ''
  habitsRev.value++
}
function onRemoveManual(id: string) {
  removeProfileEntry(id)
  habitsRev.value++
}
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
.sp-habit-section-title { margin-top: 6px; font-weight: 600; font-size: var(--fs-sm); }
.sp-habit-actions { flex: none; display: inline-flex; gap: 4px; }
.sp-habit-add { display: flex; align-items: center; gap: 6px; }
.sp-habit-input { flex: 1; min-width: 0; }
.sp-habit-count { flex: none; font-size: var(--fs-xs, 0.75rem); color: var(--text-secondary); }
.sp-habit-tag { flex: none; font-size: var(--fs-xs, 0.75rem); color: var(--text-tertiary, var(--text-secondary)); }
</style>
