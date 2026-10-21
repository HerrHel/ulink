<template>
  <div
    class="chat-draft-diff-card"
    :class="{
      'is-completed': card.completed,
      'is-executing': card.executing,
    }"
  >
    <div class="diff-card-header">
      <span class="diff-card-badge">{{ t('ai.draftDiffBadge') }}</span>
      <h4 class="diff-card-title">{{ card.title }}</h4>
    </div>

    <div v-if="card.desc" class="diff-card-summary">
      {{ card.desc }}
    </div>

    <!-- 统计指示条 -->
    <div v-if="diffPayload?.stats" class="diff-card-stats">
      <span v-if="diffPayload.stats.toModify > 0" class="diff-stat-chip is-modify">
        ~ {{ t('ai.diffChangeModify') }} ({{ diffPayload.stats.toModify }})
      </span>
      <span v-if="diffPayload.stats.toNest > 0" class="diff-stat-chip is-nest">
        ↳ {{ t('ai.diffChangeNest') }} ({{ diffPayload.stats.toNest }})
      </span>
      <span v-if="diffPayload.stats.toRemove > 0" class="diff-stat-chip is-remove">
        - {{ t('ai.diffChangeRemove') }} ({{ diffPayload.stats.toRemove }})
      </span>
      <span v-if="diffPayload.stats.toAdd > 0" class="diff-stat-chip is-add">
        + {{ t('ai.diffChangeAdd') }} ({{ diffPayload.stats.toAdd }})
      </span>
    </div>

    <!-- 筛选与全选操作栏 -->
    <div v-if="diffPayload && !card.completed" class="diff-card-toolbar">
      <span class="diff-toolbar-count">
        {{ t('ai.selectedCount', { n: selectedCount }) }} / {{ diffPayload.items.length }}
      </span>
      <button
        type="button"
        class="diff-toolbar-toggle"
        :disabled="card.executing"
        @click="emit('toggleSelectAll')"
      >
        {{ isAllSelected ? t('ai.unselectAll') : t('ai.selectAll') }}
      </button>
    </div>

    <!-- 差异明细列表 -->
    <div v-if="diffPayload" class="diff-item-list">
      <label
        v-for="item in diffPayload.items"
        :key="item.id"
        class="diff-item-row"
        :class="{
          'is-checked': item.selected,
          [`is-${item.changeType}`]: true,
        }"
      >
        <input
          type="checkbox"
          class="diff-item-checkbox"
          :checked="item.selected"
          :disabled="card.executing || card.completed"
          @change="emit('toggleItemSelection', item.id)"
        />
        <span class="diff-type-indicator" :title="item.changeType">
          {{ getTypeSymbol(item.changeType) }}
        </span>
        <div class="diff-item-body">
          <div class="diff-item-title-row">
            <span class="diff-item-name" :title="item.title">{{ item.title }}</span>
            <span v-if="item.url" class="diff-item-domain">{{ formatDomain(item.url) }}</span>
          </div>

          <!-- 差异演练指示 (Before ➜ After) -->
          <div class="diff-transition-chip">
            <template v-if="item.changeType === 'modify'">
              <span class="diff-crumb before">{{ item.before?.categoryName || t('cat.uncategorized') }}</span>
              <span class="diff-arrow">➜</span>
              <span class="diff-crumb after">{{ item.after?.categoryName }}</span>
            </template>
            <template v-else-if="item.changeType === 'nest'">
              <span class="diff-crumb nest-crumb">↳ {{ t('ai.diffChangeNest') }}: {{ item.after?.parentTitle }}</span>
            </template>
            <template v-else-if="item.changeType === 'remove'">
              <span class="diff-crumb remove-crumb">{{ item.detail || t('ai.diffChangeRemove') }}</span>
            </template>
            <template v-else>
              <span class="diff-crumb add-crumb">+ {{ item.detail || t('ai.diffChangeAdd') }}</span>
            </template>
          </div>
        </div>
      </label>
    </div>

    <!-- 底部确认应用按钮 -->
    <div class="diff-card-footer">
      <button
        v-if="!card.completed"
        type="button"
        class="diff-apply-btn"
        :disabled="card.executing || selectedCount === 0"
        @click="emit('applyDiff')"
      >
        <span v-if="card.executing" class="diff-spin-icon">⏳</span>
        <span>
          {{ card.executing ? t('ai.executing') : t('ai.draftDiffApplyButton') }}
          <template v-if="!card.executing && selectedCount > 0"> ({{ selectedCount }})</template>
        </span>
      </button>
      <div v-else class="diff-completed-notice">
        <span>✓ {{ t('ai.diffApplied') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/index.js'
import type { ChatActionCard } from '../../lib/ai/chatSessions.js'
import type { DraftDiffPayload, DiffChangeType } from '../../lib/ai/draftDiff.js'

const props = defineProps<{
  card: ChatActionCard
}>()

const emit = defineEmits<{
  toggleItemSelection: [itemId: string]
  toggleSelectAll: []
  applyDiff: []
}>()

const { t } = useI18n()

const diffPayload = computed<DraftDiffPayload | null>(() => {
  return ((props.card.payload as any)?.diffPayload as DraftDiffPayload) || null
})

const selectedCount = computed(() => {
  return diffPayload.value?.items.filter((i) => i.selected).length ?? 0
})

const isAllSelected = computed(() => {
  if (!diffPayload.value || diffPayload.value.items.length === 0) return false
  return selectedCount.value === diffPayload.value.items.length
})

function getTypeSymbol(type: DiffChangeType): string {
  switch (type) {
    case 'add': return '+'
    case 'modify': return '~'
    case 'nest': return '↳'
    case 'remove': return '-'
    default: return '•'
  }
}

function formatDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 16)
  }
}
</script>

<style scoped>
.chat-draft-diff-card {
  margin-top: 12px;
  padding: 14px;
  border-radius: 10px;
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: all 0.2s ease;
}

.diff-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.diff-card-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(37, 99, 235, 0.08);
  color: var(--accent-color, #2563eb);
}

.diff-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

.diff-card-summary {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #64748b);
}

.diff-card-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.diff-stat-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.04));
  color: var(--text-secondary, #64748b);
}

.diff-stat-chip.is-modify {
  background: rgba(217, 119, 6, 0.08);
  color: #b45309;
}
.diff-stat-chip.is-nest {
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
}
.diff-stat-chip.is-remove {
  background: rgba(225, 29, 72, 0.08);
  color: #be123c;
}
.diff-stat-chip.is-add {
  background: rgba(16, 185, 129, 0.08);
  color: #047857;
}

.diff-card-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary, #64748b);
  padding: 4px 0;
  border-bottom: 1px dashed var(--border-color, rgba(0, 0, 0, 0.06));
}

.diff-toolbar-toggle {
  background: none;
  border: none;
  color: var(--accent-color, #2563eb);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
}

.diff-toolbar-toggle:hover {
  text-decoration: underline;
}

.diff-item-list {
  max-height: 240px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}

.diff-item-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 6px;
  background: var(--bg-subtle, rgba(0, 0, 0, 0.02));
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.diff-item-row:hover {
  background: var(--bg-hover, rgba(0, 0, 0, 0.04));
}

.diff-item-row.is-checked {
  border-color: rgba(37, 99, 235, 0.2);
  background: rgba(37, 99, 235, 0.02);
}

.diff-item-checkbox {
  margin-top: 2px;
  cursor: pointer;
}

.diff-type-indicator {
  font-size: 11px;
  font-weight: 700;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  flex-shrink: 0;
}

.diff-item-row.is-modify .diff-type-indicator {
  background: rgba(217, 119, 6, 0.12);
  color: #b45309;
}
.diff-item-row.is-nest .diff-type-indicator {
  background: rgba(37, 99, 235, 0.12);
  color: #1d4ed8;
}
.diff-item-row.is-remove .diff-type-indicator {
  background: rgba(225, 29, 72, 0.12);
  color: #be123c;
}
.diff-item-row.is-add .diff-type-indicator {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}

.diff-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.diff-item-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.diff-item-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary, #1e293b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-item-domain {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  flex-shrink: 0;
}

.diff-transition-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}

.diff-crumb {
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  color: var(--text-secondary, #64748b);
}

.diff-crumb.before {
  color: var(--text-secondary, #94a3b8);
  text-decoration: line-through;
}

.diff-crumb.after {
  color: var(--accent-color, #2563eb);
  font-weight: 500;
  border-color: rgba(37, 99, 235, 0.2);
}

.diff-arrow {
  color: var(--text-secondary, #94a3b8);
  font-size: 10px;
}

.diff-card-footer {
  margin-top: 4px;
}

.diff-apply-btn {
  width: 100%;
  padding: 8px 14px;
  border-radius: 6px;
  border: none;
  background: var(--accent-color, #2563eb);
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background 0.15s ease;
}

.diff-apply-btn:hover:not(:disabled) {
  opacity: 0.92;
}

.diff-apply-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.diff-completed-notice {
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  color: #10b981;
  padding: 6px;
  background: rgba(16, 185, 129, 0.08);
  border-radius: 6px;
}
</style>
