<template>
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
      <div v-if="showSlash && slashItems.length" class="slash-suggest-dock">
        <div
          v-for="(item, idx) in slashItems"
          :key="item.cmd"
          class="slash-suggest-item"
          :class="{ active: idx === activeIndex }"
          @click="emit('applySlash', item.cmd)"
          @mouseenter="activeIndex = idx"
        >
          <span class="slash-cmd-tag">{{ item.cmd }}</span>
          <span class="slash-cmd-title">{{ item.title }}</span>
          <span class="slash-cmd-desc">{{ item.desc }}</span>
        </div>
      </div>

      <div class="chat-input-wrapper" :class="{ focused: focused }">
        <textarea
          :ref="bindTa"
          v-model="query"
          class="chat-textarea"
          :placeholder="attachedCardsList.length > 0 ? t('ai.attachedInputPlaceholder') : t('ai.sidebarInputPlaceholder')"
          rows="1"
          @focus="focused = true"
          @blur="focused = false"
          @keydown="emit('taKeydown', $event)"
          @input="emit('adjustHeight')"
        ></textarea>
        <!-- 停止生成 / 发送按钮平滑切换 -->
        <button
          v-if="aiLoading"
          class="chat-send-btn stop active"
          @click="emit('stop')"
          :title="t('ai.stopGenerating')"
          :aria-label="t('ai.stopGenerating')"
        >
          <span class="stop-square"></span>
        </button>
        <button
          v-else
          class="chat-send-btn"
          :class="{ active: !!query.trim() || attachedCardsList.length > 0 }"
          :disabled="!query.trim() && attachedCardsList.length === 0"
          @click="emit('submit')"
          :title="t('ai.searchAction') + ' (Enter)'"
          :aria-label="t('ai.searchAction')"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
            <path d="M8 2.5l4.5 4.5h-3v6.5h-3V7h-3L8 2.5z"/>
          </svg>
        </button>
      </div>
    </div>
</template>

<script setup lang="ts">
import type { Ref } from 'vue'
import { useI18n } from '../../i18n/index.js'
import { useUIStore } from '../../stores/ui.js'

defineOptions({ name: 'ChatInputDock' })

/** 拖拽附加的卡片胶囊（组 / 书签） */
interface DockCard { type: 'group' | 'bm'; id: string; title: string; url: string }
/** 斜杠指令联想项（title/desc 已由父侧 t() 渲染） */
interface SlashItem { cmd: string; title: string; desc: string }

const props = defineProps<{
  attachedCardsList: DockCard[]
  slashItems: SlashItem[]
  showSlash: boolean
  aiLoading: boolean
  textareaRef: Ref<HTMLTextAreaElement | null>
}>()

const query = defineModel<string>('query', { required: true })
const focused = defineModel<boolean>('focused', { required: true })
const activeIndex = defineModel<number>('activeIndex', { required: true })

const emit = defineEmits<{
  applySlash: [cmd: string]
  submit: []
  stop: []
  taKeydown: [e: KeyboardEvent]
  adjustHeight: []
}>()

const { t } = useI18n()
const ui = useUIStore()

/** 函数 ref：把 textarea 元素写回父组件共享的 ref（useChatPanelDom / useChatInputInteraction 依赖它） */
function bindTa(el: unknown) {
  // 与父组件共享同一 ref 对象是刻意设计（父侧直接读写该 ref），并非修改 props 本身
  // eslint-disable-next-line vue/no-mutating-props
  props.textareaRef.value = el as HTMLTextAreaElement | null
}
</script>

<style scoped>
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
</style>
