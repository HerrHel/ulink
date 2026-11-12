<script setup lang="ts">
/**
 * ChatConvHeader — 对话态常驻顶栏（2026-11-11，第四版）。
 *
 * 解决三个都不该「滚着找」的东西：
 *   1. 历史会话入口（跨会话切换）；
 *   2. 本次会话标题（可就地重命名）；
 *   3. 新对话入口。
 *
 * 形态选择：不是 sticky 横带，也不是滚离顶部才浮出的胶囊 —— 而是列宽对齐正文的
 * 悬浮控件，底色只在中轴附近铺开、两侧用 mask 渐隐，正文从它下方穿过时像被雾化
 * 而不是被切了一刀。`pointer-events` 只落在三个控件上，其余区域让给正文。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { t } from '../../i18n/index.js'
import { truncateCodePoints } from '../../lib/ai/chatSessions.js'

const props = withDefaults(defineProps<{
  /** 当前会话标题（自定义 / 自动提炼 / i18n 兜底，父级已算好） */
  title: string
  /** 历史会话数量 */
  sessionCount: number
  /** 会话 id：编辑开始时捕获，随 rename 一起回传，杜绝跨会话写错对象 */
  sessionId?: string
}>(), { sessionId: '' })

const emit = defineEmits<{
  openHistory: []
  newChat: []
  rename: [sessionId: string, title: string]
}>()

const editing = ref(false)
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
const titleRef = ref<HTMLElement | null>(null)
/** 编辑开始时的会话与标题快照：会话切换/流式自动命名期间 props 会变，不能用实时值 */
const sessionAtStart = ref('')
const titleAtStart = ref('')

/**
 * 标题 ⇄ 输入框不是硬切：从当前标题的宽度「长」到输入框宽度，收起时再缩回去。
 * 先把内联宽度设成起点、强刷一帧，再交还给 CSS 的目标宽度，过渡才有起点。
 */
function animateWidth(el: HTMLElement | null, from: number | null) {
  if (!el || !from) return
  el.style.transition = 'none'
  el.style.width = `${Math.round(from)}px`
  void el.offsetWidth
  el.style.transition = ''
  el.style.width = ''
}

async function startEdit() {
  const fromWidth = titleRef.value?.getBoundingClientRect().width ?? null
  sessionAtStart.value = props.sessionId
  titleAtStart.value = (props.title || '').trim()
  draft.value = titleAtStart.value
  editing.value = true
  await nextTick()
  animateWidth(inputRef.value, fromWidth)
  inputRef.value?.focus()
  inputRef.value?.select()
}

/** 卸载输入框后把焦点还给标题按钮，避免键盘导航从文档开头重来 */
function restoreFocus() {
  void nextTick(() => titleRef.value?.focus())
}

/** 提交：Enter / 失焦；空串交给父级恢复自动命名 */
function commit() {
  if (!editing.value) return
  editing.value = false
  const next = draft.value.trim().replace(/\s+/g, ' ')
  restoreFocus()
  if (next === titleAtStart.value) return
  emit('rename', sessionAtStart.value, truncateCodePoints(next, 60))
}

/** 取消：Esc；先落 editing 再卸载输入框，避免随后的 blur 二次提交 */
function cancel() {
  if (!editing.value) return
  editing.value = false
  restoreFocus()
}

/** 中文输入法「按 Enter 选词」不能当作提交（Vue 的 .enter 不检查 isComposing） */
function onEnterKeyDown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  e.preventDefault()
  commit()
}

/** 会话真的换了就取消编辑：草稿属于旧会话，不能落到新会话上 */
watch(() => props.sessionId, (id) => {
  if (editing.value && id !== sessionAtStart.value) cancel()
})

/** 组件被卸载时（切视图 / 会话被删）兜底提交，避免已输入的草稿静默丢失 */
onBeforeUnmount(() => {
  if (editing.value) commit()
})
</script>

<template>
  <div class="conv-header">
    <div class="conv-header-inner">
      <div class="conv-header-side is-left">
        <button
          type="button"
          class="conv-history-btn"
          :title="t('ai.convHistory')"
          :aria-label="t('ai.convHistory')"
          @click="emit('openHistory')"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            <path d="M12 8v4l2.5 2.5" />
          </svg>
          <span class="conv-history-label">{{ t('ai.convHistory') }}</span>
          <span class="conv-history-count">{{ sessionCount }}</span>
        </button>
      </div>

      <div class="conv-header-center">
        <input
          v-if="editing"
          ref="inputRef"
          v-model="draft"
          class="conv-title-input"
          type="text"
          maxlength="60"
          :placeholder="t('ai.convRenameHint')"
          :aria-label="t('ai.convRename')"
          @keydown.enter="onEnterKeyDown"
          @keydown.esc.prevent="cancel"
          @blur="commit"
        />
        <button
          v-else
          ref="titleRef"
          type="button"
          class="conv-title"
          :title="t('ai.convRename')"
          @click="startEdit"
        >
          <span class="conv-title-text">{{ title }}</span>
          <svg class="conv-title-pencil" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
          </svg>
        </button>
      </div>

      <div class="conv-header-side is-right">
        <button
          type="button"
          class="conv-new-btn"
          :title="t('ai.convNewChat')"
          :aria-label="t('ai.convNewChat')"
          @click="emit('newChat')"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span class="conv-new-label">{{ t('ai.convNewChat') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conv-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 16;
  /* 整条区域不吃指针事件，只有三个控件可点，正文在其下方照常可选可滚 */
  pointer-events: none;
}

/* 雾化底：46px 内完全盖住（正文不会和按钮叠字），只在下沿 12px 化开、两侧渐隐 */
.conv-header::before {
  content: '';
  position: absolute;
  inset: 0 0 -12px;
  background: linear-gradient(
    to bottom,
    var(--bg) 0%,
    var(--bg) 79%,
    color-mix(in srgb, var(--bg) 72%, transparent) 90%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%);
  mask-image: linear-gradient(to right, transparent 0%, #000 9%, #000 91%, transparent 100%);
}

/* 与正文同宽同边距：三个控件严格坐在消息列的延长线上 */
.conv-header-inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  height: 46px;
  max-width: 760px;
  margin: 0 auto;
  padding: 0 20px;
}

.conv-header-side {
  display: flex;
  align-items: center;
  min-width: 0;
}
.conv-header-side.is-left { justify-content: flex-start; }
.conv-header-side.is-right { justify-content: flex-end; }

.conv-header-center {
  display: flex;
  justify-content: center;
  min-width: 0;
}

/* ── 历史会话：文字 + 条数，安静但一眼可见 ── */
.conv-history-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 7px 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
  pointer-events: auto;
  transition:
    color 0.16s ease,
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.conv-history-btn:hover {
  color: var(--accent);
  background: var(--surface-hover);
  border-color: var(--border-light);
}

.conv-history-btn svg {
  flex: 0 0 auto;
  opacity: 0.85;
}

.conv-history-label {
  white-space: nowrap;
}

.conv-history-count {
  min-width: 17px;
  padding: 1px 5px;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--text-muted) 14%, transparent);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
  text-align: center;
  transition:
    color 0.16s ease,
    background-color 0.16s ease;
}

.conv-history-btn:hover .conv-history-count {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

/* ── 会话标题：点一下就改名 ── */
.conv-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(420px, 100%);
  height: 28px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  pointer-events: auto;
  transition:
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.conv-title:hover {
  background: var(--surface-hover);
  border-color: var(--border-light);
}

.conv-title-text {
  min-width: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 铅笔只在 hover 时出现，静止时标题是干净的 */
.conv-title-pencil {
  flex: 0 0 auto;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.16s ease;
}
.conv-title:hover .conv-title-pencil { opacity: 0.75; }

.conv-title-input {
  /* 固定一段可读宽度：靠 100% 会退化成输入框固有宽度，改长标题时看得见半截 */
  width: clamp(200px, 42vw, 360px);
  height: 28px;
  padding: 0 10px;
  border-radius: var(--radius-sm, 6px);
  border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border));
  background: var(--surface);
  box-shadow: 0 0 0 3px var(--accent-light);
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 600;
  text-align: center;
  outline: none;
  pointer-events: auto;
  transition: width 0.24s cubic-bezier(0.4, 0, 0.2, 1);
}

.conv-title-input::placeholder {
  font-weight: 400;
  color: var(--text-muted);
}

/* ── 新对话：唯一带实感的控件，站内胶囊语言 ── */
.conv-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 11px 0 9px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-light);
  background: var(--surface-hover);
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
  pointer-events: auto;
  transition:
    color 0.16s ease,
    background-color 0.16s ease,
    border-color 0.16s ease;
}

.conv-new-btn:hover {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: var(--accent-light);
}

.conv-new-btn svg { flex: 0 0 auto; }

:global([data-theme="dark"]) .conv-new-btn {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset;
}

@media (max-width: 768px) {
  .conv-header-inner {
    height: 44px;
    padding: 0 12px;
    gap: 6px;
  }
  .conv-title { max-width: 100%; }
  .conv-title-text { font-size: var(--fs-xs); }
}

@media (max-width: 640px) {
  .conv-history-label { display: none; }
}

@media (max-width: 520px) {
  .conv-new-label { display: none; }
  .conv-new-btn {
    width: 26px;
    padding: 0;
    justify-content: center;
  }
}
</style>
