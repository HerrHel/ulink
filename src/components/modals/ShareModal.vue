<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="modalTitle" :class="{ open: store.modals.share }" @mousedown="onMaskMouseDown" @click="onMaskClick">
    <div class="modal share-modal">
      <div class="modal-head">
        <h2>{{ modalTitle }}</h2>
        <button class="modal-close" @click="onClose" :title="t('common.close')" :aria-label="t('common.close')" v-html="I.close"></button>
      </div>

      <div class="modal-body">
        <!-- 目标信息卡片 -->
        <div class="share-target-preview">
          <div class="share-target-info">
            <div class="share-target-name">{{ targetName }}</div>
            <div class="share-target-meta">{{ targetMetaText }}</div>
          </div>
        </div>

        <!-- 分隔线 -->
        <div class="share-divider"></div>

        <!-- 加载状态（分类查询 share_id 期间） -->
        <div v-if="loading" class="share-loading">
          <span class="share-spinner"></span>
          <span>{{ t('share.loading') }}</span>
        </div>

        <!-- 公开状态区域 -->
        <div v-else class="share-status-card" :class="{ 'is-public': isPublic }">
          <div class="share-toggle-row">
            <div class="share-toggle-text">
              <div class="share-toggle-title">
                <span class="share-status-dot" :class="{ active: isPublic }"></span>
                <span>{{ isPublic ? t('modal.share.publicStatusOn') : t('modal.share.publicStatusOff') }}</span>
              </div>
              <div class="share-toggle-desc">
                {{ isPublic ? t('modal.share.publicDescOn') : t('modal.share.publicDescOff') }}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="isPublic"
              class="switch-toggle-btn"
              :class="{ active: isPublic, disabled: operating }"
              :disabled="operating"
              :title="isPublic ? t('modal.share.stopShare') : t('modal.share.enableShare')"
              @click.stop="onTogglePublic"
            >
              <span class="switch-slider"></span>
            </button>
          </div>

          <!-- 开启状态下的链接与操作 -->
          <div v-if="isPublic" class="share-link-section">
            <div class="share-link-box">
              <input
                type="text"
                class="form-input share-link-input"
                readonly
                :value="shareUrl"
                @focus="($event.target as HTMLInputElement).select()"
              />
              <button class="btn btn-primary btn-sm share-btn-copy" :disabled="operating" @click="onCopyLink">
                <span aria-hidden="true" v-html="copied ? I.listCheck : I.copy"></span>
                <span>{{ copied ? t('modal.share.copied') : t('modal.share.copyLink') }}</span>
              </button>
            </div>

            <div class="share-actions-row">
              <a :href="shareUrl" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm share-btn-preview">
                <span aria-hidden="true" v-html="I.external"></span>
                <span>{{ t('modal.share.preview') }}</span>
              </a>
              <button class="btn btn-danger-ghost btn-sm share-btn-stop" :disabled="operating" @click="onStopShare">
                {{ t('modal.share.stopShare') }}
              </button>
            </div>
          </div>

          <!-- 关闭状态下的大按钮提示 -->
          <div v-else class="share-disabled-section">
            <button class="btn btn-primary btn-sm" :disabled="operating" @click="onEnableShare">
              {{ t('modal.share.enableShare') }}
            </button>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn btn-secondary" @click="onClose">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAuthStore } from '../../stores/auth.js'
import { I } from '../../config/icons.js'
import { SHARE_BASE } from '../../config/urls.js'
import {
  setGroupPublic,
  upsertPublicCategoryShare,
  getCategoryShareId,
  deletePublicCategoryShare,
  CATEGORY_SHARE_PATH,
} from '../../composables/domain/syncShare.js'
import { copyToClipboard } from '../../utils.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { collectDescendantIds } from '../../lib/collectSubIds.js'
import { t } from '../../i18n/index.js'

const store = useAppStore()
const dataStore = useDataStore()
const uiStore = useUIStore()
const authStore = useAuthStore()

const loading = ref(false)
const operating = ref(false)
const copied = ref(false)
const categoryShareId = ref<string | null>(null)

const target = computed(() => uiStore.shareModalTarget)
const isGroup = computed(() => target.value?.type === 'group')
const targetId = computed(() => target.value?.id || '')

const groupItem = computed(() => isGroup.value ? dataStore.groupMap[targetId.value] : null)
const categoryItem = computed(() => !isGroup.value ? dataStore.categoryMap[targetId.value] : null)

const modalTitle = computed(() => {
  return isGroup.value ? t('modal.share.titleGroup') : t('modal.share.titleCat')
})

const targetName = computed(() => {
  if (isGroup.value) {
    return groupItem.value?.name || t('cards.unnamedGroup')
  }
  return categoryItem.value?.name || t('modal.category.name')
})



const targetMetaText = computed(() => {
  if (isGroup.value) {
    const count = groupItem.value?.bookmarkIds?.length || 0
    return `${count} ${t('cards.bookmarksCount')}`
  }
  const count = dataStore.bookmarks.filter(b => b.categoryId === targetId.value && !b.deletedAt).length
  return `${count} ${t('cards.bookmarksCount')}`
})

const isPublic = computed(() => {
  if (isGroup.value) {
    return Boolean(groupItem.value?.isPublic)
  }
  return Boolean(categoryShareId.value)
})

const shareUrl = computed(() => {
  if (isGroup.value) {
    return `${SHARE_BASE}/${targetId.value}`
  }
  if (categoryShareId.value) {
    return `${SHARE_BASE}/${CATEGORY_SHARE_PATH}/${categoryShareId.value}`
  }
  return ''
})

async function checkCategoryShare() {
  if (isGroup.value || !targetId.value) return
  loading.value = true
  try {
    categoryShareId.value = await getCategoryShareId(targetId.value)
  } finally {
    loading.value = false
  }
}

watch(
  () => [store.modals.share, uiStore.shareModalTarget],
  ([open]) => {
    copied.value = false
    if (open) {
      if (!isGroup.value && targetId.value) {
        checkCategoryShare()
      }
    } else {
      categoryShareId.value = null
    }
  },
  { immediate: true }
)

const { onMaskMouseDown, onMaskClick } = useMaskClose(() => onClose())

function onClose() {
  uiStore.closeShareModal()
}

function collectAllGroupBookmarks(groupId: string): string[] {
  const g = dataStore.groupMap[groupId]
  if (!g) return []
  const bmIds = new Set<string>()
  for (const bid of g.bookmarkIds || []) {
    const subs = collectDescendantIds((pid) => dataStore.childrenMap[pid], bid)
    for (const sid of subs) bmIds.add(sid)
  }
  return Array.from(bmIds)
}

function collectAllCategoryBookmarks(categoryId: string): { groupIds: string[]; bookmarkIds: string[] } {
  const groups = dataStore.siblingGroups.filter(g => g.categoryId === categoryId && !g.deletedAt)
  const groupIds = groups.map(g => g.id)
  const bmIds = new Set<string>()
  for (const b of dataStore.bookmarks) {
    if (b.categoryId === categoryId && !b.deletedAt) {
      const subs = collectDescendantIds((pid) => dataStore.childrenMap[pid], b.id)
      for (const sid of subs) bmIds.add(sid)
    }
  }
  for (const g of groups) {
    for (const bid of g.bookmarkIds || []) {
      const subs = collectDescendantIds((pid) => dataStore.childrenMap[pid], bid)
      for (const sid of subs) bmIds.add(sid)
    }
  }
  return { groupIds, bookmarkIds: Array.from(bmIds) }
}

function syncSharedEntities() {
  const now = Date.now()
  if (isGroup.value) {
    const g = groupItem.value
    if (g) {
      dataStore._markDirty(g.id)
      g.updatedAt = Math.max(Number(g.updatedAt || 0), now)
      const bmIds = collectAllGroupBookmarks(g.id)
      for (const bid of bmIds) {
        const b = dataStore.bookmarkMap[bid]
        if (b) {
          dataStore._markDirty(bid)
          b.updatedAt = Math.max(Number(b.updatedAt || 0), now)
          if (g.categoryId && (!b.categoryId || b.categoryId !== g.categoryId)) {
            b.categoryId = g.categoryId
          }
        }
      }
    }
  } else if (targetId.value) {
    dataStore._markDirty(targetId.value)
    const { groupIds, bookmarkIds } = collectAllCategoryBookmarks(targetId.value)
    for (const gid of groupIds) {
      const g = dataStore.groupMap[gid]
      if (g) {
        dataStore._markDirty(gid)
        g.updatedAt = Math.max(Number(g.updatedAt || 0), now)
      }
    }
    for (const bid of bookmarkIds) {
      const b = dataStore.bookmarkMap[bid]
      if (b) {
        dataStore._markDirty(bid)
        b.updatedAt = Math.max(Number(b.updatedAt || 0), now)
        if (!b.categoryId) {
          b.categoryId = targetId.value
        }
      }
    }
  }

  // 同步将全部实体（含所有子书签与最新解密明文）即刻推送到云端
  try {
    void useCloudSync().syncImmediate().catch(() => {})
  } catch (syncErr) {
    console.warn('[share] pre-share sync error:', syncErr)
  }
}

async function onCopyLink() {
  if (!shareUrl.value) return
  copyToClipboard(shareUrl.value, t('msg.shareLinkLabel'))
  copied.value = true
  setTimeout(() => {
    copied.value = false
  }, 2000)
  if (authStore.isLoggedIn) {
    syncSharedEntities()
  }
}

async function onEnableShare() {
  if (operating.value) return
  if (!authStore.isLoggedIn) {
    toast(t('msg.shareLoginRequired'), false)
    return
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    toast(t('common.networkOffline'), false)
    return
  }

  operating.value = true
  try {
    syncSharedEntities()

    if (isGroup.value) {
      const ok = await setGroupPublic(targetId.value, true)
      if (!ok) {
        toast(t('common.failed'), false)
        return
      }
      onCopyLink()
      toast(t('modal.share.enabled'), true)
    } else {
      const shareId = await upsertPublicCategoryShare(targetId.value)
      if (!shareId) {
        toast(t('common.failed'), false)
        return
      }
      categoryShareId.value = shareId
      onCopyLink()
      toast(t('modal.share.enabled'), true)
    }
  } catch (err) {
    console.warn('[share] enable share error:', err)
    toast(t('common.failed'), false)
  } finally {
    operating.value = false
  }
}

async function onStopShare() {
  if (operating.value) return
  const confirmed = await showConfirm(t('modal.share.stopConfirm'))
  if (!confirmed) return

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    toast(t('common.networkOffline'), false)
    return
  }

  operating.value = true
  try {
    if (isGroup.value) {
      const ok = await setGroupPublic(targetId.value, false)
      if (ok) {
        toast(t('modal.share.stopped'), true)
      } else {
        toast(t('common.failed'), false)
      }
    } else {
      const ok = await deletePublicCategoryShare(targetId.value)
      if (ok) {
        categoryShareId.value = null
        toast(t('modal.share.stopped'), true)
      } else {
        toast(t('common.failed'), false)
      }
    }
  } catch (err) {
    console.warn('[share] stop share error:', err)
    toast(t('common.failed'), false)
  } finally {
    operating.value = false
  }
}

async function onTogglePublic() {
  if (operating.value) return
  if (isPublic.value) {
    await onStopShare()
  } else {
    await onEnableShare()
  }
}
</script>
