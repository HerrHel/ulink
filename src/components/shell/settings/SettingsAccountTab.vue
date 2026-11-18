<template>
  <div class="settings-tab-panel" data-testid="settings-panel-account">
    <div class="sp-tab-header">
      <h3 class="sp-tab-title">{{ t('settings.tabAccount') }}</h3>
      <p class="sp-tab-desc">{{ t('settings.tabAccountDesc') }}</p>
    </div>

    <!-- 账号与同步卡片 -->
    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.syncSecurity') }}</div>
      <template v-if="auth.isLoggedIn">
        <div class="sp-card-row sp-user-main-row">
          <div class="sp-user-avatar">
            <span v-if="auth.avatar" class="sp-user-emoji">{{ auth.avatar }}</span>
            <span v-else class="sp-user-initial">{{ userInitial }}</span>
          </div>
          <div class="sp-user-details">
            <div class="sp-user-name-row">
              <span class="sp-user-name">{{ auth.displayName || userDisplay }}</span>
              <button class="btn btn-ghost btn-xs sp-edit-profile-btn" @click.stop="toggleProfileEditor">
                <span aria-hidden="true" v-html="I.edit"></span>
                {{ isEditingProfile ? t('userPopover.closeEdit') : t('userPopover.editProfile') }}
              </button>
            </div>
            <span class="sp-user-email">{{ auth.userEmail }}</span>
          </div>
        </div>

        <!-- 云端多端同步 -->
        <div class="sp-card-row sp-sync-card-row">
          <div class="sp-row-meta">
            <div class="sp-sync-title-row">
              <span class="sp-row-title">{{ t('settings.cloudMultiSync') }}</span>
              <span class="sp-sync-status" data-testid="lv-sync-label" :class="syncState.level">
                <span class="sp-sync-dot" :class="syncState.dotClass"></span>{{ syncState.label }}
              </span>
            </div>
            <span class="sp-row-desc">{{ syncDetailDesc }}</span>
            <!-- 异常与错误明细提示 -->
            <div v-if="syncErrorMessage" class="sp-sync-error-banner" :class="{ 'is-quota': syncState.level === 'quota' }" data-testid="lv-sync-error-banner">
              <span class="sp-error-icon" aria-hidden="true" v-html="I.alert"></span>
              <div class="sp-error-text">
                <div class="sp-error-summary">{{ syncErrorSummary }}</div>
                <div v-if="syncErrorDetail" class="sp-error-detail">{{ syncErrorDetail }}</div>
              </div>
            </div>
          </div>
          <div class="sp-row-ctrl sp-sync-actions">
            <button
              v-if="sync.syncErrorKind.value === 'auth'"
              class="btn btn-primary btn-sm"
              data-testid="sp-reauth-btn"
              @click.stop="onOpenAuthModal"
            >
              <span aria-hidden="true" v-html="I.login"></span>
              {{ t('sync.reauth') }}
            </button>
            <button
              class="btn btn-secondary btn-sm"
              data-testid="sp-retry-sync-btn"
              :disabled="isSyncing || isResyncing"
              @click.stop="onManualSync"
              :title="isSyncing ? t('sync.syncing') : (canRetrySync ? t('sync.retrySync') : t('sync.syncNow'))"
            >
              <span aria-hidden="true" v-html="I.refresh" :class="{ 'icon-spin': isSyncing }"></span>
              {{ isSyncing ? t('sync.syncing') : (canRetrySync ? t('sync.retrySync') : t('sync.syncNow')) }}
            </button>
            <button
              v-if="syncState.level === 'conflict'"
              class="btn btn-ghost btn-sm"
              data-testid="sp-view-conflicts-btn"
              @click.stop="onViewConflicts"
            >
              <span aria-hidden="true" v-html="I.alert"></span>
              {{ t('sync.viewConflicts') }}
            </button>
            <button
              class="btn btn-ghost btn-sm"
              data-testid="sp-resync-all-btn"
              :disabled="isSyncing || isResyncing"
              @click.stop="onResyncAll"
              :title="t('sync.resyncAllHint')"
            >
              <span aria-hidden="true" v-html="I.cloud"></span>
              {{ isResyncing ? t('sync.resyncing') : t('sync.resyncAll') }}
            </button>
          </div>
        </div>

        <!-- 个人资料编辑卡片 -->
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
              {{ savingProfile ? t('common.saving') : t('common.save') }}
            </button>
            <button
              class="btn btn-ghost btn-sm up-action-btn"
              @click="isEditingProfile = false"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>

        <div class="sp-card-row">
          <div class="sp-row-meta">
            <span class="sp-row-title">{{ t('settings.setPassword') }}</span>
            <span class="sp-row-desc">{{ t('settings.setPasswordDesc') }}</span>
          </div>
          <div class="sp-row-ctrl">
            <button class="btn btn-secondary btn-sm" id="spSetPasswordBtn" @click.stop="onOpenSetPassword">
              <span aria-hidden="true" v-html="I.password"></span>
              {{ t('settings.setPassword') }}
            </button>
          </div>
        </div>

        <div class="sp-card-row">
          <div class="sp-row-meta">
            <span class="sp-row-title">{{ t('userPopover.signOut') }}</span>
            <span class="sp-row-desc">{{ t('settings.signOutDesc') }}</span>
          </div>
          <div class="sp-row-ctrl">
            <button class="btn btn-ghost btn-sm text-danger" @click.stop="onLogout">
              <span aria-hidden="true" v-html="I.logout"></span>
              {{ t('userPopover.signOut') }}
            </button>
          </div>
        </div>
</template>
      <template v-else>
        <div class="sp-card-row">
          <div class="sp-row-meta">
            <span class="sp-row-title">{{ t('settings.loginAndSync') }}</span>
            <span class="sp-row-desc">{{ t('settings.loginHint') }}</span>
          </div>
          <div class="sp-row-ctrl">
            <button class="btn btn-primary btn-sm" @click.stop="onOpenLogin">{{ t('settings.loginRegister') }}</button>
          </div>
        </div>
      </template>
    </div>

    <!-- 端到端加密卡片 -->
    <div class="sp-card">
      <div class="sp-card-head">{{ t('userPopover.e2eTitle') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <div class="sp-row-title-with-badge">
            <span class="sp-row-title">{{ t('userPopover.e2eTitle') }}</span>
            <span class="sp-sync-status" data-testid="lv-e2e-status" :class="e2eEnabled ? (e2eUnlocked ? 'ok' : 'pending') : 'error'">
              {{ e2eEnabled ? (e2eUnlocked ? t('settings.e2eUnlocked') : t('settings.e2eLocked')) : t('settings.e2eDisabled') }}
            </span>
          </div>
          <span class="sp-row-desc">{{ t('settings.e2eHint') }}<span v-if="!auth.isLoggedIn">{{ t('settings.e2eHintLocalOnly') }}</span></span>
        </div>
        <div class="sp-row-ctrl">
          <button
            v-if="!e2eEnabled"
            class="btn btn-primary btn-sm"
            data-testid="lv-e2e-setup-btn"
            @click.stop="onOpenE2ESetup"
          >
            {{ t('userPopover.enableE2E') }}
          </button>
          <button
            v-else-if="!e2eUnlocked"
            class="btn btn-primary btn-sm"
            data-testid="lv-e2e-unlock-btn"
            @click.stop="onOpenE2EUnlock"
          >
            {{ e2e.isBiometricEnrolled.value ? t('settings.biometricUnlock') : t('userPopover.decrypt') }}
          </button>
          <button
            v-else
            class="btn btn-secondary btn-sm"
            data-testid="lv-e2e-lock-btn"
            @click.stop="onE2ELock"
          >
            {{ t('userPopover.lock') }}
          </button>
        </div>
      </div>
      <div v-if="e2eEnabled && e2eUnlocked" class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.masterKeySecurity') }}</span>
          <span class="sp-row-desc">{{ t('settings.masterKeySecurityDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button class="btn btn-ghost btn-sm" data-testid="lv-e2e-changepw-btn" @click.stop="onOpenE2EChangePw">
            <span aria-hidden="true" v-html="I.edit"></span> {{ t('settings.changeMasterPassword') }}
          </button>
          <button v-if="e2e.isBiometricEnrolled.value" class="btn btn-ghost btn-sm text-danger" data-testid="lv-e2e-biometric-remove" @click.stop="onRemoveBiometric">
            {{ t('settings.removeBiometric') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 账号注销卡片 -->
    <div v-if="auth.isLoggedIn" class="sp-card sp-danger-card">
      <div class="sp-card-head text-danger">{{ t('settings.danger') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title text-danger">{{ t('settings.deleteAccount') }}</span>
          <span class="sp-row-desc">{{ t('settings.deleteAccountDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button
            type="button"
            class="btn btn-danger btn-sm"
            data-testid="lv-delete-account"
            :disabled="deletingAccount"
            @click.stop="onDeleteAccount"
          >
            {{ deletingAccount ? t('settings.deleteAccountDoing') : t('settings.deleteAccount') }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Tab 2: 外观与视图 -->
</template>

<script setup lang="ts">
/** 设置面板 ·「账号与安全（登录 / 同步状态 / 资料编辑 / 端到端加密 / 注销）」标签页。共享实例经 settingsContext 注入，见该文件说明。 */
import { computed, ref, reactive } from 'vue'
import { useUIStore } from '../../../stores/ui.js'
import { I } from '../../../config/icons.js'
import { toast, showConfirm } from '../../../lib/toast.js'
import { purgeAccount } from '../../../composables/domain/useAccountDeletion.js'
import { PRESET_AVATAR_EMOJIS } from '../../../lib/avatar.js'
import { t } from '../../../i18n/index.js'
import { useSettingsContext } from './settingsContext.js'

const { sync, auth, e2e, userDisplay, userInitial, syncState } = useSettingsContext()

const uiStore = useUIStore()

const isResyncing = ref(false)

const isManualSyncing = ref(false)

const isSyncing = computed(() => syncState.value.level === 'syncing' || isManualSyncing.value)

const canRetrySync = computed(() =>
  syncState.value.level === 'error' ||
  syncState.value.level === 'offline' ||
  syncState.value.level === 'quota',
)

async function onManualSync() {
  if (isSyncing.value || isResyncing.value) return
  isManualSyncing.value = true
  toast(t('sync.startSync'))
  try {
    const ok = await sync.fullSync()
    if (ok) {
      toast(t('settings.syncDoneToast'), true)
    } else {
      toast(sync.syncError.value || t('settings.syncFailedToast'), false)
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : t('settings.syncFailedToast'), false)
  } finally {
    isManualSyncing.value = false
  }
}

async function onResyncAll() {
  if (isResyncing.value || isSyncing.value) return
  isResyncing.value = true
  toast(t('sync.startSync'))
  try {
    const ok = await sync.resyncAllToCloud()
    toast(ok ? t('sync.resyncAllDone') : t('sync.resyncAllFailed'), ok)
  } catch (err) {
    toast(err instanceof Error ? err.message : t('sync.resyncAllFailed'), false)
  } finally {
    isResyncing.value = false
  }
}

function onViewConflicts() {
  sync.resetConflictBannerDismissed()
  toast(t('sync.viewConflicts'))
}

function onOpenAuthModal() {
  uiStore.panels.settings = false
  auth.authModalOpen = true
}

const syncDetailDesc = computed(() => {
  if (sync.lastSyncAt.value) {
    const diff = Date.now() - sync.lastSyncAt.value
    let timeStr = t('settings.syncJustNow')
    if (diff >= 3600000) {
      timeStr = t('settings.syncHoursAgo', { n: Math.floor(diff / 3600000) })
    } else if (diff >= 60000) {
      timeStr = t('settings.syncMinutesAgo', { n: Math.floor(diff / 60000) })
    }
    return t('settings.syncLastSynced', { time: timeStr })
  }
  return t('settings.syncDefaultDesc')
})

const syncErrorMessage = computed(() => {
  if (syncState.value.level === 'quota') {
    return t('settings.syncErrorQuotaMsg')
  }
  if (sync.syncErrorKind.value === 'auth') {
    return t('settings.syncErrorAuthMsg')
  }
  if (sync.syncErrorKind.value === 'network') {
    return t('settings.syncErrorNetworkMsg')
  }
  if (syncState.value.level === 'error' && sync.syncError.value) {
    return sync.syncError.value
  }
  return ''
})

const syncErrorSummary = computed(() => {
  if (syncState.value.level === 'quota') return t('settings.syncErrorQuota')
  if (sync.syncErrorKind.value === 'auth') return t('settings.syncErrorAuth')
  if (sync.syncErrorKind.value === 'network') return t('settings.syncErrorNetwork')
  return t('settings.syncErrorGeneral')
})

const syncErrorDetail = computed(() => {
  if (syncState.value.level === 'quota') {
    return t('settings.syncErrorQuotaDetail')
  }
  if (sync.syncErrorKind.value === 'auth') {
    return t('settings.syncErrorAuthDetail')
  }
  if (sync.syncErrorKind.value === 'network') {
    return t('settings.syncErrorNetworkDetail')
  }
  return sync.syncError.value || t('settings.syncErrorGeneralDetail')
})

const isEditingProfile = ref(false)

const savingProfile = ref(false)

// 账号注销
const deletingAccount = ref(false)

async function onDeleteAccount() {
  if (deletingAccount.value) return
  const ok = await showConfirm(t('settings.deleteAccountConfirm'))
  if (!ok) return
  deletingAccount.value = true
  try {
    const r = await purgeAccount()
    if (r.ok) {
      toast(t('settings.deleteAccountDone'))
      // 重新加载，确保内存里的 store 也被清空
      setTimeout(() => location.reload(), 1200)
    } else {
      toast(t('settings.deleteAccountFailed'), false)
    }
  } finally {
    deletingAccount.value = false
  }
}

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
    const ok = await auth.updateProfile({
      nickname: profileForm.nickname,
      avatar: profileForm.avatar,
    })
    if (ok) {
      toast(t('settings.profileSavedToast'))
      isEditingProfile.value = false
    } else {
      // 云端保存失败：不再无条件弹「已保存」，保持编辑态供用户重试
      toast(t('common.failed'), false)
    }
  } catch (err) {
    console.error('Failed to save profile', err)
  } finally {
    savingProfile.value = false
  }
}

// dl and e2e initialized at top
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

async function onOpenLogin() {
  auth.authModalOpen = true
  uiStore.panels.settings = false
}

async function onLogout() {
  // signOutAndReset：无论远端是否确认都清同步态（详见 useCloudSync 里的注释）
  await sync.signOutAndReset()
}

// ── 设置/修改密码：表单在 SetPasswordModal 里，面板只负责唤起 ──
// 与 onOpenE2ESetup / onOpenE2EUnlock 一致：开弹窗就先收起面板，避免两层遮罩叠加。
function onOpenSetPassword() {
  uiStore.modals.setPassword = true
  uiStore.panels.settings = false
}
</script>
