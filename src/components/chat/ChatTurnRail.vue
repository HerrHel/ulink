<script setup lang="ts">
/**
 * 左侧消息锚点导航（2026-11-11）。
 *
 * 设计取舍：AI 工作台主内容是 760px 居中瀑布流，常驻侧栏会挤压阅读宽度，
 * 所以默认只露一条极窄的点带（每个点 = 一轮用户提问），hover / 键盘聚焦时
 * 才向右展开摘要列表。点击任一项 emit('jump')，由父组件滚动到对应消息。
 *
 * 展开状态用纯事件 + ref，不引入定时器；focusout 用 relatedTarget 判断，
 * 避免在点之间切换焦点时误收起。
 */
import { computed, ref } from 'vue'
import { t } from '../../i18n/index.js'
import { buildTurnAnchors } from '../../lib/ai/turnAnchors.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

const props = defineProps<{
  turns: ChatTurn[]
  activeId: string | null
}>()

const emit = defineEmits<{
  jump: [id: string]
  openHistory: []
}>()

/** 少于两轮时不值得占一条导航带 */
const anchors = computed(() => buildTurnAnchors(props.turns))
const expanded = ref(false)

function labelOf(label: string): string {
  return label || t('ai.turnRailAttachment')
}

function onFocusOut(e: FocusEvent) {
  const root = e.currentTarget as HTMLElement | null
  const next = e.relatedTarget as Node | null
  if (!root || (next && root.contains(next))) return
  expanded.value = false
}
</script>

<template>
  <div
    v-if="anchors.length >= 2"
    class="chat-turn-rail"
    :class="{ 'is-expanded': expanded }"
    @mouseenter="expanded = true"
    @mouseleave="expanded = false"
    @focusin="expanded = true"
    @focusout="onFocusOut"
  >
    <!-- 常驻点带 -->
    <div class="rail-dot-column" role="group" :aria-label="t('ai.turnRailTitle')">
      <button
        v-for="(a, i) in anchors"
        :key="a.id"
        type="button"
        class="rail-dot"
        :class="{ 'is-active': a.id === activeId }"
        :aria-label="`${t('ai.turnRailItem', { n: i + 1 })} · ${labelOf(a.label)}`"
        :title="labelOf(a.label)"
        @click="emit('jump', a.id)"
      />
    </div>

    <!-- hover / 聚焦时展开的摘要列表 -->
    <Transition name="rail-pop">
      <div v-if="expanded" class="rail-panel" :aria-label="t('ai.turnRailTitle')">
        <div class="rail-panel-head">
          <span class="rail-panel-title">{{ t('ai.turnRailTitle') }}</span>
          <span class="rail-panel-count">{{ anchors.length }}</span>
        </div>
        <div class="rail-panel-list">
          <button
            v-for="(a, i) in anchors"
            :key="a.id"
            type="button"
            class="rail-panel-item"
            :class="{ 'is-active': a.id === activeId }"
            @click="emit('jump', a.id)"
          >
            <span class="rail-panel-idx">{{ i + 1 }}</span>
            <span class="rail-panel-label">{{ labelOf(a.label) }}</span>
          </button>
        </div>
        <button type="button" class="rail-history-btn" @click="emit('openHistory')">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          </svg>
          <span>{{ t('ai.turnRailHistory') }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.chat-turn-rail {
  position: absolute;
  left: 6px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 14;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 3px;
  border-radius: var(--radius-full);
}

/* 常驻只有 ~13px 宽，落在 .ai-dialogue-stream-wrap 的 20px padding 内，不遮文字 */
.rail-dot-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  max-height: min(58vh, 420px);
  padding: 3px;
  overflow-y: auto;
  scrollbar-width: none;
}
.rail-dot-column::-webkit-scrollbar { display: none; }

.rail-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  padding: 0;
  border: none;
  border-radius: var(--radius-full);
  background: var(--text-muted);
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}
.rail-dot:hover {
  opacity: 1;
  transform: scale(1.25);
}
.rail-dot.is-active {
  opacity: 1;
  background: var(--accent);
  transform: scale(1.35);
  box-shadow: 0 0 0 3px var(--accent-light);
}

.rail-panel {
  width: 248px;
  max-height: min(58vh, 420px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  font-size: var(--fs-xs);
}

.rail-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border-light);
  color: var(--text-secondary);
}
.rail-panel-title { font-weight: 600; }
.rail-panel-count {
  min-width: 18px;
  text-align: center;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  background: var(--surface-hover);
  color: var(--text-muted);
}

.rail-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}
.rail-panel-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.rail-panel-item:hover { background: var(--surface-hover); }
.rail-panel-item.is-active {
  background: var(--accent-light);
  color: var(--accent);
}
.rail-panel-idx {
  flex: 0 0 auto;
  min-width: 14px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.rail-panel-item.is-active .rail-panel-idx { color: var(--accent); }
.rail-panel-label {
  flex: 1;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-history-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 12px;
  border: none;
  border-top: 1px solid var(--border-light);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.rail-history-btn:hover {
  color: var(--accent);
  background: var(--accent-light);
}

.rail-pop-enter-active,
.rail-pop-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.rail-pop-enter-from,
.rail-pop-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

/* 窄屏内容区没有余量，隐藏导航带；sticky 顶栏仍保证「开启新对话」随时可点 */
@media (max-width: 768px) {
  .chat-turn-rail { display: none; }
}
</style>
