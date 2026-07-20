<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="死链检测" :class="{ open: visible }" @click.self="close">
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
          <button v-if="unconfirmedList.length" class="popover-tab" :class="{ active: tab === 'unconfirmed' }" @click="switchTab('unconfirmed')">
            未确认 <span class="tab-count">{{ unconfirmedList.length }}</span>
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
            <button class="pop-action-btn" :disabled="!selectedIds.size" @click="ignoreSelected" title="标记忽略">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
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
          暂无{{ tab === 'dead' ? '失效' : tab === 'blocked' ? '被墙' : '未确认' }}链接
        </div>
        <div v-for="b in currentList" :key="b.id" class="popover-result"
             :class="{ selected: selectedIds.has(b.id) }"
             @click="selectMode ? toggleSelect(b.id) : onSelect(b.id)">
          <!-- 多选复选框 -->
          <div v-if="selectMode" class="pr-checkbox" :class="{ checked: selectedIds.has(b.id) }">
            <svg v-if="selectedIds.has(b.id)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l5 5L20 7"/></svg>
          </div>
          <img :src="favicon(b.url)" alt="" @error="onImgError">
          <div class="pr-info">
            <span class="pr-name">{{ b.title }}</span>
            <span class="pr-url">{{ domain(b.url) }}</span>
          </div>
          <span v-if="tab === 'dead'" class="pr-badge dead">失效</span>
          <span v-else-if="tab === 'blocked'" class="pr-badge blocked">被墙</span>
          <span v-else class="pr-badge unconfirmed">未确认</span>
          <button v-if="!selectMode" class="pr-delete" @click.stop="onDelete(b.id)" title="删除">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { favicon, domain } from '../../utils.js'
import { openBmModal, deleteBookmarkWithUndo } from '../../composables/domain/useBookmark.js'
import { showConfirm, toast, toastWithUndo } from '../../lib/toast.js'
import { debouncedSaveAppData, saveAppData } from '../../stores/app.js'

const store = useAppStore()
const dataStore = useDataStore()
const deadLinkChecker = useDeadLinkChecker()
const visible = ref(false)
const tab = ref<'dead' | 'blocked' | 'unconfirmed'>('dead')
const selectMode = ref(false)
const selectedIds = ref(new Set<string>())

const deadList = computed(() =>
  dataStore.bookmarks.filter(b => !b.deletedAt && b.attributes?.['dead-link'] && !b.attributes?.['dead-link-ignored'])
)

function onImgError(e: Event) {
  (e.target as HTMLImageElement).classList.add('img-error')
}

const blockedList = computed(() =>
  dataStore.bookmarks.filter(b => !b.deletedAt && b.attributes?.['gfw-blocked'] && !b.attributes?.['dead-link-ignored'])
)

/** 未确认列表：本次检测 inconclusive 的项（in-session，不读 attributes） */
const unconfirmedList = computed(() => {
  const r = deadLinkChecker.results
  const out: { id: string; title: string; url: string }[] = []
  for (const id in r) {
    if (r[id].verdict !== 'inconclusive') continue
    const bm = dataStore.bookmarkMap[id]
    if (!bm || bm.deletedAt) continue
    out.push({ id: bm.id, title: bm.title, url: bm.url })
  }
  return out
})

const currentList = computed(() =>
  tab.value === 'dead' ? deadList.value : tab.value === 'blocked' ? blockedList.value : unconfirmedList.value
)

const allSelected = computed(() =>
  currentList.value.length > 0 && currentList.value.every(b => selectedIds.value.has(b.id))
)

watch(() => store.overlays.deadLinks, (v) => {
  if (v) {
    visible.value = true
    selectMode.value = false
    selectedIds.value = new Set()
    if (deadList.value.length) tab.value = 'dead'
    else if (blockedList.value.length) tab.value = 'blocked'
    else if (unconfirmedList.value.length) tab.value = 'unconfirmed'
  } else {
    visible.value = false
  }
})

function switchTab(t: 'dead' | 'blocked' | 'unconfirmed') {
  tab.value = t
  selectedIds.value = new Set()
}

function close() {
  store.overlays.deadLinks = false
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

function ignoreSelected() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  for (const id of ids) {
    const bm = dataStore.bookmarkMap[id]
    if (bm) {
      dataStore.updateBookmark(id, {
        attributes: { ...(bm.attributes || {}), 'dead-link-ignored': true }
      })
    }
  }
  debouncedSaveAppData()
  toast('已标记忽略 ' + ids.length + ' 个链接')
  selectedIds.value = new Set()
  exitSelectMode()
}

function collectSubIds(id: string): string[] {
  // 与 useBatch.batchDelete 一致的父子语义：含所有子孙书签一起删
  const cm = dataStore.childrenMap
  const ids: string[] = [id]
  const stack = [id]
  while (stack.length) {
    const pid = stack.pop()!
    const children = cm[pid]
    if (children) {
      for (const c of children) { ids.push(c.id); stack.push(c.id) }
    }
  }
  return ids
}

function deleteSelected() {
  const count = selectedIds.value.size
  if (!count) return
  const ids = [...selectedIds.value]
  // A3-007：确认后再 close；取消时保持面板与多选态
  showConfirm(`确认删除 ${count} 个书签？`).then(ok => {
    if (!ok) return
    // 复用底层 store 直删：deleteBookmark 会自动从所属组剔除并把组关系
    // 记到 _deletedGroupMemberships，undo/回收站恢复时能正确还原组关联。
    // 不再循环调 deleteBookmarkWithUndo(id, true) —— toastWithUndo 是单例，
    // 循环里 N 次会互相 dismissUndo 覆盖，最终只剩最后一个可撤销。
    const allIds: string[] = []
    ids.forEach(id => {
      const sub = collectSubIds(id)
      sub.forEach(bid => { dataStore.deleteBookmark(bid); allIds.push(bid) })
    })
    saveAppData()
    selectedIds.value = new Set()
    exitSelectMode()
    close()
    toastWithUndo(`已删除 ${count} 个书签`, () => {
      allIds.forEach(bid => dataStore.restoreBookmark(bid))
      debouncedSaveAppData()
      toast('已恢复')
    })
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
.pr-badge.unconfirmed{
  color:var(--text-muted);
  background:var(--bg-alt);
  border:1px solid var(--border);
  font-weight:600;
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
