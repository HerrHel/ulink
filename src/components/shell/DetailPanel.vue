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
            <div class="chat-quick-hints" role="group" :aria-label="t('ai.emptyLead')">
              <template v-for="(hint, hIdx) in dynamicQuickHints" :key="hint.query">
                <button
                  type="button"
                  class="hint-text-btn"
                  @click="quickFill(hint.query)"
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
import { toast } from '../../lib/toast.js'
import BookmarkCard from '../cards/BookmarkCard.vue'
import GroupCard from '../cards/GroupCard.vue'
import AiInlineCard from '../cards/AiInlineCard.vue'
import { parseTurnContentSegments, type ChatContentSegment } from '../../lib/ai/chatStreamParser.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'
import { useAiChat } from '../../composables/domain/useAiChat.js'
import { buildDetailCards } from './buildDetailCards.js'
import type { DetailEntry } from './buildDetailCards.js'

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

const isInputFocused = ref(false)
const isSessionMenuOpen = ref(false)

// ── AI 调度逻辑抽至 useAiChat（会话管理 / 提交调度 / 行动卡片 / 斜杠命令）；
//    DOM 副作用（滚动到底、输入框聚焦/高度、会话菜单收起、切回对话 tab）由本组件回调注入 ──
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
  showAiTab: () => {
    currentTab.value = 'ai'
  },
})

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  if (diff < 60000) return t('ai.timeJustNow')
  if (diff < 3600000) return t('ai.timeMinutesAgo', { n: Math.floor(diff / 60000) })
  if (diff < 86400000) return t('ai.timeHoursAgo', { n: Math.floor(diff / 3600000) })
  return new Date(timestamp).toLocaleDateString(isZh.value ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric' })
}

// ── 斜杠指令快捷联想（文案走 i18n，与语言包 slash* 键一一对应）──
// SLASH_COMMANDS 与 dynamicQuickHints 已随调度逻辑迁至 useAiChat

// 行动卡片辅助与执行（getActionCardNavTarget / navigateToActionTarget / 候选多选微操 /
// handleActionCardClick）已随调度逻辑迁至 useAiChat

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

// revokeUserMessage（撤回并回填输入框）已随调度逻辑迁至 useAiChat

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

// applySlashCommand（斜杠补全）已随调度逻辑迁至 useAiChat

// ── 终端式命令历史回溯 (↑ / ↓) 状态由 useAiChat 提供（inputHistory / historyCursor / tempInput）──

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

function scrollToBottom(smooth = false) {
  nextTick(() => {
    if (!chatScrollRef.value) return
    const el = chatScrollRef.value
    if (typeof el.scrollTo === 'function' && smooth) {
      try {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: 'smooth',
        })
      } catch {
        // fallback to direct assignment
      }
    }
    el.scrollTop = el.scrollHeight
  })
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
      if (inputHistory.value.length > 0 && historyCursor.value > 0) {
        e.preventDefault()
        if (historyCursor.value === inputHistory.value.length) {
          tempInput.value = aiQuery.value
        }
        historyCursor.value--
        aiQuery.value = inputHistory.value[historyCursor.value]
        nextTick(() => adjustTextareaHeight())
        return
      }
    }
  } else if (e.key === 'ArrowDown') {
    const el = aiTextareaRef.value
    if (el && (el.selectionEnd === aiQuery.value.length || !aiQuery.value.includes('\n'))) {
      if (historyCursor.value < inputHistory.value.length - 1) {
        e.preventDefault()
        historyCursor.value++
        aiQuery.value = inputHistory.value[historyCursor.value]
        nextTick(() => adjustTextareaHeight())
        return
      } else if (historyCursor.value === inputHistory.value.length - 1) {
        e.preventDefault()
        historyCursor.value = inputHistory.value.length
        aiQuery.value = tempInput.value
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

.hint-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border-light);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  cursor: pointer;
  border-radius: 9999px;
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.02);
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  letter-spacing: -0.1px;
  line-height: 1.3;
}

.hint-pill-icon {
  color: var(--accent);
  opacity: 0.7;
  flex-shrink: 0;
  transition: transform 0.14s ease, opacity 0.14s ease;
}

.hint-text-btn:hover {
  color: var(--accent);
  background: var(--surface-hover);
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border-light));
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(44, 40, 36, 0.04);
}

.hint-text-btn:hover .hint-pill-icon {
  opacity: 1;
  transform: translateX(1px);
}

.hint-text-btn:active {
  transform: translateY(0) scale(0.97);
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

/* 用户气泡与微操作区 */
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
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: 14px 14px 3px 14px;
  font-size: 13px;
  color: var(--text);
  line-height: 1.55;
  word-break: break-word;
  letter-spacing: -0.01em;
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.03);
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

/* 深度思考流 (Reasoning Stream) - 纸质缩进手记质感 */
.chat-thinking-box {
  margin-bottom: 6px;
  background: color-mix(in srgb, var(--surface) 92%, var(--surface-active) 8%);
  border: 1px solid var(--border-light);
  border-left: 2.5px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.chat-thinking-box.is-thinking {
  border-left-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 3%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 25%, var(--border-light));
  box-shadow: inset 0 1px 2px rgba(44, 40, 36, 0.02);
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

/* 交互行动卡片 (Actionable Artifact / Generative UI) - 优雅质感工坊 */
.chat-action-card {
  margin-top: 6px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: 0 1px 3px rgba(44, 40, 36, 0.03), 0 4px 12px rgba(44, 40, 36, 0.02);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.chat-action-card:hover {
  box-shadow: 0 2px 6px rgba(44, 40, 36, 0.05), 0 8px 20px rgba(44, 40, 36, 0.03);
  border-color: var(--border-hover);
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

/* 底部仅留一个对话输入框：浮动工作室 Dock */
.chat-input-dock {
  position: relative;
  flex-shrink: 0;
  padding: 10px 12px 12px;
  background: var(--surface);
  border-top: 1px solid var(--border-light);
  box-shadow: 0 -4px 16px -2px rgba(44, 40, 36, 0.03);
  min-width: 0 !important;
  box-sizing: border-box;
}

/* 斜杠指令补全浮层 */
.slash-suggest-dock {
  position: absolute;
  bottom: calc(100% - 2px);
  left: 12px;
  right: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: 0 8px 24px rgba(44, 40, 36, 0.08);
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
  background: var(--bg);
  padding: 6px 8px 6px 12px;
  box-shadow: inset 0 1px 2px rgba(44, 40, 36, 0.02);
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  min-width: 0;
  box-sizing: border-box;
}

.chat-input-wrapper:hover {
  border-color: var(--border-hover);
}

.chat-input-wrapper:focus-within,
.chat-input-wrapper.focused {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 2px var(--accent-light), 0 2px 8px -2px rgba(44, 40, 36, 0.06);
}

.chat-textarea {
  flex: 1;
  min-width: 0;
  height: 24px;
  min-height: 24px;
  max-height: 120px;
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
  margin: 0 !important;
  font-family: var(--font-sans);
  font-size: 12.5px;
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
  width: 26px;
  height: 26px;
  border: none;
  background: var(--surface-hover);
  color: var(--text-muted);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
}

.chat-send-btn.active {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--accent) 30%, transparent);
}

.chat-send-btn.active:hover {
  background: var(--brand-logo-blue, var(--accent));
  transform: scale(1.05);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 40%, transparent);
}

.chat-send-btn:active {
  transform: scale(0.94);
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