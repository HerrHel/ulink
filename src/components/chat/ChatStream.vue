<template>
        <!-- 初始空态：淡雅、温和、轻量的文字引导 -->
        <div v-if="chatTurns.length === 0" class="chat-empty-state">
          <div class="chat-empty-inner">
            <svg class="chat-empty-sparkle" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" />
            </svg>
            <p class="chat-empty-lead">{{ t('ai.emptyLead') }}</p>
            <p class="chat-empty-sub">{{ t('ai.emptySub') }}</p>
            <div class="chat-quick-hints" role="group" :aria-label="t('ai.emptyLead')">
              <template v-for="(hint, hIdx) in dynamicQuickHints" :key="hint.query">
                <button
                  type="button"
                  class="hint-text-btn"
                  @click="emit('quickFill', hint.query)"
                >
                  <svg class="hint-pill-icon" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M6 3.5l4.5 4.5L6 12.5" />
                  </svg>
                  <span>{{ hint.label }}</span>
                </button>
                <span v-if="hIdx < dynamicQuickHints.length - 1" class="hint-dot" aria-hidden="true">·</span>
              </template>
            </div>
          </div>
        </div>

        <!-- 对话流 (具备无障碍 live region 广播标准) -->
        <div
          class="chat-flow-list"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-label="AI 对话记录"
        >
          <div
            v-for="turn in chatTurns"
            :key="turn.id"
            class="chat-turn-item"
            :class="`turn-${turn.role}`"
          >
            <!-- 用户消息：轻量气泡与微操作栏（复制 / 撤回） -->
            <div v-if="turn.role === 'user'" class="chat-user-wrap">
              <div class="chat-user-bubble">
                <div v-if="turn.attachedCards && turn.attachedCards.length > 0" class="chat-user-attachments">
                  <span
                    v-for="c in turn.attachedCards"
                    :key="c.id"
                    class="user-attachment-pill"
                    :class="`pill-${c.type}`"
                  >
                    <span class="pill-badge">{{ c.type === 'group' ? t('cards.note') : t('cards.bookmark') }}</span>
                    <span class="pill-text">{{ c.title }}</span>
                  </span>
                </div>
                <div class="chat-user-text">{{ turn.content }}</div>
              </div>
              <!-- 发送前透明摘要：本次实际发给 AI 的数据构成（条数/字段/截断情况），可展开（隐私透明） -->
              <div v-if="turn.sendSummary" class="chat-send-summary">
                <button
                  type="button"
                  class="send-summary-toggle"
                  :aria-expanded="!!openSummaries[turn.id]"
                  @click="openSummaries[turn.id] = !openSummaries[turn.id]"
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <span>{{ t('ai.sendSummaryTitle') }}</span>
                  <span class="send-summary-arrow" :class="{ open: !!openSummaries[turn.id] }">
                    <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </button>
                <div v-if="openSummaries[turn.id]" class="send-summary-body">
                  <div v-for="(line, lIdx) in getSendSummaryLines(turn.sendSummary)" :key="lIdx" class="send-summary-line">{{ line }}</div>
                  <div class="send-summary-note">{{ t('ai.sendSummaryNote') }}</div>
                </div>
              </div>
              <div class="chat-msg-actions user-actions">
                <button
                  class="chat-msg-act-btn"
                  :class="{ 'is-copied': copiedActionKey === `user-${turn.id}` }"
                  @click="emit('copyMessage', turn.content, `user-${turn.id}`)"
                  :title="copiedActionKey === `user-${turn.id}` ? t('ai.copied') : t('ai.copyContent')"
                  :aria-label="copiedActionKey === `user-${turn.id}` ? t('ai.copied') : t('ai.copyContent')"
                >
                  <svg v-if="copiedActionKey === `user-${turn.id}`" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <svg v-else viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                  </svg>
                </button>
                <button
                  class="chat-msg-act-btn"
                  @click="emit('revokeUserMessage', turn)"
                  :title="t('ai.revokeEdit')"
                  :aria-label="t('ai.revokeEdit')"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- 助手回复 -->
            <div v-else class="chat-assistant-wrap">
              <!-- 初始思考等待：当尚无任何思考和内容流出时，展示三点呼吸动效 -->
              <div v-if="turn.loading && !turn.reasoning && !turn.content" class="chat-thinking-pulse">
                <span class="thinking-dot dot-1"></span>
                <span class="thinking-dot dot-2"></span>
                <span class="thinking-dot dot-3"></span>
                <span class="thinking-label">{{ loadingText }}</span>
              </div>

              <!-- 回复内容、思考过程与候选卡片 -->
              <div v-else class="chat-reply-body">
                <!-- 深度思考过程折叠条 (Thinking Process) -->
                <div v-if="turn.reasoning" class="chat-thinking-box" :class="{ 'is-thinking': turn.isThinking }">
                  <button
                    class="chat-thinking-header"
                    @click="emit('toggleThinkingOpen', turn)"
                    :title="turn._thinkingOpen ? t('ai.thinkingCollapse') : t('ai.thinkingExpand')"
                    :aria-expanded="!!turn._thinkingOpen"
                  >
                    <div class="thinking-header-left">
                      <!-- 动态 Sparkle 图标：思考中旋转，完成后静止 -->
                      <svg
                        class="thinking-icon"
                        :class="{ 'is-spinning': turn.isThinking }"
                        viewBox="0 0 24 24"
                        width="12"
                        height="12"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path v-if="turn.isThinking" d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        <path v-else d="m12 3 1.912 5.885a2 2 0 0 0 1.272 1.272L21 12l-5.816 1.843a2 2 0 0 0-1.272 1.272L12 21l-1.912-5.885a2 2 0 0 0-1.272-1.272L3 12l5.816-1.843a2 2 0 0 0 1.272-1.272L12 3z" />
                      </svg>
                      <span class="thinking-header-title">
                        <template v-if="turn.isThinking">
                          {{ t('ai.thinkingActive') }}
                        </template>
                        <template v-else-if="turn.reasoningTimeMs">
                          {{ t('ai.thinkingTime', { sec: formatReasoningSec(turn.reasoningTimeMs) }) }}
                        </template>
                        <template v-else>
                          {{ t('ai.thinkingComplete') }}
                        </template>
                      </span>
                    </div>

                    <span class="thinking-arrow" :class="{ open: turn._thinkingOpen }">
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                  </button>

                  <div v-if="turn._thinkingOpen" class="chat-thinking-body">
                    <div class="chat-thinking-text">{{ turn.reasoning }}<span v-if="turn.isThinking" class="thinking-stream-cursor" aria-hidden="true"></span></div>
                  </div>
                </div>

                <!-- 工具执行轨迹折叠条 (Tool Execution Trace) -->
                <div v-if="turn.steps?.length" class="chat-trace-wrap">
                  <button
                    class="chat-trace-toggle-btn"
                    @click="emit('toggleTraceOpen', turn)"
                    :title="turn._traceOpen ? t('ai.traceCollapse') : t('ai.traceExpand')"
                    :aria-expanded="!!turn._traceOpen"
                  >
                    <span class="trace-tag">{{ t('ai.traceTag') }}</span>
                    <span class="trace-summary">{{ turn.steps[turn.steps.length - 1]?.text }}</span>
                    <span class="trace-arrow" :class="{ open: turn._traceOpen }">
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </span>
                  </button>
                  <div v-if="turn._traceOpen" class="chat-trace-dropdown">
                    <div v-for="(step, sIdx) in turn.steps" :key="sIdx" class="chat-trace-step-item">
                      <span class="trace-step-icon">
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span class="trace-step-text">{{ step.text }}</span>
                    </div>
                  </div>
                </div>

                <!-- 核心回复流：正文与随文嵌入卡片图文交融 -->
                <div v-if="turn.content || turn.candidates?.length" class="chat-reply-flow-wrap">
                  <div class="chat-flow-header">
                    <button
                      class="chat-msg-act-btn"
                      :class="{ 'is-copied': copiedActionKey === `asst-${turn.id}` }"
                      @click="emit('copyMessage', getCleanCopyText(turn.content), `asst-${turn.id}`)"
                      :title="copiedActionKey === `asst-${turn.id}` ? t('ai.copied') : t('ai.copyReply')"
                      :aria-label="copiedActionKey === `asst-${turn.id}` ? t('ai.copied') : t('ai.copyReply')"
                    >
                      <svg v-if="copiedActionKey === `asst-${turn.id}`" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <svg v-else viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                    </button>
                  </div>

                  <div class="chat-flow-content">
                    <template v-for="(seg, sIdx) in getTurnSegments(turn)" :key="sIdx">
                      <div
                        v-if="seg.type === 'text'"
                        class="chat-flow-text"
                      >
                        <span v-html="seg.html"></span>
                        <span
                          v-if="turn.loading && !turn.isThinking && sIdx === getTurnSegments(turn).length - 1"
                          class="chat-typing-cursor"
                          aria-hidden="true"
                        ></span>
                      </div>
                      <div
                        v-else-if="seg.type === 'card'"
                        class="chat-flow-card-row"
                      >
                        <AiInlineCard :candidate="seg.candidate" />
                      </div>
                    </template>
                  </div>

                  <!-- 消息尾部：当含有未存入的候选卡片时，在底部收敛呈现一键全部存入 -->
                  <div v-if="hasUnaddedInTurn(turn) && !turn.loading" class="chat-flow-footer-actions">
                    <button class="chat-batch-add-btn" @click="emit('addAllInTurn', turn)">
                      <span class="batch-add-icon" aria-hidden="true" v-html="I.plus"></span>
                      <span>{{ t('ai.addAllDirect') }}</span>
                    </button>
                  </div>

                  <!-- 知识沉淀与反向写回操作条 (Bi-directional Knowledge Write-Back & Card Locating) -->
                  <div v-if="!turn.loading && turn.content" class="chat-writeback-toolbar">
                    <!-- 若当轮包含关联笔记，展示追加到原笔记与替换原笔记 -->
                    <template v-if="getAttachedNotes(turn).length > 0">
                      <button
                        v-for="note in getAttachedNotes(turn)"
                        :key="'append-' + note.id"
                        class="writeback-btn writeback-append"
                        :title="t('ai.writebackAppend') + ': ' + note.title"
                        @click="emit('handleAppendToNote', note.id, turn.content)"
                      >
                        <span class="writeback-btn-icon" aria-hidden="true">📥</span>
                        <span>{{ t('ai.writebackAppend') }}</span>
                      </button>
                      <button
                        v-for="note in getAttachedNotes(turn)"
                        :key="'replace-' + note.id"
                        class="writeback-btn writeback-replace"
                        :title="t('ai.writebackReplace') + ': ' + note.title"
                        @click="emit('handleReplaceNote', note.id, turn.content)"
                      >
                        <span class="writeback-btn-icon" aria-hidden="true">🔄</span>
                        <span>{{ t('ai.writebackReplace') }}</span>
                      </button>
                    </template>

                    <!-- 始终提供存为新笔记 -->
                    <button
                      class="writeback-btn writeback-new"
                      :title="t('ai.writebackNew')"
                      @click="emit('handleSaveAsNewNote', turn.content)"
                    >
                      <span class="writeback-btn-icon" aria-hidden="true">📝</span>
                      <span>{{ t('ai.writebackNew') }}</span>
                    </button>

                    <!-- 当轮有关联卡片或笔记时，提供在主网格高亮定位 -->
                    <button
                      v-for="card in getTurnAttachedCards(turn)"
                      :key="'locate-' + card.id"
                      class="writeback-btn writeback-locate"
                      :title="t('ai.locateInVault') + ': ' + card.title"
                      @click="emit('handleLocateCard', card.id, card.type === 'group' ? 'group' : 'bookmark')"
                    >
                      <span class="writeback-btn-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="12" cy="12" r="3" />
                          <line x1="12" y1="2" x2="12" y2="5" />
                          <line x1="12" y1="19" x2="12" y2="22" />
                          <line x1="2" y1="12" x2="5" y2="12" />
                          <line x1="19" y1="12" x2="22" y2="12" />
                        </svg>
                      </span>
                      <span>{{ card.type === 'group' ? t('ai.locateAttachedNote') : t('ai.locateAttachedCard') }}</span>
                    </button>
                  </div>
                </div>

                <!-- 交互行动卡片 (Actionable Artifact / Generative UI) -->
                <ChatDraftDiff
                  v-if="turn.actionCard && turn.actionCard.type === 'draft_diff'"
                  :card="turn.actionCard"
                  @toggle-item-selection="(id) => emit('toggleDiffItemSelection', turn.actionCard!, id)"
                  @toggle-select-all="() => emit('toggleSelectAllDiffItems', turn.actionCard!)"
                  @apply-diff="() => emit('handleActionCardClick', turn.actionCard!, turn)"
                />
                <ChatDagPlan
                  v-else-if="turn.actionCard && turn.actionCard.type === 'dag_plan'"
                  :card="turn.actionCard"
                  @execute-all="() => emit('handleActionCardClick', turn.actionCard!, turn)"
                  @execute-step="(stepId) => emit('runSingleDagStep', turn.actionCard!, stepId)"
                />
                <div
                  v-else-if="turn.actionCard"
                  class="chat-action-card"
                  :class="{
                    'is-completed': turn.actionCard.completed,
                    'is-executing': turn.actionCard.executing,
                  }"
                >
                  <div class="action-card-header">
                    <span class="action-card-badge">{{ t('ai.actionSuggest') }}</span>
                    <span class="action-card-title">{{ turn.actionCard.title }}</span>
                  </div>
                  <div v-if="turn.actionCard.desc" class="action-card-desc">
                    {{ turn.actionCard.desc }}
                  </div>

                  <!-- 候选微操过滤：多选框列表 (Micro-Curation Checkboxes) -->
                  <div
                    v-if="turn.actionCard.actionName === 'create_topic_workspace' && getCardCandidateList(turn.actionCard).length > 0 && !turn.actionCard.completed"
                    class="action-card-curation"
                  >
                    <div class="action-card-curation-head">
                      <span class="action-card-curation-count">
                        {{ t('ai.selectedCount', { n: getSelectedCandidateCount(turn.actionCard) }) }}
                      </span>
                      <button
                        type="button"
                        class="action-card-curation-toggle"
                        @click="emit('toggleSelectAllCandidates', turn.actionCard)"
                      >
                        {{ isAllCandidatesSelected(turn.actionCard) ? t('ai.unselectAll') : t('ai.selectAll') }}
                      </button>
                    </div>
                    <div class="action-card-candidate-list">
                      <label
                        v-for="c in getCardCandidateList(turn.actionCard)"
                        :key="c.url"
                        class="action-candidate-item"
                        :class="{ 'is-checked': isCandidateSelected(turn.actionCard, c.url) }"
                      >
                        <input
                          type="checkbox"
                          class="action-candidate-checkbox"
                          :checked="isCandidateSelected(turn.actionCard, c.url)"
                          :disabled="turn.actionCard.executing"
                          @change="emit('toggleCandidateSelection', turn.actionCard, c.url)"
                        />
                        <div class="action-candidate-info">
                          <span class="action-candidate-name">{{ c.title }}</span>
                          <span class="action-candidate-domain">{{ formatDomain(c.url) }}</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div class="action-card-footer">
                    <button
                      v-if="!turn.actionCard.completed"
                      class="action-card-btn"
                      :class="{ 'is-executing': turn.actionCard.executing }"
                      :disabled="turn.actionCard.executing || (turn.actionCard.actionName === 'create_topic_workspace' && getCardCandidateList(turn.actionCard).length > 0 && getSelectedCandidateCount(turn.actionCard) === 0)"
                      @click="emit('handleActionCardClick', turn.actionCard, turn)"
                    >
                      <svg
                        v-if="turn.actionCard.executing"
                        class="action-card-spinner"
                        viewBox="0 0 24 24"
                        width="11"
                        height="11"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                      <span>{{ turn.actionCard.executing ? t('ai.executing') : turn.actionCard.buttonText }}</span>
                    </button>
                    <div v-else class="action-card-done-wrap">
                      <span class="action-card-done">
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        {{ t('ai.actionDone') }}
                      </span>
                      <button
                        v-if="getActionCardNavTarget(turn.actionCard)"
                        class="action-card-nav-btn"
                        @click="emit('navigateToActionTarget', turn.actionCard)"
                        :title="t('ai.goToWorkspace')"
                      >
                        <span>{{ t('ai.goToWorkspace') }}</span>
                        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
</template>

<script setup lang="ts">
// 中部对话流：初始空态 + 对话轮次流（自 DetailPanel.vue 模板抽取，行为零变化）
// 数据、展示函数与动作逻辑全部留在父组件 DetailPanel（vm 绑定测试依赖），本组件只做渲染与事件上抛
import type { ChatTurn, ChatActionCard, AttachedCardMeta } from '../../lib/ai/chatSessions.js'
import type { ChatContentSegment } from '../../lib/ai/chatStreamParser.js'
import type { AiSendSummary } from '../../lib/ai/sendSummary.js'
import { reactive } from 'vue'
import { useI18n } from '../../i18n/index.js'
import { I } from '../../config/icons.js'
import AiInlineCard from '../cards/AiInlineCard.vue'
import ChatDraftDiff from './ChatDraftDiff.vue'
import ChatDagPlan from './ChatDagPlan.vue'

defineOptions({ name: 'ChatStream' })

/** 空态快捷提示项（对齐 useAiChat 内部未导出的 QuickHint 形态） */
interface QuickHint {
  label: string
  query: string
}

/** 行动卡片 payload 内候选条目（对齐 useAiActionCards 内部未导出的 ActionCardCandidate 形态，模板只读 title/url） */
interface ActionCardCandidate {
  title: string
  url: string
  [key: string]: unknown
}

defineProps<{
  /** 对话轮次列表（只读渲染；思考/轨迹折叠态翻转经 toggle* 事件上抛） */
  chatTurns: ChatTurn[]
  /** 空态快捷提示项 */
  dynamicQuickHints: QuickHint[]
  /** 复制成功态 key（user-<id> / asst-<id>） */
  copiedActionKey: string | null
  /** 加载态提示文案（已由父侧 t() 渲染） */
  loadingText: string
  // ── 展示类函数（签名照抄父侧 useChatDisplay / useAiChat / useAiActionCards 实际类型）──
  formatReasoningSec: (ms?: number) => string
  getCleanCopyText: (content?: string) => string
  getTurnSegments: (turn: ChatTurn) => ChatContentSegment[]
  getTurnAttachedCards: (turn: ChatTurn) => AttachedCardMeta[]
  getAttachedNotes: (turn: ChatTurn) => AttachedCardMeta[]
  hasUnaddedInTurn: (turn: ChatTurn) => boolean
  getCardCandidateList: (card: ChatActionCard) => ActionCardCandidate[]
  getSelectedCandidateCount: (card: ChatActionCard) => number
  isAllCandidatesSelected: (card: ChatActionCard) => boolean
  isCandidateSelected: (card: ChatActionCard, url: string) => boolean
  formatDomain: (url: string) => string
  getActionCardNavTarget: (card: ChatActionCard) => string | null
}>()

// 事件上抛：动作调用参数原样透传，父组件绑定原函数（折叠态翻转为等价内联表达式）
const emit = defineEmits<{
  quickFill: [query: string]
  copyMessage: [text: string, actionKey?: string]
  revokeUserMessage: [turn: ChatTurn]
  toggleThinkingOpen: [turn: ChatTurn]
  toggleTraceOpen: [turn: ChatTurn]
  addAllInTurn: [turn: ChatTurn]
  handleAppendToNote: [noteId: string, content: string]
  handleReplaceNote: [noteId: string, content: string]
  handleSaveAsNewNote: [content: string]
  handleLocateCard: [id: string, type: 'bookmark' | 'group']
  toggleSelectAllCandidates: [card: ChatActionCard]
  toggleCandidateSelection: [card: ChatActionCard, url: string]
  handleActionCardClick: [card: ChatActionCard, turn: ChatTurn]
  navigateToActionTarget: [card: ChatActionCard]
  toggleDiffItemSelection: [card: ChatActionCard, itemId: string]
  toggleSelectAllDiffItems: [card: ChatActionCard]
  runSingleDagStep: [card: ChatActionCard, stepId: string]
}>()

const { t } = useI18n()

// 发送摘要展开态：组件内部纯 UI 状态（不影响 vm 绑定的展示函数与动作事件）
const openSummaries = reactive<Record<string, boolean>>({})

/** 发送摘要展示行（i18n 渲染，按实际注入字段动态拼装；截断情况如实标注） */
function getSendSummaryLines(summary: AiSendSummary): string[] {
  const lines: string[] = []
  lines.push(t('ai.sendSummaryTaxonomy', { cats: summary.categoriesCount, attrs: summary.attributesCount }))
  if (summary.focusedGroup) {
    const trunc = summary.focusedGroup.shown < summary.focusedGroup.total ? t('ai.sendSummaryTruncated') : ''
    lines.push(
      t('ai.sendSummaryWorkspace', {
        name: summary.focusedGroup.name,
        shown: summary.focusedGroup.shown,
        total: summary.focusedGroup.total,
      }) + trunc,
    )
  }
  if (summary.selected) {
    const trunc = summary.selected.shown < summary.selected.total ? t('ai.sendSummaryTruncated') : ''
    lines.push(
      t('ai.sendSummarySelected', { shown: summary.selected.shown, total: summary.selected.total }) + trunc,
    )
  }
  lines.push(t('ai.sendSummaryCards', { n: summary.attachedCardsCount }))
  lines.push(
    summary.vaultKnowledgeChars > 0
      ? t('ai.sendSummaryRagOn', { chars: summary.vaultKnowledgeChars })
      : t('ai.sendSummaryRagOff'),
  )
  // 个人记忆注入条数（旧持久化摘要无此字段时如实缺省不显示）
  if (typeof summary.profileEntries === 'number') {
    lines.push(t('ai.sendSummaryMemory', { n: summary.profileEntries }))
  }
  lines.push(t('ai.sendSummaryHistory', { n: summary.historyTurnsIncluded }))
  lines.push(
    t('ai.sendSummaryChars', {
      prompt: summary.userPromptChars,
      system: summary.systemPromptChars,
      total: summary.estimatedTotalChars,
    }),
  )
  return lines
}
</script>
<style scoped>
/* 空态：淡雅、温和、纸质极客感引导 */
.chat-empty-state {
  height: 100%;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  text-align: center;
}

.chat-empty-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 280px;
}

.chat-empty-sparkle {
  display: block;
  color: var(--accent);
  margin-bottom: 10px;
  opacity: 0.85;
}

.chat-empty-lead {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 6px 0;
  letter-spacing: -0.15px;
}

.chat-empty-sub {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.55;
  margin: 0 0 16px 0;
}

.chat-quick-hints {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 280px;
}

.hint-dot {
  display: none;
}

/* 提示胶囊：与主站卡片 Tag 质感一致，拥有立体悬浮微光感 */
.hint-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
  border-radius: 9999px;
  box-shadow: var(--shadow-xs);
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  letter-spacing: -0.1px;
  line-height: 1.3;
}

.hint-pill-icon {
  color: var(--accent);
  opacity: 0.75;
  flex-shrink: 0;
  transition: transform 0.14s ease, opacity 0.14s ease;
}

.hint-text-btn:hover {
  color: var(--accent);
  background: var(--surface-hover);
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px var(--accent-glow);
}

.hint-text-btn:hover .hint-pill-icon {
  opacity: 1;
  transform: translateX(1px);
}

.hint-text-btn:active {
  transform: translateY(0) scale(0.97);
}

:global([data-theme="dark"]) .hint-text-btn {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset;
}

:global([data-theme="dark"]) .hint-text-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--surface-hover);
  box-shadow: 0 0 0 1px var(--accent-glow), 0 4px 12px rgba(0, 0, 0, 0.35);
}

/* 对话流 */
.chat-flow-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-turn-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  animation: chat-fade-in-up 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes chat-fade-in-up {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 用户气泡与微操作区：主站卡片式质感 */
.chat-user-wrap {
  align-self: flex-end;
  max-width: 86%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.chat-user-bubble {
  padding: 8px 12px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 14px 14px 3px 14px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.55;
  word-break: break-word;
  letter-spacing: -0.01em;
  box-shadow: var(--shadow-xs);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

:global([data-theme="dark"]) .chat-user-bubble {
  background: var(--surface-hover);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset, 0 2px 6px rgba(0, 0, 0, 0.25);
}

.chat-msg-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.chat-user-wrap:hover .chat-msg-actions,
.chat-user-wrap:focus-within .chat-msg-actions {
  opacity: 1;
}

@media (hover: none) {
  .chat-msg-actions {
    opacity: 0.7;
  }
}

.chat-msg-act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-xs, 4px);
  transition: all 0.12s ease;
}

.chat-msg-act-btn svg {
  display: block;
  flex-shrink: 0;
}

.chat-msg-act-btn:hover {
  color: var(--accent);
  background: var(--surface-hover);
}

.chat-msg-act-btn.is-copied {
  color: var(--green, #2e7d32);
}

.chat-msg-act-btn.is-copied:hover {
  color: var(--green, #2e7d32);
}

.chat-assistant-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

/* 思考状态：极简微动效三点 */
.chat-thinking-pulse {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 2px;
}

.thinking-dot {
  width: 4.5px;
  height: 4.5px;
  border-radius: 50%;
  background: var(--accent);
  animation: dot-pulse 1.2s infinite ease-in-out;
}
.dot-1 { animation-delay: 0s; }
.dot-2 { animation-delay: 0.2s; }
.dot-3 { animation-delay: 0.4s; }

@keyframes dot-pulse {
  0%, 80%, 100% { opacity: 0.2; transform: scale(0.85); }
  40% { opacity: 1; transform: scale(1.15); }
}

.thinking-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 4px;
}

/* 深度思考流 (Reasoning Stream) - 纸质缩进手记质感，与主站便签块保持一致 */
.chat-thinking-box {
  margin-bottom: 6px;
  background: color-mix(in srgb, var(--surface) 94%, var(--surface-active) 6%);
  border: 1px solid var(--border-light);
  border-left: 2.5px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.02);
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.chat-thinking-box.is-thinking {
  border-left-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 4%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-light));
  box-shadow: inset 0 1px 2px rgba(44, 40, 36, 0.02);
}

:global([data-theme="dark"]) .chat-thinking-box {
  background: color-mix(in srgb, var(--surface) 95%, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--border);
  border-left: 2.5px solid var(--border-hover);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.04) inset;
}

:global([data-theme="dark"]) .chat-thinking-box.is-thinking {
  border-left-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px var(--accent-glow);
}

.chat-thinking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 5px 9px;
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: color 0.12s ease;
}

.chat-thinking-header:hover {
  color: var(--text);
}

.thinking-header-left {
  display: flex;
  align-items: center;
  gap: 5px;
}

.thinking-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.thinking-icon.is-spinning {
  animation: thinking-spin 1.8s linear infinite;
}

@keyframes thinking-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.thinking-header-title {
  font-weight: 600;
  letter-spacing: -0.1px;
}

.thinking-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.thinking-arrow.open {
  transform: rotate(180deg);
}

.chat-thinking-body {
  padding: 8px 12px 10px;
  border-top: 1px solid var(--border-light);
  background: var(--surface);
  max-height: 240px;
  overflow-y: auto;
}

.chat-thinking-text {
  font-size: 11.5px;
  line-height: 1.62;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-sans);
}

/* 思考中的流式闪烁光标 */
.thinking-stream-cursor {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: 4px;
  vertical-align: 1px;
  border-radius: 50%;
  background-color: var(--accent);
  animation: cursor-pulse 0.7s ease-in-out infinite alternate;
}

@keyframes cursor-pulse {
  from { opacity: 0.2; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1.2); }
}

/* 正文流式打字机竖线光标 */
.chat-typing-cursor {
  display: inline-block;
  width: 2px;
  height: 12px;
  margin-left: 2px;
  vertical-align: -1px;
  background-color: var(--accent);
  border-radius: 1px;
  animation: typing-blink 0.8s infinite;
}

@keyframes typing-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.chat-reply-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 核心回复流：正文与随文嵌入卡片图文交融 */
.chat-reply-flow-wrap {
  position: relative;
  font-size: 13px;
  color: var(--text);
  padding: 0 1px;
}

/* 回复操作行：随内容流布局（右对齐、自占一行），
   绝对定位浮层会盖住正文首行文字（复制按钮与内容重叠），故不浮层 */
.chat-flow-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.chat-assistant-wrap:hover .chat-flow-header,
.chat-assistant-wrap:focus-within .chat-flow-header {
  opacity: 1;
}

@media (hover: none) {
  .chat-flow-header {
    opacity: 0.7;
  }
}

.chat-flow-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  word-break: break-word;
  line-height: 1.68;
}

.chat-flow-text {
  font-size: 13px;
  color: var(--text);
  letter-spacing: -0.01em;
}

.chat-flow-text :deep(.chat-flow-heading) {
  margin: 12px 0 5px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.02em;
}

.chat-flow-text :deep(.chat-flow-para) {
  margin: 4px 0 10px;
  line-height: 1.68;
  color: var(--text);
}

.chat-flow-text :deep(strong) {
  font-weight: 600;
  color: var(--text);
}

.chat-flow-text :deep(.chat-flow-code) {
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  padding: 2px 5px;
  border-radius: var(--radius-xs, 4px);
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  color: var(--accent);
}

:global([data-theme="dark"]) .chat-flow-text :deep(.chat-flow-code) {
  background: var(--surface-hover);
  border-color: var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset;
}

.chat-flow-text :deep(.chat-flow-list) {
  margin: 4px 0 8px 16px;
  padding: 0;
  line-height: 1.65;
}

.chat-flow-text :deep(.chat-flow-list li) {
  margin-bottom: 4px;
}

.chat-flow-text :deep(.chat-flow-link) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
  word-break: break-all;
  transition: opacity 0.12s ease;
}

.chat-flow-text :deep(.chat-flow-link:hover) {
  opacity: 0.8;
}

.chat-flow-card-row {
  margin: 6px 0 8px;
  min-height: 48px;
  contain: layout;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.chat-flow-footer-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border-light);
}

.chat-batch-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-light);
  border: 1px solid transparent;
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.chat-batch-add-btn:hover {
  background: var(--accent);
  color: #ffffff;
  transform: translateY(-1px);
}

.chat-batch-add-btn:active {
  transform: translateY(0) scale(0.97);
}

.batch-add-icon :deep(svg) {
  width: 11px;
  height: 11px;
}

/* 知识沉淀与双向卡片定位操作条 (Knowledge Write-back & Deep Locating Toolbar) */
.chat-writeback-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--border);
}

.writeback-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: var(--radius-xs, 4px);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: var(--shadow-xs);
  line-height: 1.4;
}

.writeback-btn:hover {
  border-color: var(--border-hover);
  color: var(--text);
  background: var(--surface-hover);
  transform: translateY(-0.5px);
}

.writeback-btn:active {
  transform: translateY(0) scale(0.97);
}

.writeback-append:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
}

.writeback-replace:hover {
  border-color: var(--amber, #f59e0b);
  color: var(--amber, #f59e0b);
  background: var(--amber-light, rgba(245, 158, 11, 0.1));
}

.writeback-new:hover {
  border-color: var(--green);
  color: var(--green);
  background: var(--green-light);
}

.writeback-locate:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
}

.writeback-btn-icon {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
}

.writeback-btn-icon :deep(svg) {
  width: 12px;
  height: 12px;
}

:global([data-theme="dark"]) .writeback-btn {
  background: var(--surface);
  border-color: var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset;
}

:global([data-theme="dark"]) .writeback-btn:hover {
  background: var(--surface-hover);
}

/* 工具调用轨迹 (Tool Execution Trace) */
.chat-trace-wrap {
  margin-bottom: 2px;
}

.chat-trace-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: 9999px;
  padding: 2px 9px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.02);
  transition: all 0.14s ease;
}

.chat-trace-toggle-btn:hover {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
  transform: translateY(-1px);
}

.trace-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: -0.2px;
  flex-shrink: 0;
}

.trace-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.trace-arrow {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.15s ease;
}

.trace-arrow.open {
  transform: rotate(180deg);
}

.chat-trace-dropdown {
  margin-top: 4px;
  padding: 6px 8px;
  background: var(--surface-hover);
  border-radius: var(--radius-xs, 4px);
  border-left: 2px solid var(--accent);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.chat-trace-step-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.trace-step-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--accent);
}

.trace-step-text {
  flex: 1;
  min-width: 0;
}

/* 交互行动卡片 (Actionable Artifact / Generative UI) - 优雅质感工坊，采用主站卡片级材质 */
.chat-action-card {
  margin-top: 6px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: var(--shadow-card);
  transition: box-shadow 0.25s var(--ease-out), border-color 0.2s ease, transform 0.25s var(--ease-out), background-color 0.2s ease;
}

.chat-action-card:hover {
  box-shadow: var(--shadow-card-hover);
  border-color: var(--border-hover);
  transform: translateY(-1px);
}

:global([data-theme="dark"]) .chat-action-card {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.08) inset,
              0 0 0 1px rgba(255, 255, 255, 0.06),
              0 2px 8px rgba(0, 0, 0, 0.25);
}

:global([data-theme="dark"]) .chat-action-card:hover {
  border-color: var(--border-hover);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.13) inset,
              0 0 0 1px rgba(255, 255, 255, 0.1),
              0 8px 24px -4px rgba(0, 0, 0, 0.5),
              0 2px 6px rgba(0, 0, 0, 0.25);
}

.chat-action-card.is-completed {
  background: color-mix(in srgb, var(--surface) 94%, var(--accent-light) 6%);
  border-color: color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
}

.chat-action-card.is-executing {
  opacity: 0.92;
}

.action-card-header {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
}

.action-card-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 9999px;
  background: var(--accent-light);
  color: var(--accent);
  letter-spacing: -0.1px;
  flex-shrink: 0;
}

.action-card-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.15px;
}

.action-card-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 8px;
}

/* 候选微操过滤列表 */
.action-card-curation {
  margin: 8px 0 10px 0;
  padding: 8px 10px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm, 6px);
}

.action-card-curation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}

.action-card-curation-count {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--accent);
}

.action-card-curation-toggle {
  background: none;
  border: none;
  padding: 0;
  font-size: 10.5px;
  color: var(--text-muted);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.12s ease;
}

.action-card-curation-toggle:hover {
  color: var(--text);
}

.action-card-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 130px;
  overflow-y: auto;
}

.action-candidate-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: none;
}

.action-candidate-item:hover {
  background: var(--surface);
}

.action-candidate-item.is-checked {
  background: color-mix(in srgb, var(--surface) 75%, var(--accent-light) 25%);
}

.action-candidate-checkbox {
  appearance: auto;
  accent-color: var(--accent);
  width: 13px;
  height: 13px;
  margin: 0;
  cursor: pointer;
}

.action-candidate-info {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.action-candidate-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.action-candidate-domain {
  font-size: 9.5px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.action-card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.action-card-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-size: 11.5px;
  font-weight: 600;
  border-radius: var(--radius-xs, 4px);
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #ffffff;
  cursor: pointer;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--accent) 30%, transparent);
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.action-card-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 3px 8px color-mix(in srgb, var(--accent) 40%, transparent);
}

.action-card-btn:active:not(:disabled) {
  transform: translateY(0) scale(0.97);
}

.action-card-btn.is-executing,
.action-card-btn:disabled {
  opacity: 0.75;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.action-card-spinner {
  animation: thinking-spin 1s linear infinite;
  flex-shrink: 0;
}

.action-card-done-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.action-card-done {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--accent);
  font-weight: 600;
}

.action-card-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 9px;
  font-size: 11px;
  font-weight: 500;
  border-radius: var(--radius-xs, 4px);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--accent);
  cursor: pointer;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.action-card-nav-btn:hover {
  background: var(--accent-light);
  border-color: var(--accent);
  transform: translateY(-1px);
}

.action-card-nav-btn:active {
  transform: translateY(0) scale(0.97);
}

/* 用户气泡内关联卡片标签：主站微胶囊质感 */
.chat-user-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
  padding-bottom: 5px;
  border-bottom: 1px dashed color-mix(in srgb, var(--border) 60%, transparent);
}

.user-attachment-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1.5px 6px;
  border-radius: var(--radius-xs, 4px);
  background: var(--surface);
  border: 1px solid var(--border);
  font-size: 11px;
  color: var(--text);
  max-width: 100%;
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.02);
}

:global([data-theme="dark"]) .user-attachment-pill {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset;
}

.user-attachment-pill .pill-badge {
  font-size: 9.5px;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--surface-hover);
  color: var(--text-muted);
}

.user-attachment-pill.pill-group .pill-badge {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.user-attachment-pill .pill-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

/* 发送前透明摘要：随内容流布局的隐私披露条（不遮挡正文，右对齐贴合气泡） */
.chat-send-summary {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  margin-top: 2px;
}

.send-summary-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  background: transparent;
  border: 1px solid transparent;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 9999px;
  transition: color 0.12s ease, background 0.12s ease, border-color 0.12s ease;
  line-height: 1.4;
}

.send-summary-toggle:hover {
  color: var(--accent);
  background: var(--surface-hover);
  border-color: var(--border);
}

.send-summary-arrow {
  display: inline-flex;
  align-items: center;
  transition: transform 0.16s ease;
}

.send-summary-arrow.open {
  transform: rotate(180deg);
}

.send-summary-body {
  width: 100%;
  padding: 7px 10px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-left: 2.5px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
}

:global([data-theme="dark"]) .send-summary-body {
  background: var(--surface);
  border-color: var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.04) inset;
}

.send-summary-line {
  font-size: 10.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.send-summary-note {
  margin-top: 3px;
  padding-top: 4px;
  border-top: 1px dashed var(--border-light);
  font-size: 10px;
  color: var(--text-muted);
}
</style>
