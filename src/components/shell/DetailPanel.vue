<template>
  <div
    ref="detailPanelRef"
    class="detail-panel"
    :class="{ open: isOpen, swiping: isSwiping }"
    :style="translateY ? { transform: `translateY(${translateY}px)` } : undefined"
    id="detailPanel"
  >
    <div class="detail-drag-handle" id="detailDragHandle"></div>

    <!-- 顶部功能栏与模式切换 -->
    <div class="detail-top-bar">
      <div v-if="entries.length" class="detail-tab-group">
        <button
          class="detail-tab-btn"
          :class="{ active: currentTab === 'ai' }"
          @click="currentTab = 'ai'"
        >
          <span class="detail-sparkle-icon">✨</span>
          <span>{{ t('ai.tabInsight') }}</span>
        </button>
        <button
          class="detail-tab-btn"
          :class="{ active: currentTab === 'cards' }"
          @click="currentTab = 'cards'"
        >
          <span>{{ t('ai.tabCards') }}</span>
          <span class="detail-tab-badge">{{ entries.length }}</span>
        </button>
      </div>
      <div v-else class="detail-panel-title">
        <span class="detail-sparkle-icon">✨</span>
        <span>{{ t('ai.sidebarTitle') }}</span>
      </div>

      <div class="detail-top-actions">
        <button
          v-if="currentTab === 'ai' && aiCandidates.length > 0"
          class="btn btn-ghost btn-xs"
          @click="clearAiResults"
        >
          {{ t('ai.sidebarClear') }}
        </button>
        <button
          class="detail-close-panel-btn"
          @click="closeEntirePanel"
          :title="t('common.close')"
        >
          &times;
        </button>
      </div>
    </div>

    <!-- 中间滚动内容流 -->
    <div class="detail-inner" id="detailInner">
      <!-- 模式 1: AI 智能副驾视图 -->
      <template v-if="currentTab === 'ai'">
        <!-- 偏好选择器胶囊 -->
        <div class="detail-pref-row">
          <AiPreferenceChips v-model="preferences" />
        </div>

        <!-- 思考与加载态 -->
        <div v-if="aiLoading" class="detail-ai-loading">
          <div class="ai-spinner"></div>
          <span>{{ t('ai.aiThinking') }}</span>
        </div>

        <!-- 候选结果列表 -->
        <div v-else-if="aiCandidates.length > 0" class="detail-candidates-wrap">
          <div class="detail-results-summary">
            <span class="summary-count">{{ t('ai.foundCount', { n: aiCandidates.length }) }}</span>
            <button
              v-if="hasUnadded"
              class="btn btn-ghost btn-xs summary-add-all"
              @click="addAllCandidates"
            >
              {{ t('ai.addAllDirect') }}
            </button>
          </div>

          <div class="detail-cards-stream">
            <AiCandidateCard
              v-for="item in aiCandidates"
              :key="item.url"
              :candidate="item"
            />
          </div>
        </div>

        <!-- 空态与快捷探索建议 -->
        <div v-else class="detail-ai-welcome">
          <div class="welcome-box">
            <div class="welcome-sparkle-badge">✨</div>
            <h4>{{ t('ai.sidebarWelcomeTitle') }}</h4>
            <p>{{ t('ai.sidebarWelcomeDesc') }}</p>
          </div>

          <!-- 针对已选卡片的平替挖掘引导（如有暂存卡片） -->
          <div v-if="activeEntry" class="detail-similar-hint-box" @click="searchSimilarForActive">
            <span class="hint-icon">🔍</span>
            <div class="hint-meta">
              <span class="hint-title">寻找「{{ activeEntry.data.title || activeEntry.data.name }}」类似平替</span>
              <span class="hint-sub">点击立即在全网挖掘替代方案</span>
            </div>
          </div>

          <!-- 快捷探索词胶囊 -->
          <div class="detail-prompts-label">{{ t('ai.searchAction') }}:</div>
          <div class="detail-prompts-cloud">
            <button
              v-for="p in QUICK_PROMPTS"
              :key="p.key"
              class="detail-prompt-chip"
              @click="quickSearch(t(p.key))"
            >
              <span class="prompt-emoji">{{ p.emoji }}</span>
              <span>{{ t(p.key) }}</span>
            </button>
          </div>
        </div>
      </template>

      <!-- 模式 2: 暂存卡片展架（100% 保留原有兼容） -->
      <template v-else>
        <template v-if="entries.length">
          <div class="card-grid grid-view detail-grid">
            <div class="card-list-inner">
              <template v-for="entry in entries" :key="entry.rawId">
                <div class="detail-card-wrap" :data-bm-id="entry.rawId" :data-didx="entry.realIdx">
                  <button class="detail-close" @click.stop="closeDetail(entry.rawId)" :title="t('common.close')">&times;</button>
                  <GroupCard v-if="entry.isGroup" :group="entry.data" detail-mode />
                  <BookmarkCard v-else :bookmark="entry.data" :default-acct-open="true" />
                </div>
              </template>
            </div>
          </div>
        </template>
        <div v-else class="empty empty-compact">
          <div class="empty-icon" v-html="bookmarkIcon"></div>
          <h3>{{ t('detail.panel') }}</h3>
          <p>{{ t('detail.dragHint') }}</p>
        </div>
      </template>
    </div>

    <!-- 侧边栏底部常驻输入框（核心用户需求） -->
    <div class="detail-bottom-input-wrap">
      <div class="detail-ai-input-bar">
        <input
          ref="aiInputRef"
          type="text"
          class="form-input detail-ai-input"
          v-model="aiQuery"
          :placeholder="t('ai.sidebarInputPlaceholder')"
          @keydown.enter="handleAiSubmit"
        />
        <button
          class="btn btn-primary detail-ai-submit"
          :disabled="aiLoading || !aiQuery.trim()"
          @click="handleAiSubmit"
          :title="t('ai.searchAction')"
        >
          <span v-if="aiLoading" class="ai-spin">⏳</span>
          <span v-else class="ai-submit-sparkle">✨</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { isMobile, domain, fixUrl } from '../../utils.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'
import BookmarkCard from '../cards/BookmarkCard.vue'
import GroupCard from '../cards/GroupCard.vue'
import AiPreferenceChips from '../ui/AiPreferenceChips.vue'
import AiCandidateCard from '../cards/AiCandidateCard.vue'
import {
  searchWebsitesByIntent,
  findSimilarWebsites,
  extractBookmarksFromVideo,
} from '../../lib/ai/cloudAiClient.js'
import { buildDetailCards } from './buildDetailCards.js'
import type { DetailEntry } from './buildDetailCards.js'
import type { AiSearchPreference, AiCandidateBookmark } from '../../types/ai.js'

const ui = useUIStore()
const ds = useDataStore()
const detailPanelRef = ref<HTMLElement | null>(null)
const aiInputRef = ref<HTMLInputElement | null>(null)

const isOpen = computed(() => ui.panels.detail || ui.detailCards.length > 0)

const entries = computed<DetailEntry[]>(() =>
  buildDetailCards(ui.detailCards, ds.groupMap, ds.bookmarkMap, domain),
)

const activeEntry = computed<DetailEntry | null>(() => {
  return entries.value.length ? entries.value[0] : null
})

// Tab 状态：有暂存卡片时可切换，默认在 AI 探宝
const currentTab = ref<'ai' | 'cards'>('ai')

// AI 交互状态
const aiQuery = ref('')
const aiLoading = ref(false)
const aiCandidates = ref<AiCandidateBookmark[]>([])
const preferences = ref<AiSearchPreference[]>(['free', 'no_proxy'])

const hasUnadded = computed(() => aiCandidates.value.some(c => !c.isAdded))

const QUICK_PROMPTS = [
  { key: 'ai.promptPrototype', emoji: '🏷️' },
  { key: 'ai.promptGallery', emoji: '🇨🇳' },
  { key: 'ai.promptWhiteboard', emoji: '🪶' },
  { key: 'ai.promptOpenNotes', emoji: '⚡' },
]

// 打开面板时自动聚焦底部输入框
watch(
  () => isOpen.value,
  (open) => {
    if (open) {
      if (!entries.value.length) {
        currentTab.value = 'ai'
      }
      nextTick(() => {
        if (currentTab.value === 'ai') {
          aiInputRef.value?.focus()
        }
      })
    }
  }
)

function clearAiResults() {
  aiCandidates.value = []
  aiQuery.value = ''
}

function closeEntirePanel() {
  ui.panels.detail = false
  ui.detailCards.splice(0)
}

function quickSearch(prompt: string) {
  aiQuery.value = prompt
  handleAiSubmit()
}

function searchSimilarForActive() {
  if (!activeEntry.value) return
  const data = activeEntry.value.data
  const url = data.url || ''
  if (!url) return
  aiQuery.value = url
  handleAiSubmit()
}

/** 核心智能处理：根据输入自动分流（视频/网址平替/意图寻站） */
async function handleAiSubmit() {
  const query = aiQuery.value.trim()
  if (!query || aiLoading.value) return

  currentTab.value = 'ai'
  aiLoading.value = true
  aiCandidates.value = []

  try {
    const isVideo = /(bilibili\.com|douyin\.com|v\.douyin|xiaohongshu\.com|xhslink\.com|youtube\.com|youtu\.be)/i.test(query)
    const isUrl = /^(https?:\/\/|[a-z0-9-]+\.[a-z]{2,})/i.test(query)

    if (isVideo) {
      const res = await extractBookmarksFromVideo(query, ds.categories, ds.customAttributes)
      aiCandidates.value = res.bookmarks
    } else if (isUrl) {
      const targetUrl = fixUrl(query)
      const res = await findSimilarWebsites(targetUrl, '', preferences.value, ds.categories, ds.customAttributes)
      aiCandidates.value = res
    } else {
      const res = await searchWebsitesByIntent(query, preferences.value, ds.categories, ds.customAttributes)
      aiCandidates.value = res
    }
  } finally {
    aiLoading.value = false
  }
}

/** 一键直接存入全部候选网站（零弹窗，全自动赋给预匹配分类） */
function addAllCandidates() {
  let count = 0
  for (const c of aiCandidates.value) {
    if (!c.isAdded) {
      const attrObj: Record<string, boolean> = {}
      if (c.suggestedAttrIds?.length) {
        for (const aid of c.suggestedAttrIds) attrObj[aid] = true
      }
      ds.addBookmark({
        title: c.title,
        url: fixUrl(c.url),
        notes: c.notes,
        categoryId: c.categoryId || 'all',
        attributes: attrObj,
      })
      c.isAdded = true
      count++
    }
  }
  toast(t('ai.addedBatchSuccess', { n: count }), true)
}

/* Swipe-to-dismiss (mobile only) */
const isSwiping = ref(false)
const translateY = ref(0)
let _swipeStartY = 0
function onSwipeStart(e: TouchEvent) {
  if (!isMobile() || !ui.panels.detail) return
  if (!(e.target as HTMLElement).closest('.detail-drag-handle')) return
  _swipeStartY = e.touches[0].clientY
}
function onSwipeMove(e: TouchEvent) {
  if (!_swipeStartY) return
  const dy = e.touches[0].clientY - _swipeStartY
  if (dy > 0) {
    e.preventDefault()
    isSwiping.value = true
    translateY.value = dy
  }
}
function onSwipeEnd() {
  if (!isSwiping.value) { _swipeStartY = 0; return }
  const panel = detailPanelRef.value
  const panelHeight = panel ? panel.offsetHeight : 300
  if (translateY.value > panelHeight * 0.3) { ui.panels.detail = false; ui.detailCards.splice(0) }
  _resetSwipe()
}
function onSwipeCancel() {
  if (isSwiping.value || _swipeStartY) _resetSwipe()
}
function _resetSwipe() {
  translateY.value = 0
  isSwiping.value = false
  _swipeStartY = 0
}

onMounted(() => {
  const el = detailPanelRef.value
  if (el) {
    el.addEventListener('touchstart', onSwipeStart, { passive: true })
    el.addEventListener('touchmove', onSwipeMove, { passive: false })
    el.addEventListener('touchend', onSwipeEnd)
    el.addEventListener('touchcancel', onSwipeCancel)
  }
})
onUnmounted(() => {
  const el = detailPanelRef.value
  if (el) {
    el.removeEventListener('touchstart', onSwipeStart)
    el.removeEventListener('touchmove', onSwipeMove)
    el.removeEventListener('touchend', onSwipeEnd)
    el.removeEventListener('touchcancel', onSwipeCancel)
  }
})

const bookmarkIcon = I.emptyBookmark

function closeDetail(rawId: string) {
  const idx = ui.detailCards.indexOf(rawId)
  if (idx > -1) ui.detailCards.splice(idx, 1)
  if (!ui.detailCards.length) ui.panels.detail = false
}
</script>

<style scoped>
.detail-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

/* 顶部功能栏 */
.detail-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--border-light, #eee);
  background: var(--surface, #fff);
  flex-shrink: 0;
  user-select: none;
}

.detail-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text, #333);
}

.detail-sparkle-icon {
  font-size: 14px;
  color: var(--accent, #e65c00);
}

.detail-tab-group {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-alt, #f3f3f3);
  padding: 2px;
  border-radius: var(--radius-base, 8px);
}

.detail-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.15s ease;
}

.detail-tab-btn.active {
  background: var(--surface, #fff);
  color: var(--text, #111);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.detail-tab-badge {
  background: var(--accent-light, rgba(230, 92, 0, 0.12));
  color: var(--accent, #e65c00);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 9999px;
  font-weight: 700;
}

.detail-top-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-close-panel-btn {
  border: none;
  background: transparent;
  color: var(--text-muted, #999);
  font-size: 18px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.15s ease;
}
.detail-close-panel-btn:hover {
  background: var(--surface-hover, #f5f5f5);
  color: var(--text, #111);
}

/* 偏好胶囊 */
.detail-pref-row {
  margin-bottom: 12px;
}

/* AI 思考中 */
.detail-ai-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 16px;
  color: var(--text-secondary, #666);
  font-size: 12.5px;
}

.ai-spinner {
  width: 24px;
  height: 24px;
  border: 2.5px solid var(--border-light, #eee);
  border-top-color: var(--accent, #e65c00);
  border-radius: 50%;
  animation: detail-spin 0.8s linear infinite;
}

@keyframes detail-spin {
  to { transform: rotate(360deg); }
}

/* 结果摘要条 */
.detail-results-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  padding: 0 2px;
}
.summary-count {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted, #888);
}
.summary-add-all {
  color: var(--accent, #e65c00);
  font-weight: 600;
}

/* 欢迎态与建议胶囊 */
.detail-ai-welcome {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 8px 0;
}

.welcome-box {
  background: var(--surface-alt, #faf8f5);
  border: 1px dashed var(--border, #e5ddd3);
  border-radius: var(--radius-md, 10px);
  padding: 16px 14px;
  text-align: center;
}

.welcome-sparkle-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--accent-light, rgba(230, 92, 0, 0.1));
  color: var(--accent, #e65c00);
  border-radius: 50%;
  font-size: 16px;
  margin-bottom: 8px;
}

.welcome-box h4 {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text, #333);
  margin-bottom: 4px;
}

.welcome-box p {
  font-size: 11.5px;
  color: var(--text-muted, #777);
  line-height: 1.5;
  margin: 0;
}

/* 针对当前选中的类似平替推荐条 */
.detail-similar-hint-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--surface, #fff);
  border: 1px solid var(--accent, #e65c00);
  border-radius: var(--radius-md, 10px);
  cursor: pointer;
  transition: all 0.15s ease;
}
.detail-similar-hint-box:hover {
  background: var(--accent-light, rgba(230, 92, 0, 0.05));
  transform: translateY(-1px);
}
.hint-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.hint-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.hint-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text, #222);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hint-sub {
  font-size: 10.5px;
  color: var(--text-muted, #888);
}

.detail-prompts-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted, #888);
  margin-top: 4px;
}

.detail-prompts-cloud {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-prompt-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface, #fff);
  border: 1px solid var(--border-light, #eee);
  border-radius: var(--radius-md, 10px);
  font-size: 12px;
  color: var(--text-secondary, #444);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}
.detail-prompt-chip:hover {
  border-color: var(--accent, #e65c00);
  color: var(--accent, #e65c00);
  background: var(--surface-hover, #fafafa);
  transform: translateX(2px);
}
.prompt-emoji {
  font-size: 14px;
  flex-shrink: 0;
}

/* 侧边栏底部固定输入框（吸底常驻） */
.detail-bottom-input-wrap {
  flex-shrink: 0;
  padding: 10px 14px 12px;
  background: var(--surface, #fff);
  border-top: 1px solid var(--border-light, #eee);
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.03);
  z-index: 10;
}

.detail-ai-input-bar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-ai-input {
  flex: 1;
  min-width: 0;
  border-radius: var(--radius-full, 9999px) !important;
  padding: 6px 14px !important;
  font-size: 12.5px !important;
  border: 1px solid var(--border, #ddd) !important;
  background: var(--bg, #fdfbf9) !important;
}
.detail-ai-input:focus {
  border-color: var(--accent, #e65c00) !important;
  background: var(--surface, #fff) !important;
  box-shadow: 0 0 0 2px var(--accent-glow, rgba(230, 92, 0, 0.15)) !important;
}

.detail-ai-submit {
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 50% !important;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ai-submit-sparkle {
  font-size: 13px;
  line-height: 1;
}
.ai-spin {
  font-size: 12px;
  line-height: 1;
}
</style>