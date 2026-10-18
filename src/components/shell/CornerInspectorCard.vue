<template>
  <!-- Mobile Backdrop Overlay (移动端自底向上抽屉半透明磨砂遮罩，点按背景优雅退出) -->
  <Transition name="corner-backdrop-trans">
    <div
      v-if="isOpen && isMobileScreen"
      class="corner-inspector-backdrop"
      aria-hidden="true"
      @click.stop="close"
    ></div>
  </Transition>

  <Transition name="corner-inspector-trans">
    <aside
      v-if="isOpen"
      class="corner-inspector-wrapper"
      :class="{
        'is-anchor-bottom': anchorMode === 'bottom',
        'is-docked': isDockVisible,
        'is-mobile-sheet': isMobileScreen,
      }"
      :style="flyoutStyle"
      role="region"
      :aria-label="t('modal.quickLook.ariaLabel')"
    >
      <div
        ref="frameRef"
        class="corner-inspector-frame"
        data-testid="corner-inspector-card"
        :style="mobileFrameStyle"
        @click.stop
      >
        <!-- Mobile grab handle on top of bottom sheet (移动端原生下拉抓手条) -->
        <div
          v-if="isMobileScreen"
          class="mobile-drag-bar"
          aria-hidden="true"
          @touchstart.passive="onTouchStart"
          @touchmove.passive="onTouchMove"
          @touchend="onTouchEnd"
        ></div>

        <!-- Top Micro-bar: Meta info & controls (桌面端支持直接上下拖拽调整高度，移动端支持触控下滑关闭) -->
        <div
          class="inspector-header"
          :class="{ 'is-dragging': isDraggingHeader }"
          :title="isMobileScreen ? '' : (t('staging.dragHandleHint') || '上下拖动调整高度')"
          @pointerdown="onHeaderPointerDown"
          @pointermove="onHeaderPointerMove"
          @pointerup="onHeaderPointerUp"
          @pointercancel="onHeaderPointerCancel"
          @touchstart.passive="onTouchStart"
          @touchmove.passive="onTouchMove"
          @touchend="onTouchEnd"
        >
          <div
            class="inspector-lead"
            :title="targetGroup ? (t('cards.group') + ': ' + (displayText(targetGroup.name) || t('cards.unnamedGroup'))) : (parentBm ? (t('modal.quickLook.belongsTo') + ': ' + displayText(parentBm.title)) : displayText(bm?.title || ''))"
          >
            <!-- 返回上一级卡片（如子书签返回主卡片、多级速览回退） -->
            <button
              v-if="canGoBack"
              class="inspector-back-btn"
              type="button"
              :title="t('common.back') || '返回'"
              :aria-label="t('common.back') || '返回'"
              @pointerdown.stop
              @click.stop="goBack"
            >
              <span class="back-icon" aria-hidden="true" v-html="I.back"></span>
              <span v-if="isMobileScreen" class="back-text">{{ t('common.back') || '返回' }}</span>
            </button>

            <span v-if="!isMobileScreen && !canGoBack" class="inspector-grip" aria-hidden="true" :title="t('staging.dragHandleHint') || '上下拖动调整高度'">⋮⋮</span>
            <span class="inspector-badge">
              ↳ {{ targetGroup ? t('cards.group') : (isSub ? t('modal.quickLook.subBookmark') : t('cards.details')) }}
            </span>
            <span v-if="parentBm" class="inspector-parent-name" :title="displayText(parentBm.title)">
              {{ displayText(parentBm.title) }}
            </span>
            <span v-if="parentBm" class="inspector-breadcrumb-sep" aria-hidden="true">›</span>
            <span v-if="parentBm" class="inspector-breadcrumb-current" :title="displayText(bm?.title || '')">
              {{ displayText(bm?.title || '') }}
            </span>
            <span v-else-if="targetGroup" class="inspector-parent-name">
              {{ displayText(targetGroup.name) || t('cards.unnamedGroup') }}
            </span>
          </div>

          <div class="inspector-actions">
            <!-- Edit Note Button: 抽屉内一键进入聚焦编辑模式 -->
            <button
              v-if="targetGroup"
              class="inspector-action-btn edit-note-btn"
              type="button"
              :title="t('cards.focusGroup')"
              :aria-label="t('cards.focusGroup')"
              @pointerdown.stop
              @click.stop="focusTargetGroup"
              v-html="I.edit"
            ></button>
            <!-- Stage / Unstage button (仅桌面端展示，移动端无拖拽暂存诉求) -->
            <button
              v-if="!isMobileScreen"
              class="inspector-action-btn"
              :class="{ 'is-staged': isStaged }"
              type="button"
              :title="isStaged ? t('modal.quickLook.addedToShelf') : t('modal.quickLook.addToShelf')"
              :aria-label="isStaged ? t('modal.quickLook.addedToShelf') : t('modal.quickLook.addToShelf')"
              @pointerdown.stop
              @click.stop="toggleStaging"
              v-html="isStaged ? I.check : I.bookmark"
            ></button>
            <!-- Close [✕] -->
            <button
              class="inspector-action-btn close-btn"
              type="button"
              :title="t('common.close')"
              :aria-label="t('common.close')"
              @pointerdown.stop
              @click.stop="close"
              v-html="I.close"
            ></button>
          </div>
        </div>

        <!-- Snug compact wrapper for standard BookmarkCard or GroupCard with snappy push/pop transition -->
        <div ref="bodyRef" class="corner-inspector-body">
          <Transition :name="navTransitionName" mode="out-in">
            <div :key="currentCardKey" class="inspector-card-content">
              <GroupCard
                v-if="targetGroup"
                :group="targetGroup"
                :detail-mode="true"
              />
              <BookmarkCard
                v-else-if="bm"
                :bookmark="bm"
                :default-acct-open="true"
                :detail-mode="true"
              />
            </div>
          </Transition>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { displayText } from '../../utils.js'
import { I } from '../../config/icons.js'
import { useI18n } from '../../i18n/index.js'
import BookmarkCard from '../cards/BookmarkCard.vue'
import GroupCard from '../cards/GroupCard.vue'
import type { Bookmark, SiblingGroup } from '../../types.js'

interface Props {
  anchorMode?: 'top' | 'bottom'
  dockPanelStyle?: Record<string, string>
  isDockVisible?: boolean
  hasHandle?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  anchorMode: 'top',
  dockPanelStyle: () => ({ top: '24px', bottom: 'auto' }),
  isDockVisible: true,
  hasHandle: false,
})

const emit = defineEmits<{
  (e: 'drag-start'): void
  (e: 'drag-move', deltaY: number): void
  (e: 'drag-end'): void
}>()

const { t } = useI18n()
const ui = useUIStore()
const ds = useDataStore()

const bodyRef = ref<HTMLElement | null>(null)

const targetGid = computed<string | null>(() => {
  if (!ui.quickLookBmId) return null
  if (ui.quickLookBmId.startsWith('group:')) return ui.quickLookBmId.replace('group:', '')
  if (ds.groupMap[ui.quickLookBmId]) return ui.quickLookBmId
  return null
})

const targetGroup = computed<SiblingGroup | null>(() => {
  if (!targetGid.value) return null
  return ds.groupMap[targetGid.value] || null
})

const bm = computed<Bookmark | null>(() => {
  if (!ui.quickLookBmId || targetGid.value) return null
  return ds.bookmarkMap[ui.quickLookBmId] || null
})

const isOpen = computed(() => ui.modals.quickLook && (!!bm.value || !!targetGroup.value))

const isSub = computed(() => !!bm.value?.parentId)
const parentBm = computed<Bookmark | null>(() => {
  if (!bm.value?.parentId) return null
  return ds.bookmarkMap[bm.value.parentId] || null
})

const currentCardKey = computed(() => {
  if (targetGroup.value) return `group-${targetGroup.value.id}`
  if (bm.value) return `bm-${bm.value.id}`
  return 'none'
})

const navDirection = ref<'forward' | 'backward'>('forward')
const navTransitionName = computed(() => `inspector-slide-${navDirection.value}`)
let prevHistoryLen = 0

// 支持返回上一级：有历史记录栈或当前是子书签且有主书签
const canGoBack = computed(() => (ui.quickLookHistory?.length || 0) > 0 || (isSub.value && !!parentBm.value))

function goBack() {
  navDirection.value = 'backward'
  if (ui.quickLookHistory && ui.quickLookHistory.length > 0) {
    ui.goBackQuickLook()
    return
  }
  if (isSub.value && parentBm.value) {
    ui.openQuickLook(parentBm.value.id)
  }
}

const isStaged = computed(() => {
  if (targetGroup.value) return ui.detailCards.includes('group:' + targetGroup.value.id)
  return !!(bm.value && ui.detailCards.includes(bm.value.id))
})

const isMobileScreen = computed(() => ui.isMobile)

// 智能吸附定位：桌面端紧贴暂存架左侧（间距 8px），与暂存架高度同步锁定；移动端为标准底部抽屉，无需设置行内 top/right
const flyoutStyle = computed(() => {
  if (isMobileScreen.value) {
    return {}
  }
  let rightPx = 8
  if (props.isDockVisible) {
    rightPx = 236 // 8px (右边距) + 220px (暂存面板宽) + 8px (间隙)
  } else if (props.hasHandle) {
    rightPx = 29 // 7px (悬浮手柄右边距) + 14px (手柄宽) + 8px (间隙)
  }

  return {
    ...props.dockPanelStyle,
    right: `${rightPx}px`,
  }
})

// 移动端底部抽屉下拉轻扫关闭手势（Swipe down to dismiss）
let touchStartY = 0
let touchCurrentY = 0
const touchDragY = ref(0)
const isSwiping = ref(false)

function onTouchStart(e: TouchEvent) {
  if (!isMobileScreen.value) return
  if (e.touches.length !== 1) return
  touchStartY = e.touches[0].clientY
  touchCurrentY = touchStartY
  touchDragY.value = 0
  isSwiping.value = true
}

function onTouchMove(e: TouchEvent) {
  if (!isSwiping.value) return
  touchCurrentY = e.touches[0].clientY
  const delta = touchCurrentY - touchStartY
  if (delta > 0) {
    touchDragY.value = delta
  } else {
    touchDragY.value = 0
  }
}

function onTouchEnd() {
  if (!isSwiping.value) return
  isSwiping.value = false
  if (touchDragY.value > 70) {
    close()
    setTimeout(() => {
      touchDragY.value = 0
    }, 200)
  } else {
    touchDragY.value = 0
  }
}

const mobileFrameStyle = computed(() => {
  if (isMobileScreen.value && touchDragY.value > 0) {
    return {
      transform: `translateY(${touchDragY.value}px)`,
      transition: 'none',
    }
  }
  return {}
})

// 监听卡片与历史导航深度，自适应设置前进/后退滑动方向，重置滚动位置
watch(
  () => [ui.quickLookBmId, ui.quickLookHistory?.length || 0],
  ([, newLen]) => {
    const curLen = Number(newLen) || 0
    if (curLen < prevHistoryLen) {
      navDirection.value = 'backward'
    } else if (curLen > prevHistoryLen) {
      navDirection.value = 'forward'
    }
    prevHistoryLen = curLen
    if (bodyRef.value) {
      bodyRef.value.scrollTop = 0
    }
  },
)

function close() {
  ui.closeQuickLook()
}

function focusTargetGroup() {
  if (!targetGroup.value) return
  ui.focusedGroupId = targetGroup.value.id
  close()
}

function toggleStaging() {
  if (targetGroup.value) {
    const id = 'group:' + targetGroup.value.id
    const idx = ui.detailCards.indexOf(id)
    if (idx > -1) {
      ui.detailCards.splice(idx, 1)
    } else {
      ui.detailCards.push(id)
    }
    return
  }
  if (!bm.value) return
  const id = bm.value.id
  const idx = ui.detailCards.indexOf(id)
  if (idx > -1) {
    ui.detailCards.splice(idx, 1)
  } else {
    ui.detailCards.push(id)
  }
}

// 当点击聚焦某个分组时，平滑关闭抽屉
watch(
  () => ui.focusedGroupId,
  (gid) => {
    if (gid && isOpen.value) {
      close()
    }
  },
)

const isDraggingHeader = ref(false)
let headerStartY = 0
let headerHasMoved = false

function onHeaderPointerDown(e: PointerEvent) {
  if (isMobileScreen.value) return // 移动端交由触控轻扫手势处理，禁用桌面绝对定位拖拽
  if (e.button !== undefined && e.button !== 0) return
  if ((e.target as HTMLElement).closest('button')) return

  headerStartY = e.clientY
  headerHasMoved = false
  isDraggingHeader.value = true
  emit('drag-start')

  const target = e.currentTarget as HTMLElement
  if (target?.setPointerCapture) {
    try {
      target.setPointerCapture(e.pointerId)
    } catch {}
  }
}

function onHeaderPointerMove(e: PointerEvent) {
  if (!isDraggingHeader.value) return
  const deltaY = e.clientY - headerStartY
  if (Math.abs(deltaY) > 3) {
    headerHasMoved = true
  }
  if (headerHasMoved) {
    emit('drag-move', deltaY)
  }
}

function onHeaderPointerUp(e: PointerEvent) {
  if (!isDraggingHeader.value) return
  isDraggingHeader.value = false

  const target = e.currentTarget as HTMLElement
  if (target?.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId)
    } catch {}
  }

  if (headerHasMoved) {
    emit('drag-end')
    setTimeout(() => {
      headerHasMoved = false
    }, 50)
  }
}

function onHeaderPointerCancel(e: PointerEvent) {
  if (!isDraggingHeader.value) return
  isDraggingHeader.value = false
  const target = e.currentTarget as HTMLElement
  if (target?.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId)
    } catch {}
  }
  emit('drag-end')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close()
  }
}

function onDocumentClick(e: MouseEvent) {
  if (!isOpen.value || isMobileScreen.value) return
  if (isDraggingHeader.value) return
  const target = e.target as HTMLElement | null
  if (!target) return

  // 点击详情窗内部：不收起
  if (frameRef.value && frameRef.value.contains(target)) return

  // 点击暂存架面板或手柄：不收起
  if (target.closest('.edge-staging-dock-panel, .edge-staging-handle')) return

  // 点击打开详情的相关操作按钮：不提前拦截
  if (target.closest('.card-menu-btn, .gic-btn, .card-actions-btn, [data-action="open-detail"]')) return

  close()
}

let clickTimeoutId: ReturnType<typeof setTimeout> | null = null

watch(
  isOpen,
  (open) => {
    if (clickTimeoutId) {
      clearTimeout(clickTimeoutId)
      clickTimeoutId = null
    }
    if (open && !isMobileScreen.value) {
      clickTimeoutId = setTimeout(() => {
        window.addEventListener('click', onDocumentClick)
      }, 0)
    } else {
      window.removeEventListener('click', onDocumentClick)
    }
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  if (clickTimeoutId) {
    clearTimeout(clickTimeoutId)
  }
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('click', onDocumentClick)
})

const frameRef = ref<HTMLElement | null>(null)

defineExpose({
  getCardHeight: () => frameRef.value?.offsetHeight || 0,
})
</script>

<style scoped>
.corner-inspector-wrapper {
  position: absolute;
  z-index: 90;
  pointer-events: auto;
  user-select: none;
  will-change: top, bottom;
  transition: right 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Compact Card Frame: 舒适比例，与主站卡片质感高度一致 */
.corner-inspector-frame {
  width: 270px;
  max-width: calc(100vw - 250px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-xl), 0 0 0 1px var(--border-light);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Dark mode enhancement: 与主站暗色卡片一致的材质感，通过顶部内高光与深度投影强化悬浮层级 */
:global([data-theme="dark"]) .corner-inspector-frame {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.12) inset,
              0 0 0 1px var(--border-hover),
              var(--shadow-xl);
}

:global([data-theme="dark"]) .inspector-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

:global([data-theme="dark"]) .corner-inspector-wrapper.is-mobile-sheet .corner-inspector-frame {
  border-top: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.12) inset,
              0 -12px 36px rgba(0, 0, 0, 0.6);
}

/* Micro-bar Header: 舒适精致排版，与卡片顶栏质感一致，支持直接拖拽 */
.inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--border-light);
  min-height: 34px;
  box-sizing: border-box;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.inspector-header.is-dragging {
  cursor: grabbing !important;
}

.inspector-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border: none;
  background: var(--accent-light);
  color: var(--accent);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
  margin-right: 3px;
  transition: background 0.15s ease, transform 0.12s ease;
}

.inspector-back-btn:hover,
.inspector-back-btn:focus-visible {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  transform: translateX(-1px);
}

.inspector-back-btn .back-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
}

.inspector-back-btn .back-icon :deep(svg) {
  width: 12px;
  height: 12px;
  stroke-width: 2.5;
}

.inspector-back-btn .back-text {
  font-size: 11.5px;
  line-height: 1;
}

.inspector-grip {
  font-size: 11px;
  letter-spacing: -2px;
  color: var(--text-muted);
  opacity: 0.55;
  cursor: grab;
  margin-right: 2px;
  flex-shrink: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.inspector-header:hover .inspector-grip {
  opacity: 1;
  color: var(--accent);
}

.inspector-lead {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.inspector-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-light);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}

.inspector-parent-name {
  font-size: 11.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 85px;
}

.inspector-breadcrumb-sep {
  font-size: 10px;
  color: var(--text-muted);
  opacity: 0.6;
  flex-shrink: 0;
  margin: 0 1px;
}

.inspector-breadcrumb-current {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px;
}

.inspector-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.inspector-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 5px;
  cursor: pointer;
  padding: 0;
  transition: all 0.12s ease;
}

.inspector-action-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.inspector-action-btn.is-staged {
  color: var(--accent);
  background: var(--accent-light);
}

.inspector-action-btn.close-btn:hover {
  background: var(--rose-light, #fee2e2);
  color: var(--rose, #e11d48);
}

.inspector-action-btn :deep(svg) {
  width: 13.5px;
  height: 13.5px;
}

/* Snug Body: 预留稳定滚动条凹槽（scrollbar-gutter: stable），杜绝切换抖动与闪烁 */
.corner-inspector-body {
  padding: 6px 8px 8px;
  background: transparent;
  overflow-y: auto;
  max-height: min(360px, calc(100vh - 240px));
  scrollbar-gutter: stable;
  scrollbar-width: thin;
}

.corner-inspector-body::-webkit-scrollbar {
  width: 4px;
}

.corner-inspector-body::-webkit-scrollbar-track {
  background: transparent;
}

.corner-inspector-body::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.corner-inspector-body::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* Push / Pop Page Slide Transition: 丝滑多级导航推入推出动效 */
.inspector-card-content {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.inspector-slide-forward-enter-active,
.inspector-slide-forward-leave-active,
.inspector-slide-backward-enter-active,
.inspector-slide-backward-leave-active {
  transition: opacity 0.16s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.inspector-slide-forward-enter-from {
  opacity: 0;
  transform: translateX(18px);
}
.inspector-slide-forward-leave-to {
  opacity: 0;
  transform: translateX(-18px);
}

.inspector-slide-backward-enter-from {
  opacity: 0;
  transform: translateX(-18px);
}
.inspector-slide-backward-leave-to {
  opacity: 0;
  transform: translateX(18px);
}

/* 嵌在浮动框内的 BookmarkCard 紧凑精致化 */
.corner-inspector-body :deep(.card) {
  box-shadow: none !important;
  border: none !important;
  background: transparent !important;
  margin: 0 !important;
  padding: 4px 6px !important;
  width: 100% !important;
  height: auto !important;
  min-height: 0 !important;
  animation: none !important;
  cursor: default !important;
}

.corner-inspector-body :deep(.card-logo) {
  width: 32px !important;
  height: 32px !important;
  border-radius: 7px !important;
}

.corner-inspector-body :deep(.card-logo img) {
  width: 20px !important;
  height: 20px !important;
}

.corner-inspector-body :deep(.card-name) {
  font-size: 13px !important;
  font-weight: 600 !important;
  line-height: 1.3 !important;
}

.corner-inspector-body :deep(.card-domain) {
  font-size: 11px !important;
}

.corner-inspector-body :deep(.card-toprow) {
  gap: 8px !important;
  margin-bottom: 4px !important;
}

.corner-inspector-body :deep(.card-body) {
  padding-top: 2px !important;
  gap: 5px !important;
}

.corner-inspector-body :deep(.card-notes) {
  font-size: 11.5px !important;
  line-height: 1.4 !important;
  margin-top: 3px !important;
  padding: 4px 8px !important;
  border-radius: 6px !important;
}

.corner-inspector-body :deep(.card-tags) {
  margin-top: 3px !important;
  gap: 4px !important;
}

.corner-inspector-body :deep(.card-tag) {
  font-size: 10.5px !important;
  padding: 1px 6px !important;
  height: 18px !important;
  line-height: 16px !important;
  border-radius: 4px !important;
}

.corner-inspector-body :deep(.card-acct-toggle) {
  font-size: 11px !important;
  padding: 3px 6px !important;
  margin-top: 3px !important;
}

.corner-inspector-body :deep(.card-acct-body) {
  margin-top: 3px !important;
  padding: 4px 8px !important;
  gap: 4px !important;
  border-radius: 6px !important;
}

.corner-inspector-body :deep(.acct-row) {
  font-size: 11px !important;
  gap: 6px !important;
}

.corner-inspector-body :deep(.acct-show-pw),
.corner-inspector-body :deep(.acct-copy-btn) {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  min-height: 24px !important;
  padding: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 5px !important;
}

.corner-inspector-body :deep(.acct-show-pw svg) {
  width: 14px !important;
  height: 14px !important;
}

.corner-inspector-body :deep(.acct-copy-btn svg) {
  width: 12px !important;
  height: 12px !important;
}

.corner-inspector-body :deep(.sub-sites) {
  margin-top: 4px !important;
  gap: 4px !important;
}

.corner-inspector-body :deep(.group-inline-card) {
  padding: 3px 8px !important;
  font-size: 11px !important;
  border-radius: 5px !important;
  min-height: 26px !important;
}

.corner-inspector-body :deep(.gic-btn) {
  font-size: 11px !important;
  padding: 2px 7px !important;
  border-radius: 4px !important;
}

.corner-inspector-body :deep(.card-foot) {
  margin-top: 6px !important;
  padding-top: 6px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  min-height: 28px !important;
}

.corner-inspector-body :deep(.card-stat) {
  font-size: 11px !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 3px !important;
}

.corner-inspector-body :deep(.card-stat svg) {
  width: 12px !important;
  height: 12px !important;
}

.corner-inspector-body :deep(.card-actions) {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  margin-left: auto !important;
}

/* 核心修复：重置 btn-xs 为 26px 方正标准按钮与 14px 图标，显式清除 padding，消除由于 20px + padding 导致的挤成细点 */
.corner-inspector-body :deep(.btn-xs) {
  width: 26px !important;
  height: 26px !important;
  min-width: 26px !important;
  min-height: 26px !important;
  padding: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 6px !important;
  box-sizing: border-box !important;
}

.corner-inspector-body :deep(.btn-xs svg) {
  width: 14px !important;
  height: 14px !important;
}

/* 抽屉/浮动检查窗中隐藏列表与批量专用的冗余组件，杜绝撑大与重复渲染 */
.corner-inspector-body :deep(.card-menu-btn),
.corner-inspector-body :deep(.list-expand-btn),
.corner-inspector-body :deep(.card-preview),
.corner-inspector-body :deep(.mini-domain),
.corner-inspector-body :deep(.batch-drag-handle),
.corner-inspector-body :deep(.batch-chk),
.corner-inspector-body :deep(.group-card-accent),
.corner-inspector-body :deep(.group-head-actions) {
  display: none !important;
}

.corner-inspector-body :deep(.group-body-readonly) {
  display: block !important;
  font-size: 13.5px !important;
  line-height: 1.65 !important;
  color: var(--text) !important;
  word-break: break-word !important;
  padding: 6px 8px !important;
  border-radius: 8px;
  transition: background 0.15s ease;
}

.corner-inspector-body :deep(.group-body-readonly.can-edit) {
  cursor: pointer;
}

.corner-inspector-body :deep(.group-body-readonly.can-edit:hover) {
  background: color-mix(in srgb, var(--surface-hover) 65%, transparent);
}

.corner-inspector-body :deep(.group-body-readonly:empty::before) {
  content: '（暂无笔记内容，轻触开始记录…）';
  color: var(--text-muted);
  font-style: italic;
}

.corner-inspector-body :deep(.card-titlewrap .card-domain) {
  display: block !important;
}

/* Transitions: 桌面端从右向左滑入吸附在暂存架左侧 */
.corner-inspector-trans-enter-active {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease;
}

.corner-inspector-trans-leave-active {
  transition: transform 0.14s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.14s ease;
}

.corner-inspector-trans-enter-from,
.corner-inspector-trans-leave-to {
  opacity: 0;
  transform: translateX(14px) scale(0.98);
}

/* Mobile Bottom Sheet & Backdrop (移动端转为自底向上原生卡片抽屉) */
.corner-inspector-backdrop {
  display: none;
}

.mobile-drag-bar {
  display: none;
}

@media (max-width: 768px) {
  .corner-inspector-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 95;
    pointer-events: auto;
  }

  .corner-backdrop-trans-enter-active,
  .corner-backdrop-trans-leave-active {
    transition: opacity 0.2s ease;
  }

  .corner-backdrop-trans-enter-from,
  .corner-backdrop-trans-leave-to {
    opacity: 0;
  }

  .corner-inspector-wrapper {
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    top: auto !important;
    width: 100% !important;
    max-width: 100vw !important;
    z-index: 100 !important;
    pointer-events: auto;
    user-select: none;
  }

  .corner-inspector-frame {
    width: 100% !important;
    max-width: 100% !important;
    border-radius: 20px 20px 0 0 !important;
    border-left: none !important;
    border-right: none !important;
    border-bottom: none !important;
    box-shadow: 0 -8px 36px rgba(0, 0, 0, 0.28) !important;
    background: var(--surface) !important;
    padding-bottom: calc(12px + env(safe-area-inset-bottom, 16px));
    box-sizing: border-box;
  }

  .mobile-drag-bar {
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-hover);
    margin: 10px auto 4px;
    cursor: grab;
    position: relative;
  }

  .mobile-drag-bar::before {
    content: '';
    position: absolute;
    inset: -10px -20px;
  }

  .inspector-header {
    cursor: default;
    border-bottom-color: var(--border-light);
    padding: 8px 14px;
    min-height: 40px;
  }

  .inspector-grip {
    display: none !important;
  }

  .inspector-parent-name {
    max-width: calc(100vw - 130px) !important;
  }

  .inspector-action-btn:not(.close-btn):not(.edit-note-btn) {
    display: none !important;
  }

  .inspector-action-btn.edit-note-btn {
    width: 30px !important;
    height: 30px !important;
    border-radius: 6px;
    display: inline-flex !important;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }

  .inspector-action-btn.edit-note-btn :deep(svg) {
    width: 15px !important;
    height: 15px !important;
  }

  .inspector-action-btn.close-btn {
    width: 30px !important;
    height: 30px !important;
    border-radius: 6px;
  }

  .inspector-action-btn.close-btn :deep(svg) {
    width: 16px !important;
    height: 16px !important;
  }

  .corner-inspector-body {
    padding: 8px 14px 12px !important;
    max-height: min(480px, 72vh) !important;
    -webkit-overflow-scrolling: touch;
    scrollbar-gutter: auto !important;
  }

  .corner-inspector-body :deep(.card-logo) {
    width: 36px !important;
    height: 36px !important;
    border-radius: 8px !important;
  }

  .corner-inspector-body :deep(.card-logo img) {
    width: 22px !important;
    height: 22px !important;
  }

  .corner-inspector-body :deep(.card-name) {
    font-size: 14.5px !important;
  }

  .corner-inspector-body :deep(.card-domain) {
    font-size: 12px !important;
  }

  .corner-inspector-body :deep(.card-notes) {
    font-size: 12px !important;
    line-height: 1.45 !important;
    padding: 6px 10px !important;
  }

  .corner-inspector-body :deep(.btn-xs) {
    width: 30px !important;
    height: 30px !important;
    min-width: 30px !important;
    min-height: 30px !important;
    border-radius: 7px !important;
  }

  .corner-inspector-body :deep(.btn-xs svg) {
    width: 15px !important;
    height: 15px !important;
  }

  .corner-inspector-body :deep(.card-stat) {
    font-size: 12px !important;
  }

  .corner-inspector-trans-enter-from,
  .corner-inspector-trans-leave-to {
    opacity: 0;
    transform: translateY(100%);
  }
}
</style>
