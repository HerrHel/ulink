<template>
<ShareView v-if="shareGroupId" :group-id="shareGroupId" @close="shareGroupId = null" />
<template v-else>
<ErrorBoundary name="MainLayout">
<div class="lv-panel">
  <AppNav />
  <input type="file" id="importFile" accept=".json,.html,.htm,.csv" style="display:none" @change="handlers.onImportFile">
  <div class="resize-handle" id="resizeLeft"></div>
  <div class="panel-main">
    <div class="panel-main-inner">
      <AppHeader @toggle-rail="toggleRail" @exit-focus="handlers.onExitGroupFocus" @focus-title-change="handlers.onFocusTitleChange" @toggle-detail="toggleDetailPanel" @search="handlers.onSearch" @focus-edit-group="handlers.onFocusEditGroup" @focus-share-group="handlers.onFocusShareGroup" />
      <div class="filter-bar-wrap">
        <FilterBar @exit-focus="handlers.onExitGroupFocus" @focus-add-bm="handlers.onFocusAddBm" @focus-edit-group="handlers.onFocusEditGroup" @focus-undo="handlers.onFocusUndo" @focus-redo="handlers.onFocusRedo" @toggle-attr-filter="handlers.onToggleAttrFilter" @add-bookmark="handlers.onAddBookmark" @add-group="handlers.onAddGroup" />
        <BatchBar @batch-move="handlers.onBatchMove" @batch-delete="handlers.onBatchDelete" />
      </div>
      <BatchBottom @batch-move="handlers.onBatchMove" @batch-delete="handlers.onBatchDelete" />
      <div class="flex-1" style="display:flex;overflow:hidden">
        <div class="panel-content" id="panelContent">
          <ErrorBoundary name="CardGrid">
            <CardGrid />
          </ErrorBoundary>
        </div>
      </div>
      <BatchPopover />
    </div>
    <div class="resize-handle" id="resizeRight"></div>
    <DetailPanel />
  </div>
</div>

<ErrorBoundary name="Modals">
<template v-if="store.modals.bookmark">
  <BookmarkModal />
</template>
<template v-if="store.modals.category">
  <CategoryModal />
</template>
<template v-if="store.modals.attribute">
  <AttributeModal />
</template>
<template v-if="store.modals.groupEdit">
  <GroupEditModal />
</template>
<TrashPanel :open="store.panels.trash" @close="store.panels.trash = false" />
<ConfirmModal />
<HistoryPanel :open="store.panels.history" :item-id="store.historyItemId" :item-type="store.historyItemType" @close="store.panels.history = false" />
<AuthModal />
<E2ESetupModal :open="store.modals.e2eSetup" @close="store.modals.e2eSetup = false" />
<E2EUnlockModal :open="store.modals.e2eUnlock" @close="onE2EClose" @unlocked="onE2EUnlocked" />
<SetupGuide />
</ErrorBoundary>

<ErrorBoundary name="Overlays">
<ContextMenu /><ActionSheet /><ToastContainer /><FormatToolbar /><MentionDropdown />
<AddPopover />
<DeadLinksPopover />
<SyncConflictBanner />
<CommandPalette />
<ShortcutHelpPanel />
</ErrorBoundary>

<div class="dp-overlay" id="dpOverlay" :class="{ show: store.panels.detail && isMobile() }" @click="store.panels.detail = false; store.detailCards.splice(0)"></div>
<div class="overlay" id="railOverlay" :class="{ show: store.panels.rail }" @click="closeRail"></div>
</ErrorBoundary>
</template>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref, onMounted, watch } from 'vue'
import { useAppStore } from './stores/app.js'
import { isMobile } from './utils.js'
import { toggleDetailPanel, toggleRail, closeRail } from './composables/ui/useUI.js'
import { useApp } from './composables/useApp.js'
import { useAppHandlers } from './composables/useAppHandlers.js'
import { useAppLifecycle, onShareRoute } from './composables/useAppLifecycle.js'
import { useE2E } from './composables/domain/useE2E.js'
import { useCloudSync } from './composables/domain/useCloudSync.js'
import { useE2EStore } from './stores/e2e.js'
import AppHeader from './components/shell/AppHeader.vue'
import FilterBar from './components/shell/FilterBar.vue'
import BatchBar from './components/shell/BatchBar.vue'
import BatchBottom from './components/shell/BatchBottom.vue'
import CardGrid from './components/cards/CardGrid.vue'
import AppNav from './components/shell/AppNav.vue'
import ErrorBoundary from './components/ui/ErrorBoundary.vue'
import DetailPanel from './components/shell/DetailPanel.vue'
// PERF-5：非首屏 overlay / modal 全部 async，切断启动链
const AddPopover = defineAsyncComponent(() => import('./components/overlays/AddPopover.vue'))
const DeadLinksPopover = defineAsyncComponent(() => import('./components/overlays/DeadLinksPopover.vue'))
const ToastContainer = defineAsyncComponent(() => import('./components/overlays/ToastContainer.vue'))
const ContextMenu = defineAsyncComponent(() => import('./components/overlays/ContextMenu.vue'))
const ActionSheet = defineAsyncComponent(() => import('./components/overlays/ActionSheet.vue'))
const BatchPopover = defineAsyncComponent(() => import('./components/overlays/BatchPopover.vue'))
const FormatToolbar = defineAsyncComponent(() => import('./components/editor/FormatToolbar.vue'))
const MentionDropdown = defineAsyncComponent(() => import('./components/overlays/MentionDropdown.vue'))
const SyncConflictBanner = defineAsyncComponent(() => import('./components/overlays/SyncConflictBanner.vue'))
const CommandPalette = defineAsyncComponent(() => import('./components/overlays/CommandPalette.vue'))
const ShortcutHelpPanel = defineAsyncComponent(() => import('./components/overlays/ShortcutHelpPanel.vue'))
const ConfirmModal = defineAsyncComponent(() => import('./components/modals/ConfirmModal.vue'))
const AuthModal = defineAsyncComponent(() => import('./components/modals/AuthModal.vue'))
import { openBmModal, bmForm, saveFromExtension } from './composables/domain/useBookmark.js'

const BookmarkModal = defineAsyncComponent(() => import('./components/modals/BookmarkModal.vue'))
const CategoryModal = defineAsyncComponent(() => import('./components/modals/CategoryModal.vue'))
const AttributeModal = defineAsyncComponent(() => import('./components/modals/AttributeModal.vue'))
const GroupEditModal = defineAsyncComponent(() => import('./components/modals/GroupEditModal.vue'))
const TrashPanel = defineAsyncComponent(() => import('./components/modals/TrashPanel.vue'))
const HistoryPanel = defineAsyncComponent(() => import('./components/modals/HistoryPanel.vue'))
const E2ESetupModal = defineAsyncComponent(() => import('./components/modals/E2ESetupModal.vue'))
const E2EUnlockModal = defineAsyncComponent(() => import('./components/modals/E2EUnlockModal.vue'))
const SetupGuide = defineAsyncComponent(() => import('./components/modals/SetupGuide.vue'))

// A4: 公开分享页面
const ShareView = defineAsyncComponent(() => import('./views/ShareView.vue'))
const shareGroupId = ref<string | null>(null)
onShareRoute((gid: string) => { shareGroupId.value = gid })

const store = useAppStore()
useApp()
useAppLifecycle()
const { handlers } = useAppHandlers()

// E2E 加密状态
const e2e = useE2E()
const e2eStore = useE2EStore()
const cloudSync = useCloudSync()

onMounted(async () => {
  // P1: E2E 改为按需引导 — 不再是「设过主密码就每次启动必解锁」。
  // 仅在保存敏感字段（密码）或编辑已加密书签时弹解锁提示。
  await e2e.checkE2EStatus()

  // 处理扩展 / share_target 传来的保存请求
  //   - 扩展快捷键/右键菜单: ?ext_save=1&ext_save_url=...&ext_save_title=...
  //   - Web Share Target: ?title=...&text=...&url=...
  // 静默保存 + toast 撤销（否决纯静默方案，保留可逆性）
  const params = new URLSearchParams(window.location.search)
  const extSaveUrl = params.get('ext_save_url')
  const shareUrl = params.get('url')
  // ext_save 优先，share_target 次之
  const incomingUrl = extSaveUrl || shareUrl
  if (incomingUrl) {
    const incomingTitle = params.get('ext_save_title') || params.get('title') || ''
    const incomingText = params.get('ext_save_notes') || params.get('text') || ''
    // 等应用初始化完成后再保存
    setTimeout(() => {
      saveFromExtension(incomingUrl, incomingTitle, incomingText)
      // 清理 URL 参数，避免刷新时重复保存
      const cleanUrl = window.location.origin + window.location.pathname
      window.history.replaceState(null, '', cleanUrl)
    }, 800)
  }
})

/**
 * 按需解锁：当 e2eStore.pendingUnlock 数组非空时，弹出解锁弹窗。
 * B-2 修复：改为监听数组长度变化（而非单值），允许多个等待者同时被通知。
 */
watch(() => e2eStore.pendingUnlock.length, (len) => {
  if (len > 0) {
    store.modals.e2eUnlock = true
  }
})

function onE2EUnlocked() {
  store.modals.e2eUnlock = false
  // 有操作在等待解锁 → 逐个 resolve(true) 继续
  const pending = e2eStore.pendingUnlock.splice(0)
  for (const resolve of pending) resolve(true)
  // 解锁后 flush：锁定期静默排队等解锁的敏感字段 op（username/notes 等）此时 key 已入内存，
  // 触发一次推送把它们补上云。debouncedSync 内含 autoSync 检查，关闭自动同步时跳过。
  cloudSync.debouncedSync()
}

/** E2E 解锁弹窗关闭/取消 */
function onE2EClose() {
  store.modals.e2eUnlock = false
  // 有操作在等待解锁但用户取消 → 逐个 resolve(false)
  const pending = e2eStore.pendingUnlock.splice(0)
  for (const resolve of pending) resolve(false)
}
</script>
