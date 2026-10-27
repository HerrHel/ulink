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
        <!-- 1. 书签与笔记资产卡片（等高 52px 结构化微卡片） -->
        <div
          v-for="card in attachedCardsList"
          :key="card.id"
          class="chat-attached-chip attach-card-item attach-card-pill"
          :class="`pill-${card.type}`"
        >
          <!-- 书签类型 -->
          <template v-if="card.type === 'bm'">
            <div class="card-icon-box bm-icon-box">
              <img v-if="getBookmarkIcon(card.id)" :src="getBookmarkIcon(card.id)" class="bm-favicon" alt="" />
              <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="card-text-col">
              <span class="card-main-title">{{ card.title }}</span>
              <span class="card-sub-info">{{ getBookmarkDomain(card.id) || t('cards.bookmark') }}</span>
            </div>
            <div class="attach-tooltip">{{ card.title }}<template v-if="card.url"> ({{ card.url }})</template></div>
          </template>

          <!-- 笔记类型 -->
          <template v-else>
            <div class="card-icon-box note-icon-box">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21.66 10.44L20.68 14.62C19.84 18.23 18.18 19.69 15.06 19.39C14.56 19.35 14.02 19.26 13.44 19.12L11.76 18.72C7.59 17.73 6.3 15.67 7.28 11.49L8.26 7.3C8.46 6.45 8.7 5.71 9 5.1C10.17 2.68 12.16 2.03 15.5 2.82L17.17 3.21C21.36 4.19 22.64 6.26 21.66 10.44Z"/>
                <path d="M7.83 5.41L6.25 5.93C2.28 7.21 1.22 9.31 2.5 13.28L3.78 17.23C5.07 21.2 7.16 22.27 11.13 20.99L12.71 20.47" opacity="0.5"/>
              </svg>
            </div>
            <div class="card-text-col">
              <span class="card-main-title">{{ card.title }}</span>
              <span class="card-sub-info">{{ getNoteMeta(card.id) }}</span>
            </div>
            <div class="attach-tooltip">{{ card.title }} ({{ t('cards.note') }})</div>
          </template>

          <!-- 移除按钮（右上角圆底 ×） -->
          <button
            type="button"
            class="chip-remove-btn attach-close-btn"
            @click.stop="ui.removeAiAttachedCard(card.id)"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
          >
            <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </div>

        <!-- 2. 图片缩略图卡片（完全还原用户参考截图：方块缩略图 + 悬停深色气泡文件名） -->
        <template v-for="file in attachedFilesList" :key="file.id">
          <!-- 图片展示为方块缩略图，悬停在上方显示文件名 -->
          <div
            v-if="file.type === 'image'"
            class="chat-attached-chip attach-card-item attach-card-thumb"
          >
            <img v-if="file.dataUrl" :src="file.dataUrl" :alt="file.name" class="thumb-img" />
            <div v-else class="thumb-fallback">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
            <!-- 悬停上方展示文件名（与参考截图一致） -->
            <div class="attach-tooltip">{{ file.name }}</div>
            <!-- 右上角关闭按钮（与参考截图一致） -->
            <button
              type="button"
              class="chip-remove-btn attach-close-btn thumb-close-btn"
              @click.stop="ui.removeAiAttachedFile(file.id)"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
            >
              <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          </div>

          <!-- 3. 文件/视频/代码/PDF 文档卡片（等高 52px 结构化微卡片） -->
          <div
            v-else
            class="chat-attached-chip attach-card-item attach-card-pill pill-file"
            :class="`pill-file-${getFileCategory(file)}`"
          >
            <div class="card-icon-box" :class="`file-icon-${getFileCategory(file)}`">
              <!-- PDF -->
              <svg v-if="getFileCategory(file) === 'pdf'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
              <!-- 视频 -->
              <svg v-else-if="getFileCategory(file) === 'video'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              <!-- 代码 -->
              <svg v-else-if="getFileCategory(file) === 'code'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              <!-- 通用文档 -->
              <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div class="card-text-col">
              <span class="card-main-title">{{ file.name }}</span>
              <span class="card-sub-info">{{ file.sizeFormatted }}</span>
            </div>
            <div class="attach-tooltip">{{ file.name }} ({{ file.sizeFormatted }})</div>
            <!-- 移除按钮 -->
            <button
              type="button"
              class="chip-remove-btn attach-close-btn"
              @click.stop="ui.removeAiAttachedFile(file.id)"
              :title="t('common.delete')"
              :aria-label="t('common.delete')"
            >
              <svg viewBox="0 0 16 16" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          </div>
        </template>

        <!-- 清空全部按钮 -->
        <button
          v-if="attachedCardsList.length + attachedFilesList.length > 1"
          type="button"
          class="chip-clear-all"
          @click="clearAllAttachments"
          :title="t('common.clear')"
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
          rows="1"
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
import { useDataStore } from '../../stores/data.js'
import { processFileForAi, type AttachedMediaFile } from '../../lib/ai/attachmentHelper.js'
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
const ds = useDataStore()

const attachedFilesList = computed(() => ui.aiAttachedFiles)
const hasAttachments = computed(() => props.attachedCardsList.length > 0 || attachedFilesList.value.length > 0)

function getBookmarkIcon(id: string): string | undefined {
  return ds.bookmarkMap[id]?.icon
}

function getBookmarkDomain(id: string): string {
  const b = ds.bookmarkMap[id]
  if (!b?.url) return b?.categoryId ? (ds.categoryMap[b.categoryId]?.name || '') : ''
  try {
    const host = new URL(b.url).hostname.replace(/^www\./, '')
    const cat = b?.categoryId ? ds.categoryMap[b.categoryId]?.name : ''
    return cat ? `${host} • ${cat}` : host
  } catch {
    return ''
  }
}

function getNoteMeta(id: string): string {
  const g = ds.groupMap[id]
  if (!g) return t('cards.note')
  const count = g.bookmarkIds?.length || 0
  const cat = g.categoryId ? ds.categoryMap[g.categoryId]?.name : ''
  const parts: string[] = [t('cards.note')]
  if (count > 0) parts.push(`${count} 项`)
  if (cat && cat !== 'all' && cat !== 'uncategorized') parts.push(cat)
  return parts.join(' • ')
}

function getFileCategory(file: AttachedMediaFile): 'image' | 'video' | 'pdf' | 'code' | 'doc' {
  if (file.type === 'image') return 'image'
  if (file.type === 'video') return 'video'
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf' || file.mimeType.includes('pdf')) return 'pdf'
  if (['js', 'ts', 'jsx', 'tsx', 'vue', 'json', 'py', 'java', 'c', 'cpp', 'rs', 'go', 'html', 'css', 'scss', 'sql', 'sh', 'md'].includes(ext)) {
    return 'code'
  }
  return 'doc'
}

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

/* 统一输入容器：舒适两段式设计（上纯文本输入，下工具栏） */
.chat-input-wrapper {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg);
  padding: 8px 10px 8px 12px;
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
  height: 24px;
  min-height: 24px;
  max-height: 160px;
  border: none !important;
  background: transparent !important;
  padding: 0 !important;
  margin: 0 !important;
  font-family: var(--font-sans);
  font-size: 13.5px;
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
  opacity: 0.75;
  user-select: none;
}

/* 底部操作与工具栏 */
.chat-input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 0;
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
  gap: 8px;
  margin-bottom: 8px;
  padding-top: 4px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--border-light);
  animation: attachSlideIn 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  overflow: visible;
  position: relative;
}

@keyframes attachSlideIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 附件通用项容器 */
.attach-card-item {
  position: relative;
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
  flex-shrink: 0;
}

/* 1. 图片缩略图卡片（贴合用户截图：圆角方块缩略图 + 悬停深色气泡文件名） */
.attach-card-thumb {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.attach-card-thumb:hover {
  border-color: var(--border-hover);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12);
}

:global([data-theme="dark"]) .attach-card-thumb {
  background: #18181b;
  border-color: rgba(255, 255, 255, 0.12);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
}

.attach-card-thumb .thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 9px;
  display: block;
}

.attach-card-thumb .thumb-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

/* 2. 结构化卡片（书签、笔记、文档、视频、代码） */
.attach-card-pill {
  display: inline-flex;
  align-items: center;
  height: 52px;
  padding: 6px 26px 6px 8px; /* 右侧 26px 预留给关闭按钮 */
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  gap: 8px;
  max-width: 200px;
  cursor: default;
}

.attach-card-pill:hover {
  border-color: var(--border-hover);
  background: var(--surface-hover);
}

:global([data-theme="dark"]) .attach-card-pill {
  background: #18181b;
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

:global([data-theme="dark"]) .attach-card-pill:hover {
  background: #202024;
  border-color: rgba(255, 255, 255, 0.18);
}

/* 图标容器框 */
.card-icon-box {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.bm-icon-box {
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-hover));
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
}

.bm-favicon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  object-fit: contain;
}

.note-icon-box {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.22);
}

.file-icon-pdf {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.22);
}

.file-icon-video {
  background: rgba(168, 85, 247, 0.12);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.22);
}

.file-icon-code {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.22);
}

.file-icon-doc {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.22);
}

/* 文字双行排版 */
.card-text-col {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  overflow: hidden;
  line-height: 1.35;
}

.card-main-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-sub-info {
  font-size: 10.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

/* 右上角关闭删除圆按钮（贴合截图中的右上角圆黑底 ×） */
.attach-close-btn {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  color: #ffffff;
  border: 1.5px solid var(--surface);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.14s ease;
  z-index: 20;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.attach-close-btn:hover {
  background: rgba(220, 38, 38, 0.95);
  transform: scale(1.12);
}

:global([data-theme="dark"]) .attach-close-btn {
  background: rgba(30, 30, 35, 0.85);
  border-color: #242428;
  color: #f4f4f5;
}

:global([data-theme="dark"]) .attach-close-btn:hover {
  background: rgba(239, 68, 68, 0.95);
}

/* 浮动提示 Tooltip（贴合截图中的上方深色浮现气泡） */
.attach-tooltip {
  position: absolute;
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: #18181b;
  color: #f4f4f5;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 60;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.attach-tooltip::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: #18181b;
}

.attach-card-item:hover .attach-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

/* 清空全部按钮 */
.chat-attached-cards-bar .chip-clear-all {
  height: 24px;
  padding: 0 8px;
  border-radius: 12px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.chat-attached-cards-bar .chip-clear-all:hover {
  color: var(--danger, #ef4444);
  border-color: var(--danger, #ef4444);
}
</style>
