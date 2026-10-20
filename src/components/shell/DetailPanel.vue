<template>
  <div
    ref="detailPanelRef"
    class="detail-panel ulink-simple-chat"
    :class="{ open: isOpen, swiping: isSwiping, 'chat-drop-active': isDragOverPanel, 'floating-hud': isFloatingHud && !isMobileDevice }"
    :style="panelStyle"
    id="detailPanel"
    @dragover.prevent="onPanelDragOver"
    @dragleave="onPanelDragLeave"
    @drop.prevent="onPanelDrop"
  >
    <div class="detail-drag-handle" id="detailDragHandle"></div>

    <ChatTopBar
      v-model:menu-open="isSessionMenuOpen"
      :current-session-title="currentSessionTitle"
      :is-current-session-empty="isCurrentSessionEmpty"
      :sessions="sessions"
      :current-session-id="currentSessionId"
      :is-mobile-device="isMobileDevice"
      :is-floating-hud="isFloatingHud"
      :session-item-title="sessionItemTitle"
      :format-time-ago="formatTimeAgo"
      @create-session="handleCreateSession"
      @delete-session="handleDeleteSession"
      @clear-all-sessions="handleClearAllSessions"
      @switch-session="switchSession"
      @toggle-float-hud="toggleFloatingHud"
      @close="closeEntirePanel"
    />

    <!-- 中间区域：对话流 -->
    <div class="detail-inner chat-scroll-body" id="detailInner" ref="chatScrollRef">

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
    />

    </div>

    <ChatInputDock
      v-model:query="aiQuery"
      v-model:focused="isInputFocused"
      v-model:active-index="activeSlashIndex"
      :attached-cards-list="attachedCardsList"
      :slash-items="filteredSlashCommands"
      :show-slash="showSlashSuggest"
      :ai-loading="aiLoading"
      :textarea-ref="aiTextareaRefObj"
      @apply-slash="applySlashCommand"
      @submit="handleAiSubmit"
      @stop="handleStopGenerating"
      @ta-keydown="handleKeyDown"
      @adjust-height="adjustTextareaHeight"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import ChatInputDock from '../chat/ChatInputDock.vue'
import ChatStream from '../chat/ChatStream.vue'
import ChatTopBar from '../chat/ChatTopBar.vue'
import { useAiChat } from '../../composables/domain/useAiChat.js'
import { useChatDisplay } from '../../composables/ui/useChatDisplay.js'
import { useChatPanelDom } from '../../composables/ui/useChatPanelDom.js'
import { useChatPanelShell } from '../../composables/ui/useChatPanelShell.js'
import { useChatInputInteraction } from '../../composables/ui/useChatInputInteraction.js'

const ui = useUIStore()
const detailPanelRef = ref<HTMLElement | null>(null)
const aiTextareaRef = ref<HTMLTextAreaElement | null>(null)
// 模板表达式会自动解包 ref，包一层 computed 以 ref 对象本体传给 ChatInputDock（子组件与父侧共享同一 ref，
// useChatPanelDom/useChatInputInteraction 的接线不变）
const aiTextareaRefObj = computed(() => aiTextareaRef)
const chatScrollRef = ref<HTMLElement | null>(null)

// ── 面板壳层（开合 / 聚焦态 / 会话菜单+外部点击 / 浮动 HUD / 附件列表 / note 写回）抽至 useChatPanelShell ──
const {
  isOpen,
  isInputFocused,
  isSessionMenuOpen,
  isMobileDevice,
  isFloatingHud,
  toggleFloatingHud,
  attachedCardsList,
  handleAppendToNote,
  handleReplaceNote,
  handleSaveAsNewNote,
  handleLocateCard,
  closeEntirePanel,
} = useChatPanelShell()

// ── 面板 DOM 行为（拖拽悬停 / 滚动到底 / 输入框自适应高度 / 下滑关闭手势）抽至 useChatPanelDom；
//    getQuery 惰性读取 useAiChat 的 aiQuery（延迟到其初始化后） ──
const {
  isDragOverPanel,
  onPanelDragOver,
  onPanelDragLeave,
  onPanelDrop,
  scrollToBottom,
  adjustTextareaHeight,
  isSwiping,
  panelStyle,
} = useChatPanelDom({
  panelRef: detailPanelRef,
  textareaRef: aiTextareaRef,
  scrollRef: chatScrollRef,
  getQuery: () => aiQuery.value,
})

// ── AI 调度逻辑抽至 useAiChat（会话管理 / 提交调度 / 行动卡片 / 斜杠命令）；
//    DOM 副作用（滚动到底、输入框聚焦/高度、会话菜单收起）由本组件回调注入 ──
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
  SLASH_COMMANDS,
  dynamicQuickHints,
  applySlashCommand,
  inputHistory,
  historyCursor,
  tempInput,
} = useAiChat({
  onTurnsChanged: () => scrollToBottom(),
  onQueryChanged: () => adjustTextareaHeight(),
  focusInput: () => nextTick(() => aiTextareaRef.value?.focus()),
  closeSessionMenu: () => {
    isSessionMenuOpen.value = false
  },
})

// ── 展示层纯逻辑（格式化 / 轮次渲染数据组装 / 复制消息）抽至 useChatDisplay ──
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

// ── 斜杠指令快捷联想（文案走 i18n，与语言包 slash* 键一一对应）──
// SLASH_COMMANDS 与 dynamicQuickHints 已随调度逻辑迁至 useAiChat

// 行动卡片辅助与执行（getActionCardNavTarget / navigateToActionTarget / 候选多选微操 /
// handleActionCardClick）已随调度逻辑迁至 useAiChat

// revokeUserMessage（撤回并回填输入框）已随调度逻辑迁至 useAiChat

// ── 输入框交互（斜杠联想 / 键盘调度 / ↑↓ 历史回溯 / quickFill）抽至 useChatInputInteraction ──
const {
  activeSlashIndex,
  showSlashSuggest,
  filteredSlashCommands,
  quickFill,
  handleKeyDown,
} = useChatInputInteraction({
  aiQuery,
  textareaRef: aiTextareaRef,
  slashCommands: SLASH_COMMANDS,
  applySlashCommand,
  submit: handleAiSubmit,
  adjustTextareaHeight,
  inputHistory,
  historyCursor,
  tempInput,
})

watch(
  () => ui.aiAssistantInitialQuery,
  (val) => {
    if (val) {
      aiQuery.value = val
      ui.aiAssistantInitialQuery = ''
      adjustTextareaHeight()
      nextTick(() => {
        handleAiSubmit()
      })
    }
  },
  { immediate: true },
)

// applySlashCommand（斜杠补全）已随调度逻辑迁至 useAiChat

// ── 终端式命令历史回溯 (↑ / ↓) 状态由 useAiChat 提供（inputHistory / historyCursor / tempInput）──

watch(
  () => isOpen.value,
  (open) => {
    if (open) {
      nextTick(() => {
        adjustTextareaHeight()
        aiTextareaRef.value?.focus()
      })
    }
  },
)
</script>

<style scoped>
.ulink-simple-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 根节点禁止写 position：本元素同时是 .detail-panel，其定位归全局布局管
     （.is-mobile .detail-panel 的 position:fixed 底部抽屉）。scoped 规则与全局
     规则 specificity 打平、出厂顺序更靠后，一旦写 position 就会覆写 fixed：
     抽屉变回流内元素后 translateY(100%) 关不掉，且 width:100%+flex-shrink:0
     会把主内容区挤到 0 宽（移动端整页空白）。内部浮层各自有相对定位锚点
     （.chat-top-title-wrap/.chat-reply-flow-wrap/.chat-input-dock），根节点无需做包含块。 */
  background: var(--surface);
  color: var(--text);
  font-family: var(--font-sans);
  min-width: 0 !important;
  box-sizing: border-box;
  border-left: 1px solid var(--border);
  box-shadow: -4px 0 16px -2px rgba(44, 40, 36, 0.04), inset 1px 0 0 0 var(--border-light);
}

/* 深色模式下强化与主站卡片高度统一的高光切边与深邃阴影，彻底消除融底与发糊感 */
:global([data-theme="dark"]) .detail-panel {
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 28px -4px rgba(0, 0, 0, 0.5), inset 1px 0 0 0 rgba(255, 255, 255, 0.08);
}

/* 滚动内容区 */
.chat-scroll-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
  min-width: 0 !important;
  box-sizing: border-box;
  scroll-behavior: smooth;
  scrollbar-width: thin;
  scrollbar-color: var(--border-light) transparent;
}
.chat-scroll-body::-webkit-scrollbar {
  width: 4px;
}
.chat-scroll-body::-webkit-scrollbar-thumb {
  background: var(--border-light);
  border-radius: 9999px;
}

/* 拖拽卡片投掷到 AI 对话框活跃态：与主站拖拽光晕一致 */
.detail-panel.chat-drop-active {
  outline: 2px dashed var(--accent);
  outline-offset: -3px;
  background: color-mix(in srgb, var(--accent) 3%, var(--surface)) !important;
  box-shadow: inset 0 0 0 3px var(--accent-light) !important;
}

:global([data-theme="dark"]) .detail-panel.chat-drop-active {
  background: color-mix(in srgb, var(--accent) 6%, var(--surface)) !important;
  box-shadow: inset 0 0 0 3px var(--accent-glow) !important;
}

.detail-panel.chat-drop-active :deep(.chat-input-wrapper) {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
}

/* 移动端底部抽屉深度模式质感强化：与 CornerInspectorCard 完全统一 */
:global([data-theme="dark"]) .is-mobile .detail-panel {
  border-top: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.12) inset, 0 -12px 36px rgba(0, 0, 0, 0.6);
}

/* 桌面端浮动窗口 (Floating PiP HUD) 模式：脱离流布局，主网格完整延展，支持多任务无压浏览 */
.detail-panel.floating-hud {
  position: fixed !important;
  right: 20px !important;
  bottom: 20px !important;
  top: auto !important;
  width: 420px !important;
  max-width: calc(100vw - 40px) !important;
  height: 640px !important;
  max-height: calc(100vh - 40px) !important;
  border-radius: var(--radius-lg, 12px) !important;
  border: 1px solid var(--border) !important;
  box-shadow: 0 16px 48px -8px rgba(0, 0, 0, 0.28), 0 0 0 1px var(--border) !important;
  z-index: var(--z-modal, 1000) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  background: var(--surface) !important;
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.detail-panel.floating-hud:not(.open) {
  opacity: 0 !important;
  pointer-events: none !important;
  transform: scale(0.96) translateY(12px) !important;
}

.detail-panel.floating-hud.open {
  opacity: 1 !important;
  pointer-events: auto !important;
  transform: scale(1) translateY(0) !important;
}

:global([data-theme="dark"]) .detail-panel.floating-hud {
  box-shadow: 0 20px 60px -10px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1) !important;
  background: color-mix(in srgb, var(--surface) 92%, transparent) !important;
}

/* 注意：:global() 必须包裹完整选择器；写成 :global(:has(...)) #resizeRight 会被 scoped 编译截断成 :has(...){display:none}，
   使 body/#app 等全部祖先节点被隐藏（曾导致 e2e 设置按钮不可见的回归） */
:global(:has(.detail-panel.floating-hud.open) #resizeRight) {
  display: none !important;
}
</style>