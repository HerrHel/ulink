<template>
  <Teleport to="body">
    <Transition name="up-popover">
      <div
        v-if="store.open && auth.isLoggedIn"
        class="user-popover-mask"
        @click="close"
        @keydown.esc="close"
      >
        <div
          class="user-popover-card"
          :style="popoverStyle"
          @click.stop
        >
          <!-- 顶部：用户个人资料区 -->
          <div class="up-hero">
            <div class="up-avatar">
              <span v-if="auth.avatar" class="up-avatar-emoji">{{ auth.avatar }}</span>
              <span v-else class="up-avatar-initial">{{ userInitial }}</span>
            </div>
            <div class="up-meta">
              <div class="up-name-row">
                <span class="up-name" :title="auth.displayName || userDisplay">{{ auth.displayName || userDisplay }}</span>
                <button
                  class="up-edit-btn"
                  @click="toggleEditProfile"
                  :title="isEditing ? t('userPopover.closeEdit') : t('userPopover.editProfile')"
                >
                  <span aria-hidden="true" v-html="I.edit"></span>
                  <span>{{ isEditing ? t('userPopover.closeEdit') : t('userPopover.editProfile') }}</span>
                </button>
              </div>
              <span class="up-email" :title="auth.userEmail">{{ auth.userEmail }}</span>
            </div>
          </div>

          <!-- 就地编辑个人资料模式（展开态） -->
          <div v-if="isEditing" class="up-edit-box">
            <div class="up-field">
              <label class="up-label">{{ t('settings.nickname') }}</label>
              <input
                v-model="profileForm.nickname"
                type="text"
                maxlength="20"
                class="up-input"
                :placeholder="t('settings.nicknamePlaceholder')"
                @keydown.enter="saveProfile"
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
                :disabled="saving"
                @click="saveProfile"
              >
                {{ saving ? (t('common.saving') || '保存中…') : t('common.save') }}
              </button>
              <button
                class="btn btn-ghost btn-sm up-action-btn"
                @click="isEditing = false"
              >
                {{ t('common.cancel') }}
              </button>
            </div>
          </div>

          <!-- 快捷操作列表 -->
          <div v-else class="up-menu">
            <!-- 云端同步状态与手动触发 -->
            <div class="up-menu-item up-sync-item">
              <div class="up-item-left">
                <span class="up-item-icon" aria-hidden="true" v-html="I.cloud"></span>
                <div class="up-sync-info">
                  <span class="up-item-title">{{ t('settings.cloudSync') }}</span>
                  <span class="up-sync-status" :class="syncState.level">
                    <span class="up-sync-dot" :class="syncState.dotClass"></span>{{ syncState.label }}
                  </span>
                </div>
              </div>
              <button
                class="up-sync-trigger-btn"
                :class="{ syncing: isSyncing }"
                :disabled="isSyncing"
                @click="triggerSync"
                :title="t('userPopover.syncNow')"
              >
                <span aria-hidden="true" v-html="I.refresh" class="up-spin-icon"></span>
                <span>{{ isSyncing ? t('userPopover.syncing') : t('userPopover.syncNow') }}</span>
              </button>
            </div>

            <!-- 数据解密 / 加密状态与切换 -->
            <button class="up-menu-item" @click="handleE2EAction">
              <div class="up-item-left">
                <span class="up-item-icon" aria-hidden="true" v-html="I.password"></span>
                <div class="up-item-text">
                  <span class="up-item-title">{{ t('userPopover.e2eTitle') }}</span>
                  <span class="up-item-desc">{{ e2eStatusDesc }}</span>
                </div>
              </div>
              <span class="up-tag" :class="e2eTagClass">
                {{ e2eActionLabel }}
              </span>
            </button>

            <!-- 完整设置入口 -->
            <button class="up-menu-item" @click="openSettings">
              <div class="up-item-left">
                <span class="up-item-icon" aria-hidden="true" v-html="I.settings"></span>
                <span class="up-item-title">{{ t('userPopover.preferences') }}</span>
              </div>
              <span class="up-chevron" aria-hidden="true" v-html="I.chevron"></span>
            </button>

            <div class="up-divider"></div>

            <!-- 退出登录 -->
            <button class="up-menu-item up-danger-item" @click="onSignOut">
              <div class="up-item-left">
                <span class="up-item-icon" aria-hidden="true" v-html="I.logout"></span>
                <span class="up-item-title">{{ t('userPopover.signOut') }}</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted } from 'vue'
import { useUserPopoverStore } from '../../stores/overlay.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { useUIStore } from '../../stores/ui.js'
import { I } from '../../config/icons.js'
import { PRESET_AVATAR_EMOJIS } from '../../lib/avatar.js'
import { toast } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'

const store = useUserPopoverStore()
const auth = useAuth()
const sync = useCloudSync()
const syncState = useSyncState()
const e2e = useE2E()
const uiStore = useUIStore()

const isSyncing = ref(false)
const isEditing = ref(false)
const saving = ref(false)

const profileForm = reactive({
  nickname: '',
  avatar: '',
})

const userInitial = computed(() => {
  const name = auth.displayName || auth.userEmail
  if (!name) return 'U'
  return name.charAt(0).toUpperCase()
})

const userDisplay = computed(() => {
  if (!auth.userEmail) return ''
  return auth.userEmail.split('@')[0]
})

const isE2EEnabled = computed(() => !!e2e.isE2EEnabled.value)
const isUnlocked = computed(() => !!e2e.isUnlocked.value)

const e2eStatusDesc = computed(() => {
  if (!isE2EEnabled.value) return t('userPopover.e2eDisabled')
  return isUnlocked.value ? t('userPopover.e2eUnlocked') : t('userPopover.e2eLocked')
})

const e2eActionLabel = computed(() => {
  if (!isE2EEnabled.value) return t('userPopover.enableE2E')
  return isUnlocked.value ? t('userPopover.lock') : t('userPopover.decrypt')
})

const e2eTagClass = computed(() => {
  if (!isE2EEnabled.value) return 'tag-disabled'
  return isUnlocked.value ? 'tag-unlocked' : 'tag-locked'
})

const popoverStyle = computed(() => {
  const rect = store.triggerRect
  if (!rect) return {}
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1024
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 768

  const isNarrow = rect.width ? rect.width < 100 : rect.right < 100
  let left = rect.left
  let bottom = windowHeight - rect.top + 8

  if (isNarrow) {
    // 侧边栏折叠小图标态：向右上方对齐弹出
    left = rect.right + 10
    bottom = Math.max(12, windowHeight - rect.bottom)
  } else {
    // 展开态：卡片正上方对齐
    left = Math.max(12, rect.left)
  }

  // 防止超出右边缘
  const popoverWidth = 280
  if (left + popoverWidth > windowWidth - 12) {
    left = windowWidth - popoverWidth - 12
  }

  return {
    left: `${left}px`,
    bottom: `${bottom}px`,
  }
})

function close() {
  store.hide()
  isEditing.value = false
}

function toggleEditProfile() {
  if (!isEditing.value) {
    profileForm.nickname = auth.displayName !== userDisplay.value ? (auth.customNickname || auth.displayName) : (auth.customNickname || '')
    profileForm.avatar = auth.avatar || ''
    isEditing.value = true
  } else {
    isEditing.value = false
  }
}

async function saveProfile() {
  saving.value = true
  try {
    await auth.updateProfile({
      nickname: profileForm.nickname,
      avatar: profileForm.avatar,
    })
    toast(t('settings.profileSavedToast'))
    isEditing.value = false
  } catch (err) {
    console.error('Failed to save profile', err)
  } finally {
    saving.value = false
  }
}

async function triggerSync() {
  if (isSyncing.value) return
  isSyncing.value = true
  toast(t('sync.startSync'))
  try {
    await sync.fullSync()
  } finally {
    setTimeout(() => {
      isSyncing.value = false
    }, 600)
  }
}

function handleE2EAction() {
  close()
  if (!isE2EEnabled.value) {
    uiStore.modals.e2eSetup = true
  } else if (isUnlocked.value) {
    e2e.lock()
    toast(t('settings.lockedToast'))
  } else {
    uiStore.e2eUnlockInitialMode = 'unlock'
    uiStore.modals.e2eUnlock = true
  }
}

function openSettings() {
  close()
  uiStore.panels.settings = true
}

async function onSignOut() {
  close()
  const ok = await auth.signOut()
  if (ok) {
    await sync.resetSyncState()
    toast(t('settings.logout'))
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && store.open) {
    close()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>
