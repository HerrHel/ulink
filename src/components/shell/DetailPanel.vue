<template>
  <div
    ref="detailPanelRef"
    class="detail-panel ulink-detail-panel"
    :class="{ open: isOpen, swiping: isSwiping }"
    :style="panelStyle"
    id="detailPanel"
  >
    <div class="detail-drag-handle" id="detailDragHandle"></div>

    <!-- 顶部功能栏：融入与链原生风格 -->
    <div class="ulink-panel-header">
      <!-- 左侧：多模式 Tab 或 单一简洁标题 -->
      <div v-if="entries.length" class="ulink-header-tabs">
        <button
          class="ulink-tab-btn"
          :class="{ active: currentTab === 'ai' }"
          @click="currentTab = 'ai'"
        >
          <span>{{ t('ai.tabInsight') }}</span>
        </button>
        <button
          class="ulink-tab-btn"
          :class="{ active: currentTab === 'cards' }"
          @click="currentTab = 'cards'"
        >
          <span>{{ t('ai.tabCards') }}</span>
          <span class="ulink-tab-count">{{ entries.length }}</span>
        </button>
      </div>
      <div v-else class="ulink-panel-title">
        <svg class="ulink-title-glyph" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 3v18M3 12h18"/>
        </svg>
        <span>{{ t('ai.sidebarTitle') }}</span>
      </div>

      <!-- 右侧：简洁快捷操作 -->
      <div class="ulink-header-actions">
        <button
          v-if="currentTab === 'ai'"
          class="btn-icon-subtle"
          @click="startNewChat"
          :title="t('ai.sidebarClear')"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
          </svg>
        </button>
        <button
          class="btn-icon-subtle close-btn"
          @click="closeEntirePanel"
          :title="t('common.close')"
        >
          &times;
        </button>
      </div>
    </div>

    <!-- 中间滚动内容流 -->
    <div class="detail-inner ulink-content-scroll" id="detailInner" ref="chatScrollRef">
      <!-- 模式 1: AI 助手流 -->
      <template v-if="currentTab === 'ai'">
        <!-- 空态：与链风格简洁引导 -->
        <div v-if="chatTurns.length === 0" class="ulink-ai-welcome">
          <div class="welcome-branding">
            <div class="welcome-logo-badge">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            </div>
            <h3 class="welcome-title">{{ t('ai.sidebarWelcomeTitle') }}</h3>
            <p class="welcome-desc">{{ t('ai.sidebarWelcomeDesc') }}</p>
          </div>

          <div class="quick-prompts-block">
            <div class="prompts-heading">{{ t('ai.searchAction') }}</div>
            <div class="prompts-grid">
              <button
                v-for="p in QUICK_PROMPTS"
                :key="p.key"
                class="prompt-capsule"
                @click="quickSearch(t(p.key))"
              >
                <span class="capsule-arrow">&rsaquo;</span>
                <span class="capsule-text">{{ t(p.key) }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 历史交互流 -->
        <div v-else class="ulink-turns-flow">
          <div
            v-for="turn in chatTurns"
            :key="turn.id"
            class="flow-turn"
            :class="`turn-${turn.role}`"
          >
            <!-- 用户消息 -->
            <div v-if="turn.role === 'user'" class="user-turn-box">
              <div class="user-text">{{ turn.content }}</div>
            </div>

            <!-- 助手回复 -->
            <div v-else class="assistant-turn-box">
              <!-- 思考状态 -->
              <div v-if="turn.loading" class="thinking-state">
                <div class="thinking-line"></div>
                <span class="thinking-label">{{ t('ai.searching') }}</span>
              </div>

              <!-- 回复内容与候选卡片 -->
              <div v-else class="reply-content">
                <div v-if="turn.content" class="reply-header-row">
                  <span class="summary-text">{{ turn.content }}</span>
                  <button
                    v-if="turn.candidates?.length && hasUnaddedInTurn(turn)"
                    class="btn-link-action"
                    @click="addAllInTurn(turn)"
                  >
                    {{ t('ai.addAllDirect') }}
                  </button>
                </div>

                <div v-if="turn.candidates?.length" class="candidates-column">
                  <AiCandidateCard
                    v-for="item in turn.candidates"
                    :key="item.url"
                    :candidate="item"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 模式 2: 暂存卡片展架 (原有功能 100% 兼容) -->
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

    <!-- 底部常驻输入底座：简洁明了与链风 -->
    <div class="ulink-bottom-dock">
      <!-- 关联上下文指示条 -->
      <div v-if="activeContext" class="context-pill-wrap">
        <span class="context-label"># {{ isZh ? '参考' : 'context' }}:</span>
        <span class="context-title" :title="activeContext.url">{{ activeContext.title }}</span>
        <button class="context-close" @click="dismissContext" title="Remove context">&times;</button>
        <button class="context-action" @click="searchSimilarForContext">{{ isZh ? '挖掘平替 →' : 'Alternatives →' }}</button>
      </div>

      <!-- 核心输入卡片容器 -->
      <div class="ulink-input-card" :class="{ focused: isInputFocused }">
        <textarea
          ref="aiTextareaRef"
          v-model="aiQuery"
          class="ulink-card-textarea"
          :placeholder="t('ai.sidebarInputPlaceholder')"
          rows="1"
          @focus="isInputFocused = true"
          @blur="isInputFocused = false"
          @keydown="handleKeyDown"
          @input="adjustTextareaHeight"
        ></textarea>

        <!-- 工具栏：偏好标签 + 发送按钮 -->
        <div class="ulink-card-toolbar">
          <div class="preference-tags-group">
            <button
              v-for="pref in PREF_OPTIONS"
              :key="pref.id"
              type="button"
              class="pref-chip"
              :class="{ active: preferences.includes(pref.id) }"
              @click="togglePreference(pref.id)"
              :title="t(pref.hintKey)"
            >
              {{ t(pref.labelKey) }}
            </button>
          </div>

          <button
            class="ulink-send-btn"
            :class="{ active: !!aiQuery.trim() && !aiLoading }"
            :disabled="aiLoading || !aiQuery.trim()"
            @click="handleAiSubmit"
            :title="t('ai.searchAction') + ' (Enter)'"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M8 2.5l4.5 4.5h-3v6.5h-3V7h-3L8 2.5z"/>
            </svg>
          </button>
        </div>
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
import { useI18n } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'
import BookmarkCard from '../cards/BookmarkCard.vue'
import GroupCard from '../cards/GroupCard.vue'
import AiCandidateCard from '../cards/AiCandidateCard.vue'
import {
  searchWebsitesByIntent,
  findSimilarWebsites,
  extractBookmarksFromVideo,
} from '../../lib/ai/cloudAiClient.js'
import { buildDetailCards } from './buildDetailCards.js'
import type { DetailEntry } from './buildDetailCards.js'
import type { AiSearchPreference, AiCandidateBookmark } from '../../types/ai.js'

const { t, locale } = useI18n()
const isZh = computed(() => locale.value.startsWith('zh'))

interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  candidates?: AiCandidateBookmark[]
  loading?: boolean
  timestamp: number
}

const ui = useUIStore()
const ds = useDataStore()
const detailPanelRef = ref<HTMLElement | null>(null)
const aiTextareaRef = ref<HTMLTextAreaElement | null>(null)
const chatScrollRef = ref<HTMLElement | null>(null)

const isOpen = computed(() => ui.panels.detail || ui.detailCards.length > 0)

const entries = computed<DetailEntry[]>(() =>
  buildDetailCards(ui.detailCards, ds.groupMap, ds.bookmarkMap, domain),
)

// 当前上下文书签
const dismissedContextId = ref<string | null>(null)
const activeContext = computed(() => {
  if (!entries.value.length) return null
  const first = entries.value[0]
  if (first.rawId === dismissedContextId.value) return null
  const data = first.data
  return {
    id: first.rawId,
    title: data.title || data.name || '',
    url: data.url || '',
  }
})

function dismissContext() {
  if (activeContext.value) {
    dismissedContextId.value = activeContext.value.id
  }
}

// Tab 状态
const currentTab = ref<'ai' | 'cards'>('ai')

// 输入状态
const aiQuery = ref('')
const aiLoading = ref(false)
const isInputFocused = ref(false)
const preferences = ref<AiSearchPreference[]>(['free', 'no_proxy'])

const PREF_OPTIONS: Array<{ id: AiSearchPreference; labelKey: string; hintKey: string }> = [
  { id: 'free', labelKey: 'ai.prefFree', hintKey: 'ai.prefFreeHint' },
  { id: 'no_proxy', labelKey: 'ai.prefNoProxy', hintKey: 'ai.prefNoProxyHint' },
  { id: 'lightweight', labelKey: 'ai.prefLightweight', hintKey: 'ai.prefLightweightHint' },
  { id: 'open_source', labelKey: 'ai.prefOpenSource', hintKey: 'ai.prefOpenSourceHint' },
  { id: 'professional', labelKey: 'ai.prefProfessional', hintKey: 'ai.prefProfessionalHint' },
]

function togglePreference(id: AiSearchPreference) {
  const idx = preferences.value.indexOf(id)
  if (idx > -1) {
    preferences.value.splice(idx, 1)
  } else {
    preferences.value.push(id)
  }
}

// 对话流历史
const chatTurns = ref<ChatTurn[]>([])

const QUICK_PROMPTS = [
  { key: 'ai.promptPrototype' },
  { key: 'ai.promptGallery' },
  { key: 'ai.promptWhiteboard' },
  { key: 'ai.promptOpenNotes' },
]

// 面板内联样式绑定
const panelStyle = computed(() => {
  const styles: Record<string, string> = {}
  if (translateY.value) {
    styles.transform = `translateY(${translateY.value}px)`
  }
  return Object.keys(styles).length ? styles : undefined
})

// 打开面板时自动聚焦
watch(
  () => isOpen.value,
  (open) => {
    if (open) {
      if (!entries.value.length) {
        currentTab.value = 'ai'
      }
      nextTick(() => {
        if (currentTab.value === 'ai') {
          aiTextareaRef.value?.focus()
        }
      })
    }
  }
)

function scrollToBottom() {
  nextTick(() => {
    if (chatScrollRef.value) {
      chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
    }
  })
}

function startNewChat() {
  chatTurns.value = []
  aiQuery.value = ''
  dismissedContextId.value = null
  adjustTextareaHeight()
  nextTick(() => aiTextareaRef.value?.focus())
}

function closeEntirePanel() {
  ui.panels.detail = false
  ui.detailCards.splice(0)
}

function quickSearch(prompt: string) {
  aiQuery.value = prompt
  handleAiSubmit()
}

function searchSimilarForContext() {
  if (!activeContext.value?.url) return
  aiQuery.value = activeContext.value.url
  handleAiSubmit()
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleAiSubmit()
  }
}

function adjustTextareaHeight() {
  const el = aiTextareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 100) + 'px'
}

/** 核心提交分流 */
async function handleAiSubmit() {
  const raw = aiQuery.value.trim()
  if (!raw || aiLoading.value) return

  if (raw === '/clear') {
    startNewChat()
    return
  }

  currentTab.value = 'ai'
  aiLoading.value = true
  aiQuery.value = ''
  adjustTextareaHeight()

  const turnId = 'turn-' + Date.now()
  chatTurns.value.push({
    id: turnId + '-user',
    role: 'user',
    content: raw,
    timestamp: Date.now(),
  })

  const assistantTurn: ChatTurn = {
    id: turnId + '-assistant',
    role: 'assistant',
    content: '',
    loading: true,
    candidates: [],
    timestamp: Date.now(),
  }
  chatTurns.value.push(assistantTurn)
  scrollToBottom()

  try {
    const isVideo = /bilibili\.com|b23\.tv|douyin\.com|tiktok\.com|xiaohongshu\.com|xhslink\.com/.test(raw)
    const isUrl = /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/.test(raw)

    if (isVideo) {
      const res = await extractBookmarksFromVideo(raw, ds.categories, ds.customAttributes)
      assistantTurn.loading = false
      assistantTurn.candidates = res.bookmarks
      assistantTurn.content = res.videoTitle
        ? `${res.videoTitle} (${t('ai.foundCount', { n: res.bookmarks.length })})`
        : t('ai.foundCount', { n: res.bookmarks.length })
    } else if (isUrl) {
      const res = await findSimilarWebsites(raw, preferences.value, ds.categories, ds.customAttributes)
      assistantTurn.loading = false
      assistantTurn.candidates = res
      assistantTurn.content = t('ai.foundCount', { n: res.length })
    } else {
      const res = await searchWebsitesByIntent(raw, preferences.value, ds.categories, ds.customAttributes)
      assistantTurn.loading = false
      assistantTurn.candidates = res
      assistantTurn.content = t('ai.foundCount', { n: res.length })
    }
  } catch (err: unknown) {
    assistantTurn.loading = false
    assistantTurn.content = isZh ? '检索失败，请稍后重试。' : 'Failed to search, please try again.'
    console.error('[ulink AI] search error:', err)
  } finally {
    aiLoading.value = false
    scrollToBottom()
  }
}

function hasUnaddedInTurn(turn: ChatTurn): boolean {
  return !!turn.candidates?.some(c => !c.isAdded)
}

function addAllInTurn(turn: ChatTurn) {
  if (!turn.candidates) return
  let count = 0
  for (const c of turn.candidates) {
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

/* 移动端下滑关闭手势 */
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
.ulink-detail-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-sans);
  min-width: 0 !important;
  box-sizing: border-box;
}

/* 顶部功能栏 */
.ulink-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  min-width: 0;
  user-select: none;
}

.ulink-panel-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.ulink-title-glyph {
  color: var(--accent);
}

/* 顶部模式切换选项卡 */
.ulink-header-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
}

.ulink-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}

.ulink-tab-btn:hover {
  color: var(--text);
}

.ulink-tab-btn.active {
  color: var(--accent);
  font-weight: 600;
  border-bottom-color: var(--accent);
}

.ulink-tab-count {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 9999px;
  background: var(--accent-light);
  color: var(--accent);
}

/* 顶栏图标操作 */
.ulink-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-icon-subtle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-icon-subtle:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.btn-icon-subtle.close-btn {
  font-size: 17px;
  line-height: 1;
}

/* 中间内容滚动流 */
.ulink-content-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
  min-width: 0 !important;
  box-sizing: border-box;
}

/* 空态欢迎区 */
.ulink-ai-welcome {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 10px 4px;
}

.welcome-branding {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.welcome-logo-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-base, 8px);
  background: var(--accent-light);
  color: var(--accent);
  margin-bottom: 2px;
}

.welcome-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.welcome-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

/* 快捷建议 */
.quick-prompts-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompts-heading {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.prompts-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prompt-capsule {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.prompt-capsule:hover {
  background: var(--surface-hover);
  border-color: var(--accent);
  color: var(--accent);
  transform: translateX(2px);
}

.capsule-arrow {
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
}

/* 对话流 */
.ulink-turns-flow {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.flow-turn {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.user-turn-box {
  align-self: flex-end;
  max-width: 90%;
  padding: 8px 12px;
  background: var(--surface-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  border-bottom-right-radius: 2px;
  font-size: 12.5px;
  color: var(--text);
  line-height: 1.45;
}

.assistant-turn-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

/* 思考进度 */
.thinking-state {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0;
}

.thinking-line {
  height: 2px;
  width: 100%;
  background: var(--border);
  position: relative;
  overflow: hidden;
  border-radius: 1px;
}

.thinking-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 35%;
  height: 100%;
  background: var(--accent);
  animation: ulink-scan 1.2s ease-in-out infinite;
}

@keyframes ulink-scan {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.thinking-label {
  font-size: 11px;
  color: var(--text-muted);
}

.reply-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text-muted);
  padding: 0 2px;
}

.btn-link-action {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.btn-link-action:hover {
  text-decoration: underline;
}

.candidates-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 底部常驻输入底座 */
.ulink-bottom-dock {
  flex-shrink: 0;
  padding: 8px 10px 10px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  min-width: 0 !important;
  box-sizing: border-box;
}

/* 上下文引用条 */
.context-pill-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--surface-hover);
  font-size: 11px;
  min-width: 0;
}

.context-label {
  color: var(--text-muted);
  font-weight: 600;
  flex-shrink: 0;
}

.context-title {
  color: var(--text);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.context-close {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
}
.context-close:hover {
  color: var(--text);
}

.context-action {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}
.context-action:hover {
  text-decoration: underline;
}

/* 与链风格输入卡片 */
.ulink-input-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  background: var(--surface);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
  box-sizing: border-box;
}

.ulink-input-card.focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow, rgba(18, 46, 138, 0.15));
}

.ulink-card-textarea {
  width: 100%;
  border: none !important;
  background: transparent !important;
  padding: 8px 10px 4px !important;
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text);
  resize: none;
  outline: none;
  max-height: 100px;
  min-width: 0;
  box-sizing: border-box;
}

.ulink-card-textarea::placeholder {
  color: var(--text-muted);
}

/* 卡片工具栏 */
.ulink-card-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-top: 1px solid var(--border-light, #eee);
  min-width: 0;
}

.preference-tags-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

.pref-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  font-size: 10.5px;
  color: var(--text-muted);
  border: 1px solid transparent;
  background: var(--surface-hover);
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.pref-chip:hover {
  color: var(--text);
  border-color: var(--border);
}

.pref-chip.active {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
  font-weight: 600;
}

/* 发送按钮 */
.ulink-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: var(--surface-hover);
  color: var(--text-muted);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  margin-left: 4px;
}

.ulink-send-btn.active {
  background: var(--accent);
  color: #fff;
}

.ulink-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>