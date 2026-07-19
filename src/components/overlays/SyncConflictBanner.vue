<template>
  <Teleport to="body">
    <Transition name="conflict-slide">
      <div v-if="sync.conflicts.value.length > 0 && !sync.conflictBannerDismissed.value" class="conflict-banner" data-testid="lv-conflict-banner" role="alert">
        <div class="conflict-banner-head">
          <span class="conflict-icon" aria-hidden="true" v-html="I.alert"></span>
          <span class="conflict-title">同步冲突 ({{ sync.conflicts.value.length }})</span>
          <span class="conflict-subtitle">本地和云端同时修改了以下数据</span>
          <button class="conflict-close" @click="sync.conflictBannerDismissed.value = true" title="暂时关闭">
            <span aria-hidden="true" v-html="I.close"></span>
          </button>
        </div>
        <div class="conflict-list">
            <div v-for="c in sync.conflicts.value" :key="c.id" class="conflict-item">
              <div class="conflict-item-info">
                <span class="conflict-type-badge">{{ typeLabel(c.type) }}</span>
                <span class="conflict-item-name">{{ itemName(c) }}</span>
              </div>
              <div class="conflict-item-actions">
                <button class="btn btn-ghost btn-xs" @click="sync.resolveConflict(c.id, true)">保留本地</button>
                <button class="btn btn-ghost btn-xs" @click="sync.resolveConflict(c.id, false)">用云端覆盖</button>
              </div>
            </div>
          </div>
          <div class="conflict-banner-foot">
            <button class="btn btn-ghost btn-xs" @click="sync.resolveAllConflicts(true)">全部保留本地</button>
            <button class="btn btn-ghost btn-xs" @click="sync.resolveAllConflicts(false)">全部用云端</button>
          </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import type { SyncConflict } from '../../stores/sync.js'
import { useDataStore } from '../../stores/data.js'
import { I } from '../../config/icons.js'

const sync = useCloudSync()
const ds = useDataStore()

function typeLabel(type: SyncConflict['type']): string {
  const map: Record<string, string> = { bookmark: '书签', group: '组', category: '分类', attribute: '属性' }
  return map[type] || type
}

function itemName(c: SyncConflict): string {
  const d = c.local as Record<string, unknown>
  if (c.type === 'bookmark') {
    const bm = ds.bookmarkMap[c.id]
    return bm?.title || (d?.title as string) || c.id
  }
  if (c.type === 'group') {
    const g = ds.groupMap[c.id]
    return g?.name || (d?.name as string) || c.id
  }
  if (c.type === 'category') {
    const cat = ds.categories.find(x => x.id === c.id)
    return cat?.name || (d?.name as string) || c.id
  }
  const attr = ds.customAttributes.find(x => x.id === c.id)
  return attr?.name || (d?.name as string) || c.id
}
</script>

<style scoped>
.conflict-banner {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  z-index: 5000; width: min(460px, calc(100vw - 32px));
  background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.15);
  overflow: hidden; font-size: 13px;
}
.conflict-banner-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; background: var(--warning-bg, #FEF3C7);
  border-bottom: 1px solid var(--border-light, #f0f0f0);
}
.conflict-icon { color: #D97706; display: flex; flex-shrink: 0; }
.conflict-icon :deep(svg) { width: 18px; height: 18px; }
.conflict-title { font-weight: 600; color: #92400E; white-space: nowrap; }
.conflict-subtitle { color: #92400E; opacity: .75; font-size: 12px; flex: 1; }
.conflict-close { background: none; border: none; cursor: pointer; padding: 4px; color: #92400E; display: flex; }
.conflict-close :deep(svg) { width: 16px; height: 16px; }
.conflict-list { max-height: 200px; overflow-y: auto; }
.conflict-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; border-bottom: 1px solid var(--border-light, #f0f0f0);
}
.conflict-item:last-child { border-bottom: none; }
.conflict-item-info { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.conflict-type-badge {
  font-size: 11px; padding: 2px 6px; border-radius: 4px;
  background: var(--accent-bg, #EFF6FF); color: var(--accent, #3B82F6);
  white-space: nowrap; flex-shrink: 0;
}
.conflict-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conflict-item-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: 8px; }
.conflict-banner-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 8px 16px; border-top: 1px solid var(--border-light, #f0f0f0);
}
.conflict-slide-enter-active { transition: all .3s cubic-bezier(.34,1.56,.64,1); }
.conflict-slide-leave-active { transition: all .2s ease; }
.conflict-slide-enter-from { opacity: 0; transform: translateX(-50%) translateY(24px); }
.conflict-slide-leave-to { opacity: 0; transform: translateX(-50%) translateY(12px); }
</style>
