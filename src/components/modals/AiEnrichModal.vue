<template>
  <div
    class="modal-mask"
    role="dialog"
    aria-modal="true"
    :aria-label="t('ai.enrichModalTitle')"
    :class="{ open: ui.modals.aiEnrich }"
    @click.self="close"
  >
    <div class="modal modal-md ai-enrich-modal" @click.stop>
      <div class="modal-head">
        <div class="modal-title">
          <span class="ai-title-badge">PRO</span>
          <span>{{ t('ai.enrichModalTitle') }}</span>
        </div>
        <button class="modal-close" @click="close" :title="t('common.close')" v-html="I.close"></button>
      </div>

      <div class="modal-body ai-enrich-body">
        <div v-if="loading" class="ai-enrich-loading">
          <div class="ai-spinner"></div>
          <span>{{ t('ai.enrichAnalyzing') }}</span>
        </div>

        <div v-else-if="diff && targetBookmark" class="ai-diff-container">
          <div class="ai-diff-tip">
            <span aria-hidden="true" v-html="I.sparkle || I.plus"></span>
            <span>{{ t('ai.enrichDiffTip') }}</span>
          </div>

          <!-- 1. 标题建议 -->
          <div v-if="diff.suggestedTitle" class="ai-diff-card">
            <label class="ai-diff-header">
              <input type="checkbox" v-model="applyTitle" class="ai-chk" />
              <span class="ai-field-label">{{ t('ai.fieldTitle') }}</span>
            </label>
            <div class="ai-diff-content">
              <div class="ai-diff-row current">
                <span class="ai-label-muted">{{ t('ai.diffCurrent') }}:</span>
                <span>{{ diff.currentTitle }}</span>
              </div>
              <div class="ai-diff-row suggested">
                <span class="ai-label-muted">{{ t('ai.diffSuggested') }}:</span>
                <span class="ai-val-highlight">{{ diff.suggestedTitle }}</span>
              </div>
            </div>
          </div>

          <!-- 2. 备注建议（补缺） -->
          <div v-if="diff.suggestedNotes" class="ai-diff-card">
            <label class="ai-diff-header">
              <input type="checkbox" v-model="applyNotes" class="ai-chk" />
              <span class="ai-field-label">{{ t('ai.fieldNotes') }}</span>
            </label>
            <div class="ai-diff-content">
              <div v-if="diff.currentNotes" class="ai-diff-row current">
                <span class="ai-label-muted">{{ t('ai.diffCurrent') }}:</span>
                <span class="text-truncate">{{ diff.currentNotes }}</span>
              </div>
              <div class="ai-diff-row suggested">
                <span class="ai-label-muted">{{ t('ai.diffSuggested') }}:</span>
                <div class="ai-notes-preview">{{ diff.suggestedNotes }}</div>
              </div>
            </div>
          </div>

          <!-- 3. 分类建议（归拢） -->
          <div v-if="diff.suggestedCategoryId" class="ai-diff-card">
            <label class="ai-diff-header">
              <input type="checkbox" v-model="applyCategory" class="ai-chk" />
              <span class="ai-field-label">{{ t('ai.fieldCategory') }}</span>
            </label>
            <div class="ai-diff-content">
              <div class="ai-diff-row suggested">
                <span class="ai-label-muted">{{ t('ai.suggestMoveTo') }}:</span>
                <span class="card-tag ai-cat-tag">
                  <span aria-hidden="true" v-html="I.folder"></span>
                  {{ suggestedCategoryName }}
                </span>
              </div>
            </div>
          </div>

          <!-- 4. 属性标签建议 -->
          <div v-if="suggestedTagNames.length > 0" class="ai-diff-card">
            <label class="ai-diff-header">
              <input type="checkbox" v-model="applyAttributes" class="ai-chk" />
              <span class="ai-field-label">{{ t('ai.fieldAttributes') }}</span>
            </label>
            <div class="ai-diff-content">
              <div class="ai-diff-row suggested">
                <span class="ai-label-muted">{{ t('ai.suggestAddTags') }}:</span>
                <div class="ai-tags-wrap">
                  <span v-for="tag in suggestedTagNames" :key="tag" class="card-tag tag-custom">{{ tag }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="empty empty-compact">
          <p>{{ t('ai.enrichNoChanges') }}</p>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn btn-ghost btn-sm" @click="close">{{ t('common.cancel') }}</button>
        <button
          class="btn btn-primary btn-sm"
          :disabled="loading || !hasSelection"
          @click="onApplyDiff"
        >
          {{ t('ai.applyEnrich') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'
import type { AiEnrichDiff } from '../../types/ai.js'
import { enrichBookmarkMetadata } from '../../lib/ai/cloudAiClient.js'

const ui = useUIStore()
const ds = useDataStore()

const loading = ref(false)
const diff = ref<AiEnrichDiff | null>(null)

const applyTitle = ref(true)
const applyNotes = ref(true)
const applyCategory = ref(true)
const applyAttributes = ref(true)

const targetBookmark = computed(() => {
  if (!ui.aiEnrichTargetBmId) return null
  return ds.bookmarkMap[ui.aiEnrichTargetBmId] || null
})

watch(
  () => ui.modals.aiEnrich,
  async (open) => {
    if (open && targetBookmark.value) {
      loading.value = true
      applyTitle.value = true
      applyNotes.value = true
      applyCategory.value = true
      applyAttributes.value = true
      try {
        diff.value = await enrichBookmarkMetadata(
          targetBookmark.value,
          ds.categories,
          ds.customAttributes
        )
      } finally {
        loading.value = false
      }
    } else {
      diff.value = null
      loading.value = false
    }
  }
)

const suggestedCategoryName = computed(() => {
  if (!diff.value?.suggestedCategoryId) return ''
  return ds.categoryMap[diff.value.suggestedCategoryId]?.name || ''
})

const suggestedTagNames = computed(() => {
  if (!diff.value?.suggestedAttrIds?.length) return []
  return diff.value.suggestedAttrIds
    .map(id => ds.attributeMap[id]?.name)
    .filter(Boolean) as string[]
})

const hasSelection = computed(() => {
  if (!diff.value) return false
  return (
    (applyTitle.value && !!diff.value.suggestedTitle) ||
    (applyNotes.value && !!diff.value.suggestedNotes) ||
    (applyCategory.value && !!diff.value.suggestedCategoryId) ||
    (applyAttributes.value && suggestedTagNames.value.length > 0)
  )
})

function close() {
  ui.modals.aiEnrich = false
}

/** 用户主动确认采纳：精准落盘，决不乱改其他字段 */
function onApplyDiff() {
  if (!targetBookmark.value || !diff.value) return

  const updates: Record<string, any> = {}

  if (applyTitle.value && diff.value.suggestedTitle) {
    updates.title = diff.value.suggestedTitle
  }
  if (applyNotes.value && diff.value.suggestedNotes) {
    updates.notes = diff.value.suggestedNotes
  }
  if (applyCategory.value && diff.value.suggestedCategoryId) {
    updates.categoryId = diff.value.suggestedCategoryId
  }
  if (applyAttributes.value && diff.value.suggestedAttrIds.length) {
    const mergedAttrs = { ...(targetBookmark.value.attributes || {}) }
    for (const aid of diff.value.suggestedAttrIds) {
      mergedAttrs[aid] = true
    }
    updates.attributes = mergedAttrs
  }

  ds.updateBookmark(targetBookmark.value.id, updates)
  toast(t('ai.enrichAppliedSuccess'), true)
  close()
}
</script>

<style scoped>
.ai-enrich-modal {
  max-width: 540px;
}
.ai-title-badge {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  letter-spacing: 0.05em;
}
.ai-enrich-body {
  padding: 16px 20px;
  max-height: 70vh;
  overflow-y: auto;
}
.ai-enrich-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 36px 0;
  color: var(--text-muted);
  font-size: 0.82rem;
}
.ai-diff-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ai-diff-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--surface-hover);
  padding: 8px 12px;
  border-radius: var(--radius-md);
}
.ai-diff-tip svg {
  width: 14px;
  height: 14px;
  color: var(--accent);
}
.ai-diff-card {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface);
  overflow: hidden;
}
.ai-diff-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-hover);
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  user-select: none;
}
.ai-chk {
  cursor: pointer;
}
.ai-field-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text);
}
.ai-diff-content {
  padding: 10px 12px;
  font-size: 0.78rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ai-diff-row {
  display: flex;
  gap: 6px;
  line-height: 1.4;
}
.ai-diff-row.current {
  color: var(--text-muted);
}
.ai-diff-row.suggested {
  color: var(--text);
}
.ai-label-muted {
  color: var(--text-muted);
  font-size: 0.72rem;
  flex-shrink: 0;
}
.ai-val-highlight {
  color: var(--accent);
  font-weight: 600;
}
.ai-notes-preview {
  background: var(--surface-hover);
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  color: var(--text);
  line-height: 1.5;
  width: 100%;
}
.ai-cat-tag {
  background: var(--surface-hover);
  border: 1px solid var(--border);
  color: var(--text);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ai-cat-tag svg {
  width: 12px;
  height: 12px;
}
.ai-tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
</style>
