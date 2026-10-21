<template>
  <!-- 底部常驻：单一精致对话框（集成斜杠联想、卡片附件、多模态文件附件与停止生成） -->
  <div
    class="chat-input-dock"
    @dragover.prevent="onDockDragOver"
    @dragleave.prevent="onDockDragLeave"
    @drop.prevent="onDockDrop"
    :class="{ 'dock-drag-over': isDockDragOver }"
  >
    <!-- 斜杠指令补全浮层（保留在输入框上方定位） -->
    <div v-if="showSlash && slashItems.length > 0" class="slash-suggest-dock" role="listbox">
      <div
        v-for="(item, idx) in slashItems"
        :key="item.cmd"
        class="slash-suggest-item"
        :class="{ active: idx === _activeIndex }"
        role="option"
        :aria-selected="idx === _activeIndex"
        @mousedown.prevent="emit('applySlash', item.cmd)"
      >
        <span class="slash-cmd-tag">{{ item.cmd }}</span>
        <span class="slash-cmd-title">{{ item.title }}</span>
        <span class="slash-cmd-desc">{{ item.desc }}</span>
      </div>
    </div>

    <!-- 统一精致输入卡片容器：顶部输入区 + 底部工具栏 -->
    <div
      class="chat-input-wrapper"
      :class="{ focused: focused, 'drag-active': isDockDragOver }"
    >
      <!-- 拖拽附加的卡片、笔记与多模态附件胶囊条（内置于输入容器顶部） -->
      <div v-if="hasAttachments" class="chat-attached-cards-bar">
        <!-- 卡片胶囊 -->
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

        <!-- 附件文件（图片、视频、文档）胶囊 -->
        <div
          v-for="file in attachedFilesList"
          :key="file.id"
          class="chat-attached-chip chip-file"
          :class="`chip-file-${file.type}`"
          :title="`${file.name} (${file.sizeFormatted})`"
        >
          <img v-if="file.type === 'image' && file.dataUrl" :src="file.dataUrl" :alt="file.name" class="chip-img-preview" />
          <span v-else class="chip-type-badge file-badge">
            {{ file.type === 'image' ? '🖼️' : file.type === 'video' ? '🎥' : '📄' }}
          </span>
          <span class="chip-title">{{ file.name }}</span>
          <span class="chip-filesize">{{ file.sizeFormatted }}</span>
          <button
            type="button"
            class="chip-remove-btn"
            @click.stop="ui.removeAiAttachedFile(file.id)"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
          >
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <button
          v-if="attachedCardsList.length + attachedFilesList.length > 1"
          type="button"
          class="chip-clear-all"
          @click="clearAllAttachments"
        >
          {{ t('common.clear') }}
        </button>
      </div>

      <!-- 上半部分：纯文本多行输入区 -->
      <div class="chat-input-main">
        <textarea
          :ref="bindTa"
          v-model="query"
          class="chat-textarea"
          :placeholder="hasAttachments ? t('ai.attachedInputPlaceholder') : t('ai.sidebarInputPlaceholder')"
          rows="2"
          @focus="focused = true"
          @blur="focused = false"
          @keydown="emit('taKeydown', $event)"
          @paste="handlePaste"
          @input="emit('adjustHeight')"
        ></textarea>
      </div>

      <!-- 下半部分：工具与发送按钮工具栏 -->
      <div class="chat-input-toolbar">
        <div class="toolbar-left">
          <!-- 附件选择按钮（+ 按钮，与截图一致） -->
          <button
            type="button"
            class="chat-tool-btn chat-attach-btn"
            :title="t('ai.attachFile')"
            :aria-label="t('ai.attachFile')"
            @click="triggerFileInput"
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

          <!-- 智能管家状态徽标（与截图中的左下角模型标签完全一致） -->
          <div class="toolbar-model-pill" title="与链全能资产管家 Agent">
            <span class="model-pill-dot"></span>
            <span class="model-pill-text">ULink Agent</span>
          </div>
        </div>

        <div class="toolbar-right">
          <!-- 停止生成 / 发送按钮（圆形操作大按钮，与截图完全一致） -->
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
            class="chat-send-btn round-send-btn"
            :class="{ active: !!query.trim() || hasAttachments }"
            :disabled="!query.trim() && !hasAttachments"
            @click="emit('submit')"
            :title="t('ai.searchAction') + ' (Enter)'"
            :aria-label="t('ai.searchAction')"
          >
            <!-- 贴合截图的清晰箭头图标 -->
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, type Ref } from 'vue'
import { useI18n } from '../../i18n/index.js'
import { useUIStore } from '../../stores/ui.js'
import { processFileForAi } from '../../lib/ai/attachmentHelper.js'
import { toast } from '../../lib/toast.js'

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
const _activeIndex = defineModel<number>('activeIndex', { required: true })

const emit = defineEmits<{
  applySlash: [cmd: string]
  submit: []
  stop: []
  taKeydown: [e: KeyboardEvent]
  adjustHeight: []
}>()

const { t } = useI18n()
const ui = useUIStore()

const attachedFilesList = computed(() => ui.aiAttachedFiles)
const hasAttachments = computed(() => props.attachedCardsList.length > 0 || attachedFilesList.value.length > 0)

function clearAllAttachments() {
  ui.clearAiAttachedCards()
  ui.clearAiAttachedFiles()
}

// ── 文件选择与附件上传 ──
const fileInputRef = ref<HTMLInputElement | null>(null)

function triggerFileInput() {
  fileInputRef.value?.click()
}

async function handleFiles(files: FileList | File[]) {
  if (!files || files.length === 0) return
  let addedCount = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (f.size > 50 * 1024 * 1024) {
      toast(t('ai.fileTooLarge'))
      continue
    }
    const processed = await processFileForAi(f)
    ui.attachFileToAi(processed)
    addedCount++
  }
  if (addedCount > 0) {
    if (addedCount === 1) {
      toast(t('ai.fileAttachedToast', { name: files[0].name }))
    } else {
      toast(t('ai.attachedFilesCount', { n: addedCount }))
    }
  }
}

async function handleFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) {
    await handleFiles(input.files)
  }
  input.value = ''
}

// ── 剪贴板直接粘贴图片或文件 ──
async function handlePaste(e: ClipboardEvent) {
  const clipboardData = e.clipboardData
  if (!clipboardData) return

  const files: File[] = []
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      files.push(clipboardData.files[i])
    }
  } else if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i]
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
  }

  if (files.length > 0) {
    const hasText = !!clipboardData.getData('text/plain')
    // 如果纯粘贴文件或图片，阻止默认在输入框中产生 [object File] 等异常占位
    if (!hasText) {
      e.preventDefault()
    }
    await handleFiles(files)
  }
}

// ── 拖拽文件到输入区域释放 ──
const isDockDragOver = ref(false)

function onDockDragOver(e: DragEvent) {
  if (e.dataTransfer?.types?.includes('Files')) {
    isDockDragOver.value = true
  }
}

function onDockDragLeave() {
  isDockDragOver.value = false
}

async function onDockDrop(e: DragEvent) {
  isDockDragOver.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    await handleFiles(files)
  }
}

/** 函数 ref：把 textarea 元素写回父组件共享的 ref（useChatPanelDom / useChatInputInteraction 依赖它） */
function bindTa(el: unknown) {
  // 与父组件共享同一 ref 对象是刻意设计（父侧直接读写该 ref），并非修改 props 本身
  // eslint-disable-next-line vue/no-mutating-props
  props.textareaRef.value = el as HTMLTextAreaElement | null
}
</script>

<style scoped>
/* 底部精致常驻 Dock */
.chat-input-dock {
  position: relative;
  flex-shrink: 0;
  padding: 8px 12px 12px;
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

/* 统一输入容器：舒适大高框设计，上下两段式（上输入，下工具） */
.chat-input-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 84px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg);
  padding: 9px 12px 7px 12px;
  box-shadow: inset 0 1px 2px rgba(44, 40, 36, 0.03);
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  min-width: 0;
  box-sizing: border-box;
}

:global([data-theme="dark"]) .chat-input-wrapper {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 0 0 rgba(255, 255, 255, 0.05);
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

:global([data-theme="dark"]) .chat-input-wrapper:focus-within,
:global([data-theme="dark"]) .chat-input-wrapper.focused {
  border-color: var(--accent);
  background: var(--surface);
  box-shadow: 0 0 0 2px var(--accent-glow), 0 4px 16px rgba(0, 0, 0, 0.35);
}

.dock-drag-over,
.chat-input-wrapper.drag-active {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 2px var(--accent-light) !important;
  background: var(--surface) !important;
}

/* 主输入区域 */
.chat-input-main {
  width: 100%;
  flex: 1;
  display: flex;
}

.chat-textarea {
  width: 100%;
  height: 44px;
  min-height: 44px;
  max-height: 160px;
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
  margin: 0 !important;
  font-family: var(--font-sans);
  font-size: 13.5px;
  line-height: 1.5;
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
  opacity: 0.75;
  user-select: none;
}

/* 底部操作与工具栏 */
.chat-input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 4px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 工具按钮（+ 附件添加等） */
.chat-tool-btn {
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
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
  padding: 0;
}

.chat-tool-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
  transform: scale(1.08);
}

.chat-tool-btn:active {
  transform: scale(0.95);
}

/* 智能管家微标签 (截图左下角模型标签) */
.toolbar-model-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2.5px 8px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: 12px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: default;
  user-select: none;
  transition: all 0.12s ease;
}

.toolbar-model-pill .model-pill-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #10b981;
}

:global([data-theme="dark"]) .toolbar-model-pill {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

/* 圆形发送与停止操作按钮 (截图右下角高亮圆按钮) */
.chat-send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: var(--surface-hover);
  color: var(--text-muted);
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  flex-shrink: 0;
  padding: 0;
}

.chat-send-btn.active {
  background: #2563eb;
  color: #fff;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
}

.chat-send-btn.active:hover {
  background: #1d4ed8;
  transform: scale(1.08);
  box-shadow: 0 3px 12px rgba(37, 99, 235, 0.45);
}

.chat-send-btn:active {
  transform: scale(0.94);
}

.chat-send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.chat-send-btn.stop {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 2px 8px var(--accent-glow);
}

.stop-square {
  width: 8px;
  height: 8px;
  background: #fff;
  border-radius: 1.5px;
  display: block;
}

/* 关联卡片/附件胶囊栏：置于输入框顶部 */
.chat-attached-cards-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  margin-bottom: 6px;
  padding-bottom: 5px;
  border-bottom: 1px dashed var(--border-light);
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
  padding: 2.5px 7px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  font-size: 11px;
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

.chip-img-preview {
  width: 15px;
  height: 15px;
  border-radius: 3px;
  object-fit: cover;
  flex-shrink: 0;
}

.chip-filesize {
  font-size: 9.5px;
  color: var(--text-muted);
  opacity: 0.85;
  margin-left: -2px;
  flex-shrink: 0;
}

.chip-file .file-badge {
  font-size: 10.5px;
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
  font-size: 10px;
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
