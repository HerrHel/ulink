<template>
  <div ref="detailPanelRef" class="detail-panel" :class="{ open: isOpen, swiping: isSwiping }"
       :style="translateY ? { transform: `translateY(${translateY}px)` } : undefined" id="detailPanel">
    <div class="detail-drag-handle" id="detailDragHandle"></div>
    <div class="detail-search" id="detailSearchWrap" v-show="isOpen && entries.length > 0">
      <input type="text" class="detail-search-input" id="detailSearch"
             placeholder="搜索辅助栏..." aria-label="搜索辅助栏" v-model="searchQuery">
    </div>
    <div class="detail-inner" id="detailInner">
      <template v-if="entries.length">
        <div class="card-grid grid-view detail-grid">
          <div class="card-list-inner">
            <template v-for="entry in filteredEntries" :key="entry.rawId">
              <div class="detail-card-wrap" :data-bm-id="entry.rawId" :data-didx="filteredEntries.indexOf(entry)">
                <button class="detail-close" @click.stop="closeDetail(entry.rawId)" title="关闭">&times;</button>
                <GroupCard v-if="entry.isGroup" :group="entry.data" detail-mode />
                <BookmarkCard v-else :bookmark="entry.data" :default-acct-open="true" />
              </div>
            </template>
          </div>
        </div>
      </template>
      <div v-else class="empty empty-compact">
        <div class="empty-icon" v-html="bookmarkIcon"></div>
        <h3>辅助栏</h3>
        <p>拖拽书签到此处查看</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { isMobile, domain } from '../../utils.js'
import { I } from '../../config/icons.js'
import BookmarkCard from '../cards/BookmarkCard.vue'
import GroupCard from '../cards/GroupCard.vue'
import type { Bookmark, SiblingGroup } from '../../types.js'

const ui = useUIStore()
const ds = useDataStore()
const searchQuery = ref('')
const detailPanelRef = ref<HTMLElement | null>(null)

const isOpen = computed(() => ui.panels.detail || ui.detailCards.length > 0)

type DetailEntry = {
  rawId: string
  isGroup: true
  data: SiblingGroup
  name: string
  domain: string
} | {
  rawId: string
  isGroup: false
  data: Bookmark
  name: string
  domain: string
}

const entries = computed<DetailEntry[]>(() => {
  return (ui.detailCards || []).map(rawId => {
    if (typeof rawId === 'string' && rawId.startsWith('group:')) {
      const gid = rawId.slice(6)
      const sg = ds.groupMap[gid]
      return sg ? { rawId, isGroup: true, data: sg, name: sg.name || '', domain: '' } : null
    }
    const bm = ds.bookmarkMap[rawId]
    return bm ? { rawId, isGroup: false, data: bm, name: bm.title || '', domain: domain(bm.url) } : null
  }).filter((e): e is DetailEntry => e !== null)
})

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter(e =>
    e.name.toLowerCase().includes(q) || e.domain.toLowerCase().includes(q)
  )
})

/* Swipe-to-dismiss (mobile only, non-passive to allow preventDefault) */
const isSwiping = ref(false)
const translateY = ref(0)
let _swipeStartY = 0
function onSwipeStart(e: TouchEvent) {
  if (!isMobile() || !ui.panels.detail) return
  if (!(e.target as HTMLElement).closest('.detail-drag-handle')) return
  _swipeStartY = e.touches[0].clientY
}
function onSwipeMove(e: TouchEvent) {
  if (!_swipeStartY) return
  const dy = e.touches[0].clientY - _swipeStartY
  if (dy > 0) {
    e.preventDefault()
    isSwiping.value = true
    translateY.value = dy
  }
}
function onSwipeEnd() {
  if (!isSwiping.value) { _swipeStartY = 0; return }
  const panel = detailPanelRef.value
  const panelHeight = panel ? panel.offsetHeight : 300
  if (translateY.value > panelHeight * 0.3) { ui.panels.detail = false; ui.detailCards.splice(0) }
  _resetSwipe()
}
function onSwipeCancel() {
  // touchcancel（来电/系统手势中断）时复位，避免残留状态
  if (isSwiping.value || _swipeStartY) _resetSwipe()
}
function _resetSwipe() {
  translateY.value = 0
  isSwiping.value = false
  _swipeStartY = 0
}

onMounted(() => {
  const el = detailPanelRef.value
  if (el) {
    el.addEventListener('touchstart', onSwipeStart, { passive: true })
    el.addEventListener('touchmove', onSwipeMove, { passive: false })
    el.addEventListener('touchend', onSwipeEnd)
    el.addEventListener('touchcancel', onSwipeCancel)
  }
})
onUnmounted(() => {
  const el = detailPanelRef.value
  if (el) {
    el.removeEventListener('touchstart', onSwipeStart)
    el.removeEventListener('touchmove', onSwipeMove)
    el.removeEventListener('touchend', onSwipeEnd)
    el.removeEventListener('touchcancel', onSwipeCancel)
  }
})

const bookmarkIcon = I.emptyBookmark

function closeDetail(rawId: string) {
  const idx = ui.detailCards.indexOf(rawId)
  if (idx > -1) ui.detailCards.splice(idx, 1)
  if (!ui.detailCards.length) ui.panels.detail = false
}
</script>