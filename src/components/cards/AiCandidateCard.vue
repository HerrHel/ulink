<template>
  <div class="card ai-candidate-card" :class="{ 'is-added': isItemAdded }">
    <div class="card-topline">
      <div class="card-toprow">
        <div class="card-logo" :title="candidate.title" @click.stop="openUrl">
          <img :src="faviconSrc" alt="" loading="lazy" decoding="async" @error="onFaviconError">
          <span v-if="imgFailed" class="card-logo-fallback">{{ candidate.title.charAt(0) || '?' }}</span>
        </div>
        <div class="card-titlewrap" @click.stop="openUrl">
          <div class="card-titlewrap-text">
            <div class="card-name">
              <span>{{ candidate.title }}</span>
              <span v-if="candidate.tag" class="ai-card-tag">{{ candidate.tag }}</span>
            </div>
            <div class="card-domain">{{ domainStr }}</div>
          </div>
          <span class="card-open-hint" aria-hidden="true" v-html="I.external" :title="t('cards.openLink')"></span>
        </div>
        <!-- 核心交互：一键零摩擦秒存按钮 -->
        <div class="ai-card-action">
          <button
            v-if="!isItemAdded"
            class="btn btn-primary btn-xs ai-save-btn"
            :title="t('ai.quickAddTooltip')"
            @click.stop="saveToVault"
          >
            <span aria-hidden="true" v-html="I.plus"></span>
            <span>{{ t('ai.quickAdd') }}</span>
          </button>
          <button
            v-else
            class="btn btn-ghost btn-xs ai-saved-btn"
            disabled
          >
            <span aria-hidden="true" v-html="I.check"></span>
            <span>{{ t('ai.saved') }}</span>
          </button>
        </div>
      </div>
      <!-- 预匹配的分类与属性胶囊（零手动配置） -->
      <div class="card-tags ai-tags-row">
        <span v-if="categoryName" class="card-tag ai-cat-tag">
          <span aria-hidden="true" v-html="I.folder"></span>
          {{ categoryName }}
        </span>
        <span v-for="tag in tagNames" :key="tag" class="card-tag tag-custom">{{ tag }}</span>
      </div>
    </div>

    <!-- 备注说明与核心亮点 -->
    <div class="card-body">
      <div v-if="candidate.highlight" class="ai-highlight-bar">
        <span class="ai-sparkle-dot"></span>
        <span>{{ candidate.highlight }}</span>
      </div>
      <div class="card-notes" v-if="candidate.notes">
        {{ candidate.notes }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { AiCandidateBookmark } from '../../types/ai.js'
import { useDataStore } from '../../stores/data.js'
import { favicon, domain, fixUrl } from '../../utils.js'
import { toast } from '../../lib/toast.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

const props = defineProps<{
  candidate: AiCandidateBookmark
  targetGroupId?: string | null
}>()

const emit = defineEmits<{
  (e: 'added', candidate: AiCandidateBookmark): void
}>()

const ds = useDataStore()
const imgFailed = ref(false)
const isLocalAdded = ref(false)
const isItemAdded = computed(() => isLocalAdded.value || !!props.candidate.isAdded)

const domainStr = computed(() => domain(props.candidate.url))
const faviconSrc = computed(() => favicon(props.candidate.url))

function onFaviconError(e: Event) {
  imgFailed.value = true
  ;(e.target as HTMLElement).style.display = 'none'
}

function openUrl() {
  const safe = fixUrl(props.candidate.url)
  if (safe) window.open(safe, '_blank')
}

const categoryName = computed(() => {
  if (!props.candidate.categoryId || props.candidate.categoryId === CAT_UNCATEGORIZED) return ''
  return ds.categoryMap[props.candidate.categoryId]?.name || ''
})

const tagNames = computed(() => {
  if (!props.candidate.suggestedAttrIds?.length) return []
  return props.candidate.suggestedAttrIds
    .map(id => ds.attributeMap[id]?.name)
    .filter(Boolean) as string[]
})

/**
 * 零摩擦秒级入库：直接调用 dataStore，无需再次弹窗确认
 */
function saveToVault() {
  if (isItemAdded.value) return

  const attrObj: Record<string, boolean> = {}
  if (props.candidate.suggestedAttrIds?.length) {
    for (const aid of props.candidate.suggestedAttrIds) {
      attrObj[aid] = true
    }
  }

  const finalCatId = props.candidate.categoryId || CAT_UNCATEGORIZED

  const newBm = ds.addBookmark({
    title: props.candidate.title,
    url: fixUrl(props.candidate.url),
    notes: props.candidate.notes,
    categoryId: finalCatId,
    attributes: attrObj,
    icon: faviconSrc.value,
  })

  // 如果是在组上下文中提取，则直接归入目标组
  if (props.targetGroupId) {
    ds.addBookmarkToGroup(newBm.id, props.targetGroupId)
  }

  isLocalAdded.value = true
  emit('added', { ...props.candidate, isAdded: true })

  const catHint = categoryName.value ? ` -> 「${categoryName.value}」` : ''
  toast(t('ai.saveSuccessToast', { title: props.candidate.title }) + catHint, true)
}
</script>

<style scoped>
.ai-candidate-card {
  position: relative;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  border: 1px solid var(--border);
  background: var(--surface);
  margin-bottom: 10px;
}
.ai-candidate-card:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}
.ai-candidate-card.is-added {
  border-color: var(--border-light);
  opacity: 0.85;
  background: var(--surface-hover);
}
.ai-card-action {
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.ai-save-btn {
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ai-save-btn svg {
  width: 13px;
  height: 13px;
}
.ai-saved-btn {
  font-weight: 600;
  color: var(--accent);
  cursor: default;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ai-saved-btn svg {
  width: 13px;
  height: 13px;
}
.ai-card-tag {
  font-size: 0.68rem;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--accent-light);
  color: var(--accent);
  font-weight: 600;
  white-space: nowrap;
}
.ai-tags-row {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ai-cat-tag {
  background: var(--surface-hover);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ai-cat-tag svg {
  width: 11px;
  height: 11px;
}
.ai-highlight-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.73rem;
  color: var(--accent);
  font-weight: 600;
  margin-bottom: 4px;
  line-height: 1.4;
}
.ai-sparkle-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}
</style>
