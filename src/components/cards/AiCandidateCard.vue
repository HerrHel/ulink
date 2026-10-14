<template>
  <div class="card ai-candidate-card" :class="{ 'is-added': isItemAdded }">
    <!-- 顶部行：Logo + 标题 + 域名 + 悬停外链提示 -->
    <div class="card-topline">
      <div class="card-toprow">
        <div class="card-logo" :title="t('cards.openLink')" @click.stop="openUrl">
          <img
            :src="faviconSrc"
            alt=""
            loading="lazy"
            decoding="async"
            :class="{ 'img-loaded': imgLoaded }"
            @load="imgLoaded = true"
            @error="onFaviconError"
          >
          <span v-if="imgFailed || !imgLoaded" class="card-logo-fallback">
            {{ candidate.title.charAt(0) || '?' }}
          </span>
        </div>
        <div class="card-titlewrap" :title="t('cards.openLink')" @click.stop="openUrl">
          <div class="card-titlewrap-text">
            <div class="card-name">
              <span>{{ candidate.title }}</span>
              <span v-if="candidate.tag" class="card-tag tag-custom ai-tag-pill">{{ candidate.tag }}</span>
            </div>
            <div class="card-domain">{{ domainStr }}</div>
          </div>
          <span class="card-open-hint" aria-hidden="true" v-html="I.external"></span>
        </div>
      </div>
    </div>

    <!-- 卡片主体：标签胶囊 + 亮点条 + 备注说明 -->
    <div class="card-body">
      <!-- 预匹配的分类与属性标签 -->
      <div class="card-tags" v-if="categoryName || tagNames.length">
        <span v-if="categoryName" class="card-tag tag-custom ai-cat-pill">
          <span aria-hidden="true" v-html="I.folder"></span>
          {{ categoryName }}
        </span>
        <span v-for="tag in tagNames" :key="tag" class="card-tag tag-custom">{{ tag }}</span>
      </div>

      <!-- AI 提炼的核心亮点 -->
      <div v-if="candidate.highlight" class="ai-highlight-bar">
        <span class="ai-highlight-label">{{ t('ai.highlightLabel') }}</span>
        <span class="ai-highlight-text">{{ candidate.highlight }}</span>
      </div>

      <!-- 网站详细功能备注 -->
      <div class="card-notes" v-if="candidate.notes">
        {{ candidate.notes }}
      </div>
    </div>

    <!-- 底部操作栏：对齐主站宫格卡片的 card-foot 规格 -->
    <div class="card-foot">
      <div class="card-stat">
        <span v-if="isItemAdded" class="ai-stat-saved">
          <span aria-hidden="true" v-html="I.check"></span>
          {{ t('ai.saved') }}
        </span>
        <span v-else class="ai-stat-source">
          <svg class="ai-sparkle" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" />
          </svg>
          <span>{{ t('ai.curated') }}</span>
        </span>
      </div>
      <div class="card-actions">
        <button
          v-if="!isItemAdded"
          class="ai-action-btn ai-btn-add"
          :title="t('ai.quickAddTooltip')"
          @click.stop="saveToVault"
        >
          <span aria-hidden="true" v-html="I.plus"></span>
          <span>{{ t('ai.quickAdd') }}</span>
        </button>
        <button
          v-else
          class="ai-action-btn ai-btn-saved"
          disabled
        >
          <span aria-hidden="true" v-html="I.check"></span>
          <span>{{ t('ai.saved') }}</span>
        </button>
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
import { candidateToBookmark } from '../../lib/ai/candidateSave.js'
import { saveAppData } from '../../stores/app.js'
import { addToGroupDirect } from '../../composables/domain/useGroup.js'

const props = defineProps<{
  candidate: AiCandidateBookmark
  targetGroupId?: string | null
}>()

const emit = defineEmits<{
  (e: 'added', candidate: AiCandidateBookmark): void
}>()

const ds = useDataStore()
const imgFailed = ref(false)
const imgLoaded = ref(false)
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
 * 零摩擦秒级入库：候选 → 完整 Bookmark 走统一构造器，落盘持久化
 */
function saveToVault() {
  if (isItemAdded.value) return

  const newBm = candidateToBookmark(ds, props.candidate, faviconSrc.value)
  ds.addBookmark(newBm)

  // 组上下文中提取：走 useGroup 标准入组链路（去重 + 编辑器同步 + 落盘）
  if (props.targetGroupId) {
    addToGroupDirect(newBm.id, props.targetGroupId)
  } else {
    saveAppData()
  }

  isLocalAdded.value = true
  emit('added', { ...props.candidate, isAdded: true })

  const msg = categoryName.value
    ? t('ai.saveSuccessToastInCat', { title: props.candidate.title, cat: categoryName.value })
    : t('ai.saveSuccessToast', { title: props.candidate.title })
  toast(msg, true)
}
</script>

<style scoped>
/* 候选卡片：100% 继承主站大宫格卡片骨架与美学标准 */
.ai-candidate-card {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-card);
  padding: 13px 14px 10px;
  cursor: default;
  height: auto;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  transition: box-shadow 0.25s var(--ease-out), border-color 0.2s ease, transform 0.25s var(--ease-out), background-color 0.2s ease;
  margin: 0;
}

@media (hover: hover) and (pointer: fine) {
  .ai-candidate-card:hover {
    border-color: var(--border-hover);
    box-shadow: var(--shadow-card-hover);
    transform: translateY(-2px);
  }
}

.ai-candidate-card.is-added {
  border-color: var(--border-light);
  background: var(--surface);
}

/* 顶部信息行 */
.card-topline {
  flex-shrink: 0;
  z-index: 2;
  background: transparent;
}

.card-toprow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 6px;
}

/* 主站统一规范的 Logo 容器 */
.card-logo {
  flex-shrink: 0;
  cursor: pointer;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt);
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--border-light);
  overflow: hidden;
  position: relative;
  transition: border-color 0.2s ease, transform 0.25s var(--ease-spring), box-shadow 0.2s ease;
}

@media (hover: hover) and (pointer: fine) {
  .card-logo:hover {
    border-color: var(--accent);
    transform: scale(1.08);
    box-shadow: 0 2px 8px var(--accent-glow);
    z-index: 2;
  }
}

.card-logo img {
  width: 26px;
  height: 26px;
  object-fit: contain;
  opacity: 0;
  transition: opacity 0.2s var(--ease-out);
}

.card-logo img.img-loaded {
  opacity: 1;
}

.card-logo-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent);
  text-transform: uppercase;
  user-select: none;
}

/* 标题区：整行自由舒展，不被右侧生硬按钮挤压 */
.card-titlewrap {
  flex: 1;
  min-width: 0;
  height: 38px;
  overflow: hidden;
  cursor: pointer;
  padding: 0 4px;
  margin: 0 -4px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  border-radius: var(--radius-sm, 6px);
  transition: background 0.15s ease;
}

@media (hover: hover) and (pointer: fine) {
  .card-titlewrap:hover {
    background: var(--accent-light);
  }
  .card-titlewrap:hover .card-name {
    color: var(--accent);
  }
  .card-titlewrap:hover .card-open-hint {
    display: block;
  }
}

.card-titlewrap-text {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
}

.card-name {
  font-weight: 600;
  font-size: 0.9rem;
  line-height: 18px;
  letter-spacing: -0.01em;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 5px;
}

.card-domain {
  font-family: var(--font-mono, monospace);
  font-size: 0.72rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 16px;
  letter-spacing: 0.02em;
}

.card-open-hint {
  flex-shrink: 0;
  display: none;
  width: 14px;
  height: 14px;
  color: var(--accent);
  opacity: 0.85;
}

.card-open-hint svg {
  width: 14px;
  height: 14px;
  display: block;
}

/* 卡片主体 */
.card-body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 6px;
}

/* 标签行 */
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-items: center;
  overflow: hidden;
}

.card-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1.5px 6px;
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
  border-radius: var(--radius-xs, 4px);
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.tag-custom {
  background: var(--card-badge-bg, rgba(44, 40, 36, 0.05));
  color: var(--text-secondary);
  border-color: var(--border-light);
}

.ai-cat-pill {
  font-family: var(--font-sans);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
  border-color: color-mix(in srgb, var(--accent) 18%, transparent);
}

.ai-cat-pill svg {
  width: 11px;
  height: 11px;
}

.ai-tag-pill {
  font-size: 0.68rem;
  padding: 0.5px 5px;
}

/* AI 提炼特色（HIGHLIGHT 亮点胶囊条） */
.ai-highlight-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  background: color-mix(in srgb, var(--accent) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: var(--radius-xs, 4px);
  padding: 2.5px 6px;
  line-height: 1.35;
}

.ai-highlight-label {
  font-family: var(--font-mono, monospace);
  font-size: 9px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.5px;
  flex-shrink: 0;
}

.ai-highlight-text {
  font-size: 11px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 网站备注 */
.card-notes {
  font-size: 0.8rem;
  color: var(--text-muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 底部操作栏：完美契合主站宫格卡片的底栏质感 */
.card-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 7px;
  border-top: 1px solid var(--border-light);
  background: transparent;
  transition: border-color 0.2s ease;
}

.ai-candidate-card:hover .card-foot {
  border-color: var(--border-hover);
}

.card-stat {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  color: var(--text-muted);
  user-select: none;
}

.ai-stat-source {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-weight: 500;
  color: var(--text-muted);
}

.ai-sparkle {
  display: block;
  color: var(--accent);
}

.ai-stat-saved {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--green);
  font-weight: 600;
}

.ai-stat-saved svg {
  width: 12px;
  height: 12px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  height: 22px;
  border-radius: var(--radius-sm, 6px);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  border: none;
}

.ai-btn-add {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--accent) 22%, transparent);
}

.ai-btn-add:hover {
  background: var(--accent-dark);
  transform: translateY(-1px);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 30%, transparent);
}

.ai-btn-add:active {
  transform: translateY(0) scale(0.96);
}

.ai-btn-add svg {
  width: 11px;
  height: 11px;
}

.ai-btn-saved {
  background: var(--green-light);
  color: var(--green);
  border: 1px solid color-mix(in srgb, var(--green) 25%, transparent);
  cursor: default;
}

.ai-btn-saved svg {
  width: 11px;
  height: 11px;
}
</style>
