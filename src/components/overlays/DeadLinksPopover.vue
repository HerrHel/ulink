<template>
  <div class="modal-mask" :class="{ open: visible }" @click.self="close">
    <div class="modal modal-md" @click.stop>
      <!-- 标签切换 + 操作栏 -->
      <div class="modal-head">
        <div class="popover-tabs">
          <button v-if="deadList.length" class="popover-tab" :class="{ active: tab === 'dead' }" @click="switchTab('dead')">
            失效 <span class="tab-count">{{ deadList.length }}</span>
          </button>
          <button v-if="blockedList.length" class="popover-tab" :class="{ active: tab === 'blocked' }" @click="switchTab('blocked')">
            被墙 <span class="tab-count tab-count-gfw">{{ blockedList.length }}</span>
          </button>
        </div>
        <div class="popover-actions">
          <button v-if="!selectMode" class="pop-action-btn" @click="enterSelectMode" title="多选">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>
          </button>
          <template v-else>
            <button class="pop-action-btn" @click="toggleSelectAll" :title="allSelected ? '取消全选' : '全选'">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path v-if="allSelected" d="M9 12l2 2 4-4"/><path v-else d="M8 12h8"/></svg>
            </button>
            <button class="pop-action-btn pop-action-danger" :disabled="!selectedIds.size" @click="deleteSelected" title="删除选中">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button class="pop-action-btn" @click="exitSelectMode" title="取消">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </template>
        </div>
        <button class="modal-close" @click="close" aria-label="关闭">&times;</button>
      </div>
      <!-- 结果列表 -->
      <div class="modal-body dead-links-body">
        <div v-if="!currentList.length" class="popover-result popover-empty">
          暂无{{ tab === 'dead' ? '失效' : '被墙' }}链接
        </div>
        <div v-for="b in currentList" :key="b.id" class="popover-result"
             :class="{ selected: selectedIds.has(b.id) }"
             @click="selectMode ? toggleSelect(b.id) : onSelect(b.id)">
          <!-- 多选复选框 -->
          <div v-if="selectMode" class="pr-checkbox" :class="{ checked: selectedIds.has(b.id) }">
            <svg v-if="selectedIds.has(b.id)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l5 5L20 7"/></svg>
          </div>
          <img :src="favicon(b.url)" alt="" @error="($event.target as HTMLImageElement).classList.add('img-error')">
          <div class="pr-info">
            <span class="pr-name">{{ b.title }}</span>
            <span class="pr-url">{{ domain(b.url) }}</span>
          </div>
          <span v-if="tab === 'dead'" class="pr-badge dead">失效</span>
          <span v-else class="pr-badge blocked">被墙</span>
          <button v-if="!selectMode" class="pr-delete" @click.stop="onDelete(b.id)" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { favicon, domain } from '../../utils.js'
import { openBmModal, deleteBookmarkWithUndo } from '../../composables/domain/useBookmark.js'
import { showConfirm } from '../../lib/toast.js'

const store = useAppStore()
const uiStore = useUIStore()
const dataStore = useDataStore()
const visible = ref(false)
const tab = ref<'dead' | 'blocked'>('dead')
const selectMode = ref(false)
const selectedIds = ref(new Set<string>())

const deadList = computed(() =>
  dataStore.bookmarks.filter(b => !b.deletedAt && b.attributes?.['dead-link'])
)

const blockedList = computed(() =>
  dataStore.bookmarks.filter(b => !b.deletedAt && b.attributes?.['gfw-blocked'])
)

const currentList = computed(() =>
  tab.value === 'dead' ? deadList.value : blockedList.value
)

const allSelected = computed(() =>
  currentList.value.length > 0 && currentList.value.every(b => selectedIds.value.has(b.id))
)

watch(() => store.deadLinksPopoverOpen, (v) => {
  if (v) {
    visible.value = true
    selectMode.value = false
    selectedIds.value = new Set()
    if (deadList.value.length) tab.value = 'dead'
    else if (blockedList.value.length) tab.value = 'blocked'
  } else {
    visible.value = false
  }
})

function switchTab(t: 'dead' | 'blocked') {
  tab.value = t
  selectedIds.value = new Set()
}

function close() {
  store.deadLinksPopoverOpen = false
}

function onSelect(bmId: string) {
  openBmModal(bmId)
  close()
}

function onDelete(bmId: string) {
  deleteBookmarkWithUndo(bmId)
}

function enterSelectMode() {
  selectMode.value = true
  selectedIds.value = new Set()
}

function exitSelectMode() {
  selectMode.value = false
  selectedIds.value = new Set()
}

function toggleSelect(bmId: string) {
  const s = new Set(selectedIds.value)
  if (s.has(bmId)) s.delete(bmId)
  else s.add(bmId)
  selectedIds.value = s
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(currentList.value.map(b => b.id))
  }
}

function deleteSelected() {
  const count = selectedIds.value.size
  if (!count) return
  const ids = [...selectedIds.value]
  close()
  showConfirm(`确认删除 ${count} 个书签？`, () => {
    for (const id of ids) {
      deleteBookmarkWithUndo(id)
    }
  })
}
</script>

<style scoped>
.dead-links-body{
  padding:0;
  max-height:60vh;
  overflow-y:auto;
}
.popover-tabs{display:flex;gap:0;flex:1}
.popover-actions{
  display:flex;gap:2px;
  margin-left:auto;
}
.pop-action-btn{
  display:flex;align-items:center;justify-content:center;
  width:30px;height:30px;
  border:1px solid var(--border);
  border-radius:var(--radius-md);
  background:var(--surface);
  color:var(--text-secondary);
  cursor:pointer;
  transition:var(--transition-normal);
}
.pop-action-btn svg{width:15px;height:15px}
.pop-action-btn:hover{
  border-color:var(--accent);
  color:var(--accent);
  background:var(--accent-light);
}
.pop-action-btn:disabled{
  opacity:0.4;cursor:not-allowed;
}
.pop-action-btn:disabled:hover{
  border-color:var(--border);
  color:var(--text-secondary);
  background:var(--surface);
}
.pop-action-danger:hover{
  border-color:var(--rose);
  color:var(--rose);
  background:var(--rose-light);
}
.pr-info{
  flex:1;min-width:0;
  display:flex;flex-direction:column;gap:2px;
}
.pr-name{
  font-size:0.82rem;font-weight:600;
  color:var(--text);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.pr-url{
  font-size:0.68rem;color:var(--text-muted);
  font-family:'JetBrains Mono',monospace;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.pr-badge{
  display:inline-flex;align-items:center;
  padding:0 6px;height:18px;
  font-size:0.6rem;font-weight:700;
  border-radius:4px;
  flex-shrink:0;
}
.pr-badge.dead{
  color:var(--rose);
  background:var(--rose-light);
  border:1px solid var(--rose);
}
.pr-badge.blocked{
  color:var(--amber);
  background:var(--amber-light);
  border:1px solid var(--amber);
}
.pr-checkbox{
  width:18px;height:18px;
  border:2px solid var(--border);
  border-radius:4px;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;
  transition:var(--transition-normal);
}
.pr-checkbox.checked{
  border-color:var(--accent);
  background:var(--accent);
}
.pr-checkbox svg{width:12px;height:12px;color:#fff}
.pr-delete{
  display:flex;align-items:center;justify-content:center;
  width:28px;height:28px;
  border:1px solid transparent;
  border-radius:var(--radius-md);
  background:transparent;
  color:var(--text-muted);
  cursor:pointer;
  flex-shrink:0;
  transition:var(--transition-normal);
}
.pr-delete svg{width:14px;height:14px}
.pr-delete:hover{
  border-color:var(--rose);
  color:var(--rose);
  background:var(--rose-light);
}
.popover-result.selected{
  background:var(--accent-light);
}
.tab-count{
  display:inline-flex;align-items:center;justify-content:center;
  min-width:16px;padding:2px 4px;
  border-radius:8px;
  background:var(--rose,#ef4444);color:#fff;
  font-size:0.55rem;font-weight:700;
  line-height:1;
  margin-left:4px;
}
.tab-count-gfw{
  background:var(--amber,#f59e0b);
}
.popover-result{
  display:flex;align-items:center;gap:10px;
  padding:10px 16px;
  cursor:pointer;
  transition:var(--transition-normal);
}
.popover-result:hover{
  background:var(--hover);
}
.popover-result img{
  width:28px;height:28px;border-radius:6px;
  object-fit:cover;flex-shrink:0;
}
.popover-empty{
  justify-content:center;
  color:var(--text-muted);
  font-size:0.8rem;
  padding:20px;
  cursor:default;
}
.popover-empty:hover{background:none}
</style>
