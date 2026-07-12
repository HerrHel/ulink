<template>
  <div class="cmd-mask" :class="{ open: visible }" @click.self="close">
    <div class="cmd-palette">
      <div class="cmd-input-wrap">
        <span class="cmd-icon" aria-hidden="true" v-html="I.search"></span>
        <input class="cmd-input" v-model="query" placeholder="搜索书签、组或输入命令…"
               ref="inputRef" @keydown="onKeydown" @input="onInput">
        <kbd class="cmd-kbd">Esc</kbd>
      </div>
      <div class="cmd-results" v-if="filtered.length">
        <template v-for="(section, si) in grouped" :key="si">
          <div class="cmd-section-title" v-if="section.label">{{ section.label }}</div>
          <div v-for="(item, idx) in section.items" :key="item.id"
               class="cmd-item" :class="{ active: flatIndex(si, idx) === activeIdx }"
               @click="execute(item)" @mouseenter="activeIdx = flatIndex(si, idx)">
            <span class="cmd-item-icon" v-html="item.icon || I.arrow"></span>
            <span class="cmd-item-label">{{ item.label }}</span>
            <span class="cmd-item-hint" v-if="item.hint">{{ item.hint }}</span>
            <kbd class="cmd-item-kbd" v-if="item.shortcut">{{ item.shortcut }}</kbd>
          </div>
        </template>
      </div>
      <div class="cmd-empty" v-else-if="query.trim()">
        没有匹配结果
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { searchWithHighlights } from '../../lib/search.js'
import { I } from '../../config/icons.js'
import { openBookmark } from '../../composables/domain/useBookmark.js'
import { openBmModal } from '../../composables/domain/useBookmark.js'
import { toggleGroupFocus } from '../../composables/domain/useGroup.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { toast } from '../../lib/toast.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import type { SearchResultItem } from '../../lib/search.js'

interface CommandItem {
  id: string
  label: string
  icon?: string
  hint?: string
  shortcut?: string
  action: () => void
  section: 'command' | 'group' | 'bookmark'
}

const visible = ref(false)
const query = ref('')
const activeIdx = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const ds = useDataStore()
const ui = useUIStore()
const sync = useCloudSync()
const auth = useAuth()

const commands: CommandItem[] = [
  { id: 'new-bm', label: '新建书签', icon: I.plus, shortcut: 'Ctrl+N', section: 'command', action() { close(); openBmModal() } },
  { id: 'new-group', label: '新建组', icon: I.note, section: 'command', action() { close(); ui.modals.groupEdit = true } },
  { id: 'import', label: '导入数据', icon: I.import, section: 'command', action() { close(); document.getElementById('importFile')?.click() } },
  { id: 'export', label: '导出数据', icon: I.export, section: 'command', action() { close(); pushNavState(); ui.panels.settings = true } },
  { id: 'sync', label: '同步到云端', icon: I.cloud, section: 'command', async action() { close(); if (!auth.isLoggedIn) { toast('请先登录云同步', false); auth.authModalOpen = true; return } toast('开始同步...'); await sync.fullSync() } },
  { id: 'trash', label: '打开回收站', icon: I.trash, section: 'command', action() { close(); pushNavState(); ui.panels.trash = true } },
  { id: 'settings', label: '打开设置', icon: I.settings, section: 'command', action() { close(); pushNavState(); ui.panels.settings = true } },
  { id: 'shortcuts', label: '快捷键速查', icon: I.search, shortcut: 'Ctrl /', section: 'command', action() { close(); pushNavState(); ui.panels.shortcutHelp = true } },
]

const searchResults = computed<SearchResultItem[]>(() => {
  const q = query.value.trim()
  if (!q) return []
  return searchWithHighlights(
    ds.bookmarks,
    ds.siblingGroups,
    q,
    ds.bookmarkMap,
    ds.customAttributes,
    5,
    // 传 _searchVersion 复用 Fuse 基准（旧调用漏传 → 每键击重建）。
    // 全量基准 + 软删过滤推到结果层，与 data.ts / SearchSuggest 共享缓存。
    ds._searchVersion,
  ).filter(r => {
    if (r._isGroup) return !ds.groupMap[r.id]?.deletedAt
    return !ds.bookmarkMap[r.id]?.deletedAt
  })
})

const filtered = computed<CommandItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return commands
  const matchedCmds = commands.filter(c => c.label.toLowerCase().includes(q))
  const matchedGroups: CommandItem[] = searchResults.value
    .filter(r => r._isGroup)
    .map(r => ({
      id: 'g:' + r.id,
      label: r.name || r._displayTitle || '未命名组',
      icon: I.note,
      hint: (r.bookmarkIds?.length || 0) + ' 个书签',
      section: 'group' as const,
      action() { close(); toggleGroupFocus(r.id) },
    }))
  const matchedBms: CommandItem[] = searchResults.value
    .filter(r => !r._isGroup)
    .map(r => ({
      id: 'b:' + r.id,
      label: r.title || '',
      icon: I.chevron,
      hint: r.url ? (() => { try { return new URL(r.url.startsWith('http') ? r.url : 'https://' + r.url).hostname.replace(/^www\./, '') } catch { return '' } })() : '',
      section: 'bookmark' as const,
      action() { const bm = ds.bookmarkMap[r.id]; if (bm) { close(); openBookmark(bm) } },
    }))
  return [...matchedCmds, ...matchedGroups, ...matchedBms]
})

const grouped = computed(() => {
  const sections: { label: string; items: CommandItem[] }[] = []
  const bySection: Record<string, CommandItem[]> = { command: [], group: [], bookmark: [] }
  for (const item of filtered.value) {
    bySection[item.section]?.push(item)
  }
  if (bySection.command.length) sections.push({ label: '操作', items: bySection.command })
  if (bySection.group.length) sections.push({ label: '组', items: bySection.group })
  if (bySection.bookmark.length) sections.push({ label: '书签', items: bySection.bookmark })
  return sections
})

function flatIndex(sectionIdx: number, itemIdx: number): number {
  let count = 0
  for (let i = 0; i < sectionIdx; i++) count += grouped.value[i].items.length
  return count + itemIdx
}

function totalItems(): number {
  return grouped.value.reduce((sum, s) => sum + s.items.length, 0)
}

function open() {
  visible.value = true
  query.value = ''
  activeIdx.value = 0
  nextTick(() => inputRef.value?.focus())
}

function close() {
  visible.value = false
  query.value = ''
}

function execute(item: CommandItem) {
  item.action()
}

function onInput() {
  activeIdx.value = 0
}

function onKeydown(e: KeyboardEvent) {
  const total = totalItems()
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = activeIdx.value < total - 1 ? activeIdx.value + 1 : 0
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = activeIdx.value > 0 ? activeIdx.value - 1 : total - 1
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = filtered.value[activeIdx.value]
    if (item) execute(item)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    if (visible.value) close()
    else open()
  }
}

onMounted(() => document.addEventListener('keydown', onGlobalKeydown))
onUnmounted(() => document.removeEventListener('keydown', onGlobalKeydown))

defineExpose({ open, close, visible })
</script>
