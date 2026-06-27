<template>
  <div ref="cardEl" class="card" :class="{ 'card-expanded': isExpanded, 'acct-open': acctOpen, 'batch-mode': uiStore.batchMode }"
       role="article" :aria-label="bookmark.title"
       :data-id="bookmark.id" draggable="true" @click="onCardClick">
     <input v-if="uiStore.batchMode" type="checkbox" class="batch-chk"
            :id="'batchChk_' + bookmark.id" :checked="isSelected"
            @change.stop @click.stop="toggleSelect">
    <div class="card-topline">
      <div class="card-toprow">
        <div class="card-logo" title="打开链接" @click.stop="visit">
          <img v-if="iconSrc" :src="iconSrc" alt="" @error="($event.target as HTMLImageElement).classList.add('img-error')">
          <span class="card-logo-fallback">{{ bookmark.title?.charAt(0) || '?' }}</span>
        </div>
        <div class="card-titlewrap" @dblclick.stop="visit">
          <div class="card-name">
            <span v-if="searchQuery" v-html="hlText(bookmark.title, searchQuery)"></span>
            <template v-else>{{ bookmark.title }}</template>
            <span v-if="isDeadLink" class="dead-link-badge" title="链接已失效">失效</span>
            <span v-if="isGfwBlocked" class="gfw-blocked-badge" title="疑似被墙">被墙</span>
          </div>
          <div class="card-domain">
            <span v-if="searchQuery" v-html="hlText(domainStr, searchQuery)"></span>
            <template v-else>{{ domainStr }}</template>
          </div>
        </div>
      </div>
      <div class="card-tags" v-if="tagNames.length">
        <span class="card-tag tag-custom" v-for="t in tagNames" :key="t" @click.stop="filterByTagName(t)">{{ t }}</span>
      </div>
    </div>
    <div class="card-body">
      <div class="card-notes" v-if="bookmark.notes" @dblclick.stop="editNotes">
        <span v-if="searchQuery" v-html="hlText(bookmark.notes, searchQuery)"></span>
        <template v-else>{{ bookmark.notes }}</template>
      </div>
      <template v-if="bookmark.username || bookmark.password">
          <button class="card-acct-toggle" @click.stop="acctOpen = !acctOpen">
            <span v-html="I.chevronDown"></span> 账户信息
          </button>
        <div class="card-acct-body" :class="{ show: acctOpen || isExpanded }">
          <div class="acct-row" v-if="bookmark.username">
            <span class="acct-label">账户</span><span class="acct-val">{{ bookmark.username }}</span>
            <button class="acct-copy-btn" @click.stop="copyUser" title="复制" v-html="I.copy"></button>
          </div>
          <div class="acct-row" v-if="bookmark.password">
            <span class="acct-label">密码</span><span class="acct-val">{{ isVisible(bookmark.id) ? decodedPw : '••••••' }}</span>
            <button class="acct-show-pw" @click.stop="togglePw(bookmark.id)" :title="isVisible(bookmark.id) ? '隐藏密码' : '显示密码'" :aria-label="isVisible(bookmark.id) ? '隐藏密码' : '显示密码'" v-html="isVisible(bookmark.id) ? I.eyeOff : I.eye"></button>
            <button class="acct-copy-btn" @click.stop="copyPw" title="复制" v-html="I.copy"></button>
          </div>
        </div>
      </template>
      <div class="sub-sites" v-if="children.length">
        <span class="group-inline-card" v-for="sub in children" :key="sub.id" contenteditable="false" :data-bm-id="sub.id" draggable="true" @click.stop="visitSub(sub)">
          <img :src="favicon(sub.url, sub.icon)" alt="">
          <span class="gic-name">{{ sub.title }}</span>
          <span class="gic-btn" @click.stop="doOpenDetail(sub.id)">详</span>
        </span>
      </div>
      <div class="card-preview" v-if="previewText">{{ previewText }}</div>
    </div>
    <div class="card-foot">
      <span class="card-stat"><span v-html="I.click"></span> {{ bookmark.useCount || 0 }}次</span>
      <span class="card-actions">
        <button v-if="!bookmark.parentId" class="btn-xs" @click.stop="doAddSub" title="添加子网站" v-html="I.plus"></button>
        <button class="btn-xs" @click.stop="edit" title="编辑" v-html="I.edit"></button>
        <button class="btn-xs btn-danger" @click.stop="del" title="删除" v-html="I.trash"></button>
      </span>
    </div>
    <button v-if="hasExpandableContent && uiStore.layoutMode === 'list'" class="list-expand-btn" @click.stop="toggleExpand" title="展开" v-html="I.chevronDown"></button>
    <div v-if="uiStore.batchMode && isMobile()" class="batch-drag-handle" v-html="I.grip"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { favicon, getTagNames, isMobile, copyToClipboard, domain, stripEntranceAnim, esc } from '../../utils.js'
import { I } from '../../config/icons.js'
import { safeDecodePassword } from '../../crypto.js'
import { usePasswordVisibility } from '../../composables/ui/usePasswordVisibility.js'
import { openBmModal, deleteBookmarkWithUndo, addSub, openBookmark } from '../../composables/domain/useBookmark.js'
import { toggleAttrFilter } from '../../composables/domain/useAttrFilter.js'
import { openDetail } from '../../composables/ui/useUI.js'
import { toast } from '../../lib/toast.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import type { Bookmark } from '../../types.js'

function hlText(text: string, query: string): string {
  if (!text || !query.trim()) return esc(text)
  const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(q, 'gi')
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(esc(text.slice(last, m.index)))
    parts.push('<mark class="card-hl">' + esc(m[0]) + '</mark>')
    last = m.index + m[0].length
    if (m[0].length === 0) { regex.lastIndex++; continue }
  }
  if (last < text.length) parts.push(esc(text.slice(last)))
  return parts.join('')
}

const props = defineProps({ bookmark: { type: Object as () => Bookmark, required: true } })
const dataStore = useDataStore()
const uiStore = useUIStore()
const store = useAppStore()
const cardEl = ref(null)
const acctOpen = ref(false)
const decodedPw = ref('')
const { isVisible, toggle: togglePw } = usePasswordVisibility()

function decodePassword() {
  decodedPw.value = safeDecodePassword(props.bookmark.password)
}

onMounted(() => {
  decodePassword()
  stripEntranceAnim(cardEl.value)
})
watch(() => props.bookmark.password, decodePassword)

const domainStr = computed(() => domain(props.bookmark.url))
const iconSrc = computed(() => favicon(props.bookmark.url, props.bookmark.icon))
const tagNames = computed(() => getTagNames(props.bookmark, dataStore.customAttributes))
const children = computed(() => dataStore.childrenMap[props.bookmark.id] || [])
const hasExpandableContent = computed(() => !!(props.bookmark.username || props.bookmark.password || children.value.length))
const previewText = computed(() => (props.bookmark.notes || '').trim().replace(/\s+/g, ' ').slice(0, 120))
const isExpanded = computed(() => uiStore.layoutMode === 'list' && props.bookmark.isExpanded)
const isSelected = computed(() => { try { return (uiStore.batchSelected || []).indexOf(props.bookmark.id) !== -1 } catch { return false } })
const isDeadLink = computed(() => !!props.bookmark.attributes?.['dead-link'])
const isGfwBlocked = computed(() => !!props.bookmark.attributes?.['gfw-blocked'])
const searchQuery = computed(() => (uiStore.searchQuery || '').trim())

function visit() { openBookmark(props.bookmark) }
function edit() { openBmModal(props.bookmark.id) }
function del() { deleteBookmarkWithUndo(props.bookmark.id) }
function doAddSub() { addSub(props.bookmark.id) }
function doOpenDetail(bmId: string) { openDetail(bmId) }
function visitSub(sub: Bookmark) { openBookmark(sub) }
function toggleSelect() { const id = props.bookmark.id; const sel = uiStore.batchSelected; const idx = sel.indexOf(id); if (idx > -1) sel.splice(idx, 1); else sel.push(id) }
function toggleExpand() { dataStore.updateBookmark(props.bookmark.id, { isExpanded: !props.bookmark.isExpanded }); store.debouncedSave() }
function onCardClick(e: MouseEvent) {
  if (uiStore.batchMode) { toggleSelect(); return }
  if (uiStore.layoutMode !== 'list') return
  if ((e.target as HTMLElement).closest('button, input, .btn-xs, .card-actions, .card-logo, .card-titlewrap, [contenteditable="true"], .gic-btn, .gic-remove, .gic-name, .acct-copy-btn, .acct-show-pw, .list-expand-btn')) return
  toggleExpand()
}
function filterByTagName(name: string) {
  const attr = dataStore.customAttributes.find(a => a.name === name)
  if (attr) toggleAttrFilter(attr.id)
}
function copyUser() { copyToClipboard(props.bookmark.username || '', '账户') }
function copyPw() { copyToClipboard(decodedPw.value, '密码') }

function editNotes(e: Event) {
  const notesEl = e.currentTarget as HTMLElement
  if (notesEl.hasAttribute('contenteditable')) return
  notesEl.setAttribute('contenteditable', 'true')
  notesEl.style.cssText = 'outline:1px dashed var(--accent);padding:4px;border-radius:4px;cursor:text;white-space:pre-wrap;-webkit-line-clamp:unset;display:block'
  notesEl.textContent = props.bookmark.notes || ''
  notesEl.focus()
  const sel = window.getSelection()
  sel?.selectAllChildren(notesEl)

  function saveNotes() {
    notesEl.removeAttribute('contenteditable')
    notesEl.style.cssText = ''
    const newNotes = notesEl.textContent.trim()
    if (props.bookmark.notes !== newNotes) {
      dataStore.updateBookmark(props.bookmark.id, { notes: newNotes })
      store.debouncedSave()
      toast('备注已更新')
    }
    notesEl.removeEventListener('blur', saveNotes)
    notesEl.removeEventListener('keydown', onKey)
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'Escape') { ev.preventDefault(); saveNotes() }
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); saveNotes() }
  }

  notesEl.addEventListener('blur', saveNotes)
  notesEl.addEventListener('keydown', onKey)
}
</script>