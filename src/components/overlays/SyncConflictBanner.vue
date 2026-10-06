<template>
  <Teleport to="body">
    <Transition name="conflict-slide">
      <div v-if="sync.conflicts.value.length > 0 && !sync.conflictBannerDismissed.value" class="conflict-banner" data-testid="lv-conflict-banner" role="alert">
        <div class="conflict-banner-head">
          <span class="conflict-icon" aria-hidden="true" v-html="I.alert"></span>
          <span class="conflict-title">{{ t('conflict.title', { n: sync.conflicts.value.length }) }}</span>
          <span class="conflict-subtitle">{{ t('conflict.subtitle') }}</span>
          <button class="conflict-close" @click="sync.conflictBannerDismissed.value = true" :title="t('conflict.dismiss')">
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
                <button class="btn btn-ghost btn-xs" data-testid="lv-conflict-keep-local" @click="sync.resolveConflict(c.id, true)">{{ t('conflict.keepLocal') }}</button>
                <button class="btn btn-ghost btn-xs" data-testid="lv-conflict-use-remote" @click="sync.resolveConflict(c.id, false)">{{ t('conflict.useRemote') }}</button>
              </div>
            </div>
          </div>
          <div class="conflict-banner-foot">
            <button class="btn btn-ghost btn-xs" @click="sync.resolveAllConflicts(true)">{{ t('conflict.keepAllLocal') }}</button>
            <button class="btn btn-ghost btn-xs" @click="sync.resolveAllConflicts(false)">{{ t('conflict.useAllRemote') }}</button>
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
import { typeLabel } from './typeLabel.js'
import { resolveConflictItemName } from './resolveConflictItemName.js'
import { t } from '../../i18n/index.js'

const sync = useCloudSync()
const ds = useDataStore()

function itemName(c: SyncConflict): string {
  return resolveConflictItemName(c, {
    bookmarkMap: ds.bookmarkMap,
    groupMap: ds.groupMap,
    categoryMap: ds.categoryMap,
    attributeMap: ds.attributeMap,
  })
}
</script>

<style scoped>
.conflict-banner {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  z-index: 7200; width: min(460px, calc(100vw - 32px)); /* 2026-08-10：抬到模态框(6000)之上，与 undo-toast 同层 */
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-base); box-shadow: var(--shadow-xl);
  overflow: hidden; font-size: 13px;
}
.conflict-banner-head {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; background: var(--amber-light);
  border-bottom: 1px solid var(--border-light);
}
.conflict-icon { color: var(--amber); display: flex; flex-shrink: 0; }
.conflict-icon :deep(svg) { width: 18px; height: 18px; }
.conflict-title { font-weight: 600; color: var(--text); white-space: nowrap; }
.conflict-subtitle { color: var(--text-secondary); opacity: .85; font-size: 12px; flex: 1; }
.conflict-close { background: none; border: none; cursor: pointer; padding: 4px; color: var(--text-muted); display: flex; transition: color 0.15s ease; }
.conflict-close:hover { color: var(--text); }
.conflict-close :deep(svg) { width: 16px; height: 16px; }
.conflict-list { max-height: 200px; overflow-y: auto; }
.conflict-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; border-bottom: 1px solid var(--border-light);
}
.conflict-item:last-child { border-bottom: none; }
.conflict-item-info { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.conflict-type-badge {
  font-size: 11px; padding: 2px 6px; border-radius: var(--radius-xs);
  background: var(--accent-light); color: var(--accent);
  white-space: nowrap; flex-shrink: 0;
}
.conflict-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conflict-item-actions { display: flex; gap: 4px; flex-shrink: 0; margin-left: 8px; }
.conflict-banner-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 8px 16px; border-top: 1px solid var(--border-light);
}
.conflict-slide-enter-active { transition: all .3s cubic-bezier(.34,1.56,.64,1); }
.conflict-slide-leave-active { transition: all .2s ease; }
.conflict-slide-enter-from { opacity: 0; transform: translateX(-50%) translateY(24px); }
.conflict-slide-leave-to { opacity: 0; transform: translateX(-50%) translateY(12px); }
</style>
