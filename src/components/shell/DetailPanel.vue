<template>
  <div class="detail-panel" :class="{ open: isOpen, swiping: isSwiping }" id="detailPanel"
       @touchstart.passive="onSwipeStart" @touchmove.passive="onSwipeMove" @touchend="onSwipeEnd">
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
            <div style="margin-bottom:6px;display:flex;align-items:center;gap:8px">
              <img v-if="entry.data.icon" :src="entry.data.icon" alt=""
                   style="border-radius:4px;object-fit:contain;width:36px;height:36px">
              <div v-else class="card-icon" v-html="noteIcon"></div>
              <div>
                <div class="card-name">{{ entry.data.name || '未命名组' }}</div>
                <div class="card-domain">{{ (entry.data.bookmarkIds || []).length }} 个书签</div>
              </div>
            </div>
            <div class="detail-group-notes" v-html="sanitizeNotes(entry.data.notes)"></div>
          </template>

          <template v-else>
            <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px">
              <div class="card-icon">
                <img :src="getIcon(entry.data)" alt="">
                <span class="icon-fallback">{{ (entry.data.title || '?').charAt(0) }}</span>
              </div>
              <div>
                <div class="card-name">{{ entry.data.title }}</div>
                <div class="card-domain">{{ domain(entry.data.url) }}</div>
              </div>
            </div>
            <div class="card-tags mb-1" v-if="getTags(entry.data).length">
              <span class="card-tag tag-custom" v-for="t in getTags(entry.data)" :key="t">{{ t }}</span>
            </div>
            <div class="card-notes mb-1" v-if="entry.data.notes">{{ entry.data.notes }}</div>
            <div class="card-acct-body show mb-2"
                 v-if="entry.data.username || entry.data.password">
              <div class="acct-row" v-if="entry.data.username">
                <span class="acct-label">账户</span>
                <span class="acct-val">{{ entry.data.username }}</span>
                 <button class="acct-copy-btn" @click.stop="copyText(entry.data.username)" title="复制" v-html="I.copy"></button>
              </div>
              <div class="acct-row" v-if="entry.data.password">
                <span class="acct-label">密码</span>
                <span class="acct-val">{{ isVisible(entry.rawId) ? (decodedPasswords[entry.rawId] || '') : '••••••' }}</span>
                <button class="acct-show-pw" @click.stop="togglePw(entry.rawId)" title="显示"><span v-if="!isVisible(entry.rawId)" v-html="I.eye"></span><span v-else v-html="I.eyeOff"></span></button>
                <button class="acct-copy-btn" @click.stop="copyText(decodedPasswords[entry.rawId] || '')" title="复制" v-html="I.copy"></button>
              </div>
            </div>
            <div class="sub-sites" v-if="getChildren(entry.data.id).length">
              <span class="group-inline-card" v-for="sub in getChildren(entry.data.id)" :key="sub.id"
                    contenteditable="false" :data-bm-id="sub.id">
                <img :src="getIcon(sub)" alt="">
                <span class="gic-name">{{ sub.title }}</span>
                <span class="gic-btn" @click.stop="openDetail(sub.id)">详</span>
              </span>
            </div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:8px">
              <button class="btn btn-primary btn-sm" @click.stop="visit(entry.data)">打开网站</button>
              <button class="btn btn-secondary btn-sm" @click.stop="editBm(entry.data.id)">编辑</button>
              <span class="card-stat" style="margin-left:auto">{{ entry.data.useCount || 0 }}次</span>
            </div>
          </template>
        </div>
      </template>
      <div v-else class="empty" style="padding:40px 20px">
        <div class="empty-icon" v-html="bookmarkIcon"></div>
        <h3>辅助栏</h3>
        <p>拖拽书签到此处查看</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { favicon, sanitizeHTML, copyToClipboard, isMobile, domain, getTagNames } from '../../utils.js'
import { safeDecodePassword } from '../../crypto.js'
import { I } from '../../config/icons.js'
import { usePasswordVisibility } from '../../composables/ui/usePasswordVisibility.js'
import { openBmModal, openBookmark } from '../../composables/domain/useBookmark.js'

const store = useAppStore()
const searchQuery = ref('')
const decodedPasswords = ref({})
const { isVisible, toggle: togglePw } = usePasswordVisibility()

const isOpen = computed(() => store.detailOpen || store.detailCards.length > 0)

const entries = computed(() => {
  return (store.detailCards || []).map(rawId => {
    if (typeof rawId === 'string' && rawId.startsWith('group:')) {
      const gid = rawId.slice(6)
      const sg = store.groupMap[gid]
      return sg ? { rawId, isGroup: true, data: sg, name: sg.name || '', domain: '' } : null
    }
    const bm = store.bookmarkMap[rawId]
    return bm ? { rawId, isGroup: false, data: bm, name: bm.title || '', domain: domain(bm.url) } : null
  }).filter(Boolean)
})

const filteredEntries = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter(e =>
    e.name.toLowerCase().includes(q) || e.domain.toLowerCase().includes(q)
  )
})

async function decodeAllPasswords() {
  const results = {}
  for (const entry of entries.value) {
    if (!entry.isGroup && entry.data.password) {
      results[entry.rawId] = await safeDecodePassword(entry.data.password, store.masterPassword)
    }
  }
  decodedPasswords.value = results
}

watch(entries, () => nextTick(decodeAllPasswords), { deep: true })
watch(() => store.masterPassword, decodeAllPasswords)

/* Swipe-to-dismiss (mobile only) */
const isSwiping = ref(false)
let _swipeStartY = 0
function onSwipeStart(e) {
  if (!isMobile() || !store.detailOpen) return
  _swipeStartY = e.touches[0].clientY
}
function onSwipeMove(e) {
  if (!_swipeStartY) return
  const dy = e.touches[0].clientY - _swipeStartY
  if (dy > 0) {
    isSwiping.value = true
    const panel = document.getElementById('detailPanel')
    if (panel) panel.style.transform = `translateY(${dy}px)`
  }
}
function onSwipeEnd() {
  if (!isSwiping.value) { _swipeStartY = 0; return }
  const panel = document.getElementById('detailPanel')
  const currentY = panel ? parseFloat(panel.style.transform.replace(/[^-\d.]/g, '')) || 0 : 0
  if (currentY > 100) { store.detailOpen = false; store.detailCards.splice(0) }
  if (panel) panel.style.transform = ''
  isSwiping.value = false
  _swipeStartY = 0
}

const noteIcon = I.note
const bookmarkIcon = I.emptyBookmark

function getIcon(item) { return favicon(item.url, item.icon) }
function getTags(bm) { return getTagNames(bm, store.customAttributes) }
function getChildren(parentId) { return store.childrenMap[parentId] || [] }
function sanitizeNotes(notes) { return sanitizeHTML(notes || '') }

function visit(bm) { openBookmark(bm) }
function editBm(id) { openBmModal(id) }
function openDetail(id) { if (!store.detailCards.includes(id)) store.detailCards.push(id) }
function closeDetail(rawId) {
  const idx = store.detailCards.indexOf(rawId)
  if (idx > -1) store.detailCards.splice(idx, 1)
  if (!store.detailCards.length) store.detailOpen = false
}
function copyText(text) { copyToClipboard(text || '') }
</script>