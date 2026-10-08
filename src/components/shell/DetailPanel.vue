<template>
  <div
    ref="detailPanelRef"
    class="detail-panel ulink-simple-chat"
    :class="{ open: isOpen, swiping: isSwiping }"
    :style="panelStyle"
    id="detailPanel"
  >
    <div class="detail-drag-handle" id="detailDragHandle"></div>

    <!-- 顶部标题栏：极简清爽 -->
    <div class="chat-top-bar">
      <div v-if="entries.length" class="chat-top-tabs">
        <button
          class="chat-top-tab"
          :class="{ active: currentTab === 'ai' }"
          @click="currentTab = 'ai'"
        >
          <span>{{ t('ai.sidebarTitle') }}</span>
        </button>
        <button
          class="chat-top-tab"
          :class="{ active: currentTab === 'cards' }"
          @click="currentTab = 'cards'"
        >
          <span>{{ t('ai.tabCards') }}</span>
          <span class="chat-tab-badge">{{ entries.length }}</span>
        </button>
      </div>
      <div v-else class="chat-top-title">
        <span>{{ t('ai.sidebarTitle') }}</span>
      </div>

      <div class="chat-top-actions">
        <button
          v-if="currentTab === 'ai' && chatTurns.length > 0"
          class="chat-btn-icon"
          @click="startNewChat"
          :title="t('ai.sidebarClear')"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
          </svg>
        </button>
        <button
          class="chat-btn-icon"
          @click="closeEntirePanel"
          :title="t('common.close')"
        >
          &times;
        </button>
      </div>
    </div>

    <!-- 中间区域：对话流 / 暂存卡片 -->
    <div class="detail-inner chat-scroll-body" id="detailInner" ref="chatScrollRef">
      <!-- 对话模式 -->
      <template v-if="currentTab === 'ai'">
        <!-- 初始空态：只留极其简洁的一句话引导 -->
        <div v-if="chatTurns.length === 0" class="chat-empty-state">
          <p class="chat-empty-text">
            {{ isZh ? '输入需求甄选网站、输入网址找平替，或直接粘贴视频链接。' : 'Ask for sites, find alternatives, or paste video links.' }}
          </p>
        </div>

        <!-- 对话流 -->
        <div v-else class="chat-flow-list">
          <div
            v-for="turn in chatTurns"
            :key="turn.id"
            class="chat-turn-item"
            :class="`turn-${turn.role}`"
          >
            <!-- 用户消息 -->
            <div v-if="turn.role === 'user'" class="chat-user-bubble">
              {{ turn.content }}
            </div>

            <!-- 助手回复 -->
            <div v-else class="chat-assistant-wrap">
              <!-- 思考状态 -->
              <div v-if="turn.loading" class="chat-thinking">
                <div class="chat-thinking-bar"></div>
                <span>{{ t('ai.searching') }}</span>
              </div>

              <!-- 回复内容与候选卡片 -->
              <div v-else class="chat-reply-body">
                <div v-if="turn.content" class="chat-reply-line">
                  <span>{{ turn.content }}</span>
                  <button
                    v-if="turn.candidates?.length && hasUnaddedInTurn(turn)"
                    class="chat-action-link"
                    @click="addAllInTurn(turn)"
                  >
                    {{ t('ai.addAllDirect') }}
                  </button>
                </div>

                <div v-if="turn.candidates?.length" class="chat-cards-stream">
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

      <!-- 暂存卡片模式 (100% 保持原有兼容) -->
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

    <!-- 底部常驻：纯粹干净的一个对话框 -->
    <div class="chat-input-dock">
      <div class="chat-input-wrapper" :class="{ focused: isInputFocused }">
        <textarea
          ref="aiTextareaRef"
          v-model="aiQuery"
          class="chat-textarea"
          :placeholder="t('ai.sidebarInputPlaceholder')"
          rows="1"
          @focus="isInputFocused = true"
          @blur="isInputFocused = false"
          @keydown="handleKeyDown"
          @input="adjustTextareaHeight"
        ></textarea>
        <button
          class="chat-send-btn"
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

const currentTab = ref<'ai' | 'cards'>('ai')

const aiQuery = ref('')
const aiLoading = ref(false)
const isInputFocused = ref(false)
// 默认采用最佳偏好（完全免费 + 国内直连），无需用户在界面手动配置
const preferences = ref<AiSearchPreference[]>(['free', 'no_proxy'])

const chatTurns = ref<ChatTurn[]>([])

const panelStyle = computed(() => {
  const styles: Record<string, string> = {}
  if (translateY.value) {
    styles.transform = `translateY(${translateY.value}px)`
  }
  return Object.keys(styles).length ? styles : undefined
})

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
  adjustTextareaHeight()
  nextTick(() => aiTextareaRef.value?.focus())
}

function closeEntirePanel() {
  ui.panels.detail = false
  ui.detailCards.splice(0)
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
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

/** 核心提交分流：自动识别视频 / 网址 / 自然语言需求 */
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
    assistantTurn.content = isZh.value ? '检索失败，请稍后重试。' : 'Failed to search, please try again.'
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
.ulink-simple-chat {
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

/* 顶栏 */
.chat-top-bar {
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

.chat-top-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

.chat-top-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
}

.chat-top-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 100%;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}

.chat-top-tab:hover {
  color: var(--text);
}

.chat-top-tab.active {
  color: var(--accent);
  font-weight: 600;
  border-bottom-color: var(--accent);
}

.chat-tab-badge {
  font-size: 10.5px;
  padding: 0 4px;
  border-radius: 9999px;
  background: var(--accent-light);
  color: var(--accent);
}

.chat-top-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chat-btn-icon {
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

.chat-btn-icon:hover {
  background: var(--surface-hover);
  color: var(--text);
}

/* 滚动区 */
.chat-scroll-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
  min-width: 0 !important;
  box-sizing: border-box;
}

/* 初始空态 */
.chat-empty-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px 16px;
  text-align: center;
}

.chat-empty-text {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
  max-width: 240px;
  margin: 0;
}

/* 对话流 */
.chat-flow-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-turn-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-user-bubble {
  align-self: flex-end;
  max-width: 88%;
  padding: 7px 11px;
  background: var(--surface-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  border-bottom-right-radius: 2px;
  font-size: 12.5px;
  color: var(--text);
  line-height: 1.4;
  word-break: break-word;
}

.chat-assistant-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.chat-thinking {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 0;
  font-size: 11px;
  color: var(--text-muted);
}

.chat-thinking-bar {
  height: 2px;
  width: 100%;
  background: var(--border);
  position: relative;
  overflow: hidden;
  border-radius: 1px;
}

.chat-thinking-bar::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 35%;
  height: 100%;
  background: var(--accent);
  animation: chat-scan 1.2s ease-in-out infinite;
}

@keyframes chat-scan {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.chat-reply-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-reply-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text-muted);
}

.chat-action-link {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.chat-action-link:hover {
  text-decoration: underline;
}

.chat-cards-stream {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 底部仅留一个对话输入框 */
.chat-input-dock {
  flex-shrink: 0;
  padding: 8px 10px 10px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  min-width: 0 !important;
  box-sizing: border-box;
}

.chat-input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  background: var(--surface);
  padding: 6px 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
  box-sizing: border-box;
}

.chat-input-wrapper.focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow, rgba(18, 46, 138, 0.15));
}

.chat-textarea {
  flex: 1;
  min-width: 0;
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--text);
  resize: none;
  outline: none;
  max-height: 120px;
  box-sizing: border-box;
}

.chat-textarea::placeholder {
  color: var(--text-muted);
}

.chat-send-btn {
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
}

.chat-send-btn.active {
  background: var(--accent);
  color: #fff;
}

.chat-send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>