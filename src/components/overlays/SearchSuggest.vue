<template>
  <div class="search-suggest" v-show="visible && results.length > 0" role="listbox" aria-label="搜索建议">
    <template v-for="(item, idx) in results" :key="item.id">
      <div v-if="item._divider" class="ss-divider">{{ item._divider }}</div>
      <div class="search-suggest-item" :class="{ active: idx === activeIdx }"
           role="option" :aria-selected="idx === activeIdx"
           @click="select(item)" @mouseenter="activeIdx = idx">
        <span v-if="item._isGroup" class="ss-icon" aria-hidden="true" v-html="I.note"></span>
        <img v-else :src="favicon(item.url || '')" alt="">
        <span class="ss-name" v-html="renderHighlight(item._highlights, item._isGroup ? 'name' : 'title', item._displayTitle || item.title || item.name || '')"></span>
        <span class="ss-url">{{ item._isGroup ? (item.bookmarkIds?.length || 0) + ' 个书签' : domain(item.url || '') }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { favicon, domain } from '../../utils.js'
import { openBookmark } from '../../composables/domain/useBookmark.js'
import { toggleGroupFocus } from '../../composables/domain/useGroup.js'
import { searchWithHighlights } from '../../lib/search.js'
import { I } from '../../config/icons.js'
import { MAX_SUGGESTIONS } from '../../config/constants.js'
import type { SearchResultItem, HighlightSegment } from '../../lib/search.js'

const ui = useUIStore()
const dataStore = useDataStore()
const visible = ref(false)
const activeIdx = ref(-1)

const results = computed<SearchResultItem[]>(() => {
  if (ui.focusedGroupId) return []
  const q = (ui.searchQuery || '').trim()
  if (!q) return []

  const items = searchWithHighlights(
    dataStore.bookmarks,
    dataStore.siblingGroups,
    q,
    dataStore.bookmarkMap,
    dataStore.customAttributes,
    MAX_SUGGESTIONS,
    // 传 _searchVersion 让 Fuse 基准仅在 CRUD（version bump）时重建；
    // 旧调用不传 version（默认 -1）→ 每个键击重建 Fuse。基准用全量 bookmarks/siblingGroups
    //（稳定引用，CRUD 才变），软删/分类过滤推到下方结果层。与 data.ts filteredBookmarks 共享同一份缓存。
    dataStore._searchVersion,
  ).filter(r => {
    if (r._isGroup) return !dataStore.groupMap[r.id]?.deletedAt
    return !dataStore.bookmarkMap[r.id]?.deletedAt
  })

  // 在组和书签之间插入分隔线
  const firstBmIdx = items.findIndex(i => !i._isGroup)
  if (firstBmIdx > 0) items.splice(firstBmIdx, 0, { id: '__divider', _divider: '书签', _highlights: {} })
  return items.slice(0, MAX_SUGGESTIONS + 1)
})

function updateVisibility() {
  const hasResults = results.value.length > 0
  visible.value = !!ui.searchQuery?.trim() && !ui.focusedGroupId && hasResults
  activeIdx.value = -1
}

watch(() => ui.searchQuery, updateVisibility)

function select(item: SearchResultItem) {
  visible.value = false
  ui.searchQuery = ''
  if (item._isGroup) {
    toggleGroupFocus(item.id)
  } else {
    const bm = dataStore.bookmarkMap[item.id]
    if (bm) openBookmark(bm)
  }
}

function renderHighlight(highlights: Record<string, HighlightSegment[]> | undefined, key: string, fallback: string): string {
  const segs = highlights?.[key]
  if (!segs || !segs.length) return esc(fallback)
  return segs.map(s => s.highlight ? `<mark class="ss-hl">${esc(s.text)}</mark>` : esc(s.text)).join('')
}

function esc(s: string): string { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }

function hide() { visible.value = false }

function onDocClick(e: MouseEvent) { if (!(e.target as HTMLElement).closest('.search-wrapper')) visible.value = false }

function onFocusIn(e: FocusEvent) { if ((e.target as HTMLElement).matches('.search-input')) updateVisibility() }

function onKeydown(e: KeyboardEvent) {
  // M11：任一模态框打开时不抢 ArrowDown/Enter，避免 BookmarkModal 等输入框被劫持
  if (ui.modals.bookmark || ui.modals.category || ui.modals.attribute || ui.modals.groupEdit) return
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
