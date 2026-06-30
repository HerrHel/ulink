<template>
  <div id="syncStatusPopover" class="ssp-popover" :class="{ visible: store.open }">
    <div class="ssp-head">
      <span class="ssp-dot" :class="state.dotClass"></span>
      <span class="ssp-label">{{ state.label }}</span>
    </div>
    <div v-if="sync.syncError.value && state.level === 'error'" class="ssp-error">
      {{ sync.syncError.value }}
    </div>
    <div class="ssp-actions">
      <button
        class="btn btn-ghost btn-sm ssp-btn"
        :disabled="state.level !== 'error' && state.level !== 'offline'"
        :class="{ 'ssp-btn-primary': state.level === 'error' || state.level === 'offline' }"
        @click="onRetry"
      >
        <span v-html="I.refresh"></span>重试同步
      </button>
      <button
        v-if="state.level === 'conflict'"
        class="btn btn-ghost btn-sm ssp-btn"
        @click="onViewConflicts"
      >
        <span v-html="I.alert"></span>查看冲突
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted } from 'vue'
import { useSyncStatusStore } from '../../stores/overlay.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { I } from '../../config/icons.js'
import { toast } from '../../lib/toast.js'

const store = useSyncStatusStore()
const state = useSyncState()
const sync = useCloudSync()

function onRetry() {
  if (state.value.level !== 'error' && state.value.level !== 'offline') return
  toast('开始同步...')
  sync.fullSync()
  store.hide()
}

function onViewConflicts() {
  sync.resetConflictBannerDismissed()
  store.hide()
}

function _closeOnOutsideClick(e: MouseEvent) {
  const pop = document.getElementById('syncStatusPopover')
  if (pop && !pop.contains(e.target as Node) && !(e.target as HTMLElement).closest('#btnSettings')) {
    store.hide()
  }
}

const _origShow = store.show
const _origHide = store.hide
store.show = () => { _origShow(); document.addEventListener('click', _closeOnOutsideClick) }
store.hide = () => { _origHide(); document.removeEventListener('click', _closeOnOutsideClick) }

onUnmounted(() => store.hide())
</script>

<style>
.ssp-popover{
  position:fixed;top:52px;right:12px;
  transform:translateY(8px);opacity:0;
  width:240px;background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius-lg);box-shadow:var(--shadow-card);
  z-index:200;overflow:hidden;pointer-events:none;
  transition:opacity .18s,transform .18s;
}
.ssp-popover.visible{
  opacity:1;transform:translateY(0);pointer-events:auto;
}
.ssp-head{
  display:flex;align-items:center;gap:8px;
  padding:10px 14px;border-bottom:1px solid var(--border-light);
}
.ssp-dot{
  width:8px;height:8px;border-radius:50%;flex-shrink:0;
}
.ssp-dot.dot-ok{background:var(--emerald,#22c55e)}
.ssp-dot.dot-pending{background:var(--amber,#f59e0b)}
.ssp-dot.dot-syncing{background:var(--accent);animation:dot-pulse 1s ease-in-out infinite}
.ssp-dot.dot-error{background:var(--rose,#ef4444)}
.ssp-dot.dot-conflict{background:var(--rose,#ef4444);animation:dot-pulse 1s ease-in-out infinite}
.ssp-dot.dot-offline{background:var(--text-muted,#9ca3af)}
.ssp-label{font-size:0.82rem;font-weight:500;color:var(--text)}
.ssp-error{
  padding:8px 14px;font-size:0.72rem;color:var(--rose,#ef4444);
  background:rgba(239,68,68,.06);border-bottom:1px solid var(--border-light);
  word-break:break-all;
}
.ssp-actions{
  display:flex;gap:6px;padding:10px 14px;
}
.ssp-btn{flex:1;justify-content:center}
.ssp-btn:disabled{opacity:.4;cursor:not-allowed}
.ssp-btn-primary{color:var(--accent);border-color:var(--accent)}
</style>
