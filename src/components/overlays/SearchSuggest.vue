<template>
  <div class="search-suggest" v-show="visible && results.length > 0" role="listbox" aria-label="搜索建议">
    <template v-for="(item, idx) in results" :key="item.id">
      <div v-if="item._divider" class="ss-divider">{{ item._divider }}</div>
      <div class="search-suggest-item" :class="{ active: idx === activeIdx }"
           role="option" :aria-selected="idx === activeIdx"
           @click="select(item)" @mouseenter="activeIdx = idx">
        <span v-if="item._isGroup" class="ss-icon" v-html="I.note"></span>
        <img v-else :src="item.icon || favicon(item.url)" alt="">
        <span class="ss-name" v-html="highlight(item._displayTitle || item.title || item.name)"></span>
        <span class="ss-url">{{ item._isGroup ? (item.bookmarkIds?.length || 0) + ' 个书签' : domain(item.url) }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { favicon, domain } from '../../utils.js'
import { openBookmark } from '../../composables/domain/useBookmark.js'
import { toggleGroupFocus } from '../../composables/domain/useGroup.js'
import { I } from '../../config/icons.js'
import { MAX_SUGGESTIONS } from '../../config/constants.js'

const store = useAppStore()
const visible = ref(false)
const activeIdx = ref(-1)

const results = computed(() => {
  if (store.focusedGroupId) return []
  const q = (store.searchQuery || '').trim().toLowerCase()
  if (!q) return []

  const bmResults = store.bookmarks.filter(b =>
    b.title.toLowerCase().includes(q) ||
    b.url.toLowerCase().includes(q) ||
    (b.notes || '').toLowerCase().includes(q) ||
    (b.username || '').toLowerCase().includes(q)
  ).slice(0, MAX_SUGGESTIONS)

  const groupResults = store.siblingGroups.filter(g =>
    (g.name || '').toLowerCase().includes(q)
  ).slice(0, 4).map(g => ({ ...g, _isGroup: true, _displayTitle: g.name || '未命名组' }))

  if (!groupResults.length) return bmResults
  if (!bmResults.length) return groupResults
  return [...groupResults, { _divider: '书签' }, ...bmResults].slice(0, MAX_SUGGESTIONS + 1)
})

function updateVisibility() {
  const hasResults = results.value.length > 0
  visible.value = !!store.searchQuery?.trim() && !store.focusedGroupId && hasResults
  activeIdx.value = -1
}

watch(() => store.searchQuery, updateVisibility)

function select(item) {
  visible.value = false
  store.searchQuery = ''
  if (item._isGroup) {
    toggleGroupFocus(item.id)
  } else {
    openBookmark(item)
  }
}

function highlight(text: string): string {
  if (!text) return ''
  const q = (store.searchQuery || '').trim()
  if (!q) return esc(text)
  const regex = new RegExp('(' + escRegex(q) + ')', 'gi')
  return esc(text).replace(regex, '<mark class="ss-hl">$1</mark>')
}

function esc(s: string): string { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }
function escRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function hide() { visible.value = false }

function onDocClick(e) { if (!e.target.closest('.search-wrapper')) visible.value = false }

function onFocusIn(e) { if (e.target.matches('.search-input')) updateVisibility() }

function onKeydown(e) {
  if (!visible.value) return
  const len = results.value.filter(r => !r._divider).length
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = activeIdx.value < len - 1 ? activeIdx.value + 1 : 0
    scrollToActive()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = activeIdx.value > 0 ? activeIdx.value - 1 : len - 1
    scrollToActive()
  } else if (e.key === 'Enter' && activeIdx.value >= 0) {
    e.preventDefault()
    const selectable = results.value.filter(r => !r._divider)
    if (selectable[activeIdx.value]) select(selectable[activeIdx.value])
  } else if (e.key === 'Enter' && results.value.length > 0) {
    e.preventDefault()
    const first = results.value.find(r => !r._divider)
    if (first) select(first)
  } else if (e.key === 'Escape') {
    visible.value = false
  }
}

function scrollToActive() {
  const el = document.querySelector('.search-suggest-item.active')
  if (el) el.scrollIntoView({ block: 'nearest' })
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('keydown', onKeydown)
})

defineExpose({ hide, visible })
</script>
