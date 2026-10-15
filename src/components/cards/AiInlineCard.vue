<template>
  <div class="ai-inline-card" :class="{ 'is-added': isAdded }">
    <!-- 左侧可点击区域：跳转至目标网站 -->
    <div class="inline-card-left" :title="t('cards.openLink')" @click="openUrl">
      <div class="inline-card-logo">
        <img
          v-if="faviconSrc && !imgFailed"
          :src="faviconSrc"
          alt=""
          loading="lazy"
          @error="imgFailed = true"
        >
        <span v-else class="inline-logo-fallback">{{ candidate.title.charAt(0) || '?' }}</span>
      </div>
      <div class="inline-card-info">
        <div class="inline-title-row">
          <span class="inline-title">{{ candidate.title }}</span>
          <span v-if="candidate.tag" class="inline-pill inline-pill-tag">{{ candidate.tag }}</span>
          <span v-if="categoryName" class="inline-pill inline-pill-cat">{{ categoryName }}</span>
        </div>
        <div class="inline-domain-row">
          <span class="inline-domain">{{ domainStr }}</span>
          <span class="inline-ext-icon" aria-hidden="true" v-html="I.external"></span>
        </div>
      </div>
    </div>

    <!-- 右侧动作：微型存入按钮 -->
    <div class="inline-card-right">
      <button
        v-if="!isAdded"
        class="inline-save-btn"
        :title="t('ai.quickAddTooltip')"
        @click.stop="saveToVault"
      >
        <span class="inline-btn-icon" aria-hidden="true" v-html="I.plus"></span>
        <span>{{ t('ai.quickAdd') }}</span>
      </button>
      <span v-else class="inline-saved-badge">
        <span class="inline-btn-icon" aria-hidden="true" v-html="I.check"></span>
        <span>{{ t('ai.saved') }}</span>
      </span>
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
import { candidateToBookmark } from '../../lib/ai/candidateSave.js'
import { saveAppData } from '../../stores/app.js'

const props = defineProps<{
  candidate: AiCandidateBookmark
}>()

const emit = defineEmits<{
  (e: 'saved', candidate: AiCandidateBookmark): void
}>()

const ds = useDataStore()
const imgFailed = ref(false)

const domainStr = computed(() => {
  return domain(props.candidate.url) || props.candidate.url
})

const faviconSrc = computed(() => {
  if (props.candidate.icon) return props.candidate.icon
  return favicon(props.candidate.url)
})

const categoryName = computed(() => {
  if (!props.candidate.categoryId) return ''
  const cat = ds.categories.find(c => c.id === props.candidate.categoryId)
  return cat ? cat.name : ''
})

const localSaved = ref(false)

const isAdded = computed(() => {
  if (localSaved.value || props.candidate.isAdded) return true
  const cleanTarget = fixUrl(props.candidate.url).toLowerCase().replace(/\/+$/, '')
  return ds.bookmarks.some(b => {
    if (b.deletedAt) return false
    const u = fixUrl(b.url).toLowerCase().replace(/\/+$/, '')
    return u === cleanTarget
  })
})

function openUrl() {
  const url = fixUrl(props.candidate.url)
  window.open(url, '_blank', 'noopener,noreferrer')
}

function saveToVault() {
  if (isAdded.value) return

  const bm = candidateToBookmark(ds, props.candidate, props.candidate.icon)
  ds.addBookmark(bm)
  saveAppData()
  localSaved.value = true

  emit('saved', props.candidate)
  toast(t('ai.savedToast', { title: props.candidate.title }), true)
}
</script>

<style scoped>
.ai-inline-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 11px;
  margin: 6px 0;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm, 6px);
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.02);
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.ai-inline-card:hover {
  border-color: var(--border);
  background: var(--surface-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(44, 40, 36, 0.04);
}

.ai-inline-card.is-added {
  border-color: color-mix(in srgb, var(--green) 35%, var(--border-light));
  background: color-mix(in srgb, var(--green) 4%, var(--surface));
}

.inline-card-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
  cursor: pointer;
}

.inline-card-logo {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  overflow: hidden;
}

.inline-card-logo img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.inline-logo-fallback {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}

.inline-card-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.inline-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.inline-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.15px;
  transition: color 0.12s ease;
}

.inline-card-left:hover .inline-title {
  color: var(--accent);
}

.inline-pill {
  font-size: 9.5px;
  padding: 0 5px;
  border-radius: 3px;
  white-space: nowrap;
  line-height: 1.4;
}

.inline-pill-tag {
  background: var(--surface-active);
  color: var(--text-muted);
}

.inline-pill-cat {
  background: var(--accent-light);
  color: var(--accent);
  font-weight: 500;
}

.inline-domain-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.inline-domain {
  font-size: 10.5px;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.inline-ext-icon {
  display: inline-flex;
  opacity: 0.5;
  transition: opacity 0.12s ease;
}

.inline-ext-icon :deep(svg) {
  width: 9px;
  height: 9px;
}

.inline-card-left:hover .inline-ext-icon {
  opacity: 0.9;
}

.inline-card-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.inline-save-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.02);
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.inline-save-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
  transform: translateY(-0.5px);
}

.inline-save-btn:active {
  transform: translateY(0) scale(0.96);
}

.inline-btn-icon :deep(svg) {
  width: 10px;
  height: 10px;
}

.inline-saved-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--green);
  padding: 2px 7px;
  border-radius: var(--radius-xs, 4px);
  background: var(--green-light);
  border: 1px solid color-mix(in srgb, var(--green) 20%, transparent);
}
</style>
