<template>
  <div
    ref="detailPanelRef"
    class="detail-panel vscode-sidebar-theme"
    :class="{ open: isOpen, swiping: isSwiping }"
    :style="translateY ? { transform: `translateY(${translateY}px)` } : undefined"
    id="detailPanel"
  >
    <div class="detail-drag-handle" id="detailDragHandle"></div>

    <!-- 顶部 VSCode 标题栏 -->
    <div class="vscode-top-bar">
      <!-- 左侧：Tabs 或 Title -->
      <div v-if="entries.length" class="vscode-tabs">
        <button
          class="vscode-tab-btn"
          :class="{ active: currentTab === 'ai' }"
          @click="currentTab = 'ai'"
        >
          <span>CHAT</span>
        </button>
        <button
          class="vscode-tab-btn"
          :class="{ active: currentTab === 'cards' }"
          @click="currentTab = 'cards'"
        >
          <span>CARDS</span>
          <span class="vscode-tab-counter">({{ entries.length }})</span>
        </button>
      </div>
      <div v-else class="vscode-panel-title">
        <svg class="vscode-copilot-svg" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
          <path d="M14.5 3H1.5C.67 3 0 3.67 0 4.5v7c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-.5 8.5H2v-6h12v6zM4 6.5l2 1.5-2 1.5v-1H3v-1h1v-1zm4 2h4v1H8v-1z"/>
        </svg>
        <span class="vscode-title-label">COPILOT</span>
      </div>

      <!-- 右侧：VSCode 动作图标按钮组 -->
      <div class="vscode-top-actions">
        <button
          v-if="currentTab === 'ai'"
          class="vscode-icon-btn"
          @click="startNewChat"
          :title="t('ai.sidebarClear')"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
          </svg>
        </button>
        <button
          class="vscode-icon-btn"
          @click="closeEntirePanel"
          :title="t('common.close')"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 中间滚动流 -->
    <div class="detail-inner vscode-chat-inner" id="detailInner" ref="chatScrollRef">
      <!-- 模式 1: AI Copilot 对话流 -->
      <template v-if="currentTab === 'ai'">
        <!-- 空态：极简 IDE 欢迎与命令提示 -->
        <div v-if="chatTurns.length === 0" class="vscode-welcome-view">
          <div class="vscode-welcome-header">
            <svg class="vscode-brand-glyph" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <path d="M8 10l3 2-3 2M13 14h3"/>
            </svg>
            <div class="vscode-brand-name">ulink Copilot</div>
            <div class="vscode-brand-desc">{{ t('ai.sidebarWelcomeDesc') }}</div>
          </div>

          <div class="vscode-prompts-section">
            <div class="vscode-prompts-title">QUICK PROMPTS</div>
            <div class="vscode-prompts-list">
              <button
                v-for="p in QUICK_PROMPTS"
                :key="p.key"
                class="vscode-prompt-row"
                @click="quickSearch(t(p.key))"
              >
                <span class="prompt-prefix">&gt;</span>
                <span class="prompt-cmd">{{ p.cmd }}</span>
                <span class="prompt-query">{{ t(p.key) }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 对话流列表 (Chat Conversation Stream) -->
        <div v-else class="vscode-chat-stream">
          <div
            v-for="turn in chatTurns"
            :key="turn.id"
            class="vscode-chat-turn"
            :class="`turn-${turn.role}`"
          >
            <!-- User Turn -->
            <div v-if="turn.role === 'user'" class="vscode-user-msg">
              <div class="vscode-msg-header">
                <span class="msg-prompt-symbol">&gt;</span>
                <span class="msg-author">You</span>
              </div>
              <div class="vscode-msg-body user-body">
                {{ turn.content }}
              </div>
            </div>

            <!-- Assistant Turn -->
            <div v-else class="vscode-assistant-msg">
              <div class="vscode-msg-header">
                <svg class="assistant-glyph" viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
                  <path d="M14.5 3H1.5C.67 3 0 3.67 0 4.5v7c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-.5 8.5H2v-6h12v6zM4 6.5l2 1.5-2 1.5v-1H3v-1h1v-1zm4 2h4v1H8v-1z"/>
                </svg>
                <span class="msg-author">Copilot</span>
              </div>

              <!-- 思考指示器 (VSCode Scanning Bar & Indicator) -->
              <div v-if="turn.loading" class="vscode-thinking-wrap">
                <div class="vscode-progress-line"></div>
                <div class="vscode-thinking-text">Thinking...</div>
              </div>

              <!-- 结果内容 -->
              <div v-else class="vscode-msg-body assistant-body">
                <div v-if="turn.content" class="vscode-reply-text">
                  <span>{{ turn.content }}</span>
                  <button
                    v-if="turn.candidates?.length && hasUnaddedInTurn(turn)"
                    class="vscode-link-btn"
                    @click="addAllInTurn(turn)"
                  >
                    {{ t('ai.addAllDirect') }}
                  </button>
                </div>

                <!-- 候选卡片列表 -->
                <div v-if="turn.candidates?.length" class="vscode-cards-list">
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

      <!-- 模式 2: 暂存卡片展架 (兼容原有) -->
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

    <!-- 底部 VSCode Chat 输入卡片部件 -->
    <div class="vscode-bottom-dock">
      <!-- 上下文引用胶囊 (# Context reference) -->
      <div v-if="activeContext" class="vscode-context-ref">
        <span class="context-hash">#</span>
        <span class="context-label">context:</span>
        <span class="context-name" :title="activeContext.url">{{ activeContext.title }}</span>
        <button class="context-dismiss" @click="dismissContext" title="Dismiss context">&times;</button>
        <button class="context-quick-action" @click="searchSimilarForContext">寻找平替 →</button>
      </div>

      <!-- VSCode 经典多行聊天输入卡片 -->
      <div class="vscode-input-box" :class="{ focused: isInputFocused }">
        <textarea
          ref="aiTextareaRef"
          v-model="aiQuery"
          class="vscode-textarea"
          :placeholder="t('ai.sidebarInputPlaceholder')"
          rows="1"
          @focus="isInputFocused = true"
          @blur="isInputFocused = false"
          @keydown="handleKeyDown"
          @input="adjustTextareaHeight"
        ></textarea>

        <!-- 工具栏：偏好标签微调 + 发送按钮 -->
        <div class="vscode-input-toolbar">
          <div class="vscode-pref-badges">
            <button
              v-for="pref in PREF_OPTIONS"
              :key="pref.id"
              type="button"
              class="vscode-pref-badge"
              :class="{ active: preferences.includes(pref.id) }"
              @click="togglePreference(pref.id)"
              :title="t(pref.hintKey)"
            >
              {{ t(pref.labelKey) }}
            </button>
          </div>

          <button
            class="vscode-send-btn"
            :class="{ active: !!aiQuery.trim() && !aiLoading }"
            :disabled="aiLoading || !aiQuery.trim()"
            @click="handleAiSubmit"
            title="Send (Enter)"
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
import { t } from '../../i18n/index.js'
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

// 当前上下文书签（例如主视图选中的卡片）
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

// Tab 状态：有暂存卡片时可切换
const currentTab = ref<'ai' | 'cards'>('ai')

// 输入状态与偏好
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

// 对话记录
const chatTurns = ref<ChatTurn[]>([])

const QUICK_PROMPTS = [
  { key: 'ai.promptPrototype', cmd: '/find' },
  { key: 'ai.promptGallery', cmd: '/find' },
  { key: 'ai.promptWhiteboard', cmd: '/find' },
  { key: 'ai.promptOpenNotes', cmd: '/find' },
]

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

  // 斜杠命令支持
  if (raw === '/clear') {
    startNewChat()
    return
  }

  currentTab.value = 'ai'
  aiLoading.value = true
  aiQuery.value = ''
  adjustTextareaHeight()

  const turnId = 'turn-' + Date.now()
  // 添加用户消息
  chatTurns.value.push({
    id: turnId + '-user',
    role: 'user',
    content: raw,
    timestamp: Date.now(),
  })

  // 添加助手加载占位
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
        ? `${res.videoTitle} (提炼出 ${res.bookmarks.length} 个工具)`
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
    assistantTurn.content = '检索失败，请稍后重试。'
    console.error('[Copilot] search error:', err)
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
.vscode-sidebar-theme {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  background: var(--surface);
  font-family: var(--font-sans);
}

/* VSCode 顶栏 */
.vscode-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 35px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  user-select: none;
}

.vscode-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
}

.vscode-copilot-svg {
  color: var(--accent);
}

.vscode-title-label {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  color: var(--text);
}

/* VSCode 经典标签页 (Tabs) */
.vscode-tabs {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 2px;
}

.vscode-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 100%;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s ease;
}

.vscode-tab-btn:hover {
  color: var(--text);
}

.vscode-tab-btn.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}

.vscode-tab-counter {
  font-size: 10px;
  opacity: 0.7;
}

/* 顶栏图标操作按钮 */
.vscode-top-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.vscode-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: all 0.12s ease;
}

.vscode-icon-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

/* 滚动内容区 */
.vscode-chat-inner {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* 空态欢迎区 */
.vscode-welcome-view {
  padding: 16px 4px;
}

.vscode-welcome-header {
  margin-bottom: 24px;
}

.vscode-brand-glyph {
  color: var(--accent);
  margin-bottom: 8px;
}

.vscode-brand-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}

.vscode-brand-desc {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.5;
}

.vscode-prompts-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vscode-prompts-title {
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.vscode-prompts-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vscode-prompt-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs, 4px);
  background: var(--surface);
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: all 0.12s ease;
}

.vscode-prompt-row:hover {
  background: var(--surface-hover);
  border-color: var(--accent);
}

.prompt-prefix {
  font-family: var(--font-mono, monospace);
  color: var(--accent);
  font-weight: 700;
}

.prompt-cmd {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-muted);
}

.prompt-query {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 对话流 */
.vscode-chat-stream {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.vscode-chat-turn {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.vscode-msg-header {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.msg-prompt-symbol {
  color: var(--accent);
}

.assistant-glyph {
  color: var(--accent);
}

.vscode-msg-body.user-body {
  padding: 8px 10px;
  background: var(--surface-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs, 4px);
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--text);
}

.vscode-msg-body.assistant-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vscode-reply-text {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text-muted);
}

.vscode-link-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}
.vscode-link-btn:hover {
  text-decoration: underline;
}

/* 思考进度条 */
.vscode-thinking-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0;
}

.vscode-progress-line {
  height: 2px;
  width: 100%;
  background: var(--border);
  position: relative;
  overflow: hidden;
  border-radius: 1px;
}

.vscode-progress-line::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: var(--accent);
  animation: vscode-scan 1.2s ease-in-out infinite;
}

@keyframes vscode-scan {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}

.vscode-thinking-text {
  font-family: var(--font-mono, monospace);
  font-size: 10.5px;
  color: var(--text-muted);
}

.vscode-cards-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 底部 Dock 输入区域 */
.vscode-bottom-dock {
  flex-shrink: 0;
  padding: 8px 10px 10px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}

/* 上下文引用条 */
.vscode-context-ref {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs, 4px);
  background: var(--surface-hover);
  font-size: 11px;
}

.context-hash {
  font-family: var(--font-mono, monospace);
  color: var(--accent);
  font-weight: 700;
}

.context-label {
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
}

.context-name {
  color: var(--text);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}

.context-dismiss {
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
.context-dismiss:hover {
  color: var(--text);
}

.context-quick-action {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
}
.context-quick-action:hover {
  text-decoration: underline;
}

/* VSCode 输入框容器 */
.vscode-input-box {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs, 4px);
  background: var(--bg, #fdfbf9);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.vscode-input-box.focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.vscode-textarea {
  width: 100%;
  border: none !important;
  background: transparent !important;
  padding: 6px 8px !important;
  font-family: var(--font-sans);
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--text);
  resize: none;
  outline: none;
  max-height: 120px;
}

.vscode-textarea::placeholder {
  color: var(--text-muted);
  opacity: 0.8;
}

/* 工具栏 */
.vscode-input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  border-top: 1px solid var(--border-light, #f0f0f0);
}

.vscode-pref-badges {
  display: flex;
  align-items: center;
  gap: 3px;
  overflow-x: auto;
}

.vscode-pref-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
  border: 1px solid transparent;
  background: transparent;
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.vscode-pref-badge:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.vscode-pref-badge.active {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
  font-weight: 600;
}

/* 发送箭头按钮 */
.vscode-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.vscode-send-btn.active {
  background: var(--accent);
  color: #fff;
}

.vscode-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>