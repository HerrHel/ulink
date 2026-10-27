<template>
  <div
    ref="workspaceRef"
    class="ai-workspace"
    id="aiWorkspace"
    @dragenter.prevent="onWorkspaceDragEnter"
    @dragover.prevent="onWorkspaceDragOver"
    @dragleave="onWorkspaceDragLeave"
    @drop.prevent="onWorkspaceDrop"
    :class="{ 'drop-active': isDragOver }"
  >
    <!-- 主滚动区域 -->
    <div class="ai-scroll-view" ref="scrollContainerRef">
      <!-- 1. 空态：纯粹居中大看板（态势概况 + 纯净大输入框 + 动态卡片 + 最近会话） -->
      <div v-if="isCurrentSessionEmpty" class="ai-clean-hero">
        <div class="ai-clean-hero-box">
          <!-- 极简主标题（对齐 Gemini 人本自然发问） -->
          <div class="ai-hero-header">
            <h1 class="ai-hero-headline">
              {{ isZh ? '需要我为你做些什么？' : 'How can I help you today?' }}
            </h1>
          </div>

          <!-- 核心胶囊输入框（对齐 Gemini 浑然一体大圆角胶囊形态） -->
          <div
            class="ai-capsule-input-container"
            :class="{ focused: isInputFocused, 'drag-over': isDragOver }"
            @click="focusTextarea"
            @dragover.prevent="onWorkspaceDragOver"
            @drop.prevent="onWorkspaceDrop"
          >
            <!-- 真实附件胶囊条（若有附加的卡片或文件） -->
            <div v-if="hasAttachments" class="ai-attachments-pill-row">
              <div
                v-for="card in attachedCardsList"
                :key="card.id"
                class="ai-attach-pill"
                :class="card.type"
              >
                <span class="pill-dot"></span>
                <span v-if="card.type === 'cat'" class="pill-cat-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </span>
                <span class="pill-title">{{ card.title }}</span>
                <button class="pill-close" @click.stop="ui.removeAiAttachedCard(card.id)">&times;</button>
              </div>
              <div
                v-for="file in ui.aiAttachedFiles"
                :key="file.id"
                class="ai-attach-pill file"
              >
                <span class="pill-file-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </span>
                <span class="pill-title">{{ file.name }}</span>
                <button class="pill-close" @click.stop="ui.removeAiAttachedFile(file.id)">&times;</button>
              </div>
            </div>

            <!-- 胶囊核心主行（左侧附件 + 中间单行/多行输入 + 右侧发送大按钮） -->
            <div class="ai-capsule-main-row">
              <button
                type="button"
                class="capsule-icon-btn attach-btn"
                @click.stop="triggerFileInput"
                :title="t('ai.attachFile')"
                :aria-label="t('ai.attachFile')"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <input
                ref="fileInputRef"
                type="file"
                multiple
                accept="image/*,video/*,text/*,.pdf,.doc,.docx,.md,.json,.csv,.txt"
                style="display: none;"
                @change="handleFileInputChange"
              />

              <div class="capsule-textarea-wrap">
                <textarea
                  ref="aiTextareaRef"
                  v-model="aiQuery"
                  class="capsule-minimal-textarea ai-minimal-textarea"
                  :placeholder="isDragOver ? (isZh ? '松开鼠标以添加引用…' : 'Drop to attach reference...') : (isZh ? '向与链提问，或拖拽卡片引用…' : 'Ask ulink anything, or drop cards to mention...')"
                  rows="1"
                  @focus="isInputFocused = true"
                  @blur="isInputFocused = false"
                  @compositionstart="onCompositionStart"
                  @compositionend="onCompositionEnd"
                  @keydown="onTextareaKeyDown"
                  @input="onTextareaInput"
                  @dragover.prevent="onWorkspaceDragOver"
                  @drop.prevent="onWorkspaceDrop"
                ></textarea>
              </div>

              <!-- 圆形发送 / 停止大按钮 -->
              <button
                v-if="aiLoading"
                class="capsule-send-btn stop active"
                @click.stop="handleStopGenerating"
                :title="t('ai.stopGenerating')"
                :aria-label="t('ai.stopGenerating')"
              >
                <span class="stop-box"></span>
              </button>
              <button
                v-else
                class="capsule-send-btn"
                :class="{ active: hasSubmittableContent }"
                :disabled="!hasSubmittableContent"
                @click.stop="submitQuery"
                :title="t('ai.searchAction') + ' (Enter)'"
                :aria-label="t('ai.searchAction')"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 最近对话轻量单行底座（严格单行不换行，保持极简呼吸感） -->
          <div v-if="sessions.length > 0" class="ai-hero-recent-shelf">
            <span class="recent-shelf-label">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{{ isZh ? '历史' : 'History' }}</span>
            </span>
            <div class="recent-shelf-pills">
              <button
                v-for="s in recentSessionsList.slice(0, 2)"
                :key="s.id"
                class="recent-shelf-item"
                @click="onSelectRecentSession(s.id)"
                :title="`${sessionItemTitle(s)} · ${formatTimeAgo(s.updatedAt)}`"
              >
                <span class="recent-shelf-text">{{ sessionItemTitle(s) }}</span>
              </button>
              <button
                class="recent-shelf-item recent-shelf-all-btn"
                @click="openHistoryDrawer"
                :title="isZh ? '查看全部历史会话' : 'View all history'"
              >
                <span>{{ isZh ? '全部' : 'All' }}</span>
                <span class="shelf-count-tag">{{ sessions.length }}</span>
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. 对话态：居中多轮瀑布流（max-width 760px） -->
      <div v-else class="ai-dialogue-stream-wrap">
        <!-- 多轮对话时轻量展示的会话微顶栏 -->
        <div class="ai-stream-meta-header">
          <div class="stream-session-title">
            <span class="stream-title-text">{{ currentSessionTitle }}</span>
            <button
              class="stream-history-pill-btn"
              @click="openHistoryDrawer"
              :title="isZh ? '打开会话历史' : 'Open history'"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
              </svg>
              <span>{{ sessions.length }}</span>
            </button>
          </div>
          <button
            class="stream-new-chat-btn"
            @click="onNewConversation"
            :title="t('nav.aiChatAction')"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>{{ isZh ? '开启新对话' : 'New Chat' }}</span>
          </button>
        </div>

        <ChatStream
          :chat-turns="chatTurns"
          :dynamic-quick-hints="dynamicQuickHints"
          :copied-action-key="copiedActionKey"
          :loading-text="loadingText"
          :format-reasoning-sec="formatReasoningSec"
          :get-clean-copy-text="getCleanCopyText"
          :get-turn-segments="getTurnSegments"
          :get-turn-attached-cards="getTurnAttachedCards"
          :get-attached-notes="getAttachedNotes"
          :has-unadded-in-turn="hasUnaddedInTurn"
          :get-card-candidate-list="getCardCandidateList"
          :get-selected-candidate-count="getSelectedCandidateCount"
          :is-all-candidates-selected="isAllCandidatesSelected"
          :is-candidate-selected="isCandidateSelected"
          :format-domain="formatDomain"
          :get-action-card-nav-target="getActionCardNavTarget"
          @quick-fill="quickFill"
          @copy-message="copyMessage"
          @revoke-user-message="revokeUserMessage"
          @toggle-thinking-open="(turn) => (turn._thinkingOpen = !turn._thinkingOpen)"
          @toggle-trace-open="(turn) => (turn._traceOpen = !turn._traceOpen)"
          @add-all-in-turn="addAllInTurn"
          @handle-append-to-note="handleAppendToNote"
          @handle-replace-note="handleReplaceNote"
          @handle-save-as-new-note="handleSaveAsNewNote"
          @handle-locate-card="handleLocateCard"
          @toggle-select-all-candidates="toggleSelectAllCandidates"
          @toggle-candidate-selection="toggleCandidateSelection"
          @handle-action-card-click="handleActionCardClick"
          @navigate-to-action-target="navigateToActionTarget"
          @toggle-diff-item-selection="toggleDiffItemSelection"
          @toggle-select-all-diff-items="toggleSelectAllDiffItems"
          @run-single-dag-step="runSingleDagStep"
          @apply-suggested-reply="handleApplySuggestedReply"
        />
      </div>
    </div>

    <!-- 对话态悬浮居中输入框 -->
    <div v-if="!isCurrentSessionEmpty" class="ai-dock-floating-container">
      <div
        class="ai-capsule-input-container dock-capsule"
        :class="{ focused: isInputFocused, 'drag-over': isDragOver }"
        @click="focusTextarea"
        @dragover.prevent="onWorkspaceDragOver"
        @drop.prevent="onWorkspaceDrop"
      >
        <div class="ai-capsule-main-row">
          <button
            type="button"
            class="capsule-icon-btn attach-btn"
            @click.stop="triggerFileInput"
            :title="t('ai.attachFile')"
            :aria-label="t('ai.attachFile')"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          <div class="capsule-textarea-wrap">
            <textarea
              ref="aiTextareaDockRef"
              v-model="aiQuery"
              class="capsule-minimal-textarea ai-minimal-textarea"
              :placeholder="isDragOver ? (isZh ? '松开鼠标以添加引用…' : 'Drop to attach reference...') : (isZh ? '继续向与链提问…' : 'Follow up with ulink...')"
              rows="1"
              @focus="isInputFocused = true"
              @blur="isInputFocused = false"
              @compositionstart="onCompositionStart"
              @compositionend="onCompositionEnd"
              @keydown="onTextareaKeyDown"
              @input="onTextareaInput"
              @dragover.prevent="onWorkspaceDragOver"
              @drop.prevent="onWorkspaceDrop"
            ></textarea>
          </div>

          <button
            v-if="aiLoading"
            class="capsule-send-btn stop active"
            @click.stop="handleStopGenerating"
            :title="t('ai.stopGenerating')"
            :aria-label="t('ai.stopGenerating')"
          >
            <span class="stop-box"></span>
          </button>
          <button
            v-else
            class="capsule-send-btn"
            :class="{ active: hasSubmittableContent }"
            :disabled="!hasSubmittableContent"
            @click.stop="submitQuery"
            :title="t('ai.searchAction') + ' (Enter)'"
            :aria-label="t('ai.searchAction')"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- 历史会话滑动抽屉（Raycast / Perplexity 级滑出抽屉） -->
    <Teleport to="body">
      <Transition name="drawer-fade">
        <div
          v-if="isHistoryDrawerOpen"
          class="ai-history-drawer-overlay"
          @click.self="isHistoryDrawerOpen = false"
        >
          <div class="ai-history-drawer" role="dialog" aria-modal="true">
            <!-- 抽屉头部 -->
            <div class="history-drawer-header">
              <div class="header-title-row">
                <span class="drawer-title">{{ isZh ? '历史会话' : 'Chat History' }}</span>
                <span class="drawer-count-badge">{{ sessions.length }}</span>
              </div>
              <div class="header-action-row">
                <button
                  class="drawer-new-chat-btn"
                  @click="createSessionFromDrawer"
                  :title="isZh ? '开启新对话' : 'New Chat'"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>{{ isZh ? '新对话' : 'New' }}</span>
                </button>
                <button
                  class="drawer-close-btn"
                  @click="isHistoryDrawerOpen = false"
                  :title="t('common.close')"
                  :aria-label="t('common.close')"
                >
                  &times;
                </button>
              </div>
            </div>

            <!-- 搜索框 -->
            <div class="history-drawer-search-box">
              <svg class="search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                v-model="historySearchQuery"
                type="text"
                class="history-search-input"
                :placeholder="isZh ? '搜索历史对话内容…' : 'Search chat history...'"
              />
              <button
                v-if="historySearchQuery"
                class="search-clear-btn"
                @click="historySearchQuery = ''"
              >
                &times;
              </button>
            </div>

            <!-- 会话滚动列表 -->
            <div class="history-drawer-scroll">
              <div v-if="filteredHistorySessions.length === 0" class="history-drawer-empty">
                {{ historySearchQuery ? (isZh ? '无匹配会话' : 'No matches found') : (isZh ? '暂无历史会话' : 'No chat history') }}
              </div>
              <div
                v-for="s in filteredHistorySessions"
                :key="s.id"
                class="drawer-session-card"
                :class="{ active: s.id === currentSessionId }"
                @click="selectSessionFromDrawer(s.id)"
              >
                <div class="session-card-main">
                  <div class="session-card-title-row">
                    <span class="session-active-dot" v-if="s.id === currentSessionId"></span>
                    <span class="session-card-title">{{ sessionItemTitle(s) }}</span>
                  </div>
                  <div class="session-card-meta">
                    <span>{{ formatTimeAgo(s.updatedAt) }}</span>
                    <span class="meta-dot">·</span>
                    <span>{{ s.turns.length }} {{ isZh ? '条消息' : 'messages' }}</span>
                  </div>
                </div>
                <button
                  class="session-card-del-btn"
                  @click.stop="deleteSessionFromDrawer(s.id)"
                  :title="t('common.delete')"
                  :aria-label="t('common.delete')"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- 抽屉底部 -->
            <div v-if="sessions.length > 1" class="history-drawer-footer">
              <button class="drawer-clear-all-btn" @click="clearAllFromDrawer">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span>{{ isZh ? '清空所有历史' : 'Clear all history' }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onUnmounted } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { t, isZh } from '../../i18n/index.js'
import ChatStream from './ChatStream.vue'
import { useAiChat, type ChatTurn } from '../../composables/domain/useAiChat.js'
import { useChatDisplay } from '../../composables/ui/useChatDisplay.js'
import { useChatInputInteraction } from '../../composables/ui/useChatInputInteraction.js'
import { useChatPanelShell } from '../../composables/ui/useChatPanelShell.js'
import { processFileForAi } from '../../lib/ai/attachmentHelper.js'
import { toast } from '../../lib/toast.js'
import { PAYLOAD_KEY } from '../../config/constants.js'

const ui = useUIStore()
const dataStore = useDataStore()

const workspaceRef = ref<HTMLElement | null>(null)
const scrollContainerRef = ref<HTMLElement | null>(null)
const aiTextareaRef = ref<HTMLTextAreaElement | null>(null)
const aiTextareaDockRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)

const activeTa = computed(() => aiTextareaRef.value || aiTextareaDockRef.value)

const {
  isInputFocused,
  attachedCardsList,
  handleAppendToNote,
  handleReplaceNote,
  handleSaveAsNewNote,
  handleLocateCard,
} = useChatPanelShell()

function scrollToBottom() {
  nextTick(() => {
    if (scrollContainerRef.value) {
      scrollContainerRef.value.scrollTop = scrollContainerRef.value.scrollHeight
    }
  })
}

function focusTextarea() {
  const ta = activeTa.value
  if (ta) ta.focus()
}

function adjustTextareaHeight() {
  const ta = activeTa.value
  if (!ta) return
  ta.style.height = 'auto'
  // 紧凑单行初始高度为 22px，告别空两行的旷量感；仅在多行时按需伸展
  const targetH = Math.min(Math.max(ta.scrollHeight, 22), 200)
  ta.style.height = `${targetH}px`
  ta.style.overflowY = ta.scrollHeight > 200 ? 'auto' : 'hidden'
}

const {
  sessions,
  currentSessionId,
  chatTurns,
  isCurrentSessionEmpty,
  currentSessionTitle,
  handleCreateSession,
  switchSession,
  handleDeleteSession,
  handleClearAllSessions,
  aiQuery,
  aiLoading,
  loadingText,
  handleAiSubmit,
  handleActionCardClick,
  hasUnaddedInTurn,
  addAllInTurn,
  revokeUserMessage,
  handleStopGenerating,
  getActionCardNavTarget,
  navigateToActionTarget,
  getCardCandidateList,
  isCandidateSelected,
  getSelectedCandidateCount,
  isAllCandidatesSelected,
  toggleCandidateSelection,
  toggleSelectAllCandidates,
  formatDomain,
  toggleDiffItemSelection,
  toggleSelectAllDiffItems,
  runSingleDagStep,
  SLASH_COMMANDS,
  dynamicQuickHints,
  applySlashCommand,
  inputHistory,
  historyCursor,
  tempInput,
} = useAiChat({
  onTurnsChanged: () => scrollToBottom(),
  onQueryChanged: () => adjustTextareaHeight(),
  focusInput: () => nextTick(() => activeTa.value?.focus()),
})

const {
  formatTimeAgo,
  formatReasoningSec,
  getCleanCopyText,
  sessionItemTitle,
  getTurnAttachedCards,
  getAttachedNotes,
  getTurnSegments,
  copiedActionKey,
  copyMessage,
} = useChatDisplay(chatTurns)

const {
  quickFill,
  handleKeyDown,
} = useChatInputInteraction({
  aiQuery,
  textareaRef: activeTa,
  slashCommands: SLASH_COMMANDS,
  applySlashCommand,
  submit: submitQuery,
  adjustTextareaHeight,
  inputHistory,
  historyCursor,
  tempInput,
})

const isComposing = ref(false)
const compositionJustEnded = ref(false)

function onCompositionStart() {
  isComposing.value = true
}

function onCompositionEnd(e: CompositionEvent) {
  isComposing.value = false
  compositionJustEnded.value = true
  setTimeout(() => {
    compositionJustEnded.value = false
  }, 60)

  const target = e.target as HTMLTextAreaElement
  if (target && target.value !== undefined) {
    aiQuery.value = target.value
  }
  nextTick(() => {
    adjustTextareaHeight()
  })
}

function onTextareaInput(e: Event) {
  const target = e.target as HTMLTextAreaElement
  if (target && target.value !== undefined) {
    aiQuery.value = target.value
  }
  adjustTextareaHeight()
}

function onTextareaKeyDown(e: KeyboardEvent) {
  // 1. 中文/输入法正在拼写中：放行给 IME 选词，绝不触发提交
  if (isComposing.value || e.isComposing || e.keyCode === 229) {
    return
  }

  const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13

  // 2. 防 Chrome on Windows 缺陷：刚通过 Enter 确认拼音的瞬间（compositionend 刚触发），
  // Chrome 会伴生一个尾随 Enter keydown，此时既不应发送，也不应产生空行
  if (compositionJustEnded.value) {
    if (isEnter) {
      e.preventDefault()
    }
    return
  }

  // 3. Shift + Enter：允许换行
  if (isEnter && e.shiftKey && !e.ctrlKey && !e.metaKey) {
    return
  }

  // 4. 单击 Enter 或 Ctrl/Cmd + Enter：发送消息
  if (isEnter) {
    e.preventDefault()
    e.stopPropagation()

    // 强行同步 DOM 当前值，防御极端场景下 v-model 尚未 flush 导致 hasSubmittableContent 为空
    const ta = activeTa.value
    if (ta && ta.value && !aiQuery.value) {
      aiQuery.value = ta.value
    }

    submitQuery()
    return
  }

  // 其他按键（Esc、Tab、上下方向键等）交由 useChatInputInteraction 处理
  handleKeyDown(e)
}

const hasAttachments = computed(() => attachedCardsList.value.length > 0 || ui.aiAttachedFiles.length > 0)
const hasSubmittableContent = computed(() => !!aiQuery.value.trim() || hasAttachments.value)

// 最近历史会话（最多取前 5 条，方便一键续聊）
const recentSessionsList = computed(() => {
  return sessions.value.slice(0, 5)
})

function onSelectRecentSession(sid: string) {
  switchSession(sid)
  nextTick(() => {
    scrollToBottom()
  })
}

// ── 历史会话滑动抽屉（Raycast / Perplexity 级弹层） ──
const isHistoryDrawerOpen = ref(false)
const historySearchQuery = ref('')

const filteredHistorySessions = computed(() => {
  const q = historySearchQuery.value.trim().toLowerCase()
  if (!q) return sessions.value
  return sessions.value.filter((s) => {
    const title = (s.title || '').toLowerCase()
    if (title.includes(q)) return true
    return s.turns.some((t) => t.content && t.content.toLowerCase().includes(q))
  })
})

function openHistoryDrawer() {
  historySearchQuery.value = ''
  isHistoryDrawerOpen.value = true
}

function selectSessionFromDrawer(id: string) {
  switchSession(id)
  isHistoryDrawerOpen.value = false
  scrollToBottom()
}

function createSessionFromDrawer() {
  onNewConversation()
  isHistoryDrawerOpen.value = false
}

function deleteSessionFromDrawer(id: string) {
  handleDeleteSession(id)
}

function clearAllFromDrawer() {
  handleClearAllSessions()
  isHistoryDrawerOpen.value = false
}

function onDrawerKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    isHistoryDrawerOpen.value = false
  }
}

watch(isHistoryDrawerOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onDrawerKeyDown)
  } else {
    window.removeEventListener('keydown', onDrawerKeyDown)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onDrawerKeyDown)
  window.removeEventListener('dragend', resetDragState)
  window.removeEventListener('drop', resetDragState)
})

function submitQuery() {
  const ta = activeTa.value
  if (ta && ta.value && !aiQuery.value) {
    aiQuery.value = ta.value
  }
  if (!hasSubmittableContent.value) return
  handleAiSubmit()
  scrollToBottom()
}

function onNewConversation() {
  handleCreateSession()
  aiQuery.value = ''
  nextTick(() => {
    adjustTextareaHeight()
    activeTa.value?.focus()
  })
}

function triggerFileInput() {
  fileInputRef.value?.click()
}

async function handleFileInputChange(e: Event) {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  for (let i = 0; i < files.length; i++) {
    try {
      const parsed = await processFileForAi(files[i])
      ui.attachFileToAi(parsed)
    } catch (err: unknown) {
      toast((err as Error).message || '文件解析失败', false)
    }
  }
  target.value = ''
}

let dragEnterCount = 0

function onWorkspaceDragEnter() {
  dragEnterCount++
  isDragOver.value = true
}

function onWorkspaceDragOver(e: DragEvent) {
  isDragOver.value = true
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onWorkspaceDragLeave() {
  dragEnterCount--
  if (dragEnterCount <= 0) {
    dragEnterCount = 0
    isDragOver.value = false
  }
}

function resetDragState() {
  dragEnterCount = 0
  isDragOver.value = false
}

window.addEventListener('dragend', resetDragState)
window.addEventListener('drop', resetDragState)

function onWorkspaceDrop(e: DragEvent) {
  resetDragState()
  e.preventDefault()
  e.stopPropagation()
  if (!e.dataTransfer) return
  let payload: { type?: string; id?: string; srcGid?: string } | null = null
  try {
    const raw = e.dataTransfer.getData(PAYLOAD_KEY)
    if (raw) payload = JSON.parse(raw)
  } catch (_) {}

  const rawId = payload?.id || ''
  const type = payload?.type

  if (type === 'cat' || rawId.startsWith('cat_') || dataStore.categoryMap[rawId]) {
    ui.attachCardToAi('cat', rawId)
    const cat = dataStore.categoryMap[rawId]
    toast(t('ai.cardAttached', { title: cat?.name || t('nav.categories') }), true)
  } else if (type === 'group' || rawId.startsWith('group:')) {
    ui.attachCardToAi('group', rawId)
    const g = dataStore.groupMap[rawId.replace(/^group:/, '')]
    toast(t('ai.cardAttached', { title: g?.name || t('cards.note') }), true)
  } else if (rawId && dataStore.bookmarkMap[rawId]) {
    ui.attachCardToAi('bm', rawId)
    const b = dataStore.bookmarkMap[rawId]
    toast(t('ai.cardAttached', { title: b?.title || t('cards.bookmark') }), true)
  }
}

function handleApplySuggestedReply(reply: string, turn: ChatTurn) {
  turn.suggestedReplies = []
  if ((reply.includes('执行') || reply.includes('确认')) && turn.actionCard && !turn.actionCard.completed) {
    handleActionCardClick(turn.actionCard, turn)
    return
  }
  if (reply.includes('全部一键加入收藏') || reply.includes('加入收藏')) {
    addAllInTurn(turn)
    return
  }
  if (reply.includes('存为卡片笔记') && turn.content) {
    handleSaveAsNewNote(turn.content)
    return
  }
  const cleanText = reply.replace(/^[\p{Emoji}\p{Symbol}\s]+/u, '').trim() || reply
  aiQuery.value = cleanText
  nextTick(() => {
    submitQuery()
  })
}

watch(
  () => ui.activeView,
  (view) => {
    if (view === 'ai') {
      nextTick(() => {
        adjustTextareaHeight()
        activeTa.value?.focus()
      })
    }
  },
  { immediate: true },
)

watch(
  () => ui.aiNewChatTrigger,
  () => {
    if (!isCurrentSessionEmpty.value) {
      onNewConversation()
    }
  },
)

watch(aiQuery, () => {
  nextTick(adjustTextareaHeight)
})
</script>

<style scoped>
.ai-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: var(--bg);
  background-image: radial-gradient(
    ellipse 860px 520px at 50% 42%,
    rgba(66, 133, 244, 0.05) 0%,
    rgba(255, 255, 255, 0.6) 45%,
    transparent 80%
  );
  position: relative;
  overflow: hidden;
  transition: background-color 0.25s ease;
}

:root[data-theme="dark"] .ai-workspace {
  background-color: #131314;
  background-image: radial-gradient(
    ellipse 860px 520px at 50% 42%,
    rgba(30, 80, 220, 0.12) 0%,
    rgba(20, 50, 160, 0.04) 45%,
    transparent 78%
  );
}

.ai-workspace.drop-active,
.ai-workspace.chat-drop-active {
  outline: none;
}

.ai-workspace.drop-active .ai-capsule-input-container,
.ai-workspace.chat-drop-active .ai-capsule-input-container,
.ai-capsule-input-container.chat-drop-active,
.ai-capsule-input-container.drag-over {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 3px var(--accent-light), 0 8px 24px var(--accent-glow) !important;
  transform: translateY(-1px);
}

/* ── 主滚动视口 ── */
.ai-scroll-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scroll-behavior: smooth;
  position: relative;
}

/* ── 空态：Gemini 风格纯粹极简居中看板 ── */
.ai-clean-hero {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px 80px;
  min-height: 100%;
}

.ai-clean-hero-box {
  width: 100%;
  max-width: 680px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 人本自然问候排印（对齐 Gemini 主视觉） */
.ai-hero-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 28px;
}

.ai-hero-headline {
  font-size: 2.1rem;
  font-weight: 500;
  letter-spacing: -0.025em;
  color: var(--text);
  margin: 0;
  font-family: var(--font-display, inherit);
  line-height: 1.25;
}

/* ── 核心胶囊输入框（Gemini 风格浑然一体大胶囊） ── */
.ai-capsule-input-container {
  width: 100%;
  border-radius: 28px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow:
    0 1px 0 0 rgba(255, 255, 255, 0.8) inset,
    0 4px 18px -2px rgba(0, 0, 0, 0.04),
    0 12px 32px -4px rgba(0, 0, 0, 0.06);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  transition: border-color 0.2s var(--ease-out), box-shadow 0.2s var(--ease-out), border-radius 0.2s ease;
  display: flex;
  flex-direction: column;
  cursor: text;
  padding: 6px 8px 6px 12px;
}

:root[data-theme="dark"] .ai-capsule-input-container {
  background: rgba(30, 31, 35, 0.85);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow:
    0 1px 0 0 rgba(255, 255, 255, 0.06) inset,
    0 4px 20px rgba(0, 0, 0, 0.4),
    0 16px 44px -8px rgba(0, 0, 0, 0.55);
}

.ai-capsule-input-container.focused,
.ai-capsule-input-container:focus-within {
  border-color: rgba(66, 133, 244, 0.55);
  box-shadow:
    0 1px 0 0 rgba(255, 255, 255, 0.9) inset,
    0 0 0 1px var(--accent),
    0 12px 36px -4px var(--accent-glow, rgba(18, 46, 138, 0.18));
}

:root[data-theme="dark"] .ai-capsule-input-container.focused,
:root[data-theme="dark"] .ai-capsule-input-container:focus-within {
  border-color: rgba(66, 133, 244, 0.4);
  box-shadow:
    0 1px 0 0 rgba(255, 255, 255, 0.1) inset,
    0 0 0 1px var(--accent),
    0 16px 48px -8px var(--accent-glow, rgba(240, 74, 138, 0.25));
}

/* 附件条 */
.ai-attachments-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 6px 8px;
}

.ai-attach-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  font-size: 0.76rem;
  color: var(--text);
}

.ai-attach-pill .pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.ai-attach-pill .pill-file-icon,
.ai-attach-pill .pill-cat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.ai-attach-pill.cat .pill-dot {
  display: none;
}

.ai-attach-pill .pill-file-icon svg,
.ai-attach-pill .pill-cat-icon svg {
  width: 12px;
  height: 12px;
  display: block;
}

.ai-attach-pill .pill-close {
  background: transparent;
  border: none;
  font-size: 0.85rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 2px;
}

/* 胶囊单行/多行主体行 */
.ai-capsule-main-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
}

/* + 附件圆形按钮 */
.capsule-icon-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.capsule-icon-btn:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.capsule-icon-btn:active {
  transform: scale(0.92);
}

/* 文本域容器与文本域 */
.capsule-textarea-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 0 4px;
  min-width: 0;
}

.capsule-minimal-textarea {
  width: 100%;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  background: transparent !important;
  color: var(--text);
  font-size: 0.96rem;
  line-height: 24px;
  resize: none;
  font-family: inherit;
  min-height: 24px;
  height: 24px;
  padding: 0 !important;
  margin: 0 !important;
  display: block;
  overflow-y: hidden;
}

.capsule-minimal-textarea::placeholder {
  color: var(--text-muted);
  opacity: 0.55;
  line-height: 24px;
}

/* 圆形发送按钮 */
.capsule-send-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: none;
  background: var(--surface-hover);
  color: var(--text-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.18s var(--ease-out);
}

.capsule-send-btn.active {
  background: var(--accent);
  color: #fff;
  transform: scale(1.02);
  box-shadow: 0 2px 10px var(--accent-glow);
}

.capsule-send-btn.active:hover {
  transform: scale(1.08);
}

.capsule-send-btn.active:active {
  transform: scale(0.94);
}

.capsule-send-btn:disabled {
  opacity: 0.28;
  cursor: not-allowed;
}

.capsule-send-btn.stop {
  background: var(--rose, #ef4444);
  color: #fff;
}

.stop-box {
  width: 8px;
  height: 8px;
  background: #fff;
  border-radius: 1.5px;
}

/* ── 最近会话轻量悬浮底座（严格单行，保留续聊能力，绝不占据主舞台） ── */
.ai-hero-recent-shelf {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 32px;
  padding: 0 12px;
  width: 100%;
  max-width: 680px;
  box-sizing: border-box;
}

.recent-shelf-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  opacity: 0.8;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}

.recent-shelf-label svg {
  opacity: 0.75;
  flex-shrink: 0;
}

.recent-shelf-pills {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  min-width: 0;
}

.recent-shelf-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  border-radius: var(--radius-full);
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  font-size: 0.76rem;
  cursor: pointer;
  transition: all 0.16s ease;
  max-width: 220px;
  min-width: 0;
  flex-shrink: 1;
  white-space: nowrap;
}

.recent-shelf-item:hover {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border);
  transform: translateY(-1px);
}

.recent-shelf-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── 对话态：多轮流与微型会话栏 ── */
.ai-dialogue-stream-wrap {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 16px 20px 120px;
  flex: 1;
}

.ai-stream-meta-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-light);
}

.stream-title-text {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-muted);
}

.stream-new-chat-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.15s ease;
}

.stream-new-chat-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-light);
}

.ai-dock-floating-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px 20px 20px;
  background: linear-gradient(to top, var(--bg) 70%, transparent);
  pointer-events: none;
  z-index: 15;
}

.ai-capsule-input-container.dock-capsule {
  max-width: 760px;
  margin: 0 auto;
  pointer-events: auto;
  backdrop-filter: blur(16px);
}

.recent-shelf-item.recent-shelf-all-btn {
  background: var(--surface-hover);
  border-color: var(--border-light);
  color: var(--text);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 4px 10px;
}

.recent-shelf-item.recent-shelf-all-btn:hover {
  background: var(--accent-light, rgba(66, 133, 244, 0.1));
  border-color: var(--accent);
  color: var(--accent);
}

.shelf-count-tag {
  font-size: 0.68rem;
  background: var(--surface);
  color: var(--text-muted);
  padding: 1px 5px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-light);
  line-height: 1.1;
}

.stream-history-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: var(--radius-full);
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  font-size: 0.74rem;
  cursor: pointer;
  transition: all 0.15s ease;
  margin-left: 8px;
}

.stream-history-pill-btn:hover {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}

/* ── 历史会话滑动抽屉（Raycast / Perplexity 级滑出抽屉） ── */
.ai-history-drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.ai-history-drawer {
  width: 380px;
  max-width: 90vw;
  height: 100%;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 36px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

:root[data-theme="dark"] .ai-history-drawer {
  background: #191a1e;
  border-left-color: rgba(255, 255, 255, 0.08);
  box-shadow: -10px 0 44px rgba(0, 0, 0, 0.65);
}

.history-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border-light);
}

.header-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text);
}

.drawer-count-badge {
  font-size: 0.72rem;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  background: var(--surface-hover);
  color: var(--text-muted);
  font-weight: 500;
}

.header-action-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.drawer-new-chat-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.drawer-new-chat-btn:hover {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.drawer-close-btn {
  background: transparent;
  border: none;
  font-size: 1.3rem;
  line-height: 1;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-xs, 4px);
  transition: color 0.15s ease;
}

.drawer-close-btn:hover {
  color: var(--text);
}

.history-drawer-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin: 12px 18px 6px;
  border-radius: var(--radius-md, 8px);
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
}

.history-drawer-search-box .search-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.history-search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.85rem;
  color: var(--text);
}

.history-search-input::placeholder {
  color: var(--text-muted);
  opacity: 0.6;
}

.search-clear-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 4px;
}

.history-drawer-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-drawer-empty {
  padding: 40px 10px;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.drawer-session-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: var(--radius-md, 8px);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.drawer-session-card:hover {
  background: var(--surface-hover);
  border-color: var(--border-light);
}

.drawer-session-card.active {
  background: var(--surface-hover);
  border-color: var(--accent);
}

.session-card-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.session-card-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-active-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.session-card-title {
  font-size: 0.86rem;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-card-meta {
  font-size: 0.72rem;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

.meta-dot {
  opacity: 0.5;
}

.session-card-del-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 5px;
  border-radius: var(--radius-xs, 4px);
  opacity: 0;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.drawer-session-card:hover .session-card-del-btn {
  opacity: 0.7;
}

.session-card-del-btn:hover {
  opacity: 1 !important;
  color: var(--rose, #ef4444);
  background: rgba(239, 68, 68, 0.1);
}

.history-drawer-footer {
  padding: 10px 18px 14px;
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: flex-end;
}

.drawer-clear-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  font-size: 0.76rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-xs, 4px);
  transition: all 0.15s ease;
}

.drawer-clear-all-btn:hover {
  color: var(--rose, #ef4444);
  background: rgba(239, 68, 68, 0.08);
}

.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.22s ease;
}

.drawer-fade-enter-active .ai-history-drawer,
.drawer-fade-leave-active .ai-history-drawer {
  transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-fade-enter-from .ai-history-drawer,
.drawer-fade-leave-to .ai-history-drawer {
  transform: translateX(100%);
}

@media (max-width: 768px) {
  .ai-clean-hero {
    padding: 20px 14px 60px;
  }
  .ai-dialogue-stream-wrap {
    padding: 12px 12px 110px;
  }
  .ai-dock-floating-container {
    padding: 6px 12px 14px;
  }
}
</style>
