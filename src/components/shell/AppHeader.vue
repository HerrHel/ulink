<template>
  <header class="panel-header" @dblclick="onDblClick">
    <div class="header-left">
      <button v-show="!ui.focusedGroupId" class="hamburger-btn" id="hamburgerBtn" @click="$emit('toggle-rail')" title="菜单" aria-label="菜单">
        <span v-html="I.hamburger"></span>
      </button>
      <!-- Focus mode -->
      <template v-if="ui.focusedGroupId && focusedGroup">
        <span class="panel-title-group-icon" @click="$emit('exit-focus')" title="返回">
          <img v-if="focusedGroup.icon" :src="focusedGroup.icon" alt="">
          <span v-else v-html="I.note"></span>
        </span>
        <span class="focus-title-input" contenteditable="true"
              :class="{ 'focus-title-unnamed': !focusedGroup.name || focusedGroup.name === '未命名' }"
              @blur="$emit('focus-title-change', $event)" @keydown.enter.prevent="($event.target as HTMLElement).blur()"
              @focus="onTitleFocus">{{ focusedGroup.name || '未命名' }}</span>
        <span class="panel-count">{{ focusBookmarkCount }} 个书签</span>
      </template>
      <!-- Normal mode -->
      <template v-else>
        <span class="panel-breadcrumb">{{ panelTitle }}</span>
        <span class="panel-count">{{ panelCountText }}</span>
      </template>
    </div>
    <div v-show="!ui.focusedGroupId" class="search-wrapper header-search">
      <div class="search-box">
        <span v-html="I.search"></span>
        <input type="text" class="search-input" aria-label="搜索" id="searchInput" v-model="localQuery"
               placeholder="搜索…" autocomplete="off">
      </div>
      <SearchSuggest />
    </div>
    <div class="header-right">
      <button class="search-toggle-btn" id="searchToggleBtn" title="搜索" aria-label="搜索">
        <span v-html="I.search"></span>
      </button>
      <template v-if="ui.focusedGroupId">
        <button class="ft-sb-btn" @click="$emit('focus-edit-group')" title="编辑组" aria-label="编辑组">
          <span v-html="I.edit"></span>
        </button>
        <button class="ft-sb-btn" @click="$emit('focus-share-group')" title="分享组" aria-label="分享组">
          <span v-html="I.share"></span>
        </button>
      </template>
      <span v-show="!ui.focusedGroupId" class="settings-wrap" @click.stop>
        <button class="lt-btn" id="btnSettings" @click="toggleSettings" title="设置" aria-label="设置">
            <span v-html="I.settings" class="icon-sm"></span>
          <span v-if="auth.isLoggedIn.value" class="header-sync-dot" :class="syncDotClass" :title="sync.syncLabel.value"></span>
        </button>
        <SettingsPanel />
      </span>
      <button class="btn btn-ghost btn-sm" id="btnToggleDetail" @click="$emit('toggle-detail')" title="右侧辅助栏" aria-label="右侧辅助栏">
        <span v-html="I.panel" class="icon-sm"></span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { I } from '../../config/icons.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import SearchSuggest from '../overlays/SearchSuggest.vue'
import SettingsPanel from './SettingsPanel.vue'

const ui = useUIStore()
const dataStore = useDataStore()
const emit = defineEmits(['toggle-rail', 'exit-focus', 'focus-title-change', 'toggle-detail', 'search', 'focus-edit-group', 'focus-share-group'])

const auth = useAuth()
const sync = useCloudSync()
const syncDotClass = computed(() => {
  if (sync.syncStatus.value === 'syncing') return 'dot-syncing'
  if (sync.syncStatus.value === 'error') return 'dot-error'
  if (sync.pendingCount.value > 0) return 'dot-pending'
  return 'dot-ok'
})

// 搜索防抖：本地输入值延迟同步到 store
const localQuery = ref(ui.searchQuery)
let _searchTimer: ReturnType<typeof setTimeout> | null = null
watch(localQuery, (val) => {
  if (_searchTimer) clearTimeout(_searchTimer)
  _searchTimer = setTimeout(() => { ui.searchQuery = val }, 300)
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
const panelTitle = computed(() =>
  (dataStore.categories.find(c => c.id === ui.curCat) || {}).name || '全部书签'
)
const panelCountText = computed(() =>
  (dataStore.filteredBookmarks.filter(b => !b.parentId).length + dataStore.filteredGroups.length) + ' 个'
)
const focusBookmarkCount = computed(() => {
  const g = ui.focusedGroupId ? dataStore.groupMap[ui.focusedGroupId] : null
  return g ? (g.bookmarkIds?.length || 0) : 0
})

function toggleSettings() { ui.panels.settings = !ui.panels.settings }
function onTitleFocus(e: FocusEvent) {
  const target = e.target as HTMLElement
  const txt = target.textContent?.trim() || ''
  if (!txt || txt === '未命名') {
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
