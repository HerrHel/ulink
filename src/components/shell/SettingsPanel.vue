<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="uiStore.panels.settings" class="settings-drawer-wrap" @click.self="uiStore.panels.settings = false">
        <div class="settings-drawer" data-testid="lv-settings-drawer" @click.stop>
          <div class="settings-drawer-head">
            <h2 class="settings-drawer-title">{{ t('settings.title') }}</h2>
            <button class="sp-help-btn" @click.stop="onOpenShortcutHelp" :aria-label="t('settings.shortcutHelp')" :title="t('settings.shortcutHelp')">?</button>
            <button class="modal-close" @click="uiStore.panels.settings = false" :aria-label="t('settings.closeSettings')">&times;</button>
          </div>
          <div class="settings-drawer-body">
            <!-- 同步与安全（置顶，提升账户优先级） -->
            <div class="sp-section sp-section-sync-hero">
              <span class="sp-section-title">{{ t('settings.syncSecurity') }}</span>
              <template v-if="auth.isLoggedIn">
                <div class="sp-user-card">
                  <div class="sp-user-main">
                    <div class="sp-user-avatar">
                      <span v-if="auth.avatar" class="sp-user-emoji">{{ auth.avatar }}</span>
                      <span v-else class="sp-user-initial">{{ userInitial }}</span>
                    </div>
                    <div class="sp-user-info">
                      <div class="sp-user-name-row">
                        <span class="sp-user-name">{{ auth.displayName || userDisplay }}</span>
                        <button class="up-edit-btn" @click.stop="toggleProfileEditor" :title="isEditingProfile ? t('userPopover.closeEdit') : t('userPopover.editProfile')">
                          <span aria-hidden="true" v-html="I.edit"></span>
                          <span>{{ isEditingProfile ? t('userPopover.closeEdit') : t('userPopover.editProfile') }}</span>
                        </button>
                      </div>
                      <span class="sp-user-email">{{ auth.userEmail }}</span>
                      <div class="sp-sync-badge-row">
                        <span class="sp-sync-status" data-testid="lv-sync-label" :class="syncState.level">
                          <span class="sp-sync-dot" :class="syncState.dotClass"></span>{{ syncState.label }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- 个人资料编辑卡片（展开态，与侧边栏气泡样式完全一致） -->
                  <div v-if="isEditingProfile" class="up-edit-box sp-profile-edit-box">
                    <div class="up-field">
                      <label class="up-label">{{ t('settings.nickname') }}</label>
                      <input
                        v-model="profileForm.nickname"
                        type="text"
                        maxlength="20"
                        class="up-input"
                        :placeholder="t('settings.nicknamePlaceholder')"
                        @keydown.enter="onSaveProfile"
                      />
                    </div>
                    <div class="up-field">
                      <label class="up-label">{{ t('settings.avatar') }}</label>
                      <div class="up-emoji-grid">
                        <button
                          v-for="emoji in PRESET_AVATAR_EMOJIS"
                          :key="emoji"
                          type="button"
                          class="up-emoji-btn"
                          :class="{ active: profileForm.avatar === emoji }"
                          @click="profileForm.avatar = emoji"
                        >
                          {{ emoji }}
                        </button>
                      </div>
                      <div class="up-reset-row">
                        <button
                          v-if="profileForm.avatar"
                          type="button"
                          class="up-link-btn"
                          @click="profileForm.avatar = ''"
                        >
                          {{ t('settings.resetToDefaultAvatar') }}
                        </button>
                        <span v-else class="up-hint">{{ t('settings.defaultAvatarTip') }}</span>
                      </div>
                    </div>
                    <div class="up-edit-actions">
                      <button
                        class="btn btn-primary btn-sm up-action-btn"
                        :disabled="savingProfile"
                        @click="onSaveProfile"
                      >
                        {{ savingProfile ? (t('common.saving') || '保存中…') : t('common.save') }}
                      </button>
                      <button
                        class="btn btn-ghost btn-sm up-action-btn"
                        @click="isEditingProfile = false"
                      >
                        {{ t('common.cancel') }}
                      </button>
                    </div>
                  </div>

                  <div class="sp-logout-wrap">
                    <button class="up-menu-item up-danger-item sp-logout-btn" @click.stop="onLogout">
                      <div class="up-item-left">
                        <span class="up-item-icon" aria-hidden="true" v-html="I.logout"></span>
                        <span class="up-item-title">{{ t('userPopover.signOut') }}</span>
                      </div>
                    </button>
                  </div>
                </div>
                <div v-if="syncState.level === 'error' && sync.syncError.value" class="sp-sync-error">{{ sync.syncError.value }}</div>
              </template>
              <template v-else>
                <div class="sp-row">
                  <span class="sp-hint">{{ t('settings.loginHint') }}</span>
                </div>
                <div class="sp-row">
                  <button class="btn btn-primary btn-sm" @click.stop="onOpenLogin">{{ t('settings.loginRegister') }}</button>
                </div>
              </template>
              <div class="sp-divider"></div>
              <!-- 数据解密状态与控制卡片（对齐侧边栏气泡解密样式） -->
              <div class="sp-e2e-card">
                <div class="sp-e2e-left">
                  <span class="sp-e2e-icon" aria-hidden="true" v-html="I.password"></span>
                  <div class="sp-e2e-text">
                    <div class="sp-e2e-title-row">
                      <span class="sp-e2e-title">{{ t('userPopover.e2eTitle') }}</span>
                      <span class="sp-sync-status" data-testid="lv-e2e-status" :class="e2eEnabled ? (e2eUnlocked ? 'ok' : 'pending') : 'error'">
                        {{ e2eEnabled ? (e2eUnlocked ? t('settings.e2eUnlocked') : t('settings.e2eLocked')) : t('settings.e2eDisabled') }}
                      </span>
                    </div>
                    <span class="sp-e2e-desc">{{ t('settings.e2eHint') }}<span v-if="!auth.isLoggedIn">（{{ t('settings.e2eHintLocalOnly') }}）</span></span>
                  </div>
                </div>
                <div class="sp-e2e-right">
                  <button
                    v-if="!e2eEnabled"
                    class="up-tag tag-disabled"
                    data-testid="lv-e2e-setup-btn"
                    @click.stop="onOpenE2ESetup"
                  >
                    {{ t('userPopover.enableE2E') }}
                  </button>
                  <button
                    v-else-if="!e2eUnlocked"
                    class="up-tag tag-locked"
                    data-testid="lv-e2e-unlock-btn"
                    @click.stop="onOpenE2EUnlock"
                  >
                    {{ e2e.isBiometricEnrolled.value ? (t('settings.biometricUnlock') || '指纹解密') : t('userPopover.decrypt') }}
                  </button>
                  <button
                    v-else
                    class="up-tag tag-unlocked"
                    data-testid="lv-e2e-lock-btn"
                    @click.stop="onE2ELock"
                  >
                    {{ t('userPopover.lock') }}
                  </button>
                </div>
              </div>

              <!-- 已解密状态下的附属操作：修改密码 / 移除指纹 -->
              <div v-if="e2eEnabled && e2eUnlocked" class="sp-e2e-sub-actions">
                <button class="btn btn-ghost btn-xs" data-testid="lv-e2e-changepw-btn" @click.stop="onOpenE2EChangePw">
                  <span aria-hidden="true" v-html="I.edit"></span> {{ t('settings.changeMasterPassword') }}
                </button>
                <button v-if="e2e.isBiometricEnrolled.value" class="btn btn-ghost btn-xs" data-testid="lv-e2e-biometric-remove" @click.stop="onRemoveBiometric">
                  {{ t('settings.removeBiometric') }}
                </button>
              </div>
            </div>
            <!-- Theme -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.theme') }}</span>
              <div class="sp-row">
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeColor === 'light' }" @click="onSetThemeColor('light', $event)">
                    <span aria-hidden="true" v-html="I.sun" class="sp-icon"></span>{{ t('settings.themeLight') }}
                  </button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeColor === 'dark' }" @click="onSetThemeColor('dark', $event)">
                    <span aria-hidden="true" v-html="I.moon" class="sp-icon"></span>{{ t('settings.themeDark') }}
                  </button>
                </div>
              </div>
              <div class="sp-row">
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'premium' }" @click="onSetThemeStyle('premium')">{{ t('settings.themePremium') }}</button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'comfortable' }" @click="onSetThemeStyle('comfortable')">{{ t('settings.themeComfortable') }}</button>
                </div>
              </div>
              <div class="sp-toggle-row" :class="{ active: uiStore.themeMode === 'auto' }" @click="onToggleAutoTheme">
                <span aria-hidden="true" v-html="I.sun" class="sp-icon auto-icon-sun"></span>
                <span aria-hidden="true" v-html="I.moon" class="sp-icon auto-icon-moon"></span>
                <span class="sp-toggle-label">{{ t('settings.followSystem') }}</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- Layout -->
            <div class="sp-section sp-section-layout">
              <span class="sp-section-title">{{ t('settings.layout') }}</span>
              <div class="sp-row">
                <div class="sp-seg">
                  <button v-if="!uiStore.isMobile" class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'grid' }" @click="onSetLayout('grid')" :title="t('settings.gridView')"><span aria-hidden="true" v-html="I.grid"></span></button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'list' }" @click="onSetLayout('list')" :title="t('settings.listView')"><span aria-hidden="true" v-html="I.list"></span></button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'mini-grid' }" @click="onSetLayout('mini-grid')" :title="t('settings.miniGridView')"><span aria-hidden="true" v-html="I.miniGrid"></span></button>
                </div>
              </div>
            </div>
            <!-- Sort -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.sort') }}</span>
              <div class="sp-row">
                <div class="sp-seg sp-seg-wrap">
                  <button v-for="s in sortModes" :key="s.id" class="sp-seg-btn"
                          :class="{ active: uiStore.sortMode === s.id }" @click="onSetSortMode(s.id)">{{ t(s.labelKey) }}</button>
                </div>
              </div>
              <div class="sp-toggle-row" :class="{ active: uiStore.groupsOnTop }" @click="onToggleGroupsOnTop">
                <span class="sp-toggle-label">{{ t('settings.groupsOnTop') }}</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- 维护 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.maintenance') }}</span>
              <div class="sp-actions">
                <button class="sp-action" :class="{ checking: dlChecking }" @click.stop="onCheckDeadLinks" :disabled="dlChecking">
                  <span aria-hidden="true" v-html="I.radar"></span>
                  <span>{{ dlChecking ? t('settings.checking') : t('settings.checkDeadLinks') }}</span>
                  <span v-if="deadCount > 0" class="sp-badge">{{ deadCount }}</span>
                  <span v-if="blockedCount > 0" class="sp-badge sp-badge-gfw">{{ blockedCount }}</span>
                </button>
                <div v-if="dlChecking && dlProgress.total > 0" class="sp-check-progress">
                  <div class="sp-check-progress-bar" :style="{ width: (dlProgress.done / dlProgress.total * 100) + '%' }"></div>
                  <span class="sp-check-progress-text">{{ dlProgress.done }}/{{ dlProgress.total }}</span>
                </div>
                <button v-if="deadCount + blockedCount > 0" class="sp-action sp-action-sm" @click.stop="onViewDeadLinks">
                  <span aria-hidden="true" v-html="I.link"></span>
                  <span>{{ t('settings.view') }}</span>
                </button>
              </div>
              <div class="sp-toggle-row" :class="{ active: dlAutoEnabled }" @click="onToggleAutoDeadCheck">
                <span class="sp-toggle-label">{{ t('settings.autoDeadCheckWeekly') }}</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- 数据 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.data') }}</span>
              <!-- 存储占用指示条（从侧边栏移入，归位数据管理） -->
              <div v-if="storageInfo" class="sp-storage-card">
                <div class="sp-row">
                  <span class="sp-row-label">{{ t('settings.storageOccupied') }}</span>
                  <span class="sp-range-value">{{ storageInfo.label }} ({{ storageInfo.percent }}%)</span>
                </div>
                <div class="sp-storage-track">
                  <div class="sp-storage-bar" :style="{ width: storageInfo.percent + '%', background: storageBarColor }"></div>
                </div>
              </div>
              <div class="sp-actions">
                <button class="sp-action" @click.stop="onOpenTrash"><span v-html="trashIcon"></span>{{ t('settings.trash') }}</button>
              </div>
              <div class="sp-actions sp-actions--split">
                <button class="sp-action" @click.stop="onTriggerImport"><span aria-hidden="true" v-html="I.import"></span>{{ t('settings.import') }}</button>
                <div class="sp-export-wrap" @click.stop>
                  <button class="sp-action" @click="exportMenuOpen = !exportMenuOpen"><span aria-hidden="true" v-html="I.export"></span>{{ t('settings.export') }}</button>
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
                    <button class="sp-export-item" @click="onExport('raindrop')">
                      <span class="sp-export-name">Raindrop.io</span>
                      <span class="sp-export-hint">{{ t('settings.exportRaindropHint') }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <div class="sp-divider"></div>
              <div class="sp-toggle-row" :class="{ active: exportKeepSensitive }" @click="onToggleExportKeepSensitive" data-testid="lv-export-sensitive-toggle">
                <span class="sp-toggle-label">
                  {{ t('settings.exportKeepSensitive') }}
                  <span class="sp-toggle-sub">{{ t('settings.exportKeepSensitiveHint') }}</span>
                </span>
                <span class="sp-switch"></span>
              </div>
              <div class="sp-divider"></div>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.historyMax') }}</span>
                <span class="sp-range-value">{{ t('settings.historyMaxValue', { n: uiStore.historyMax }) }}</span>
              </div>
              <div class="sp-row">
                <input type="range" class="sp-range" min="5" max="30" step="1"
                       v-model.number="uiStore.historyMax" @change="onHistoryMaxChange">
                <span class="sp-range-hint">5–30</span>
              </div>
            </div>
            <!-- 关于 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.about') }}</span>
              <!-- 语言切换属低频偏好，收在「关于」区顶部，避免占据高频设置位 -->
              <div class="sp-row" data-testid="lv-lang-switch">
                <span class="sp-row-label">{{ t('settings.language') }}</span>
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: locale === 'zh-CN' }" @click="setLocale('zh-CN')">中文</button>
                  <button class="sp-seg-btn" :class="{ active: locale === 'en-US' }" @click="setLocale('en-US')">English</button>
                </div>
              </div>
              <div class="sp-divider"></div>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.version') }}</span>
                <span class="sp-sync-status" data-testid="lv-app-version">v{{ APP_VERSION }}</span>
              </div>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.buildTime') }}</span>
                <span class="sp-sync-status" data-testid="lv-build-time">{{ buildTimeText }}</span>
              </div>
              <button class="sp-action" @click.stop="onFeedback">{{ t('settings.feedback') }}</button>
            </div>
            <!-- Danger -->
            <div class="sp-section sp-danger">
              <span class="sp-section-title">{{ t('settings.danger') }}</span>
              <button class="sp-danger-btn" @click.stop="onResetData">
                <span aria-hidden="true" v-html="I.trash"></span>{{ t('settings.resetData') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 反馈 / 建议 弹窗：直接填写内容提交到企业邮箱（保留复制 / mailto 兜底） -->
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="uiStore.overlays.feedback" class="modal-mask open" role="dialog" aria-modal="true" :aria-label="t('settings.feedback')" @click.self="uiStore.overlays.feedback = false">
        <div class="modal modal-sm">
          <div class="modal-body">
            <div class="confirm-msg">{{ t('settings.feedbackFormHint') }}</div>
            <textarea
              class="form-textarea sp-feedback-text"
              rows="5"
              maxlength="2000"
              :placeholder="t('settings.feedbackPlaceholder')"
              :aria-label="t('settings.feedback')"
              v-model="feedbackText"
            ></textarea>
            <label class="sp-feedback-label" for="lv-feedback-contact">{{ t('settings.feedbackContact') }}</label>
            <input
              id="lv-feedback-contact"
              class="form-input sp-feedback-contact"
              type="text"
              maxlength="200"
              :placeholder="t('settings.feedbackContactPlaceholder')"
              v-model="feedbackContact"
            />
            <!-- honeypot：真人看不到也填不到，机器人填了就在服务端被静默丢弃 -->
            <input class="sp-feedback-hp" type="text" tabindex="-1" autocomplete="off" aria-hidden="true" v-model="feedbackHoneypot" />
            <div v-if="TURNSTILE_SITE_KEY" id="lv-turnstile" class="sp-feedback-turnstile"></div>
            <div class="sp-feedback-meta">
              <!-- 按钮被禁用时必须给出原因：只显示计数的话，用户不知道还差几个字 -->
              <span :class="{ 'sp-feedback-short': feedbackTooShort }">
                {{ feedbackTooShort ? t('settings.feedbackTooShort') : t('settings.feedbackCount', { n: feedbackText.length }) }}
              </span>
              <span>{{ t('settings.feedbackOrEmail') }}
                <button class="sp-feedback-link" @click="openFeedbackMail">{{ FEEDBACK_EMAIL }}</button>
              </span>
            </div>
          </div>
          <div class="modal-foot confirm-foot">
            <button class="btn btn-secondary" @click="copyFeedbackEmail">{{ t('settings.copyEmail') }}</button>
            <button class="btn btn-primary" :disabled="!canSendFeedback" @click="submitFeedback">
              {{ feedbackSending ? t('settings.feedbackSending') : t('settings.feedbackSend') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, reactive, watch, onBeforeUnmount } from 'vue'
import { useUIStore, type ThemeStyle, type SortMode, type LayoutMode } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { storageBarColorFor } from './storageBarColor.js'
import { setThemeStyle as themeSetStyle } from '../../lib/theme.js'
import { exportData, exportHTML, exportCSV, exportRaindrop, resetToDefaults, getExportKeepSensitive, setExportKeepSensitive } from '../../composables/domain/useDataIO.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import { I } from '../../config/icons.js'
import { toast } from '../../lib/toast.js'
import { APP_VERSION, BUILD_TIME } from '../../version.js'
import { PRESET_AVATAR_EMOJIS } from '../../lib/avatar.js'
import { t, tN, useI18n } from '../../i18n/index.js'

// 语言切换：locale 为响应式 computed，切语言后本面板与全局文案立即更新
const { locale, setLocale } = useI18n()


function triggerImport() { const el = document.getElementById('importFile') as HTMLInputElement | null; if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() } }

function onOpenShortcutHelp() { pushNavState(); uiStore.panels.shortcutHelp = true; uiStore.panels.settings = false }

const uiStore = useUIStore()
const dataStore = useDataStore()
const appStore = useAppStore()

const storageInfo = computed(() => {
  try { return appStore.getStorageInfo() } catch { return null }
})
const storageBarColor = computed(() => storageBarColorFor(storageInfo.value?.percent))
const auth = useAuth()
const sync = useCloudSync()

const userInitial = computed(() => {
  const name = auth.displayName || auth.userEmail
  if (!name) return 'U'
  return name.charAt(0).toUpperCase()
})

const userDisplay = computed(() => {
  if (!auth.userEmail) return ''
  return auth.userEmail.split('@')[0]
})

const isEditingProfile = ref(false)
const savingProfile = ref(false)
const profileForm = reactive({
  nickname: '',
  avatar: '',
})

function toggleProfileEditor() {
  if (!isEditingProfile.value) {
    profileForm.nickname = auth.displayName !== userDisplay.value ? (auth.customNickname || auth.displayName) : (auth.customNickname || '')
    profileForm.avatar = auth.avatar || ''
    isEditingProfile.value = true
  } else {
    isEditingProfile.value = false
  }
}

async function onSaveProfile() {
  savingProfile.value = true
  try {
    await auth.updateProfile({
      nickname: profileForm.nickname,
      avatar: profileForm.avatar,
    })
    toast(t('settings.profileSavedToast'))
    isEditingProfile.value = false
  } catch (err) {
    console.error('Failed to save profile', err)
  } finally {
    savingProfile.value = false
  }
}

const dl = useDeadLinkChecker()
const e2e = useE2E()
const e2eEnabled = computed(() => e2e.isE2EEnabled.value)
const e2eUnlocked = computed(() => e2e.isUnlocked.value)

function onE2ELock() { e2e.lock(); toast(t('settings.lockedToast')) }
function onRemoveBiometric() { e2e.removeBiometric(); toast(t('settings.biometricRemovedToast')) }
function onOpenE2ESetup() { uiStore.modals.e2eSetup = true; uiStore.panels.settings = false }
function onOpenE2EUnlock() { uiStore.e2eUnlockInitialMode = 'unlock'; uiStore.modals.e2eUnlock = true; uiStore.panels.settings = false }
function onOpenE2EChangePw() {
  uiStore.e2eUnlockInitialMode = 'changePw'
  uiStore.modals.e2eUnlock = true
  uiStore.panels.settings = false
}

const trashCount = computed(() => dataStore.trashCount)
const trashIcon = computed(() => trashCount.value > 0 ? I.trashFull : I.trash)
const syncState = useSyncState()
// 构建时间本地化显示（__BUILD_TIME__ 为 UTC ISO 串 → 本地时区）；define 未注入时兜底
const buildTimeText = computed(() => {
  if (!BUILD_TIME) return ''
  const d = new Date(BUILD_TIME)
  if (Number.isNaN(d.getTime())) return BUILD_TIME
  return d.toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false })
})
const dlChecking = computed(() => dl.checking.value)
const dlProgress = computed(() => dl.progress.value)
const deadCount = computed(() => dl.deadCount.value)
const blockedCount = computed(() => dl.blockedCount.value)
const dlAutoEnabled = computed(() => dl.autoCheckEnabled.value)

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

// 抽屉展开时确保深浅主题与当前实际 DOM 保持同步
watch(() => uiStore.panels.settings, (open) => {
  if (open) uiStore.syncThemeFromDOM()
})

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

function onHistoryMaxChange() {
  uiStore.historyMax = Math.min(30, Math.max(5, uiStore.historyMax))
  uiStore.saveUIState()
}

function onOpenTrash() { pushNavState(); uiStore.panels.trash = true; uiStore.panels.settings = false }
function onTriggerImport() { triggerImport(); uiStore.panels.settings = false }

const exportMenuOpen = ref(false)
function onExport(fmt: 'json' | 'html' | 'csv' | 'raindrop') {
  if (fmt === 'json') exportData()
  else if (fmt === 'html') exportHTML()
  else if (fmt === 'csv') exportCSV()
  else if (fmt === 'raindrop') exportRaindrop()
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
  if (!t.closest('.sp-export-wrap')) exportMenuOpen.value = false
}
onMounted(() => { document.addEventListener('click', _closeExportMenu); e2e.checkE2EStatus() })
onBeforeUnmount(() => document.removeEventListener('click', _closeExportMenu))
function onResetData() { resetToDefaults(); uiStore.panels.settings = false }

async function onOpenLogin() {
  auth.authModalOpen = true
  uiStore.panels.settings = false
}

async function onLogout() {
  const ok = await auth.signOut()
  if (ok) await sync.resetSyncState()
}

function onCheckDeadLinks() {
  if (dl.checking.value) return
  toast(t('settings.checkDeadLinksStart'))
  dl.checkAll(5, 200).then(() => {
    const ds = dataStore
    let dead = 0
    let blocked = 0
    for (const b of ds.bookmarks) {
      if (b.attributes?.['dead-link']) dead++
      if (b.attributes?.['gfw-blocked']) blocked++
    }
    if (dead > 0 && blocked > 0) {
      toast(t('settings.deadCheckDoneMixed', { dead, blocked }))
    } else if (dead > 0) {
      toast(tN('settings.deadCheckDoneDead', dead))
    } else if (blocked > 0) {
      toast(tN('settings.deadCheckDoneBlocked', blocked))
    } else {
      toast(t('settings.deadCheckAllOk'))
    }
  })
}

function onViewDeadLinks() {
  pushNavState()
  uiStore.overlays.deadLinks = true
  uiStore.panels.settings = false
}

function onToggleAutoDeadCheck() {
  if (dl.autoCheckEnabled.value) dl.stopAutoCheck()
  else dl.startAutoCheck()
}

// ── 反馈（A4-007：状态进 overlays.feedback，支持 Esc / popstate）──
const FEEDBACK_EMAIL = 'support@ulink.ren'
/** 反馈接口 = Supabase Edge Function（--no-verify-jwt，凭 anon key 调用）。 */
const FEEDBACK_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/send-feedback`
const FEEDBACK_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
/**
 * Turnstile 站点密钥。未配置则跳过人机校验，仅靠 honeypot + 服务端限流；
 * 配置后需同步放开 CSP：script-src 加 https://challenges.cloudflare.com、
 * frame-src 加 https://challenges.cloudflare.com。
 */
const TURNSTILE_SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '')

/** 服务端错误码 → 提示文案键（未列出的错误统一走 feedbackFailed）。 */
const FEEDBACK_ERROR_KEYS: Record<string, string> = {
  message_too_short: 'settings.feedbackTooShort',
  message_too_long: 'settings.feedbackTooLong',
  rate_limited: 'settings.feedbackRateLimited',
}

const feedbackText = ref('')
const feedbackContact = ref('')
const feedbackHoneypot = ref('')
const feedbackSending = ref(false)
const turnstileToken = ref('')

/** 正文最小长度（与 Edge Function 的 MIN_MESSAGE 保持一致）。 */
const MIN_FEEDBACK = 5

const canSendFeedback = computed(
  () =>
    feedbackText.value.trim().length >= MIN_FEEDBACK &&
    !feedbackSending.value &&
    (!TURNSTILE_SITE_KEY || !!turnstileToken.value),
)

/** 已输入但未达最小长度——此时按钮是禁用的，必须让用户知道原因。 */
const feedbackTooShort = computed(() => {
  const n = feedbackText.value.trim().length
  return n > 0 && n < MIN_FEEDBACK
})

function onFeedback() {
  pushNavState()
  feedbackText.value = ''
  feedbackContact.value = ''
  feedbackHoneypot.value = ''
  turnstileToken.value = ''
  uiStore.overlays.feedback = true
  uiStore.panels.settings = false
  nextTick(ensureTurnstile)
}

// ── Turnstile（按需加载，未配置站点密钥时完全不拉脚本）──
type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => void
  reset: (el?: HTMLElement) => void
}
function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}
function renderTurnstile(): void {
  const api = turnstileApi()
  const el = document.getElementById('lv-turnstile')
  if (!api || !el) return
  api.render(el, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: 'auto',
    callback: (token: string) => { turnstileToken.value = token },
    'expired-callback': () => { turnstileToken.value = '' },
    'error-callback': () => { turnstileToken.value = '' },
  })
}
function ensureTurnstile(): void {
  if (!TURNSTILE_SITE_KEY) return
  if (turnstileApi()) { renderTurnstile(); return }
  if (document.getElementById('lv-turnstile-script')) return
  const s = document.createElement('script')
  s.id = 'lv-turnstile-script'
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
  s.async = true
  s.defer = true
  s.onload = renderTurnstile
  document.head.appendChild(s)
}

async function copyFeedbackEmail() {
  try {
    await navigator.clipboard.writeText(FEEDBACK_EMAIL)
    toast(t('settings.emailCopied'), true)
  } catch {
    // clipboard API 不可用（旧浏览器/非安全上下文）：提示手动选中复制
    toast(t('settings.copyEmailFailed'), false)
  }
  uiStore.overlays.feedback = false
}

function openFeedbackMail() {
  window.open('mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(t('settings.feedbackSubject')), '_blank')
  uiStore.overlays.feedback = false
}

async function submitFeedback() {
  if (!canSendFeedback.value) return
  if (!FEEDBACK_ENDPOINT || !FEEDBACK_ANON_KEY) { toast(t('settings.feedbackFailed'), false); return }
  feedbackSending.value = true
  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: FEEDBACK_ANON_KEY },
      body: JSON.stringify({
        message: feedbackText.value.trim(),
        contact: feedbackContact.value.trim(),
        locale: locale.value,
        appVersion: APP_VERSION,
        turnstileToken: turnstileToken.value,
        website: feedbackHoneypot.value,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      toast(t(FEEDBACK_ERROR_KEYS[data.error || ''] || 'settings.feedbackFailed'), false)
      return
    }
    toast(t('settings.feedbackSent'), true)
    feedbackText.value = ''
    feedbackContact.value = ''
    turnstileToken.value = ''
    turnstileApi()?.reset()
    uiStore.overlays.feedback = false
  } catch {
    toast(t('settings.feedbackFailed'), false)
  } finally {
    feedbackSending.value = false
  }
}
</script>
