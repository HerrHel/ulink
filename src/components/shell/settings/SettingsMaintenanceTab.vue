<template>
  <div class="settings-tab-panel" data-testid="settings-panel-maintenance">
    <div class="sp-tab-header">
      <h3 class="sp-tab-title">{{ t('settings.tabMaintenance') }}</h3>
      <p class="sp-tab-desc">{{ t('settings.tabMaintenanceDesc') }}</p>
    </div>

    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.maintenance') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.checkDeadLinks') }}</span>
          <span class="sp-row-desc">{{ t('settings.checkDeadLinksDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button class="btn btn-secondary btn-sm" :class="{ checking: dlChecking }" @click.stop="onCheckDeadLinks" :disabled="dlChecking">
            <span aria-hidden="true" v-html="I.radar"></span>
            <span>{{ dlChecking ? t('settings.checking') : t('settings.checkDeadLinks') }}</span>
            <span v-if="deadCount > 0" class="sp-badge">{{ deadCount }}</span>
            <span v-if="blockedCount > 0" class="sp-badge sp-badge-gfw">{{ blockedCount }}</span>
          </button>
          <button v-if="deadCount + blockedCount > 0" class="btn btn-ghost btn-sm" @click.stop="onViewDeadLinks">
            {{ t('settings.view') }}
          </button>
        </div>
      </div>
      <div v-if="dlChecking && dlProgress.total > 0" class="sp-progress-box">
        <div class="sp-progress-track">
          <div class="sp-progress-bar" :style="{ width: (dlProgress.done / dlProgress.total * 100) + '%' }"></div>
        </div>
        <span class="sp-progress-label">{{ dlProgress.done }}/{{ dlProgress.total }}</span>
        <span v-if="dlProgress.truncated > 0" class="sp-progress-extra">{{ t('settings.dlScanLimited', { n: dlProgress.truncated }) }}</span>
      </div>
      <div class="sp-card-row" @click="onToggleAutoDeadCheck" style="cursor: pointer;">
        <div class="sp-row-meta">
          <span class="sp-row-title">
            {{ t('settings.autoDeadCheckWeekly') }}
            <span class="sp-pro-tag">PRO</span>
          </span>
          <span class="sp-row-desc">{{ t('settings.autoDeadCheckWeeklyDesc') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-toggle-pill" :class="{ active: dlAutoEnabled, locked: !dlAutoAllowed }">
            <span class="sp-switch"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-card sp-section-whitelist">
      <div class="sp-card-head sp-shares-header">
        <div class="sp-shares-head-title">
          <span>{{ t('settings.deadLinkWhitelist') }}</span>
          <span v-if="deadLinkWhitelist.length > 0" class="sp-shares-count">({{ deadLinkWhitelist.length }})</span>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.whitelistAdd') }}</span>
          <span class="sp-row-desc">{{ t('settings.deadLinkWhitelistDesc') }}</span>
        </div>
        <div class="sp-row-ctrl sp-whitelist-ctrl">
          <input
            type="text"
            class="form-input sp-whitelist-input"
            v-model="whitelistInput"
            :placeholder="t('settings.deadLinkWhitelistPlaceholder')"
            @keydown.enter="onAddWhitelist"
          />
          <button class="btn btn-primary btn-sm" :disabled="!whitelistInput.trim()" @click="onAddWhitelist">
            {{ t('common.add') }}
          </button>
        </div>
      </div>
      <div v-if="deadLinkWhitelist.length" class="sp-whitelist-chips-row">
        <div class="sp-whitelist-chips">
          <span v-for="domain in deadLinkWhitelist" :key="domain" class="sp-whitelist-chip">
            <span class="sp-chip-dot" aria-hidden="true"></span>
            <span class="sp-chip-domain">{{ domain }}</span>
            <button
              type="button"
              class="sp-chip-remove"
              :title="t('common.delete')"
              @click.stop="onRemoveWhitelist(domain)"
            >
              <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2">
                <line x1="3" y1="3" x2="13" y2="13" stroke-linecap="round" />
                <line x1="13" y1="3" x2="3" y2="13" stroke-linecap="round" />
              </svg>
            </button>
          </span>
        </div>
      </div>
      <div v-else class="sp-whitelist-empty">
        {{ t('settings.deadLinkWhitelistEmpty') }}
      </div>
    </div>

    <div class="sp-card sp-section-shares">
      <div class="sp-card-head sp-shares-header">
        <div class="sp-shares-head-title">
          <span>{{ t('settings.shareManagement') }}</span>
          <span v-if="allPublicShares.length > 0" class="sp-shares-count">({{ allPublicShares.length }})</span>
        </div>
        <button
          v-if="allPublicShares.length > 1"
          class="sp-shares-stop-all"
          :title="t('settings.stopAllShares')"
          @click.stop="onStopAllShares"
        >
          {{ t('settings.stopAllShares') }}
        </button>
      </div>
      <p class="sp-desc" style="padding: 10px 16px 4px;">{{ t('settings.publicSharesDesc') }}</p>
      <div v-if="allPublicShares.length > 0" class="sp-shares-list-wrap">
        <div v-for="item in allPublicShares" :key="item.type + ':' + item.id" class="sp-share-item">
          <div class="sp-share-info">
            <span class="sp-share-badge" :class="'sp-share-badge--' + item.type">
              {{ item.type === 'group' ? t('settings.shareTypeGroup') : t('settings.shareTypeCategory') }}
            </span>
            <span class="sp-share-title" :title="item.title">{{ item.title }}</span>
          </div>
          <div class="sp-share-actions">
            <button type="button" class="sp-share-btn" :title="t('modal.share.copyLink')" @click.stop="onCopyShare(item.url)" v-html="I.link"></button>
            <a :href="item.url" target="_blank" rel="noopener noreferrer" class="sp-share-btn" :title="t('modal.share.preview')" @click.stop v-html="I.external"></a>
            <button type="button" class="sp-share-btn sp-share-btn--danger" :title="t('modal.share.stopShare')" @click.stop="onStopShareItem(item)" v-html="I.close"></button>
          </div>
        </div>
      </div>
      <div v-else class="sp-shares-empty">
        {{ t('settings.noPublicShares') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 设置面板 ·「维护与分享（死链检测与白名单 / 公开分享管理）」标签页。共享实例经 settingsContext 注入，见该文件说明。 */
import { computed, ref } from 'vue'
import { useUIStore } from '../../../stores/ui.js'
import { useDataStore } from '../../../stores/data.js'
import { pushNavState } from '../../../composables/interaction/useKeyboardOps.js'
import { I } from '../../../config/icons.js'
import { toast, showConfirm } from '../../../lib/toast.js'
import { copyToClipboard } from '../../../utils.js'
import { stopShareGroup, stopShareCategory, stopAllUserShares } from '../../../composables/domain/useDataShare.js'
import { t, tN } from '../../../i18n/index.js'
import { useSettingsContext, type PublicShareItem } from './settingsContext.js'

const { loadUserCategoryShares, auth, allPublicShares, dl, showPurchase, blockedCount, deadCount } = useSettingsContext()

const dataStore = useDataStore()

const uiStore = useUIStore()

const dlChecking = computed(() => dl.checking.value)

const dlProgress = computed(() => dl.progress.value)

const dlAutoEnabled = computed(() => dl.autoCheckEnabled.value)

const dlAutoAllowed = computed(() => dl.autoCheckAllowed.value)

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

async function onToggleAutoDeadCheck() {
  if (dl.autoCheckEnabled.value) {
    dl.stopAutoCheck()
    return
  }
  if (!auth.isLoggedIn) {
    toast(t('settings.autoDeadCheckNeedsLogin'), false)
    auth.authModalOpen = true
    return
  }
  // 自动全量检测是成本最高的路径（请求数与书签数成正比），需 Plus 权益
  const allowed = await dl.refreshAutoCheckAllowed()
  if (!allowed) {
    toast(t('settings.autoDeadCheckNeedsPlus'), false)
    showPurchase.value = true
    return
  }
  dl.startAutoCheck()
}

const whitelistInput = ref('')

const deadLinkWhitelist = ref<string[]>(dl.getWhitelist())

function onAddWhitelist() {
  const d = whitelistInput.value.trim()
  if (!d) return
  dl.addToWhitelist(d)
  deadLinkWhitelist.value = dl.getWhitelist()
  whitelistInput.value = ''
  toast(t('settings.whitelistAdded', { d }))
}

function onRemoveWhitelist(d: string) {
  dl.removeFromWhitelist(d)
  deadLinkWhitelist.value = dl.getWhitelist()
  toast(t('settings.whitelistRemoved', { d }))
}

function onCopyShare(url: string) {
  copyToClipboard(url, t('msg.shareLinkLabel'))
}

async function onStopShareItem(item: PublicShareItem) {
  const ok = await showConfirm(t('modal.share.stopConfirm'))
  if (!ok) return
  if (item.type === 'group') {
    const success = await stopShareGroup(item.id)
    if (success) {
      toast(t('modal.share.stopped'), true)
    } else {
      toast(t('common.failed'), false)
    }
  } else {
    const success = await stopShareCategory(item.id)
    if (success) {
      toast(t('modal.share.stopped'), true)
      await loadUserCategoryShares()
    } else {
      toast(t('common.failed'), false)
    }
  }
}

async function onStopAllShares() {
  const ok = await showConfirm(t('settings.stopAllSharesConfirm'))
  if (!ok) return
  const success = await stopAllUserShares()
  if (success) {
    toast(t('settings.allSharesStopped'), true)
    await loadUserCategoryShares()
  } else {
    toast(t('common.failed'), false)
  }
}
</script>
