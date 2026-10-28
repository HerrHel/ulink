<template>
  <div
    class="modal-mask"
    role="dialog"
    aria-modal="true"
    :aria-label="t('ai.enrichModalTitle')"
    :class="{ open: ui.modals.aiEnrich }"
    @mousedown="onMaskMouseDown" @click="onMaskClick"
  >
    <div class="modal modal-md ai-enrich-modal" @click.stop>
      <div class="modal-head">
        <div class="modal-title">
          <span class="ai-title-badge" :class="{ 'badge-pro': quota.isPro }">
            {{ quota.isPro ? 'PRO' : t('settings.aiEnrichFreeTrialBadge', { remaining: quota.remaining, total: quota.total }) }}
          </span>
          <span>{{ t('ai.enrichModalTitle') }}</span>
        </div>
        <button class="modal-close" @click="close" :title="t('common.close')" v-html="I.close"></button>
      </div>

      <div class="modal-body ai-enrich-body">
        <div v-if="!quota.allowed" class="empty empty-compact ai-quota-exhausted-box">
          <div class="ai-quota-badge">PRO 会员专享</div>
          <p class="ai-quota-title" style="font-weight: 700; margin-bottom: 6px; font-size: var(--fs-md);">
            {{ t('settings.aiEnrichExhaustedTitle') }}
          </p>
          <p class="ai-quota-desc" style="color: var(--text-secondary); font-size: var(--fs-sm); line-height: 1.5; max-width: 380px; margin: 0 auto;">
            {{ t('settings.aiEnrichExhaustedDesc') }}
          </p>
          <button type="button" class="btn btn-primary btn-sm" style="margin-top: 14px;" @click="openUpgrade">
            {{ t('settings.aiEnrichUpgradeNow') }}
          </button>
        </div>

        <div v-else-if="!ui.smartFillEnabled" class="empty empty-compact">
          <p>{{ t('ai.smartFillDisabledModal') }}</p>
          <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 10px;" @click="enableSmartFill">
            {{ t('ai.enableSmartFillNow') }}
          </button>
        </div>

        <div v-else-if="loading" class="ai-enrich-loading">
          <div class="ai-spinner"></div>
          <span>{{ t('ai.enrichAnalyzing') }}</span>
        </div>

        <div v-else-if="diff && targetBookmark && hasAnyDiff" class="ai-diff-container">
          <div class="ai-diff-tip">
            <span aria-hidden="true" v-html="I.sparkle || I.plus"></span>
            <span>{{ diff.reason || t('ai.enrichDiffTip') }}</span>
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
          <div v-if="diff.suggestedNotes && diff.suggestedNotes !== diff.currentNotes" class="ai-diff-card">
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
          :disabled="loading || !hasSelection || !ui.smartFillEnabled"
          @click="onApplyDiff"
        >
          {{ t('ai.applyEnrich') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'
import type { AiEnrichDiff } from '../../types/ai.js'
import { enrichBookmarkMetadata } from '../../lib/ai/cloudAiClient.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'

const ui = useUIStore()
const ds = useDataStore()
const ent = useEntitlement()
const quota = computed(() => ent.checkAiEnrichQuota())

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

async function fetchEnrich() {
  if (!ui.modals.aiEnrich || !targetBookmark.value || !ui.smartFillEnabled) return
  if (!quota.value.allowed) return
  loading.value = true
  diff.value = null
  try {
    const result = await enrichBookmarkMetadata(
      targetBookmark.value,
      ds.categories,
      ds.customAttributes
    )
    diff.value = result
    ent.consumeAiEnrichQuota()
    applyTitle.value = !!result.suggestedTitle
    applyNotes.value = !!(result.suggestedNotes && result.suggestedNotes !== result.currentNotes)
    applyCategory.value = !!result.suggestedCategoryId
    applyAttributes.value = (result.suggestedAttrIds?.length || 0) > 0
  } catch {
    diff.value = null
  } finally {
    loading.value = false
  }
}

function openUpgrade() {
  close()
  ui.openPurchase()
}

function enableSmartFill() {
  ui.smartFillEnabled = true
  ui.saveUIState()
  toast(t('settings.smartFillOnToast'), true)
  void fetchEnrich()
}

onMounted(() => {
  if (ui.modals.aiEnrich && targetBookmark.value) {
    void fetchEnrich()
  }
})

watch(
  [() => ui.modals.aiEnrich, () => ui.aiEnrichTargetBmId],
  ([open, bmId]) => {
    if (open && bmId) {
      void fetchEnrich()
    } else if (!open) {
      diff.value = null
      loading.value = false
    }
  },
  { immediate: true }
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

const hasAnyDiff = computed(() => {
  if (!diff.value) return false
  return !!(
    diff.value.suggestedTitle ||
    (diff.value.suggestedNotes && diff.value.suggestedNotes !== diff.value.currentNotes) ||
    diff.value.suggestedCategoryId ||
    suggestedTagNames.value.length > 0
  )
})

const hasSelection = computed(() => {
  if (!diff.value) return false
  return (
    (applyTitle.value && !!diff.value.suggestedTitle) ||
    (applyNotes.value && !!diff.value.suggestedNotes && diff.value.suggestedNotes !== diff.value.currentNotes) ||
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
  if (applyNotes.value && diff.value.suggestedNotes && diff.value.suggestedNotes !== diff.value.currentNotes) {
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
  toast(t('ai.enrichSuccessToast'), true)
  close()
}

// 遮罩关闭统一走 useMaskClose：只有「在遮罩上按下、又在遮罩上松开」才算点击外部。
// 裸 @click.self 的坑：在弹窗内按下、滑到遮罩上松开时，click 事件的 target 是两者的
// 共同祖先（遮罩），.self 判定照样通过 -> 误关闭，正在填的内容全丢。
const { onMaskMouseDown, onMaskClick } = useMaskClose(close)
</script>

<style scoped>
.ai-enrich-modal {
  max-width: 540px;
}
.ai-title-badge {
  font-size:var(--fs-2xs);
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
  font-size:var(--fs-sm);
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
  font-size:var(--fs-xs);
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
  font-size:var(--fs-sm);
  font-weight: 600;
  color: var(--text);
}
.ai-diff-content {
  padding: 10px 12px;
  font-size:var(--fs-sm);
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
  font-size:var(--fs-2xs);
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
  font-size:var(--fs-xs);
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
.ai-quota-exhausted-box {
  padding: 32px 16px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.ai-quota-badge {
  display: inline-block;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  background: var(--accent-light);
  color: var(--accent);
  font-size: var(--fs-2xs);
  font-weight: 700;
  margin-bottom: 12px;
}
</style>
