<template>
  <div
    ref="detailPanelRef"
    class="detail-panel ulink-simple-chat"
    :class="{ open: isOpen, swiping: isSwiping }"
    :style="panelStyle"
    id="detailPanel"
  >
    <div class="detail-drag-handle" id="detailDragHandle"></div>

    <!-- 顶部标题栏：会话切换常驻左侧，暂存卡片入口与操作居右 -->
    <div class="chat-top-bar">
      <div class="chat-top-title-wrap">
        <button
          class="chat-session-dropdown-btn"
          @click.stop="isSessionMenuOpen = !isSessionMenuOpen"
          :title="t('ai.switchSession')"
          :aria-label="t('ai.switchSession')"
        >
          <span class="chat-current-title">{{ currentSessionTitle }}</span>
          <svg
            class="dropdown-chevron"
            :class="{ open: isSessionMenuOpen }"
            viewBox="0 0 16 16"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        <!-- 会话历史下拉浮层 -->
        <div v-if="isSessionMenuOpen" class="session-dropdown-popover" @click.stop>
          <div class="session-popover-header">
            <button
              class="session-new-btn"
              :class="{ 'is-disabled': isCurrentSessionEmpty }"
              :disabled="isCurrentSessionEmpty"
              @click="handleCreateSession"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              <span>{{ t('ai.newSession') }}</span>
            </button>
          </div>
          <div class="session-list-scroll">
            <div
              v-for="s in sessions"
              :key="s.id"
              class="session-item"
              :class="{ active: s.id === currentSessionId }"
              @click="switchSession(s.id)"
            >
              <span class="session-item-dot"></span>
              <div class="session-item-meta">
                <span class="session-item-title">{{ s.title }}</span>
                <span class="session-item-time">{{ formatTimeAgo(s.updatedAt) }}</span>
              </div>
              <button
                class="session-item-del"
                @click.stop="handleDeleteSession(s.id)"
                :title="t('common.delete')"
                :aria-label="t('common.delete')"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div v-if="sessions.length === 0" class="session-empty">
              {{ t('ai.noHistory') }}
            </div>
          </div>
          <div v-if="sessions.length > 1" class="session-popover-foot">
            <button class="session-clear-all-btn" @click="handleClearAllSessions">
              {{ t('ai.clearAllHistory') }}
            </button>
          </div>
        </div>
      </div>

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

      <div class="chat-top-actions">
        <button
          v-if="currentTab === 'ai'"
          class="chat-btn-icon"
          :class="{ 'is-disabled': isCurrentSessionEmpty }"
          :disabled="isCurrentSessionEmpty"
          @click="handleCreateSession"
          :title="isCurrentSessionEmpty ? t('ai.alreadyNewSession') : t('ai.newSession')"
          :aria-label="t('ai.newSession')"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
        <button
          class="chat-btn-icon"
          @click="closeEntirePanel"
          :title="t('common.close')"
          :aria-label="t('common.close')"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 中间区域：对话流 / 暂存卡片 -->
    <div class="detail-inner chat-scroll-body" id="detailInner" ref="chatScrollRef">
      <!-- 对话模式 -->
      <template v-if="currentTab === 'ai'">
        <!-- 初始空态：淡雅、温和、轻量的文字引导 -->
        <div v-if="chatTurns.length === 0" class="chat-empty-state">
          <div class="chat-empty-inner">
            <svg class="chat-empty-sparkle" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" />
            </svg>
            <p class="chat-empty-lead">{{ t('ai.emptyLead') }}</p>
            <p class="chat-empty-sub">{{ t('ai.emptySub') }}</p>
            <div class="chat-quick-hints">
              <template v-for="(hint, hIdx) in dynamicQuickHints" :key="hint.query">
                <button class="hint-text-btn" @click="quickFill(hint.query)">{{ hint.label }}</button>
                <span v-if="hIdx < dynamicQuickHints.length - 1" class="hint-dot">·</span>
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
                {{ turn.content }}
              </div>
              <div class="chat-msg-actions user-actions">
                <button
                  class="chat-msg-act-btn"
                  :class="{ 'is-copied': copiedActionKey === `user-${turn.id}` }"
                  @click="copyMessage(turn.content, `user-${turn.id}`)"
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
                  @click="revokeUserMessage(turn)"
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
                    @click="turn._thinkingOpen = !turn._thinkingOpen"
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
                    @click="turn._traceOpen = !turn._traceOpen"
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
                      @click="copyMessage(getCleanCopyText(turn.content), `asst-${turn.id}`)"
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
                    <button class="chat-batch-add-btn" @click="addAllInTurn(turn)">
                      <span class="batch-add-icon" aria-hidden="true" v-html="I.plus"></span>
                      <span>{{ t('ai.addAllDirect') }}</span>
                    </button>
                  </div>
                </div>

                <!-- 交互行动卡片 (Actionable Artifact / Generative UI) -->
                <div
                  v-if="turn.actionCard"
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
                        @click="toggleSelectAllCandidates(turn.actionCard)"
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
                          @change="toggleCandidateSelection(turn.actionCard, c.url)"
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
                      @click="handleActionCardClick(turn.actionCard, turn)"
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
                        @click="navigateToActionTarget(turn.actionCard)"
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

    <!-- 底部常驻：单一精致对话框（集成斜杠联想与停止生成） -->
    <div class="chat-input-dock">
      <!-- 斜杠指令快捷补全浮动条 -->
      <div v-if="showSlashSuggest && filteredSlashCommands.length" class="slash-suggest-dock">
        <div
          v-for="(item, idx) in filteredSlashCommands"
          :key="item.cmd"
          class="slash-suggest-item"
          :class="{ active: idx === activeSlashIndex }"
          @click="applySlashCommand(item.cmd)"
          @mouseenter="activeSlashIndex = idx"
        >
          <span class="slash-cmd-tag">{{ item.cmd }}</span>
          <span class="slash-cmd-title">{{ item.title }}</span>
          <span class="slash-cmd-desc">{{ item.desc }}</span>
        </div>
      </div>

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
        <!-- 停止生成 / 发送按钮平滑切换 -->
        <button
          v-if="aiLoading"
          class="chat-send-btn stop active"
          @click="handleStopGenerating"
          :title="t('ai.stopGenerating')"
          :aria-label="t('ai.stopGenerating')"
        >
          <span class="stop-square"></span>
        </button>
        <button
          v-else
          class="chat-send-btn"
          :class="{ active: !!aiQuery.trim() }"
          :disabled="!aiQuery.trim()"
          @click="handleAiSubmit"
          :title="t('ai.searchAction') + ' (Enter)'"
          :aria-label="t('ai.searchAction')"
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
import { isMobile, domain } from '../../utils.js'
import { I } from '../../config/icons.js'
import { useI18n } from '../../i18n/index.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import BookmarkCard from '../cards/BookmarkCard.vue'
import GroupCard from '../cards/GroupCard.vue'
import AiInlineCard from '../cards/AiInlineCard.vue'
import { parseTurnContentSegments, type ChatContentSegment } from '../../lib/ai/chatStreamParser.js'
import {
  searchWebsitesByIntent,
  findSimilarWebsites,
  extractBookmarksFromVideo,
} from '../../lib/ai/cloudAiClient.js'
import { askMiMoStream, getMiMoConfig } from '../../lib/ai/mimoClient.js'
import {
  dispatchSiteCommand,
  mergeDuplicateBookmarks,
  applyInboxZeroClustering,
  createTopicWorkspace,
  healDeadlink,
} from '../../lib/ai/siteCommander.js'
import { candidateToBookmark } from '../../lib/ai/candidateSave.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { saveAppData } from '../../stores/app.js'
import {
  loadSessions,
  saveSessions,
  createNewSession,
  updateSession,
  deleteSessionById,
  clearAllSessions,
  getCurrentSessionId,
  setCurrentSessionId,
  type AiChatSession,
  type ChatTurn,
  type ChatActionCard,
} from '../../lib/ai/chatSessions.js'
import { buildDetailCards } from './buildDetailCards.js'
import type { DetailEntry } from './buildDetailCards.js'
import type { AiSearchPreference } from '../../types/ai.js'

const { t, locale } = useI18n()
const isZh = computed(() => locale.value.startsWith('zh'))

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
// 加载态提示按分流切换：思考中 → 甄选/分析/提炼中
const loadingTextKey = ref('ai.thinking')
const loadingText = computed(() => t(loadingTextKey.value))
// 默认采用最佳偏好（完全免费 + 国内直连），无需用户在界面手动配置
const preferences = ref<AiSearchPreference[]>(['free', 'no_proxy'])

// ── 多会话管理 (方案 A) ──
const sessions = ref<AiChatSession[]>(loadSessions())
const currentSessionId = ref<string>(getCurrentSessionId() || '')
const isSessionMenuOpen = ref(false)
const chatTurns = ref<ChatTurn[]>([])

const isCurrentSessionEmpty = computed(() => chatTurns.value.length === 0)

// 初始化当前会话
if (!currentSessionId.value || !sessions.value.some((s) => s.id === currentSessionId.value)) {
  if (sessions.value.length > 0) {
    currentSessionId.value = sessions.value[0].id
    setCurrentSessionId(sessions.value[0].id)
    chatTurns.value = [...sessions.value[0].turns]
  } else {
    const fresh = createNewSession()
    currentSessionId.value = fresh.id
    sessions.value = [fresh]
    chatTurns.value = []
  }
} else {
  const cur = sessions.value.find((s) => s.id === currentSessionId.value)
  if (cur) chatTurns.value = [...cur.turns]
}

// 自动清理历史中非当前会话的无内容空会话，保持会话列表整洁
if (sessions.value.length > 1) {
  const cleaned = sessions.value.filter(
    (s) => s.id === currentSessionId.value || s.turns.length > 0,
  )
  if (cleaned.length !== sessions.value.length) {
    saveSessions(cleaned)
    sessions.value = cleaned
  }
}

const currentSessionTitle = computed(() => {
  const s = sessions.value.find((x) => x.id === currentSessionId.value)
  if (!s || s.title === '新会话') return t('ai.sessionDefaultTitle')
  return s.title
})

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60000) return t('ai.timeJustNow')
  if (diff < 3600000) return t('ai.timeMinutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('ai.timeHoursAgo', { n: Math.floor(diff / 3600000) })
  return new Date(timestamp).toLocaleDateString(isZh.value ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric' })
}

function handleCreateSession() {
  // 若当前已经是新会话且已有空会话存在，不再重复创建新会话
  if (isCurrentSessionEmpty.value && sessions.value.length > 0) {
    isSessionMenuOpen.value = false
    nextTick(() => aiTextareaRef.value?.focus())
    return
  }
  abortInFlight()
  const fresh = createNewSession()
  currentSessionId.value = fresh.id
  sessions.value = loadSessions()
  chatTurns.value = []
  aiQuery.value = ''
  isSessionMenuOpen.value = false
  adjustTextareaHeight()
  nextTick(() => aiTextareaRef.value?.focus())
}

function switchSession(id: string) {
  if (id === currentSessionId.value) {
    isSessionMenuOpen.value = false
    return
  }
  // 离开前中止在途检索并持久化旧会话（含被停止的思考气泡），防悬挂气泡被带走/丢失
  abortInFlight()
  // 若离开当前会话时，当前会话未产生任何问答，自动清理此空会话，防止残留无用草稿
  if (chatTurns.value.length === 0 && currentSessionId.value) {
    deleteSessionById(currentSessionId.value)
    sessions.value = loadSessions()
  }
  const target = sessions.value.find((s) => s.id === id)
  if (!target) return
  currentSessionId.value = id
  setCurrentSessionId(id)
  chatTurns.value = [...target.turns]
  isSessionMenuOpen.value = false
  scrollToBottom()
  nextTick(() => aiTextareaRef.value?.focus())
}

async function handleDeleteSession(id: string) {
  const target = sessions.value.find((s) => s.id === id)
  if (!target) return
  const title = target.title || t('ai.thisSession')
  isSessionMenuOpen.value = false
  const ok = await showConfirm(t('ai.deleteSessionConfirm', { title }))
  if (!ok) return

  const backupSession: AiChatSession = {
    ...target,
    turns: target.turns.map((turn) => ({ ...turn })),
  }
  sessions.value = deleteSessionById(id)
  if (currentSessionId.value === id) {
    if (sessions.value.length > 0) {
      switchSession(sessions.value[0].id)
    } else {
      handleCreateSession()
    }
  }

  toastWithUndo(
    t('ai.sessionDeleted', { title }),
    () => {
      const all = loadSessions()
      all.unshift(backupSession)
      saveSessions(all)
      sessions.value = loadSessions()
      switchSession(backupSession.id)
    },
  )
}

async function handleClearAllSessions() {
  isSessionMenuOpen.value = false
  const ok = await showConfirm(t('ai.clearAllConfirm'))
  if (!ok) return

  clearAllSessions()
  sessions.value = []
  handleCreateSession()
  toast(t('ai.clearedAllToast'), true)
}

// ── 斜杠指令快捷联想（文案走 i18n，与语言包 slash* 键一一对应）──
const SLASH_COMMANDS = [
  { cmd: '/help', titleKey: 'ai.slashHelpTitle', descKey: 'ai.slashHelpDesc' },
  { cmd: '/health', titleKey: 'ai.slashHealthTitle', descKey: 'ai.slashHealthDesc' },
  { cmd: '/inbox', titleKey: 'ai.slashInboxTitle', descKey: 'ai.slashInboxDesc' },
  { cmd: '/pack', titleKey: 'ai.slashPackTitle', descKey: 'ai.slashPackDesc' },
  { cmd: '/theme', titleKey: 'ai.slashThemeTitle', descKey: 'ai.slashThemeDesc' },
  { cmd: '/view', titleKey: 'ai.slashViewTitle', descKey: 'ai.slashViewDesc' },
  { cmd: '/cat', titleKey: 'ai.slashCatTitle', descKey: 'ai.slashCatDesc' },
  { cmd: '/trash', titleKey: 'ai.slashTrashTitle', descKey: 'ai.slashTrashDesc' },
  { cmd: '/dedup', titleKey: 'ai.slashDedupTitle', descKey: 'ai.slashDedupDesc' },
  { cmd: '/deadlink', titleKey: 'ai.slashDeadlinkTitle', descKey: 'ai.slashDeadlinkDesc' },
  { cmd: '/export', titleKey: 'ai.slashExportTitle', descKey: 'ai.slashExportDesc' },
  { cmd: '/stats', titleKey: 'ai.slashStatsTitle', descKey: 'ai.slashStatsDesc' },
  { cmd: '/undo', titleKey: 'ai.slashUndoTitle', descKey: 'ai.slashUndoDesc' },
  { cmd: '/clean', titleKey: 'ai.slashCleanTitle', descKey: 'ai.slashCleanDesc' },
  { cmd: '/clear', titleKey: 'ai.slashClearTitle', descKey: 'ai.slashClearDesc' },
]

interface QuickHint {
  label: string
  query: string
}

const dynamicQuickHints = computed<QuickHint[]>(() => {
  const hints: QuickHint[] = []

  // 1. 情境感知：若当前聚焦在某个笔记组（工作台）
  if (ui.focusedGroupId && ds.groupMap[ui.focusedGroupId]) {
    const group = ds.groupMap[ui.focusedGroupId]
    const gName = group.name.length > 8 ? group.name.slice(0, 8) + '…' : group.name
    hints.push({
      label: isZh.value ? `📦 扩展「${gName}」工具` : `📦 Tools for ${gName}`,
      query: `/pack ${group.name}`,
    })
    hints.push({
      label: isZh.value ? '🔍 查重清理' : '/dedup',
      query: '/dedup',
    })
  } else if (ui.curCat && ui.curCat !== CAT_ALL && ui.curCat !== CAT_UNCATEGORIZED) {
    // 2. 情境感知：若当前选定了特定分类
    const cat = ds.categories.find((c: any) => !c.deletedAt && c.id === ui.curCat)
    if (cat?.name) {
      const cName = cat.name.length > 8 ? cat.name.slice(0, 8) + '…' : cat.name
      hints.push({
        label: isZh.value ? `📁 探索「${cName}」精选` : `📁 ${cName} tools`,
        query: `/pack ${cat.name}`,
      })
    }
  }

  // 3. 收件箱未分类检测
  const uncatCount = ds.bookmarks.filter(
    (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId && !b.id.startsWith('bm_ulink_'),
  ).length
  if (uncatCount > 0) {
    hints.push({
      label: isZh.value ? `未分类 (${uncatCount})` : `Uncategorized (${uncatCount})`,
      query: '/inbox',
    })
  } else if (hints.length === 0) {
    hints.push({
      label: isZh.value ? '/health 体检' : '/health',
      query: '/health',
    })
  }

  // 4. 回收站堆积感知
  const trashCount =
    ds.bookmarks.filter((b) => b.deletedAt).length +
    ds.siblingGroups.filter((g) => g.deletedAt).length +
    ds.categories.filter((c: any) => c.deletedAt).length
  if (trashCount > 0 && hints.length < 4) {
    hints.push({
      label: isZh.value ? `回收站 (${trashCount})` : `Trash (${trashCount})`,
      query: '/trash',
    })
  }

  if (hints.length < 4) {
    hints.push({
      label: isZh.value ? '/dedup 查重' : '/dedup',
      query: '/dedup',
    })
  }
  if (hints.length < 4) {
    hints.push({
      label: isZh.value ? '/stats 统计' : '/stats',
      query: '/stats',
    })
  }
  if (hints.length < 4) {
    hints.push({
      label: isZh.value ? '/help 指令' : '/help',
      query: '/help',
    })
  }

  return hints.slice(0, 4)
})

function getActionCardNavTarget(card: ChatActionCard): string | null {
  if (card.resultGid && ds.groupMap[card.resultGid]) {
    return card.resultGid
  }
  const payloadGid = (card.payload as any)?.createdGid
  if (payloadGid && ds.groupMap[payloadGid]) {
    return payloadGid
  }
  return null
}

function navigateToActionTarget(card: ChatActionCard) {
  const gid = getActionCardNavTarget(card)
  if (!gid) return
  const group = ds.groupMap[gid]
  if (group) {
    if (group.categoryId) {
      ui.curCat = group.categoryId
    }
    ui.focusedGroupId = group.id
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      ui.panels.detail = false
    }
  }
}

function getCardCandidateList(card: ChatActionCard): any[] {
  const payload = card.payload as any
  if (Array.isArray(payload?.candidates)) {
    return payload.candidates
  }
  return []
}

function initCardCandidateSelection(card: ChatActionCard) {
  if (!card.selectedCandidateUrls) {
    const list = getCardCandidateList(card)
    card.selectedCandidateUrls = list.map((c) => c.url).filter(Boolean)
  }
}

function isCandidateSelected(card: ChatActionCard, url: string): boolean {
  initCardCandidateSelection(card)
  return card.selectedCandidateUrls?.includes(url) ?? true
}

function getSelectedCandidateCount(card: ChatActionCard): number {
  initCardCandidateSelection(card)
  return card.selectedCandidateUrls?.length ?? 0
}

function isAllCandidatesSelected(card: ChatActionCard): boolean {
  const all = getCardCandidateList(card)
  if (all.length === 0) return false
  return getSelectedCandidateCount(card) === all.length
}

function toggleCandidateSelection(card: ChatActionCard, url: string) {
  if (card.completed || card.executing) return
  initCardCandidateSelection(card)
  const current = card.selectedCandidateUrls || []
  if (current.includes(url)) {
    card.selectedCandidateUrls = current.filter((u) => u !== url)
  } else {
    card.selectedCandidateUrls = [...current, url]
  }
}

function toggleSelectAllCandidates(card: ChatActionCard) {
  if (card.completed || card.executing) return
  const all = getCardCandidateList(card)
  if (isAllCandidatesSelected(card)) {
    card.selectedCandidateUrls = []
  } else {
    card.selectedCandidateUrls = all.map((c) => c.url).filter(Boolean)
  }
}

function formatDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 20)
  }
}

async function handleActionCardClick(card: ChatActionCard, _turn: ChatTurn) {
  if (card.completed || card.executing) return
  const candidatesInCard = getCardCandidateList(card)
  if (
    card.actionName === 'create_topic_workspace' &&
    candidatesInCard.length > 0 &&
    getSelectedCandidateCount(card) === 0
  ) {
    toast(t('ai.noCandidatesSelected'), false)
    return
  }
  card.executing = true
  try {
    if (card.actionName === 'merge_dedup') {
      const res = mergeDuplicateBookmarks({ ds, ui, app: (ui as any).app })
      card.completed = true
      toast(res.message, true)
      chatTurns.value.push({
        id: 'turn-' + Date.now() + '-assistant',
        role: 'assistant',
        content: res.message,
        steps: [{ text: `合并了 ${res.mergedCount} 个重复副本`, done: true }],
        timestamp: Date.now(),
      })
      scrollToBottom()
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    } else if (card.actionName === 'trash_clear') {
      const res = await dispatchSiteCommand('/trash clear', { ds, ui, app: (ui as any).app })
      if (res.success !== false) {
        card.completed = true
      }
      chatTurns.value.push({
        id: 'turn-' + Date.now() + '-assistant',
        role: 'assistant',
        content: res.reply,
        steps: res.steps,
        timestamp: Date.now(),
      })
      scrollToBottom()
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    } else if (card.actionName === 'inbox_zero') {
      const res = await dispatchSiteCommand('/inbox', { ds, ui, app: (ui as any).app })
      chatTurns.value.push({
        id: 'turn-' + Date.now() + '-assistant',
        role: 'assistant',
        content: res.reply,
        steps: res.steps,
        actionCard: res.actionCard,
        timestamp: Date.now(),
      })
      scrollToBottom()
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    } else if (card.actionName === 'apply_inbox_zero') {
      const res = applyInboxZeroClustering({ ds, ui, app: (ui as any).app })
      card.completed = true
      toast(res.message, true)
      chatTurns.value.push({
        id: 'turn-' + Date.now() + '-assistant',
        role: 'assistant',
        content: res.message,
        steps: [{ text: `成功归类 ${res.movedCount} 个书签`, done: true }],
        timestamp: Date.now(),
      })
      scrollToBottom()
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    } else if (card.actionName === 'create_topic_workspace') {
      const payload = (card.payload || {}) as {
        topic?: string
        candidates?: any[]
        targetCatId?: string
      }
      const rawCandidates = payload.candidates || []
      initCardCandidateSelection(card)
      const selectedUrls = new Set(card.selectedCandidateUrls || [])
      const finalCandidates = rawCandidates.filter((c: any) => selectedUrls.has(c.url))

      const res = await createTopicWorkspace(
        payload.topic || '精选工作台',
        finalCandidates,
        payload.targetCatId,
        { ds, ui, app: (ui as any).app },
      )
      card.completed = true
      if (res.group?.id) {
        card.resultGid = res.group.id
        card.resultCatId = res.group.categoryId
      }
      toast(res.message, true)
      chatTurns.value.push({
        id: 'turn-' + Date.now() + '-assistant',
        role: 'assistant',
        content: res.message,
        steps: [
          { text: `甄选并存入 ${res.totalBookmarks} 个工具`, done: true },
          { text: `创建笔记组「${res.group.name}」`, done: true },
          { text: '切换至工作台聚焦视图', done: true },
        ],
        timestamp: Date.now(),
      })
      scrollToBottom()
      sessions.value = updateSession(currentSessionId.value, chatTurns.value)
    } else if (card.actionName === 'heal_deadlink') {
      const payload = (card.payload || {}) as {
        deadBmId?: string
        replacement?: any
      }
      if (payload.deadBmId && payload.replacement) {
        const res = healDeadlink(payload.deadBmId, payload.replacement, {
          ds,
          ui,
          app: (ui as any).app,
        })
        card.completed = true
        toast(res.message, true)
        chatTurns.value.push({
          id: 'turn-' + Date.now() + '-assistant',
          role: 'assistant',
          content: res.message,
          steps: [
            { text: '核验失效死链', done: true },
            { text: `替换为现役平替「${payload.replacement.title}」`, done: true },
          ],
          timestamp: Date.now(),
        })
        scrollToBottom()
        sessions.value = updateSession(currentSessionId.value, chatTurns.value)
      }
    }
  } catch (err: any) {
    console.error('handleActionCardClick error:', err)
    toast(err?.message || '执行失败，请稍后重试', false)
  } finally {
    card.executing = false
    sessions.value = updateSession(currentSessionId.value, chatTurns.value)
  }
}

function formatReasoningSec(ms?: number): string {
  if (!ms || ms <= 0) return '1'
  const sec = (ms / 1000).toFixed(1)
  return sec.endsWith('.0') ? sec.slice(0, -2) : sec
}

function getCleanCopyText(content?: string): string {
  if (!content) return ''
  return content.replace(/```ulink-card\s*([\s\S]*?)```/gi, '').trim()
}

function getTurnSegments(turn: ChatTurn): ChatContentSegment[] {
  if (!turn.content && (!turn.candidates || turn.candidates.length === 0)) {
    return []
  }

  const { segments, allCandidates } = parseTurnContentSegments(
    turn.content || '',
    ds.categories,
    ds.customAttributes
  )

  // 同步随文卡片到 turn.candidates（保证持久化与一键全部存入）
  if (allCandidates.length && (!turn.candidates || turn.candidates.length === 0)) {
    turn.candidates = allCandidates
  }

  // 兜底兼容：若正文没有内嵌卡片语法（例如本地静态搜索），将 candidates 转换为内嵌卡片追加在末尾
  if (allCandidates.length === 0 && turn.candidates?.length) {
    for (const c of turn.candidates) {
      segments.push({
        type: 'card',
        candidate: c,
      })
    }
  }

  return segments
}

const copiedActionKey = ref<string | null>(null)
let _copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyMessage(text: string, actionKey?: string) {
  try {
    await navigator.clipboard.writeText(text)
    if (actionKey) {
      copiedActionKey.value = actionKey
      if (_copiedTimer) clearTimeout(_copiedTimer)
      _copiedTimer = setTimeout(() => {
        if (copiedActionKey.value === actionKey) {
          copiedActionKey.value = null
        }
      }, 1500)
    }
  } catch {
    toast(isZh.value ? '复制失败' : 'Copy failed', false)
  }
}

function revokeUserMessage(turn: ChatTurn) {
  const idx = chatTurns.value.findIndex((t) => t.id === turn.id)
  if (idx === -1) return

  // 1. 将原输入内容填回输入框
  aiQuery.value = turn.content
  adjustTextareaHeight()

  // 2. 从对话流中移除该条消息及其伴随的助手回复
  const nextTurn = chatTurns.value[idx + 1]
  const removeCount = nextTurn && nextTurn.role === 'assistant' ? 2 : 1
  chatTurns.value.splice(idx, removeCount)

  // 3. 持久化当前会话
  sessions.value = updateSession(currentSessionId.value, chatTurns.value)

  // 4. 聚焦输入框便于修改重发（视觉状态已清晰直达，无需全局弹窗阻断）
  nextTick(() => aiTextareaRef.value?.focus())
}

const activeSlashIndex = ref(0)
const showSlashSuggest = computed(() => {
  const q = aiQuery.value.trim()
  return q.startsWith('/') && !q.includes(' ')
})

const filteredSlashCommands = computed(() => {
  const q = aiQuery.value.trim().toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q)).map((c) => ({
    cmd: c.cmd,
    title: t(c.titleKey),
    desc: t(c.descKey),
  }))
})

watch(filteredSlashCommands, () => {
  activeSlashIndex.value = 0
})

watch(
  () => ui.aiAssistantInitialQuery,
  (val) => {
    if (val) {
      currentTab.value = 'ai'
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

function applySlashCommand(cmd: string) {
  aiQuery.value = cmd + ' '
  adjustTextareaHeight()
  nextTick(() => aiTextareaRef.value?.focus())
}

// ── 终端式命令历史回溯 (↑ / ↓) ──
const inputHistory = ref<string[]>([])
let historyCursor = -1
let tempInput = ''

// ── 停止生成 ──
let currentAbortController: AbortController | null = null

/** 持久化当前会话；会话可能已被删除，守卫防 updateSession 重建已删会话 */
function persistCurrentSession() {
  if (currentSessionId.value && sessions.value.some((s) => s.id === currentSessionId.value)) {
    sessions.value = updateSession(currentSessionId.value, chatTurns.value)
  }
}

/** 中止在途检索并收尾：终止请求、收起思考气泡、持久化当前会话（停止按钮/切会话/新建会话共用） */
function abortInFlight() {
  if (currentAbortController) {
    currentAbortController.abort()
    currentAbortController = null
  }
  aiLoading.value = false
  const last = chatTurns.value[chatTurns.value.length - 1]
  if (last && last.role === 'assistant' && last.loading) {
    last.loading = false
    last.isThinking = false
    if (!last.content && !last.reasoning) {
      last.content = t('ai.stopped')
    }
  }
  persistCurrentSession()
}

function handleStopGenerating() {
  abortInFlight()
  scrollToBottom()
}

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
        adjustTextareaHeight()
        if (currentTab.value === 'ai') {
          aiTextareaRef.value?.focus()
        }
      })
    }
  },
)

function scrollToBottom() {
  nextTick(() => {
    if (chatScrollRef.value) {
      chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
    }
  })
}

function startNewChat() {
  handleCreateSession()
}

function quickFill(text: string) {
  aiQuery.value = text
  handleAiSubmit()
}

function closeEntirePanel() {
  ui.panels.detail = false
  ui.detailCards.splice(0)
}

function handleKeyDown(e: KeyboardEvent) {
  // IME 组合中的按键（选词/确认）交还输入法，防 Enter 误提交、方向键误翻历史
  if (e.isComposing) return
  // Esc：有输入内容/补全菜单时先清空输入（拦截不上抛，防全局清扫连带关掉面板）；
  // 空输入时放行给全局 Esc（关闭整个面板）
  if (e.key === 'Escape' && (showSlashSuggest.value || aiQuery.value)) {
    e.preventDefault()
    e.stopPropagation()
    aiQuery.value = ''
    adjustTextareaHeight()
    return
  }
  // 斜杠补全菜单的上下键与回车优先
  if (showSlashSuggest.value && filteredSlashCommands.value.length) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeSlashIndex.value =
        (activeSlashIndex.value - 1 + filteredSlashCommands.value.length) %
        filteredSlashCommands.value.length
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeSlashIndex.value =
        (activeSlashIndex.value + 1) % filteredSlashCommands.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const chosen = filteredSlashCommands.value[activeSlashIndex.value]
      if (chosen) applySlashCommand(chosen.cmd)
      return
    }
  }

  // 若用户按了 Tab，当前输入了斜杠前缀但尚未有空格
  if (e.key === 'Tab' && aiQuery.value.startsWith('/') && !aiQuery.value.includes(' ')) {
    const prefix = aiQuery.value.trim().toLowerCase()
    const match = SLASH_COMMANDS.find((c) => c.cmd.toLowerCase().startsWith(prefix))
    if (match) {
      e.preventDefault()
      applySlashCommand(match.cmd)
      return
    }
  }

  // 终端式命令历史回溯 (ArrowUp / ArrowDown)
  if (e.key === 'ArrowUp') {
    const el = aiTextareaRef.value
    if (el && (el.selectionStart === 0 || !aiQuery.value.includes('\n'))) {
      if (inputHistory.value.length > 0 && historyCursor > 0) {
        e.preventDefault()
        if (historyCursor === inputHistory.value.length) {
          tempInput = aiQuery.value
        }
        historyCursor--
        aiQuery.value = inputHistory.value[historyCursor]
        nextTick(() => adjustTextareaHeight())
        return
      }
    }
  } else if (e.key === 'ArrowDown') {
    const el = aiTextareaRef.value
    if (el && (el.selectionEnd === aiQuery.value.length || !aiQuery.value.includes('\n'))) {
      if (historyCursor < inputHistory.value.length - 1) {
        e.preventDefault()
        historyCursor++
        aiQuery.value = inputHistory.value[historyCursor]
        nextTick(() => adjustTextareaHeight())
        return
      } else if (historyCursor === inputHistory.value.length - 1) {
        e.preventDefault()
        historyCursor = inputHistory.value.length
        aiQuery.value = tempInput
        nextTick(() => adjustTextareaHeight())
        return
      }
    }
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleAiSubmit()
  }
}

function adjustTextareaHeight() {
  const el = aiTextareaRef.value
  if (!el) return
  if (!aiQuery.value) {
    el.style.height = '24px'
    el.style.lineHeight = '24px'
    el.style.overflowY = 'hidden'
    return
  }
  el.style.height = 'auto'
  const scrollH = el.scrollHeight
  if (scrollH <= 26) {
    el.style.height = '24px'
    el.style.lineHeight = '24px'
    el.style.overflowY = 'hidden'
  } else {
    const nextH = Math.min(scrollH, 110)
    el.style.height = nextH + 'px'
    el.style.lineHeight = '1.45'
    el.style.overflowY = scrollH > 110 ? 'auto' : 'hidden'
  }
}

/** 检索结果摘要：0 结果时改用空态引导文案，避免「甄选到 0 个」 */
function formatFoundCount(n: number, videoTitle?: string): string {
  if (n <= 0) return t('ai.emptyResultsHint')
  return videoTitle ? `${videoTitle} (${t('ai.foundCount', { n })})` : t('ai.foundCount', { n })
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
  loadingTextKey.value = 'ai.thinking'
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
    reasoning: '',
    reasoningTimeMs: 0,
    isThinking: false,
    _thinkingOpen: true,
    loading: true,
    candidates: [],
    timestamp: Date.now(),
  }
  chatTurns.value.push(assistantTurn)
  scrollToBottom()

  // 捕获局部 controller 引用：handleStopGenerating 会把 currentAbortController 置 null，
  // 在途代码必须读自己的 controller.signal，否则「停止生成」实际不生效
  const controller = new AbortController()
  currentAbortController = controller

  try {
    // 优先尝试站内指令/In-App Agent CLI 调度
    const siteCmd = await dispatchSiteCommand(raw, { ds, ui, app: (ui as any).app })
    if (siteCmd.handled) {
      assistantTurn.loading = false
      assistantTurn.content = siteCmd.reply
      assistantTurn.steps = siteCmd.steps
      assistantTurn.actionCard = siteCmd.actionCard
      return
    }

    const isVideo = /bilibili\.com|b23\.tv|douyin\.com|tiktok\.com|xiaohongshu\.com|xhslink\.com/.test(raw)
    const isUrl = /^(https?:\/\/|[a-zA-Z0-9-]+\.[a-zA-Z]{2,})/.test(raw)
    loadingTextKey.value = isVideo ? 'ai.extracting' : isUrl ? 'ai.analyzing' : 'ai.searching'

    if (isVideo) {
      const res = await extractBookmarksFromVideo(raw, ds.categories, ds.customAttributes)
      if (controller.signal.aborted) return
      assistantTurn.loading = false
      assistantTurn.candidates = res.bookmarks
      assistantTurn.content = formatFoundCount(res.bookmarks.length, res.videoTitle)
    } else if (isUrl) {
      const res = await findSimilarWebsites(raw, domain(raw), preferences.value, ds.categories, ds.customAttributes)
      if (controller.signal.aborted) return
      assistantTurn.loading = false
      assistantTurn.candidates = res
      assistantTurn.content = formatFoundCount(res.length)
    } else {
      const mimoConf = getMiMoConfig()
      let mimoSuccess = false

      if (mimoConf.enabled && mimoConf.apiKey) {
        try {
          const history = chatTurns.value
            .filter((t) => !t.loading && t.content && t.id !== assistantTurn.id)
            .map((t) => ({ role: t.role as 'user' | 'assistant', content: t.content }))

          let thinkingStartTime = 0

          // 动态构建情境切片 (Dynamic Context Slice)
          let focusedGroupName: string | undefined
          let focusedGroupBookmarks: Array<{ title: string; url: string }> | undefined
          if (ui.focusedGroupId && ds.groupMap[ui.focusedGroupId]) {
            const grp = ds.groupMap[ui.focusedGroupId]
            focusedGroupName = grp.name
            focusedGroupBookmarks = (grp.bookmarkIds || [])
              .map((id: string) => ds.bookmarkMap[id])
              .filter((b: any) => b && !b.deletedAt)
              .slice(0, 10)
              .map((b: any) => ({ title: b.title, url: b.url }))
          }

          let currentCategoryName: string | undefined
          if (ui.curCat && ui.curCat !== 'all' && ui.curCat !== 'uncategorized') {
            const cat = ds.categories.find((c: any) => c.id === ui.curCat && !c.deletedAt)
            if (cat) currentCategoryName = cat.name
          }

          let selectedBookmarks: Array<{ title: string; url: string }> | undefined
          if (ui.batchMode && ui.batchSelected?.length) {
            selectedBookmarks = ui.batchSelected
              .map((id: string) => ds.bookmarkMap[id])
              .filter((b: any) => b && !b.deletedAt)
              .slice(0, 8)
              .map((b: any) => ({ title: b.title, url: b.url }))
          }

          const mimoRes = await askMiMoStream(
            raw,
            {
              categories: ds.categories,
              customAttributes: ds.customAttributes,
              isZh: isZh.value,
              signal: controller.signal,
              history,
              contextSlice: {
                currentCategoryName,
                focusedGroupName,
                focusedGroupBookmarks,
                selectedBookmarks,
              },
            },
            {
              onReasoningDelta(_delta, accumulatedReasoning) {
                if (controller.signal.aborted) return
                if (!thinkingStartTime) {
                  thinkingStartTime = Date.now()
                  assistantTurn.isThinking = true
                  assistantTurn._thinkingOpen = true
                }
                assistantTurn.reasoning = accumulatedReasoning
                scrollToBottom()
              },
              onContentDelta(_delta, accumulatedContent) {
                if (controller.signal.aborted) return
                if (assistantTurn.isThinking) {
                  assistantTurn.isThinking = false
                  assistantTurn.reasoningTimeMs = Date.now() - (thinkingStartTime || Date.now())
                  // 正式回答开始流出时，默认折叠思考过程，让出核心视线（用户可随时点击展开）
                  assistantTurn._thinkingOpen = false
                }
                assistantTurn.content = accumulatedContent
                scrollToBottom()
              },
            }
          )

          if (controller.signal.aborted) return
          assistantTurn.loading = false
          assistantTurn.isThinking = false
          if (thinkingStartTime && !assistantTurn.reasoningTimeMs) {
            assistantTurn.reasoningTimeMs = Date.now() - thinkingStartTime
          }
          assistantTurn.content = mimoRes.reply
          assistantTurn.reasoning = mimoRes.reasoning || assistantTurn.reasoning
          assistantTurn.candidates = mimoRes.candidates
          assistantTurn.steps = [{ text: `小米 ${mimoRes.model} 推理完成`, done: true }]

          // 核心：若大模型自主触发了标准 Tool Calling (Function Calling)，即刻调度并挂载行动卡片
          if (mimoRes.toolCalls?.length) {
            for (const call of mimoRes.toolCalls) {
              assistantTurn.steps.push({ text: `自主调用智能工具: ${call.name}`, done: true })
              if (call.name === 'audit_vault') {
                const siteRes = await dispatchSiteCommand('/health', { ds, ui, app: (ui as any).app })
                if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
                if (!assistantTurn.content) assistantTurn.content = siteRes.reply
              } else if (call.name === 'inbox_zero') {
                const siteRes = await dispatchSiteCommand('/inbox', { ds, ui, app: (ui as any).app })
                if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
                if (!assistantTurn.content) assistantTurn.content = siteRes.reply
              } else if (call.name === 'create_workspace') {
                const topic = call.arguments?.topic || '精选工作台'
                assistantTurn.actionCard = {
                  type: 'custom',
                  actionName: 'create_topic_workspace',
                  title: `一键装配「${topic}」`,
                  desc: `基于模型推理自主规划，将工具一键存入并建构专属笔记工作台`,
                  buttonText: '一键装配工作台',
                  payload: {
                    topic,
                    candidates: assistantTurn.candidates,
                  },
                }
              } else if (call.name === 'merge_duplicates') {
                const siteRes = await dispatchSiteCommand('/dedup', { ds, ui, app: (ui as any).app })
                if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
                if (!assistantTurn.content) assistantTurn.content = siteRes.reply
              } else if (call.name === 'heal_deadlinks') {
                const siteRes = await dispatchSiteCommand('/deadlink', { ds, ui, app: (ui as any).app })
                if (siteRes.actionCard) assistantTurn.actionCard = siteRes.actionCard
                if (!assistantTurn.content) assistantTurn.content = siteRes.reply
              } else if (call.name === 'toggle_theme') {
                const mode = call.arguments?.mode || 'auto'
                await dispatchSiteCommand(`/theme ${mode}`, { ds, ui, app: (ui as any).app })
              } else if (call.name === 'change_view') {
                const layout = call.arguments?.layout || 'grid'
                await dispatchSiteCommand(`/view ${layout}`, { ds, ui, app: (ui as any).app })
              } else if (call.name === 'export_data') {
                await dispatchSiteCommand('/export', { ds, ui, app: (ui as any).app })
              }
            }
          }

          mimoSuccess = true
          persistCurrentSession()
        } catch (mimoErr: unknown) {
          if (controller.signal.aborted) return
          console.warn('[ulink AI] MiMo API call failed, falling back to local dataset:', mimoErr)
        }
      }

      // 若未开启 MiMo 或 MiMo 请求异常，优雅回退至本地离线知识库
      if (!mimoSuccess) {
        const res = await searchWebsitesByIntent(raw, preferences.value, ds.categories, ds.customAttributes)
        if (controller.signal.aborted) return
        assistantTurn.loading = false
        assistantTurn.candidates = res
        assistantTurn.content = formatFoundCount(res.length)
      }
    }

    // 智能挂载行动卡片：当单轮甄选到 3 个及以上候选站点且未挂载卡片时，出具一键装配工作台卡片
    if (assistantTurn.candidates && assistantTurn.candidates.length >= 3 && !assistantTurn.actionCard) {
      const topicRaw =
        raw
          .replace(/^(?:请?帮?我?)?(?:推荐|找|搜|整理|搭建|介绍|有哪些|看下)?\s*/i, '')
          .replace(/[?？!！。]+$/, '')
          .trim()
          .slice(0, 16) || '精选工具'
      const cleanTopic =
        topicRaw.endsWith('工作台') || topicRaw.endsWith('工具箱') ? topicRaw : `${topicRaw} 工作台`
      assistantTurn.actionCard = {
        type: 'custom',
        actionName: 'create_topic_workspace',
        title: `一键装配「${cleanTopic}」`,
        desc: `将甄选的 ${assistantTurn.candidates.length} 个工具一键存入并建构专属笔记工作台`,
        buttonText: '一键装配工作台',
        payload: {
          topic: cleanTopic,
          candidates: assistantTurn.candidates,
        },
      }
    }
  } catch (err: unknown) {
    if (controller.signal.aborted) return
    assistantTurn.loading = false
    assistantTurn.content = t('ai.searchFailed')
    console.error('[ulink AI] search error:', err)
  } finally {
    // 兜底收尾：任何路径遗留的思考气泡（如 abort 竞态）一律置为已停止，防悬挂
    if (assistantTurn.loading) {
      assistantTurn.loading = false
      if (!assistantTurn.content) assistantTurn.content = t('ai.stopped')
    }

    // 记录输入历史
    if (raw && !inputHistory.value.includes(raw)) {
      inputHistory.value.push(raw)
      if (inputHistory.value.length > 30) inputHistory.value.shift()
    }
    historyCursor = inputHistory.value.length

    // 仅当本次请求仍持有控制器时才收尾共享状态；
    // 若已被停止/切会话接管（abortInFlight 已收尾持久化），不得覆盖其状态
    if (currentAbortController === controller) {
      aiLoading.value = false
      currentAbortController = null
      persistCurrentSession()
      scrollToBottom()
    }
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
      ds.addBookmark(candidateToBookmark(ds, c))
      c.isAdded = true
      count++
    }
  }
  if (count) saveAppData()
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

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (isSessionMenuOpen.value && !target.closest('.chat-top-title-wrap')) {
    isSessionMenuOpen.value = false
  }
}

onMounted(() => {
  nextTick(() => adjustTextareaHeight())
  document.addEventListener('click', onDocumentClick)
  const el = detailPanelRef.value
  if (el) {
    el.addEventListener('touchstart', onSwipeStart, { passive: true })
    el.addEventListener('touchmove', onSwipeMove, { passive: false })
    el.addEventListener('touchend', onSwipeEnd)
    el.addEventListener('touchcancel', onSwipeCancel)
  }
})
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
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
  // 只移除单张暂存卡，绝不触碰 panels.detail——否则删最后一张卡会把整个面板连带关掉。
  // 面板开合由 isOpen = panels.detail || detailCards 决定；暂存清空后回到 AI tab。
  if (!ui.detailCards.length && currentTab.value === 'cards') currentTab.value = 'ai'
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

/* 顶栏：轻量温润 */
.chat-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 38px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid var(--border-light);
  background: var(--surface);
  flex-shrink: 0;
  min-width: 0;
  user-select: none;
}

.chat-top-title-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.chat-session-dropdown-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: var(--radius-sm, 6px);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  transition: all 0.12s ease;
  max-width: 170px;
}

.chat-session-dropdown-btn:hover {
  background: var(--surface-hover);
  color: var(--accent);
}

.chat-current-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.dropdown-chevron.open {
  transform: rotate(180deg);
  color: var(--accent);
}

/* 会话下拉浮层 (方案 A) */
.session-dropdown-popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 230px;
  max-width: 260px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04);
  z-index: 100;
  overflow: hidden;
  animation: sessionPopIn 0.15s ease-out;
}

@keyframes sessionPopIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.session-popover-header {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-light);
}

.session-new-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--radius-xs, 4px);
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease;
}

.session-new-btn:hover:not(:disabled) {
  background: var(--accent-light);
}

.session-new-btn:disabled,
.session-new-btn.is-disabled {
  opacity: 0.45;
  cursor: default;
}

.session-list-scroll {
  max-height: 200px;
  overflow-y: auto;
  padding: 4px 0;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  transition: background 0.12s ease;
  position: relative;
}

.session-item:hover,
.session-item.active {
  background: var(--surface-hover);
}

.session-item-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}

.session-item.active .session-item-dot {
  background: var(--accent);
}

.session-item-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.session-item-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item-time {
  font-size: 10px;
  color: var(--text-muted);
}

.session-item-del {
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: var(--radius-xs, 4px);
}

.session-item-del svg {
  display: block;
}

.session-item:hover .session-item-del {
  display: inline-flex;
}

.session-item-del:hover {
  color: var(--rose);
  background: var(--rose-light);
}

.session-empty {
  padding: 16px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}

.session-popover-foot {
  padding: 4px 8px;
  border-top: 1px solid var(--border-light);
  text-align: center;
}

.session-clear-all-btn {
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 3px;
}

.session-clear-all-btn:hover {
  color: var(--rose);
}

.chat-top-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.2px;
}

.chat-top-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.chat-top-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 9999px;
  transition: all 0.15s ease;
}

.chat-top-tab:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.chat-top-tab.active {
  color: var(--accent);
  font-weight: 600;
  background: var(--accent-light);
}

.chat-tab-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 0 5px;
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
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: all 0.12s ease;
}

.chat-btn-icon:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text);
}

.chat-btn-icon:disabled,
.chat-btn-icon.is-disabled {
  opacity: 0.35;
  cursor: default;
}

/* 滚动内容区 */
.chat-scroll-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 12px;
  min-width: 0 !important;
  box-sizing: border-box;
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

/* 空态：轻微点缀，不做多余视觉堆砌 */
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
  max-width: 240px;
}

.chat-empty-sparkle {
  display: block;
  color: var(--accent);
  margin-bottom: 8px;
  opacity: 0.8;
}

.chat-empty-lead {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 6px 0;
}

.chat-empty-sub {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0 0 16px 0;
}

.chat-quick-hints {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 5px;
}

.hint-text-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: var(--radius-xs, 4px);
  transition: all 0.12s ease;
}
.hint-text-btn:hover {
  color: var(--accent);
  background: var(--accent-light);
}

.hint-dot {
  color: var(--border);
  font-size: 10px;
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
  gap: 4px;
  animation: chat-fade-in 0.15s ease-out;
}

@keyframes chat-fade-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 用户气泡与微操作区 */
.chat-user-wrap {
  align-self: flex-end;
  max-width: 86%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.chat-user-bubble {
  padding: 7px 11px;
  background: var(--surface-active);
  border-radius: 12px 12px 2px 12px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.45;
  word-break: break-word;
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

.chat-reply-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-left: 8px;
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

/* 深度思考流 (Reasoning Stream) */
.chat-thinking-box {
  margin-bottom: 6px;
  background: var(--surface-hover, #fbf9f6);
  border: 1px solid var(--border-light, #ebe6e0);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.chat-thinking-box.is-thinking {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-light, #ebe6e0));
  background: color-mix(in srgb, var(--accent) 2.5%, var(--surface-hover, #fbf9f6));
}

.chat-thinking-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 8px;
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--text-muted);
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
  padding: 6px 10px 8px 12px;
  border-top: 1px solid var(--border-light, #ebe6e0);
  border-left: 2px solid var(--accent-light, #dce4f7);
  background: var(--surface);
  max-height: 220px;
  overflow-y: auto;
}

.chat-thinking-text {
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
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

.chat-flow-header {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
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
  gap: 3px;
  word-break: break-word;
  line-height: 1.55;
}

.chat-flow-text {
  font-size: 12.5px;
  color: var(--text);
}

.chat-flow-text :deep(.chat-flow-heading) {
  margin: 8px 0 3px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.2px;
}

.chat-flow-text :deep(.chat-flow-para) {
  margin: 3px 0 5px;
  line-height: 1.55;
  color: var(--text);
}

.chat-flow-text :deep(strong) {
  font-weight: 600;
  color: var(--text);
}

.chat-flow-text :deep(.chat-flow-code) {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-hover);
  color: var(--accent);
}

.chat-flow-text :deep(.chat-flow-list) {
  margin: 3px 0 6px 14px;
  padding: 0;
  line-height: 1.5;
}

.chat-flow-text :deep(.chat-flow-list li) {
  margin-bottom: 2px;
}

.chat-flow-text :deep(.chat-flow-link) {
  color: var(--accent);
  text-decoration: underline;
  word-break: break-all;
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
  padding-top: 4px;
  border-top: 1px dashed var(--border-light, #e8e3df);
}

.chat-batch-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-light, rgba(18, 46, 138, 0.08));
  border: 1px solid transparent;
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: all 0.12s ease;
}

.chat-batch-add-btn:hover {
  background: var(--accent);
  color: #ffffff;
}

.batch-add-icon :deep(svg) {
  width: 11px;
  height: 11px;
}

/* 工具调用轨迹 (Tool Execution Trace) */
.chat-trace-wrap {
  margin-bottom: 2px;
}

.chat-trace-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xs, 4px);
  padding: 2px 7px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}

.chat-trace-toggle-btn:hover {
  background: var(--surface);
  border-color: var(--border);
  color: var(--text);
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

/* 交互行动卡片 (Actionable Artifact / Generative UI) */
.chat-action-card {
  margin-top: 4px;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
  transition: all 0.2s ease;
}

.chat-action-card.is-completed {
  background: color-mix(in srgb, var(--surface) 92%, var(--accent-light) 8%);
  border-color: color-mix(in srgb, var(--border) 70%, var(--accent) 30%);
}

.chat-action-card.is-executing {
  opacity: 0.9;
}

.action-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.action-card-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--accent-light);
  color: var(--accent);
  flex-shrink: 0;
}

.action-card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.action-card-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-bottom: 6px;
}

/* 候选微操过滤列表 */
.action-card-curation {
  margin: 6px 0 8px 0;
  padding: 6px 8px;
  background: var(--surface-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-xs, 4px);
}

.action-card-curation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.action-card-curation-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
}

.action-card-curation-toggle {
  background: none;
  border: none;
  padding: 0;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.action-card-curation-toggle:hover {
  color: var(--text);
}

.action-card-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 120px;
  overflow-y: auto;
}

.action-candidate-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px;
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: none;
}

.action-candidate-item:hover {
  background: var(--surface);
}

.action-candidate-item.is-checked {
  background: color-mix(in srgb, var(--surface) 80%, var(--accent-light) 20%);
}

.action-candidate-checkbox {
  appearance: auto;
  accent-color: var(--accent);
  width: 12px;
  height: 12px;
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
  gap: 5px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  border-radius: var(--radius-xs, 4px);
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #ffffff;
  cursor: pointer;
  transition: all 0.12s ease;
}

.action-card-btn:hover:not(:disabled) {
  opacity: 0.9;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 25%, transparent);
}

.action-card-btn.is-executing,
.action-card-btn:disabled {
  opacity: 0.75;
  cursor: not-allowed;
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
  gap: 3px;
  font-size: 11px;
  color: var(--accent);
  font-weight: 500;
}

.action-card-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: var(--radius-xs, 4px);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--accent);
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-card-nav-btn:hover {
  background: var(--accent-light);
  border-color: var(--accent);
}

/* 底部仅留一个对话输入框：无重叠多层边框 */
.chat-input-dock {
  position: relative;
  flex-shrink: 0;
  padding: 8px 10px 10px;
  background: var(--surface);
  border-top: 1px solid var(--border-light, #efe8df);
  min-width: 0 !important;
  box-sizing: border-box;
}

/* 斜杠指令补全浮层 */
.slash-suggest-dock {
  position: absolute;
  bottom: calc(100% - 2px);
  left: 10px;
  right: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
  max-height: 190px;
  overflow-y: auto;
  padding: 4px;
  z-index: 50;
  animation: slashPop 0.14s ease-out;
}

@keyframes slashPop {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.slash-suggest-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: all 0.1s ease;
}

.slash-suggest-item:hover,
.slash-suggest-item.active {
  background: var(--surface-hover);
}

.slash-cmd-tag {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  min-width: 72px;
  flex-shrink: 0;
}

.slash-cmd-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  flex-shrink: 0;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slash-cmd-desc {
  font-size: 11px;
  color: var(--text-muted);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}

.chat-input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  background: var(--bg, #fdfbf9);
  padding: 5px 6px 5px 10px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
  min-width: 0;
  box-sizing: border-box;
}

.chat-input-wrapper:hover {
  border-color: var(--border-hover, #d5cbbe);
}

.chat-input-wrapper:focus-within,
.chat-input-wrapper.focused {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent) 18%, transparent);
}

.chat-textarea {
  flex: 1;
  min-width: 0;
  height: 24px;
  min-height: 24px;
  max-height: 110px;
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
  margin: 0 !important;
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 24px;
  color: var(--text);
  resize: none;
  outline: none !important;
  box-shadow: none !important;
  -webkit-tap-highlight-color: transparent !important;
  overflow-y: hidden;
  overflow-x: hidden;
  box-sizing: border-box;
}

.chat-textarea:focus,
.chat-textarea:focus-visible {
  outline: none !important;
  box-shadow: none !important;
  border: none !important;
}

.chat-textarea::placeholder {
  color: var(--text-muted);
  opacity: 0.8;
  user-select: none;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
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
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
}

.chat-send-btn.active {
  background: var(--accent);
  color: #fff;
  transform: scale(1.02);
}

.chat-send-btn.active:hover {
  background: var(--accent-dark, #0e2270);
  transform: scale(1.06);
}

.chat-send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* 停止生成方块按钮 */
.chat-send-btn.stop {
  background: var(--accent);
  color: #fff;
}

.stop-square {
  width: 8px;
  height: 8px;
  background: #fff;
  border-radius: 1.5px;
  display: block;
}
</style>