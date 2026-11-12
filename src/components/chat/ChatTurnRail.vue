<script setup lang="ts">
/**
 * 左侧消息时间轴（2026-11-11，第三版）。
 *
 * 参考 Antigravity 的轨道刻度 + WorkBuddy 的紧凑摘要列表，材质用 ulink 自己的
 * `color-mix` 半透明表面 + `backdrop-filter` 毛玻璃（同底部 dock）、1px 发丝边、
 * `--shadow-lg` 与统一 `cubic-bezier(0.16, 1, 0.3, 1)` 曲线。
 *
 * 两条硬约束：
 * 1. 收起态点距要小（10px 行高 + 4px gap，像一串珠子），展开才拉到 30px 行高；
 * 2. 展开的形变必须像「点带自己长成栏目」，而不是旁边冒出一张卡片。
 *
 * 实现：容器高度固定为展开态总高（`N × 30px`，受视口上限约束），点列在容器内
 * 居中 → 变高时从中心向两侧散开，容器中心与 `translateY(-50%)` 完全不动。
 *
 * 动画分四层，顺序是「长出」而不是「弹出」：
 *   0ms   带材质的窄条从左缘向右生长（表面铺满容器、与宽度共用同一曲线，
 *         不做横向缩放——否则表面追不上宽度，会先弹出一个透明骨架）；
 *   60ms  点被这条「条」撑开（行高 10→30、间距 4→0）；
 *   180ms 文字从点带一侧以 clip-path 揭示；
 *   220ms 轴线浮现，把散开的点重新串成时间轴。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { t } from '../../i18n/index.js'
import { buildTurnAnchors, computeVisibleAnchors } from '../../lib/ai/turnAnchors.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

const props = defineProps<{
  turns: ChatTurn[]
  activeId: string | null
}>()

const emit = defineEmits<{
  jump: [id: string]
}>()

/** 少于两轮时不值得占一条导航带 */
const anchors = computed(() => buildTurnAnchors(props.turns))
const expanded = ref(false)

/** 收起态点列上限：再多也不铺满，两端用淡化点提示「还有」 */
const MAX_DOTS = 10

/**
 * 收起：窗口化 10 点 + 两端淡化（一眼看当前位置）
 * 展开：全量轮次 + 滚动条（可随手翻到任意历史轮）
 */
const visibleAnchors = computed(() =>
  expanded.value
    ? anchors.value.map((a, i) => ({ ...a, index: i, fadeTop: false, fadeBottom: false }))
    : computeVisibleAnchors(anchors.value, props.activeId, MAX_DOTS),
)

const itemsRef = ref<HTMLElement | null>(null)

// ── 自绘滚动条：overlay 滚动条在部分环境不占宽/静止时不可见，自己画一条更可靠 ──
const scrollable = ref(false)
const thumbH = ref(0)
const thumbTop = ref(0)

/** 轨道上下各内缩 8px（与 CSS 的 top/bottom 保持一致） */
const SCROLLBAR_INSET = 8

function updateScrollbar() {
  const el = itemsRef.value
  if (!el) return
  const { scrollTop, scrollHeight, clientHeight } = el
  scrollable.value = scrollHeight > clientHeight + 1
  if (!scrollable.value) {
    thumbH.value = 0
    thumbTop.value = 0
    return
  }
  // 滑块长度与位移都按「轨道可用高度」算，否则滚到底会溢出轨道
  const barH = Math.max(0, clientHeight - SCROLLBAR_INSET * 2)
  const h = Math.max(20, (barH * clientHeight) / scrollHeight)
  thumbH.value = h
  const maxTop = Math.max(0, barH - h)
  thumbTop.value = (maxTop * scrollTop) / Math.max(1, scrollHeight - clientHeight)
}

/**
 * 容器高度恒定按「min(总轮数, 上限) × 30px + 留白」：展开态多出来的轮次靠
 * 滚动条消化，容器本身不变高 → 点列中心不跳。
 */
const railStyle = computed(() => ({
  '--rail-count': String(Math.min(anchors.value.length, MAX_DOTS)),
}))

/** 展开时把当前轮滚到列表中部，并重置收起态的滚动残留 */
watch(expanded, async (open) => {
  await nextTick()
  const box = itemsRef.value
  if (!box) return
  if (!open) {
    box.scrollTop = 0
    return
  }
  const activeEl = box.querySelector<HTMLElement>('.turn-rail-item.is-active')
  if (activeEl) {
    box.scrollTop = Math.max(
      0,
      activeEl.offsetTop - box.clientHeight / 2 + activeEl.offsetHeight / 2,
    )
  }
  updateScrollbar()
})

// 轮次数量变化（新消息 / 切会话）时重算滚动条
watch(visibleAnchors, () => nextTick(updateScrollbar))

function labelOf(label: string): string {
  return label || t('ai.turnRailAttachment')
}

/**
 * 自绘滚动条的拖动：按「滑块位移 → scrollTop」等比映射。
 * 拖动期间锁住收起（指针滑出栏目宽度时 mouseleave 会把整个栏目收掉），
 * 但松手/中断时必须补一次判断，否则那次被吞掉的 mouseleave 就没有下文了。
 */
const dragging = ref(false)
const rootRef = ref<HTMLElement | null>(null)
let stopDrag: (() => void) | null = null

function isPointerInRail(x: number, y: number): boolean {
  const root = rootRef.value
  if (!root) return false
  const r = root.getBoundingClientRect()
  return x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2
}

function onScrollbarPointerDown(e: PointerEvent) {
  const box = itemsRef.value
  if (!box || !scrollable.value || stopDrag) return
  e.preventDefault()
  const pointerId = e.pointerId
  const startY = e.clientY
  const startTop = thumbTop.value
  const barH = Math.max(1, box.clientHeight - SCROLLBAR_INSET * 2)
  const maxTop = Math.max(1, barH - thumbH.value)
  const maxScroll = Math.max(1, box.scrollHeight - box.clientHeight)
  const ratio = maxScroll / maxTop
  let lastX = e.clientX
  let lastY = e.clientY
  dragging.value = true

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    lastX = ev.clientX
    lastY = ev.clientY
    const next = Math.min(maxTop, Math.max(0, startTop + ev.clientY - startY))
    box.scrollTop = next * ratio
  }
  const finish = () => {
    stopDrag?.()
    // dragging 期间被吞掉的 mouseleave 不会重来，这里按最终指针位置补一次收起
    const focusInside = rootRef.value?.contains(document.activeElement) ?? false
    if (!focusInside && !isPointerInRail(lastX, lastY)) expanded.value = false
  }
  const onUp = (ev: PointerEvent) => { if (ev.pointerId === pointerId) finish() }
  const onCancel = () => finish()

  stopDrag = () => {
    dragging.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('blur', onCancel)
    stopDrag = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('blur', onCancel)
}

/**
 * 窗口 resize 的节流包装（审计 #30）：拖动缩放窗口时 resize 事件密集触发，
 * 每次同步读 scrollHeight/clientHeight 都是强制回流。合并到下一帧再量一次。
 */
let resizeRafId = 0
function onViewportResize() {
  if (typeof requestAnimationFrame !== 'function') {
    updateScrollbar()
    return
  }
  if (resizeRafId) return
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = 0
    updateScrollbar()
  })
}

onMounted(() => {
  // 容器高度含 62vh，窗口缩放后滑块比例必须重算（不重算会出现「滑块超出轨道」）
  window.addEventListener('resize', onViewportResize)
  nextTick(updateScrollbar)
})

onBeforeUnmount(() => {
  stopDrag?.()
  window.removeEventListener('resize', onViewportResize)
  if (resizeRafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(resizeRafId)
    resizeRafId = 0
  }
})

/** 拖滚动条时指针可能跑到栏目外，此时不能收；键盘焦点在栏内时也不能收 */
function onLeave() {
  if (dragging.value) return
  const root = rootRef.value
  if (root?.contains(document.activeElement)) return
  expanded.value = false
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
    v-if="visibleAnchors.length >= 2"
    ref="rootRef"
    class="chat-turn-rail"
    :class="{ 'is-expanded': expanded }"
    :style="railStyle"
    @mouseenter="expanded = true"
    @mouseleave="onLeave"
    @focusin="expanded = true"
    @focusout="onFocusOut"
  >
    <div class="turn-rail-body">
    <div
      ref="itemsRef"
      class="turn-rail-items"
      role="group"
      :aria-label="t('ai.turnRailTitle')"
      @scroll.passive="updateScrollbar"
    >
      <button
        v-for="a in visibleAnchors"
        :key="a.id"
        type="button"
        class="turn-rail-item"
        :class="{ 'is-active': a.id === activeId, 'is-ghost': a.fadeTop || a.fadeBottom }"
        :aria-current="a.id === activeId ? 'true' : undefined"
        :aria-label="`${t('ai.turnRailItem', { n: a.index + 1 })} · ${labelOf(a.label)}`"
        :title="labelOf(a.label)"
        @click="emit('jump', a.id)"
      >
        <span class="turn-rail-node" aria-hidden="true" />
        <span class="turn-rail-label">{{ labelOf(a.label) }}</span>
      </button>
    </div>
    <!-- 自绘滚动条：展开且内容溢出时出现，可拖动查看任意历史轮 -->
    <span
      v-if="expanded && scrollable"
      class="turn-rail-scrollbar"
      aria-hidden="true"
      @pointerdown="onScrollbarPointerDown"
    >
      <span
        class="turn-rail-thumb"
        :style="{ height: thumbH + 'px', transform: `translateY(${thumbTop}px)` }"
      />
    </span>
    </div>
    <!-- 轴线单独一层，展开时淡入，把点串成时间轴 -->
    <span class="turn-rail-track" aria-hidden="true" />
  </div>
</template>

<style scoped>
.chat-turn-rail {
  /* 收起：行高 10px + 4px 间距，点像一串珠子 */
  --rail-item-h: 10px;
  --rail-gap: 4px;
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 14;
  width: 32px;
  /* 高度按展开态固定（10 点 × 30px + 上下 6px 留白 = 312px，与 300px 宽接近 1:1，
     仍是舒服的方块比例）：变高时点列只在容器内散开，容器中心不移动 */
  height: min(calc(var(--rail-count) * 30px + 12px), 62vh, 480px);
  border-radius: var(--radius-md);
  overflow: hidden;
  /* 收起方向：快速回收，不带延迟 */
  transition:
    width 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.2s ease;
}

.chat-turn-rail.is-expanded {
  --rail-item-h: 30px;
  --rail-gap: 0px;
  width: 300px;
  box-shadow: var(--shadow-lg);
  /* 展开方向：0.32s ease-in-out，起步慢、过程可感知；材质与宽度同一条曲线生长 */
  transition:
    width 0.32s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.32s ease 0.1s;
}

/* 表面层：从点带左缘向右「刷」出来，1px 发丝边随之一同生长 */
.chat-turn-rail::before {
  content: '';
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: inherit;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  backdrop-filter: blur(18px) saturate(160%);
  opacity: 0;
  transition: opacity 0.16s ease;
}
/* 表面铺满容器并与宽度同步生长：视觉上是一条带材质的窄条从点带里长出来，
   而不是先弹出一个透明骨架再补材质 */
.chat-turn-rail.is-expanded::before {
  opacity: 1;
  border-color: var(--border);
  transition:
    opacity 0.18s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.2s ease 0.04s;
}

.turn-rail-items {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  /* safe center：条目超出视口上限时从顶部开始，避免首条被裁掉无法滚动 */
  justify-content: safe center;
  box-sizing: border-box;
  height: 100%;
  /* 右侧留 5px 给滚动条：悬停底纹不会压到它，滑块永远是「浮在内容之上」的一层 */
  padding: 6px 5px 6px 0;
  gap: var(--rail-gap);
  overflow-y: auto;
  /* 隐藏原生滚动条（overlay 在部分环境不占宽、静止不可见），改用下面自绘的那条 */
  scrollbar-width: none;
  transition: gap 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.turn-rail-items::-webkit-scrollbar { display: none; }
.is-expanded .turn-rail-items {
  transition: gap 0.32s cubic-bezier(0.4, 0, 0.2, 1) 0.06s;
}

.turn-rail-body {
  position: relative;
  height: 100%;
}

/* 自绘滚动条：3px 细条，滑块长度按内容比例，拖动/滚动时跟随 */
.turn-rail-scrollbar {
  position: absolute;
  right: 1px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  /* 必须压在条目之上：条目 hover 底纹是整行铺满的，低一层就会被吃掉 */
  z-index: 2;
  border-radius: var(--radius-full);
  background: color-mix(in srgb, var(--text-muted) 14%, transparent);
  cursor: pointer;
  touch-action: none;
}
/* 3px 太细不好按：左右各借 4px 做透明命中区（视觉仍是细条） */
.turn-rail-scrollbar::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  right: -4px;
}
.turn-rail-thumb {
  position: absolute;
  left: 0;
  width: 100%;
  border-radius: inherit;
  background: color-mix(in srgb, var(--text-muted) 70%, transparent);
  transition: background-color 0.16s ease;
}
.turn-rail-scrollbar:hover .turn-rail-thumb { background: var(--text-secondary); }

.turn-rail-item {
  display: flex;
  align-items: center;
  flex: 0 0 var(--rail-item-h);
  height: var(--rail-item-h);
  width: 100%;
  padding: 0 10px 0 12px;
  overflow: hidden;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  /* 展开时行高与间距一起拉开：点从中心向两侧散开 */
  transition:
    height 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    flex-basis 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    background-color 0.16s ease;
}
.is-expanded .turn-rail-item {
  transition:
    height 0.32s cubic-bezier(0.4, 0, 0.2, 1) 0.06s,
    flex-basis 0.32s cubic-bezier(0.4, 0, 0.2, 1) 0.06s,
    background-color 0.16s ease;
}

.turn-rail-node {
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--text-muted);
  opacity: 0.5;
  transition:
    background-color 0.2s ease,
    opacity 0.2s ease,
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.2s ease;
}
/* 指针进入时先给一点回应，提示这里可以展开 */
.chat-turn-rail:hover .turn-rail-node { opacity: 0.8; }
.turn-rail-item.is-active .turn-rail-node {
  background: var(--accent);
  opacity: 1;
  transform: scale(1.15);
  box-shadow: 0 0 0 3px var(--accent-light);
}

/* 文字从点带方向滑出，而不是原地淡入 */
.turn-rail-label {
  flex: 1;
  min-width: 0;
  margin-left: 12px;
  font-size: var(--fs-xs);
  line-height: 1.4;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0;
  /* 收起时把文字裁在点带一侧，展开时再从左向右「揭示」出来 */
  clip-path: inset(0 100% 0 0);
  transform: translateX(-4px);
  transition:
    clip-path 0.12s ease,
    opacity 0.1s ease,
    transform 0.12s ease;
}
/* 最后一步：文字像是被点带「拉」出来的 */
.is-expanded .turn-rail-label {
  opacity: 1;
  clip-path: inset(0 0 0 0);
  transform: translateX(0);
  transition:
    clip-path 0.24s cubic-bezier(0.4, 0, 0.2, 1) 0.18s,
    transform 0.24s cubic-bezier(0.4, 0, 0.2, 1) 0.18s,
    opacity 0.18s ease 0.18s;
}
.turn-rail-item.is-active .turn-rail-label {
  color: var(--text);
  font-weight: 500;
}

/* 轴线：只在展开态出现，位置对齐首末节点中心（行高 30） */
.turn-rail-track {
  position: absolute;
  left: 15px;
  top: 15px;
  bottom: 15px;
  width: 1px;
  background: var(--border);
  opacity: 0;
  transition: opacity 0.12s ease;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 6%, #000 94%, transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 6%, #000 94%, transparent);
}
/* 轴线在表面之后浮现，把散开的点重新串成时间轴 */
.is-expanded .turn-rail-track {
  opacity: 1;
  transition: opacity 0.2s ease 0.22s;
}

/* 窗口两端被折叠时，那个点淡化：上面/下面还有更多轮次 */
.turn-rail-item.is-ghost .turn-rail-node {
  opacity: 0.22;
  transform: scale(0.9);
}
.is-expanded .turn-rail-item.is-ghost .turn-rail-label { opacity: 0.42; }
.turn-rail-item.is-ghost:hover .turn-rail-node {
  opacity: 0.55;
  transform: scale(1);
}

/* 悬停/选中底纹只在展开态出现，收起时保持一串纯净的点 */
.is-expanded .turn-rail-item:hover { background: var(--surface-hover); }
.is-expanded .turn-rail-item.is-active { background: var(--accent-light); }

/* 窄窗口下正文列会压到这条轨道上（32px 点带会盖住首几个字），直接让位给正文 */
@media (max-width: 880px) {
  .chat-turn-rail { display: none; }
}
</style>
