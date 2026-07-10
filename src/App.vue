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
<E2EUnlockModal :open="store.modals.e2eUnlock" @close="store.modals.e2eUnlock = false" @unlocked="onE2EUnlocked" />
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
import { defineAsyncComponent, ref, onMounted } from 'vue'
import { useAppStore } from './stores/app.js'
import { isMobile } from './utils.js'
import { toggleDetailPanel, toggleRail, closeRail } from './composables/ui/useUI.js'
import { useApp } from './composables/useApp.js'
import { useAppHandlers } from './composables/useAppHandlers.js'
import { useAppLifecycle, onShareRoute } from './composables/useAppLifecycle.js'
import { useE2E } from './composables/domain/useE2E.js'
import AppHeader from './components/shell/AppHeader.vue'
import FilterBar from './components/shell/FilterBar.vue'
import BatchBar from './components/shell/BatchBar.vue'
import BatchBottom from './components/shell/BatchBottom.vue'
import AddPopover from './components/overlays/AddPopover.vue'
import DeadLinksPopover from './components/overlays/DeadLinksPopover.vue'
import CardGrid from './components/cards/CardGrid.vue'
import AppNav from './components/shell/AppNav.vue'
import ToastContainer from './components/overlays/ToastContainer.vue'
import ContextMenu from './components/overlays/ContextMenu.vue'
import ActionSheet from './components/overlays/ActionSheet.vue'
import BatchPopover from './components/overlays/BatchPopover.vue'
import FormatToolbar from './components/editor/FormatToolbar.vue'
import ErrorBoundary from './components/ui/ErrorBoundary.vue'
const ConfirmModal = defineAsyncComponent(() => import('./components/modals/ConfirmModal.vue'))
const AuthModal = defineAsyncComponent(() => import('./components/modals/AuthModal.vue'))
import DetailPanel from './components/shell/DetailPanel.vue'
import MentionDropdown from './components/overlays/MentionDropdown.vue'
import SyncConflictBanner from './components/overlays/SyncConflictBanner.vue'
import CommandPalette from './components/overlays/CommandPalette.vue'
import ShortcutHelpPanel from './components/overlays/ShortcutHelpPanel.vue'
import { openBmModal, bmForm } from './composables/domain/useBookmark.js'

const BookmarkModal = defineAsyncComponent(() => import('./components/modals/BookmarkModal.vue'))
const CategoryModal = defineAsyncComponent(() => import('./components/modals/CategoryModal.vue'))
const AttributeModal = defineAsyncComponent(() => import('./components/modals/AttributeModal.vue'))
const GroupEditModal = defineAsyncComponent(() => import('./components/modals/GroupEditModal.vue'))
const TrashPanel = defineAsyncComponent(() => import('./components/modals/TrashPanel.vue'))
const HistoryPanel = defineAsyncComponent(() => import('./components/modals/HistoryPanel.vue'))
const E2ESetupModal = defineAsyncComponent(() => import('./components/modals/E2ESetupModal.vue'))
const E2EUnlockModal = defineAsyncComponent(() => import('./components/modals/E2EUnlockModal.vue'))
import SetupGuide from './components/modals/SetupGuide.vue'

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

onMounted(async () => {
  const hasE2E = await e2e.checkE2EStatus()
  if (hasE2E) {
    store.modals.e2eUnlock = true
  }

  // 处理扩展传来的保存请求：?ext_save_url=...&ext_save_title=...
  const params = new URLSearchParams(window.location.search)
  const extSaveUrl = params.get('ext_save_url')
  if (extSaveUrl) {
    // 等应用初始化完成后再打开弹窗
    setTimeout(async () => {
      await openBmModal()
      bmForm.title = params.get('ext_save_title') || extSaveUrl
      bmForm.url = extSaveUrl
    }, 600)
  }
})

function onE2EUnlocked() {
  store.modals.e2eUnlock = false
}
</script>
