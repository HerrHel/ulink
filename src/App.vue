<template>
<div class="lv-panel">
  <AppNav />
  <input type="file" id="importFile" accept=".json" style="display:none" @change="handlers.onImportFile">
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
        <div class="panel-content" id="panelContent"><CardGrid /></div>
      </div>
      <BatchPopover />
    </div>
    <div class="resize-handle" id="resizeRight"></div>
    <DetailPanel />
  </div>
</div>
<template v-if="store.bmModalOpen">
  <BookmarkModal />
</template>
<template v-if="store.catModalOpen">
  <CategoryModal />
</template>
<template v-if="store.attrModalOpen">
  <AttributeModal />
</template>
<template v-if="store.groupEditOpen">
  <GroupEditModal />
</template>
<template v-if="store.confirmModalOpen">
  <ConfirmModal />
</template>
<template v-if="store.masterPasswordOpen">
  <MasterPasswordModal />
</template>
<ContextMenu /><ActionSheet /><ToastContainer /><FormatToolbar /><MentionDropdown />
<AddPopover />
<div class="dp-overlay" id="dpOverlay" :class="{ show: store.detailOpen && isMobile() }" @click="store.detailOpen = false; store.detailCards.splice(0)"></div>
<div class="overlay" id="railOverlay" :class="{ show: store.railOpen }" @click="closeRail"></div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useAppStore } from './stores/app.js'
import { isMobile } from './utils.js'
import { toggleDetailPanel, toggleRail, closeRail } from './composables/ui/useUI.js'
import { useApp } from './composables/useApp.js'
import { useAppHandlers } from './composables/useAppHandlers.js'
import { useAppLifecycle } from './composables/useAppLifecycle.js'
import AppHeader from './components/shell/AppHeader.vue'
import FilterBar from './components/shell/FilterBar.vue'
import BatchBar from './components/shell/BatchBar.vue'
import BatchBottom from './components/shell/BatchBottom.vue'
import AddPopover from './components/overlays/AddPopover.vue'
import CardGrid from './components/cards/CardGrid.vue'
import AppNav from './components/shell/AppNav.vue'
import ToastContainer from './components/overlays/ToastContainer.vue'
import ContextMenu from './components/overlays/ContextMenu.vue'
import ActionSheet from './components/overlays/ActionSheet.vue'
import BatchPopover from './components/overlays/BatchPopover.vue'
import FormatToolbar from './components/editor/FormatToolbar.vue'
const ConfirmModal = defineAsyncComponent(() => import('./components/modals/ConfirmModal.vue'))
const MasterPasswordModal = defineAsyncComponent(() => import('./components/modals/MasterPasswordModal.vue'))
import DetailPanel from './components/shell/DetailPanel.vue'
import MentionDropdown from './components/overlays/MentionDropdown.vue'

const BookmarkModal = defineAsyncComponent(() => import('./components/modals/BookmarkModal.vue'))
const CategoryModal = defineAsyncComponent(() => import('./components/modals/CategoryModal.vue'))
const AttributeModal = defineAsyncComponent(() => import('./components/modals/AttributeModal.vue'))
const GroupEditModal = defineAsyncComponent(() => import('./components/modals/GroupEditModal.vue'))

const store = useAppStore()
useApp()
useAppLifecycle()
const { handlers } = useAppHandlers()
</script>
