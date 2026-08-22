<template>
  <header class="panel-header" @dblclick="onDblClick">
    <div class="header-left">
      <button v-show="!ui.focusedGroupId" class="hamburger-btn" id="hamburgerBtn" @click="$emit('toggle-rail')" :title="t('shell.menu')" :aria-label="t('shell.menu')">
        <span aria-hidden="true" v-html="I.hamburger"></span>
      </button>
      <!-- Focus mode -->
      <template v-if="ui.focusedGroupId && focusedGroup">
        <span class="panel-title-group-icon" @click="$emit('exit-focus')" :title="t('shell.back')">
          <img v-if="focusedGroup.icon" :src="focusedGroup.icon" alt="">
          <span v-else aria-hidden="true" v-html="I.note"></span>
        </span>
        <span class="focus-title-input" contenteditable="true"
              :class="{ 'focus-title-unnamed': !focusedGroup.name || isUnnamed(focusedGroup.name) }"
              @blur="$emit('focus-title-change', $event)" @keydown.enter.prevent="($event.target as HTMLElement).blur()"
              @focus="onTitleFocus">{{ displayName }}</span>
        <span class="panel-count">{{ tN('count.bookmarks', focusBookmarkCount) }}</span>
      </template>
      <!-- Normal mode -->
      <template v-else>
        <span class="panel-breadcrumb">{{ panelTitle }}</span>
        <span class="panel-count">{{ panelCountText }}</span>
      </template>
    </div>
    <div v-show="!ui.focusedGroupId" class="search-wrapper header-search">
      <div class="search-box">
        <span aria-hidden="true" v-html="I.search"></span>
        <input type="text" class="search-input" :aria-label="t('shell.search')" id="searchInput" data-testid="lv-search-input" v-model="localQuery"
               :placeholder="t('shell.searchPlaceholder')" autocomplete="off">
      </div>
      <SearchSuggest />
    </div>
    <div class="header-right">
      <button class="search-toggle-btn" id="searchToggleBtn" :title="t('shell.search')" :aria-label="t('shell.search')">
        <span aria-hidden="true" v-html="I.search"></span>
      </button>
      <template v-if="ui.focusedGroupId">
        <button class="ft-sb-btn" @click="$emit('focus-edit-group')" :title="t('shell.editGroup')" :aria-label="t('shell.editGroup')">
          <span aria-hidden="true" v-html="I.edit"></span>
        </button>
        <button class="ft-sb-btn" @click="$emit('focus-share-group')" :title="t('shell.shareGroup')" :aria-label="t('shell.shareGroup')">
          <span aria-hidden="true" v-html="I.share"></span>
        </button>
      </template>
      <span v-show="!ui.focusedGroupId" class="settings-wrap" @click.stop>
        <button class="lt-btn" id="btnSettings" data-testid="lv-btn-settings" @click="toggleSettings" :title="t('shell.settings')" :aria-label="t('shell.settings')">
            <span aria-hidden="true" v-html="I.settings" class="icon-sm"></span>
        </button>
        <button
          v-if="auth.isLoggedIn"
          class="header-sync-btn"
          :class="syncState.dotClass"
          @click.stop="toggleSyncPopover"
          :title="syncState.label"
          :aria-label="t('shell.syncStatus')"
        >
          <span class="sync-badge" v-if="syncState.showBadge">{{ syncState.count }}</span>
        </button>
        <SettingsPanel />
        <SyncStatusPopover v-if="auth.isLoggedIn" />
      </span>
      <button class="btn btn-ghost btn-sm" id="btnToggleDetail" @click="$emit('toggle-detail')" :title="t('shell.detailPanel')" :aria-label="t('shell.detailPanel')">
        <span aria-hidden="true" v-html="I.panel" class="icon-sm"></span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import { useSyncStatusStore } from '../../stores/overlay.js'
import { I } from '../../config/icons.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import SearchSuggest from '../overlays/SearchSuggest.vue'
import SettingsPanel from './SettingsPanel.vue'
import SyncStatusPopover from '../overlays/SyncStatusPopover.vue'
import { t, tN } from '../../i18n/index.js'

const ui = useUIStore()
const dataStore = useDataStore()
const emit = defineEmits(['toggle-rail', 'exit-focus', 'focus-title-change', 'toggle-detail', 'search', 'focus-edit-group', 'focus-share-group'])

const auth = useAuth()
const syncState = useSyncState()
const syncPopover = useSyncStatusStore()

function toggleSyncPopover() {
  if (syncPopover.open) syncPopover.hide()
  else syncPopover.show()
}

// 搜索防抖：本地输入值延迟同步到 store
const localQuery = ref(ui.searchQuery)
let _searchTimer: ReturnType<typeof setTimeout> | null = null
watch(localQuery, (val) => {
  if (_searchTimer) clearTimeout(_searchTimer)
  _searchTimer = setTimeout(() => { ui.searchQuery = val }, 150)
})
// store 被外部清空时（如退出聚焦），取消待执行的防抖并同步本地值
watch(() => ui.searchQuery, (val) => {
  if (val !== localQuery.value) {
    if (_searchTimer) clearTimeout(_searchTimer)
    localQuery.value = val
  }
})

const focusedGroup = computed(() =>
  ui.focusedGroupId ? dataStore.groupMap[ui.focusedGroupId] : null
)
/** 「未命名」同时兼容旧存量数据的中文占位值 */
function isUnnamed(v: string): boolean {
  return v === '未命名' || v === 'Untitled'
}
const displayName = computed(() =>
  focusedGroup.value && focusedGroup.value.name && !isUnnamed(focusedGroup.value.name)
    ? focusedGroup.value.name
    : t('common.unnamed')
)
const panelTitle = computed(() =>
  (dataStore.categoryMap[ui.curCat] || {}).name || t('shell.allBookmarks')
)
const panelCountText = computed(() =>
  tN('count.items', dataStore.filteredBookmarks.filter(b => !b.parentId).length + dataStore.filteredGroups.length)
)
const focusBookmarkCount = computed(() => {
  const g = ui.focusedGroupId ? dataStore.groupMap[ui.focusedGroupId] : null
  return g ? (g.bookmarkIds?.length || 0) : 0
})

function toggleSettings() {
  // 仅在「即将打开」时 pushNavState 记未开态，后退能关；关闭时后退无意义不再 push。
  if (!ui.panels.settings) pushNavState()
  ui.panels.settings = !ui.panels.settings
}
function onTitleFocus(e: FocusEvent) {
  const target = e.target as HTMLElement
  const txt = target.textContent?.trim() || ''
  if (!txt || isUnnamed(txt)) {
    target.textContent = ''
    target.classList.remove('focus-title-unnamed')
  }
}

function onDblClick(e: MouseEvent) {
  if (ui.focusedGroupId && !(e.target as HTMLElement).closest('input, button')) {
    emit('exit-focus')
  }
}
</script>
