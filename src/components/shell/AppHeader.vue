<template>
  <header class="panel-header" @dblclick="onDblClick">
    <div class="header-left">
      <button v-show="!store.focusedGroupId" class="hamburger-btn" id="hamburgerBtn" @click="$emit('toggle-rail')" title="菜单">
        <span v-html="I.hamburger"></span>
      </button>
      <!-- Focus mode -->
      <template v-if="store.focusedGroupId && focusedGroup">
        <span class="panel-title-group-icon" @click="$emit('exit-focus')" title="返回">
          <img v-if="focusedGroup.icon" :src="focusedGroup.icon" alt="">
          <span v-else v-html="I.note"></span>
        </span>
        <span class="focus-title-input" contenteditable="true"
              :class="{ 'focus-title-unnamed': !focusedGroup.name || focusedGroup.name === '未命名' }"
              @blur="$emit('focus-title-change', $event)" @keydown.enter.prevent="$event.target.blur()"
              @focus="onTitleFocus">{{ focusedGroup.name || '未命名' }}</span>
        <span class="panel-count">{{ focusBookmarkCount }} 个书签</span>
      </template>
      <!-- Normal mode -->
      <template v-else>
        <span class="panel-breadcrumb">{{ panelTitle }}</span>
        <span class="panel-count">{{ panelCountText }}</span>
      </template>
    </div>
    <div v-show="!store.focusedGroupId" class="search-wrapper header-search">
      <div class="search-box">
        <span v-html="I.search"></span>
        <input type="text" class="search-input" aria-label="搜索" id="searchInput" v-model="localQuery"
               :placeholder="store.focusedGroupId ? '搜索组内…' : '搜索…'" autocomplete="off">
      </div>
      <SearchSuggest />
    </div>
    <div class="header-right">
      <button class="search-toggle-btn" id="searchToggleBtn" title="搜索">
        <span v-html="I.search"></span>
      </button>
      <template v-if="store.focusedGroupId">
        <button class="ft-sb-btn" @click="$emit('focus-edit-group')" title="编辑组">
          <span v-html="I.edit"></span>
        </button>
        <button class="ft-sb-btn" @click="$emit('focus-share-group')" title="分享组">
          <span v-html="I.share"></span>
        </button>
      </template>
      <span v-show="!store.focusedGroupId" class="settings-wrap" @click.stop>
        <button class="lt-btn" id="btnSettings" @click="toggleSettings" title="设置">
          <span v-html="I.settings" class="icon-sm"></span>
        </button>
        <SettingsPanel />
      </span>
      <button class="btn btn-ghost btn-sm" id="btnToggleDetail" @click="$emit('toggle-detail')" title="右侧辅助栏">
        <span v-html="I.panel" class="icon-sm"></span>
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { I } from '../../config/icons.js'
import SearchSuggest from '../overlays/SearchSuggest.vue'
import SettingsPanel from './SettingsPanel.vue'

const store = useAppStore()
const emit = defineEmits(['toggle-rail', 'exit-focus', 'focus-title-change', 'toggle-detail', 'search', 'focus-edit-group', 'focus-share-group'])

// 搜索防抖：本地输入值延迟同步到 store
const localQuery = ref(store.searchQuery)
let _searchTimer = null
watch(localQuery, (val) => {
  clearTimeout(_searchTimer)
  _searchTimer = setTimeout(() => { store.searchQuery = val }, 300)
})
// store 被外部清空时（如退出聚焦），取消待执行的防抖并同步本地值
watch(() => store.searchQuery, (val) => {
  if (val !== localQuery.value) {
    clearTimeout(_searchTimer)
    localQuery.value = val
  }
})

const focusedGroup = computed(() =>
  store.focusedGroupId ? store.groupMap[store.focusedGroupId] : null
)
const panelTitle = computed(() =>
  (store.categories.find(c => c.id === store.curCat) || {}).name || '全部书签'
)
const panelCountText = computed(() =>
  (store.filteredBookmarks.filter(b => !b.parentId).length + store.filteredGroups.length) + ' 个'
)
const focusBookmarkCount = computed(() => {
  const g = store.groupMap[store.focusedGroupId]
  return g ? (g.bookmarkIds?.length || 0) : 0
})

function toggleSettings() { store.settingsOpen = !store.settingsOpen }
function onTitleFocus(e) {
  const txt = e.target.textContent.trim()
  if (!txt || txt === '未命名') {
    e.target.textContent = ''
    e.target.classList.remove('focus-title-unnamed')
  }
}

function onDblClick(e) {
  if (store.focusedGroupId && !e.target.closest('input, button')) {
    emit('exit-focus')
  }
}
</script>
