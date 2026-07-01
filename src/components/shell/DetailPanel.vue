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
        <div v-for="(entry, idx) in filteredEntries" :key="entry.rawId"
             class="detail-card" :class="{ 'detail-group-card': entry.isGroup }"
             draggable="true" :data-bm-id="entry.rawId" :data-didx="idx">
          <button class="detail-close" @click.stop="closeDetail(entry.rawId)" title="关闭">&times;</button>

          <template v-if="entry.isGroup">
            <div class="detail-entry-head">
              <img v-if="grpEntry(entry).icon" :src="grpEntry(entry).icon" alt=""
                   class="detail-entry-img">
              <div v-else class="card-icon" v-html="noteIcon"></div>
              <div>
                <div class="card-name">{{ grpEntry(entry).name || '未命名组' }}</div>
                <div class="card-domain">{{ (grpEntry(entry).bookmarkIds || []).length }} 个书签</div>
              </div>
            </div>
            <div class="detail-group-notes" v-html="sanitizeHTML(grpEntry(entry).notes || '')"></div>
          </template>

          <template v-else>
            <div class="detail-entry-head">
              <div class="card-icon">
                <img :src="getIcon(bmEntry(entry))" alt="">
                <span class="icon-fallback">{{ (bmEntry(entry).title || '?').charAt(0) }}</span>
              </div>
              <div>
                <div class="card-name">{{ bmEntry(entry).title }}</div>
                <div class="card-domain">{{ domain(bmEntry(entry).url) }}</div>
              </div>
            </div>
            <div class="card-tags mb-1" v-if="getTags(bmEntry(entry)).length">
              <span class="card-tag tag-custom" v-for="t in getTags(bmEntry(entry))" :key="t">{{ t }}</span>
            </div>
            <div class="card-notes mb-1" v-if="bmEntry(entry).notes">{{ bmEntry(entry).notes }}</div>
            <div class="card-acct-body show mb-2"
                 v-if="bmEntry(entry).username || bmEntry(entry).password">
              <div class="acct-row" v-if="bmEntry(entry).username">
                <span class="acct-label">账户</span>
                <span class="acct-val">{{ bmEntry(entry).username }}</span>
                 <button class="acct-copy-btn" @click.stop="copyText(bmEntry(entry).username)" title="复制" v-html="I.copy"></button>
              </div>
              <div class="acct-row" v-if="bmEntry(entry).password">
                <span class="acct-label">密码</span>
                <span class="acct-val">{{ isVisible(entry.rawId) ? (decodedPasswords[entry.rawId] || '') : '••••••' }}</span>
                <button class="acct-show-pw" @click.stop="togglePw(entry.rawId)" title="显示"><span v-if="!isVisible(entry.rawId)" v-html="I.eye"></span><span v-else v-html="I.eyeOff"></span></button>
                <button class="acct-copy-btn" @click.stop="copyText(decodedPasswords[entry.rawId] || '')" title="复制" v-html="I.copy"></button>
              </div>
            </div>
            <div class="sub-sites" v-if="getChildren(bmEntry(entry).id).length">
              <span class="group-inline-card" v-for="sub in getChildren(bmEntry(entry).id)" :key="sub.id"
                    contenteditable="false" :data-bm-id="sub.id">
                <img :src="getIcon(sub)" alt="">
                <span class="gic-name">{{ sub.title }}</span>
                <span class="gic-btn" @click.stop="openDetail(sub.id)">详</span>
              </span>
            </div>
            <div class="detail-actions">
              <button class="btn btn-primary btn-sm" @click.stop="visit(bmEntry(entry))">打开网站</button>
              <button class="btn btn-secondary btn-sm" @click.stop="editBm(bmEntry(entry).id)">编辑</button>
              <span class="card-stat detail-use-count">{{ bmEntry(entry).useCount || 0 }}次</span>
            </div>
          </template>
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
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { favicon, sanitizeHTML, copyToClipboard, isMobile, domain, getTagNames } from '../../utils.js'
import { safeDecodePassword } from '../../crypto.js'
import { I } from '../../config/icons.js'
import { usePasswordVisibility } from '../../composables/ui/usePasswordVisibility.js'
import { openBmModal, openBookmark } from '../../composables/domain/useBookmark.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

const ui = useUIStore()
const ds = useDataStore()
const searchQuery = ref('')
const detailPanelRef = ref<HTMLElement | null>(null)
const decodedPasswords = ref<Record<string, string>>({})
const { isVisible, toggle: togglePw } = usePasswordVisibility()

const isOpen = computed(() => ui.panels.detail || ui.detailCards.length > 0)

interface DetailEntry {
  rawId: string
  isGroup: boolean
  data: Bookmark | SiblingGroup
  name: string
  domain: string
}

/** Helper: narrow entry.data to Bookmark (for v-else branch) */
function bmEntry(e: DetailEntry): Bookmark { return e.data as Bookmark }
/** Helper: narrow entry.data to SiblingGroup (for v-if="isGroup" branch) */
function grpEntry(e: DetailEntry): SiblingGroup { return e.data as SiblingGroup }

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

function decodeAllPasswords() {
  const results: Record<string, string> = {}
  for (const entry of entries.value) {
    if (!entry.isGroup && entry.data.password) {
      results[entry.rawId] = safeDecodePassword(entry.data.password)
    }
  }
  decodedPasswords.value = results
}

watch(entries, () => nextTick(decodeAllPasswords))

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
  }
})
onUnmounted(() => {
  const el = detailPanelRef.value
  if (el) {
    el.removeEventListener('touchstart', onSwipeStart)
    el.removeEventListener('touchmove', onSwipeMove)
    el.removeEventListener('touchend', onSwipeEnd)
  }
})

const noteIcon = I.note
const bookmarkIcon = I.emptyBookmark

function getIcon(item: Bookmark) { return favicon(item.url, item.icon) }
function getTags(bm: Bookmark) { return getTagNames(bm, ds.customAttributes) }
function getChildren(parentId: string) { return ds.childrenMap[parentId] || [] }

function visit(bm: Bookmark) { openBookmark(bm) }
function editBm(id: string) { openBmModal(id) }
function openDetail(id: string) { if (!ui.detailCards.includes(id)) ui.detailCards.push(id); ui.panels.detail = true }
function closeDetail(rawId: string) {
  const idx = ui.detailCards.indexOf(rawId)
  if (idx > -1) ui.detailCards.splice(idx, 1)
  if (!ui.detailCards.length) ui.panels.detail = false
}
function copyText(text: string) { copyToClipboard(text || '') }
</script>