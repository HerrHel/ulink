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
                <span class="session-item-title">{{ sessionItemTitle(s) }}</span>
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

      <div class="chat-top-actions">
        <button
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
          v-if="!isMobileDevice"
          class="chat-btn-icon float-hud-btn"
          :class="{ 'is-active': isFloatingHud }"
          @click="toggleFloatingHud"
          :title="isFloatingHud ? t('ai.dockPanel') : t('ai.floatPanel')"
          :aria-label="isFloatingHud ? t('ai.dockPanel') : t('ai.floatPanel')"
        >
          <svg v-if="!isFloatingHud" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M15 3v18" />
          </svg>
        </button>
        <button
          class="chat-btn-icon close-btn"
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

    <!-- 中间区域：对话流 -->
    <div class="detail-inner chat-scroll-body" id="detailInner" ref="chatScrollRef">
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

                  <!-- 知识沉淀与反向写回操作条 (Bi-directional Knowledge Write-Back & Card Locating) -->
                  <div v-if="!turn.loading && turn.content" class="chat-writeback-toolbar">
                    <!-- 若当轮包含关联笔记，展示追加到原笔记与替换原笔记 -->
                    <template v-if="getAttachedNotes(turn).length > 0">
                      <button
                        v-for="note in getAttachedNotes(turn)"
                        :key="'append-' + note.id"
                        class="writeback-btn writeback-append"
                        :title="t('ai.writebackAppend') + ': ' + note.title"
                        @click="handleAppendToNote(note.id, turn.content)"
                      >
                        <span class="writeback-btn-icon" aria-hidden="true">📥</span>
                        <span>{{ t('ai.writebackAppend') }}</span>
                      </button>
                      <button
                        v-for="note in getAttachedNotes(turn)"
                        :key="'replace-' + note.id"
                        class="writeback-btn writeback-replace"
                        :title="t('ai.writebackReplace') + ': ' + note.title"
                        @click="handleReplaceNote(note.id, turn.content)"
                      >
                        <span class="writeback-btn-icon" aria-hidden="true">🔄</span>
                        <span>{{ t('ai.writebackReplace') }}</span>
                      </button>
                    </template>

                    <!-- 始终提供存为新笔记 -->
                    <button
                      class="writeback-btn writeback-new"
                      :title="t('ai.writebackNew')"
                      @click="handleSaveAsNewNote(turn.content)"
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
                      @click="handleLocateCard(card.id, card.type === 'group' ? 'group' : 'bookmark')"
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
    </div>

    <!-- 底部常驻：单一精致对话框（集成斜杠联想、卡片附件与停止生成） -->
    <div class="chat-input-dock">
      <!-- 拖拽附加的卡片与笔记胶囊条 -->
      <div v-if="attachedCardsList.length > 0" class="chat-attached-cards-bar">
        <div
          v-for="card in attachedCardsList"
          :key="card.id"
          class="chat-attached-chip"
          :class="`chip-${card.type}`"
          :title="card.url || card.title"
        >
          <span class="chip-type-badge">{{ card.type === 'group' ? t('cards.note') : t('cards.bookmark') }}</span>
          <span class="chip-title">{{ card.title }}</span>
          <button
            type="button"
            class="chip-remove-btn"
            @click.stop="ui.removeAiAttachedCard(card.id)"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
          >
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <button
          v-if="attachedCardsList.length > 1"
          type="button"
          class="chip-clear-all"
          @click="ui.clearAiAttachedCards()"
        >
          {{ t('common.clear') }}
        </button>
      </div>

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
          :placeholder="attachedCardsList.length > 0 ? t('ai.attachedInputPlaceholder') : t('ai.sidebarInputPlaceholder')"
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
          :class="{ active: !!aiQuery.trim() || attachedCardsList.length > 0 }"
          :disabled="!aiQuery.trim() && attachedCardsList.length === 0"
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
import { isMobile } from '../../utils.js'
import { I } from '../../config/icons.js'
import { useI18n } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'
import AiInlineCard from '../cards/AiInlineCard.vue'
import { parseTurnContentSegments, mergeParsedCandidates, type ChatContentSegment } from '../../lib/ai/chatStreamParser.js'
import type { ChatTurn, AiChatSession } from '../../lib/ai/chatSessions.js'
import { isDefaultSessionTitle, type AttachedCardMeta } from '../../lib/ai/chatSessions.js'
import { useAiChat } from '../../composables/domain/useAiChat.js'
import { locateAndHighlightCard } from '../../lib/ai/cardLocator.js'
import {
  appendAiContentToGroup,
  replaceAiContentToGroup,
  createNoteFromAiContent,
} from '../../lib/ai/noteWriteback.js'

const { t, locale } = useI18n()
const isZh = computed(() => locale.value.startsWith('zh'))

const ui = useUIStore()
const ds = useDataStore()
const detailPanelRef = ref<HTMLElement | null>(null)
const aiTextareaRef = ref<HTMLTextAreaElement | null>(null)
const chatScrollRef = ref<HTMLElement | null>(null)

const isOpen = computed(() => ui.panels.detail)

const isInputFocused = ref(false)
const isSessionMenuOpen = ref(false)
const isDragOverPanel = ref(false)

const isMobileDevice = computed(() => isMobile())
const isFloatingHud = ref<boolean>(() => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('ulink_ai_floating_hud') === 'true'
  } catch {
    return false
  }
})

function toggleFloatingHud() {
  isFloatingHud.value = !isFloatingHud.value
  try {
    localStorage.setItem('ulink_ai_floating_hud', String(isFloatingHud.value))
  } catch {
    // 忽略持久化异常
  }
}

function onPanelDragOver() {
  if (ui.isDraggingCard) {
    isDragOverPanel.value = true
  }
}

function onPanelDragLeave(e: DragEvent) {
  const rect = detailPanelRef.value?.getBoundingClientRect()
  if (rect) {
    if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
      isDragOverPanel.value = false
    }
  }
}

function onPanelDrop() {
  isDragOverPanel.value = false
}

watch(
  () => ui.isDraggingCard,
  (dragging) => {
    if (!dragging) {
      isDragOverPanel.value = false
    }
  },
)

const attachedCardsList = computed(() => {
  return ui.aiAttachedCards.map((ref) => {
    if (ref.type === 'group') {
      const g = ds.groupMap[ref.id]
      return {
        type: 'group' as const,
        id: ref.id,
        title: g?.name || t('cards.note'),
        url: '',
      }
    } else {
      const b = ds.bookmarkMap[ref.id]
      return {
        type: 'bm' as const,
        id: ref.id,
        title: b?.title || b?.url || t('cards.bookmark'),
        url: b?.url || '',
      }
    }
  })
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

/** 会话列表标题：未命名（含存量旧默认标题）回退到 i18n 默认标题 */
function sessionItemTitle(s: AiChatSession): string {
  return isDefaultSessionTitle(s.title) ? t('ai.sessionDefaultTitle') : s.title
}

function getTurnAttachedCards(turn: ChatTurn): AttachedCardMeta[] {
  if (turn.attachedCards && turn.attachedCards.length > 0) {
    return turn.attachedCards
  }
  const idx = chatTurns.value.findIndex((t) => t.id === turn.id)
  if (idx > 0) {
    const prevTurn = chatTurns.value[idx - 1]
    if (prevTurn?.role === 'user' && prevTurn.attachedCards?.length) {
      return prevTurn.attachedCards
    }
  }
  return []
}

function getAttachedNotes(turn: ChatTurn): AttachedCardMeta[] {
  return getTurnAttachedCards(turn).filter((c) => c.type === 'group')
}

function handleAppendToNote(noteId: string, content: string) {
  appendAiContentToGroup(noteId, content)
}

function handleReplaceNote(noteId: string, content: string) {
  replaceAiContentToGroup(noteId, content)
}

function handleSaveAsNewNote(content: string) {
  const res = createNoteFromAiContent({ aiText: content })
  if (res.success && res.groupId) {
    locateAndHighlightCard({ id: res.groupId, type: 'group' })
  }
}

function handleLocateCard(id: string, type: 'bookmark' | 'group') {
  locateAndHighlightCard({ id, type, collapseDetailOnMobile: true })
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

  // 同步随文卡片到 turn.candidates（流式期间持续全量合并去重，保证持久化与一键全部存入不漏卡）
  if (allCandidates.length) {
    const merged = mergeParsedCandidates(turn.candidates, allCandidates)
    if (merged !== turn.candidates) turn.candidates = merged
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
    toast(t('ai.copyFailed'), false)
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
      nextTick(() => {
        adjustTextareaHeight()
        aiTextareaRef.value?.focus()
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
  if (translateY.value > panelHeight * 0.3) { ui.panels.detail = false }
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

/* 顶栏：轻量温润，质感与 CornerInspectorCard / 主站卡片 Header 严格对齐 */
.chat-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 38px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--border-light);
  background: var(--surface);
  flex-shrink: 0;
  min-width: 0;
  user-select: none;
}

:global([data-theme="dark"]) .chat-top-bar {
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.04) inset;
}

.chat-top-title-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

/* 会话切换胶囊：主站精工卡片徽标质感，兼具微动效与手感反馈 */
.chat-session-dropdown-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  cursor: pointer;
  padding: 3px 9px;
  border-radius: var(--radius-sm, 6px);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.02);
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  max-width: 175px;
}

.chat-session-dropdown-btn:hover {
  background: var(--surface-active);
  border-color: var(--border);
  color: var(--accent);
  transform: translateY(-0.5px);
}

:global([data-theme="dark"]) .chat-session-dropdown-btn {
  background: var(--surface-hover);
  border-color: var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset;
}

:global([data-theme="dark"]) .chat-session-dropdown-btn:hover {
  border-color: var(--border-hover);
  background: var(--surface-active);
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

/* 会话下拉浮层：与主站 Popover / Card 质感完全对齐 */
.session-dropdown-popover {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  width: 230px;
  max-width: 260px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  overflow: hidden;
  animation: sessionPopIn 0.15s ease-out;
}

:global([data-theme="dark"]) .session-dropdown-popover {
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset,
              0 0 0 1px var(--border-hover),
              var(--shadow-xl);
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
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.12s ease;
}

.chat-btn-icon:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--border-light);
  color: var(--text);
}

.chat-btn-icon.close-btn:hover:not(:disabled) {
  background: var(--rose-light, #fee2e2);
  border-color: transparent;
  color: var(--rose, #e11d48);
}

:global([data-theme="dark"]) .chat-btn-icon:hover:not(:disabled) {
  border-color: var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset;
}

:global([data-theme="dark"]) .chat-btn-icon.close-btn:hover:not(:disabled) {
  background: var(--rose-light, rgba(244, 63, 94, 0.15));
  border-color: transparent;
  color: var(--rose, #f43f5e);
  box-shadow: none;
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

/* 底部仅留一个对话输入框：浮动工作室 Dock，主站卡片级材质底座 */
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

:global([data-theme="dark"]) .chat-input-dock {
  background: var(--surface);
  border-top: 1px solid var(--border);
  box-shadow: 0 -6px 20px -2px rgba(0, 0, 0, 0.45), 0 1px 0 0 rgba(255, 255, 255, 0.05) inset;
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

:global([data-theme="dark"]) .slash-suggest-dock {
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset,
              0 0 0 1px var(--border-hover),
              var(--shadow-xl);
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
  border-radius: var(--radius-md, 10px);
  background: var(--bg);
  padding: 6px 8px 6px 12px;
  box-shadow: inset 0 1px 2px rgba(44, 40, 36, 0.03);
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

:global([data-theme="dark"]) .chat-input-wrapper {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 0 0 rgba(255, 255, 255, 0.05);
}

:global([data-theme="dark"]) .chat-input-wrapper:hover {
  border-color: var(--border-hover);
}

:global([data-theme="dark"]) .chat-input-wrapper:focus-within,
:global([data-theme="dark"]) .chat-input-wrapper.focused {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 2px var(--accent-glow), 0 4px 16px rgba(0, 0, 0, 0.35);
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
  box-shadow: 0 2px 6px var(--accent-glow);
}

.chat-send-btn.active:hover {
  background: var(--brand-logo-blue, var(--accent));
  transform: scale(1.04);
  box-shadow: 0 3px 10px var(--accent-glow);
}

.chat-send-btn:active {
  transform: scale(0.94);
}

.chat-send-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

:global([data-theme="dark"]) .chat-send-btn.active {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.15) inset, 0 2px 8px var(--accent-glow);
}

/* 停止生成方块按钮 */
.chat-send-btn.stop {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 2px 6px var(--accent-glow);
}

.stop-square {
  width: 8px;
  height: 8px;
  background: #fff;
  border-radius: 1.5px;
  display: block;
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

.detail-panel.chat-drop-active .chat-input-wrapper {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-glow);
}

/* 关联卡片/附件胶囊栏：主站精致 Chip 质感 */
.chat-attached-cards-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  animation: attachSlideIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes attachSlideIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.chat-attached-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  font-size: 11.5px;
  color: var(--text);
  max-width: 220px;
  box-shadow: var(--shadow-xs);
  transition: all 0.14s ease;
}

.chat-attached-chip:hover {
  border-color: var(--border-hover);
  background: var(--surface-hover);
  transform: translateY(-0.5px);
}

:global([data-theme="dark"]) .chat-attached-chip {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset, 0 1px 3px rgba(0, 0, 0, 0.25);
}

:global([data-theme="dark"]) .chat-attached-chip:hover {
  border-color: var(--border-hover);
  background: var(--surface-hover);
}

.chat-attached-chip .chip-type-badge {
  font-size: 9.5px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  font-weight: 500;
  flex-shrink: 0;
}

.chat-attached-chip.chip-group .chip-type-badge {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent) 25%, transparent);
}

.chat-attached-chip .chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.chat-attached-chip .chip-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 50%;
  flex-shrink: 0;
  transition: all 0.12s ease;
}

.chat-attached-chip .chip-remove-btn:hover {
  background: var(--border);
  color: var(--text);
}

.chat-attached-cards-bar .chip-clear-all {
  font-size: 10.5px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.chat-attached-cards-bar .chip-clear-all:hover {
  color: var(--accent);
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

.chat-btn-icon.float-hud-btn.is-active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

:global([data-theme="dark"]) .chat-btn-icon.float-hud-btn.is-active {
  background: color-mix(in srgb, var(--accent) 15%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}
</style>