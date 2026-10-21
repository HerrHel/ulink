<template>
  <div
    id="edgeStagingSidebar"
    ref="containerRef"
    class="edge-staging-container"
    :class="{
      'is-dragging': ui.isDraggingCard,
      'has-items': entries.length > 0,
    }"
    role="region"
    :aria-label="t('staging.shelf')"
  >
    <!-- 1. Drag Drop Target [+] (仅在暂存区完全为空且拖拽卡片时滑出) -->
    <Transition name="drop-zone-slide">
      <div
        v-if="entries.length === 0 && ui.isDraggingCard"
        class="edge-staging-drop-zone empty-state"
        :style="dockPanelStyle"
        :title="t('staging.dropToStage')"
        role="button"
        aria-dropeffect="move"
      >
        <span class="drop-plus-icon" aria-hidden="true" v-html="I.plus"></span>
        <span class="drop-hint-text">{{ t('staging.dropToStage') }}</span>
      </div>
    </Transition>

    <!-- 2. 手动收起态手柄 (有内容常驻悬浮胶囊，可垂直自由拖拽调整高度，点击展开暂存侧边栏) -->
    <Transition name="handle-slide">
      <div
        v-if="isHandleVisible"
        class="edge-staging-handle"
        :class="{
          'is-dragging': isDraggingHandle,
        }"
        :style="{ top: `${handleTop}px` }"
        :title="t('staging.dragHandleHint') || '展开暂存侧边栏 · 上下拖动调整高度'"
        role="button"
        tabindex="0"
        @pointerdown="onHandlePointerDown"
        @pointermove="onHandlePointerMove"
        @pointerup="onHandlePointerUp"
        @pointercancel="onHandlePointerCancel"
        @click="handleHandleClick"
        @keydown.enter="expandShelf"
      >
        <span class="handle-icon" aria-hidden="true" v-html="I.bookmark"></span>
        <span class="handle-badge">{{ entries.length }}</span>
        <span class="handle-chevron" aria-hidden="true">‹</span>
      </div>
    </Transition>

    <!-- 3. 常驻展开面板 (小米侧边栏风格：顶部从顶展开、底部从底展开，浮动不遮挡滚动条) -->
    <Transition name="dock-panel-slide">
      <div
        v-if="isDockVisible"
        ref="dockPanelRef"
        class="edge-staging-dock-panel"
        :class="{
          'is-drag-active': ui.isDraggingCard,
          'is-anchor-bottom': currentAnchor === 'bottom',
        }"
        :style="dockPanelStyle"
      >
        <!-- 面板顶部 Header (可直接拖拽调整整体高度，彻底告别位置割裂) -->
        <div
          class="dock-header"
          :class="{ 'is-dragging': isDraggingDock }"
          :title="t('staging.dragHandleHint') || '上下拖动调整高度 · 点击[›]收起'"
          @pointerdown="onDockPointerDown"
          @pointermove="onDockPointerMove"
          @pointerup="onDockPointerUp"
          @pointercancel="onDockPointerCancel"
        >
          <div class="dock-title-wrap">
            <span class="dock-title-icon" aria-hidden="true" v-html="I.bookmark"></span>
            <span class="dock-title-text">{{ t('staging.shelf') }}</span>
            <span class="dock-count-badge">{{ entries.length }}</span>
          </div>
          <div class="dock-header-right">
            <span class="dock-grip" aria-hidden="true" :title="t('staging.dragHandleHint') || '上下拖动调整高度'">⋮⋮</span>
            <!-- 手动收起按钮 -->
            <button
              class="dock-collapse-btn"
              type="button"
              :title="t('staging.collapseShelf') || '收起侧边栏'"
              :aria-label="t('staging.collapseShelf') || '收起侧边栏'"
              @pointerdown.stop
              @click.stop="collapseShelf"
            >
              <span class="collapse-icon" aria-hidden="true">›</span>
            </button>
          </div>
        </div>

        <div class="dock-divider" aria-hidden="true"></div>

        <!-- 暂存项滚动列表 -->
        <div class="dock-list">
          <!-- 外部拖入卡片时在列表顶端展示的平滑放置槽（不产生跳动） -->
          <div
            v-if="ui.isDraggingCard"
            class="dock-drop-slot edge-staging-drop-zone"
            :title="t('staging.dropToStage')"
          >
            <span class="slot-plus" aria-hidden="true">+</span>
            <span>{{ t('staging.dropToStage') }}</span>
          </div>

          <!-- 展开态暂存架空态占位提示 -->
          <div
            v-if="entries.length === 0 && !ui.isDraggingCard"
            class="dock-empty-slot"
          >
            <span class="empty-icon" aria-hidden="true" v-html="I.bookmark"></span>
            <span class="empty-text">{{ isZh ? '暂存架为空' : 'Shelf is empty' }}</span>
            <span class="empty-subtext">{{ isZh ? '拖拽卡片至此暂存' : 'Drop cards here to stage' }}</span>
          </div>

          <!-- 各暂存条目卡片 -->
          <div
            v-for="entry in entries"
            :key="entry.rawId"
            class="staged-card-row detail-card-wrap"
            :class="{
              'is-group': entry.isGroup,
              'is-active': ui.modals.quickLook && ui.quickLookBmId === entry.rawId,
            }"
            :data-bm-id="entry.rawId"
            :data-didx="entry.realIdx"
            draggable="true"
            @click="handleRowClick(entry)"
          >
            <!-- 头像 / 图标 -->
            <div class="staged-icon-box" aria-hidden="true">
              <span v-if="entry.isGroup" class="group-folder-icon" v-html="I.folder"></span>
              <BrandLogo v-else-if="isOfficialBrand(entry.data as Bookmark)" :size="16" />
              <template v-else>
                <img
                  v-if="!imgErrors[entry.rawId]"
                  :src="getFaviconUrl(entry.data as Bookmark)"
                  alt=""
                  class="staged-img"
                  loading="lazy"
                  @error="onImgError(entry.rawId)"
                />
                <span v-else class="staged-initial">{{ getInitials(entry.name) }}</span>
              </template>
            </div>

            <!-- 标题、域名与笔记组标识 -->
            <div class="staged-info-box" :title="entry.name">
              <div class="staged-title-row">
                <span v-if="entry.isGroup" class="group-tag">{{ isZh ? '组' : 'Group' }}</span>
                <span class="staged-title">{{ displayText(entry.name) }}</span>
              </div>
              <div class="staged-sub">
                <span v-if="entry.isGroup" class="staged-sub-text">
                  {{ (entry.data as SiblingGroup).bookmarkIds?.length || 0 }} {{ isZh ? '项书签' : 'items' }}
                </span>
                <span v-else class="staged-sub-text">
                  {{ entry.domain || (isZh ? '书签' : 'Bookmark') }}
                </span>
              </div>
            </div>

            <!-- 操作按钮：速览、打开、单独删除 [✕] -->
            <div class="staged-actions" @click.stop @mousedown.stop>
              <!-- 在暂存架左侧 1:1 卡片框展开查看 -->
              <button
                class="staged-act-btn inspect"
                type="button"
                :title="t('modal.quickLook.title')"
                :aria-label="t('modal.quickLook.title')"
                @click.stop="openQuickLook(entry.rawId)"
                v-html="I.eye"
              ></button>
              <!-- 新标签页直接访问 -->
              <button
                v-if="!entry.isGroup && (entry.data as Bookmark).url"
                class="staged-act-btn visit"
                type="button"
                :title="t('common.open')"
                :aria-label="t('common.open')"
                @click.stop="openBookmarkItem(entry.data as Bookmark)"
                v-html="I.external"
              ></button>
              <!-- 单项删除 [✕] -->
              <button
                class="staged-act-btn remove"
                type="button"
                :title="t('common.close')"
                :aria-label="t('common.close')"
                @click.stop="removeEntry(entry.rawId)"
                v-html="I.close"
              ></button>
            </div>
          </div>
        </div>

        <div v-if="entries.length > 0" class="dock-divider" aria-hidden="true"></div>

        <!-- 底部批量操作：一键清空 -->
        <div v-if="entries.length > 0" class="dock-footer">
          <button
            class="dock-foot-btn clear-all"
            type="button"
            :title="t('staging.clearAll')"
            @click="clearAll"
          >
            <span class="btn-icon" aria-hidden="true" v-html="I.trash"></span>
            <span>{{ t('staging.clearAll') }}</span>
          </button>
        </div>
      </div>
    </Transition>

    <!-- 4. 方案 A: 暂存架左侧吸附详情飞窗 (Master-Detail 联动飞窗，支持直接拖拽) -->
    <CornerInspectorCard
      ref="inspectorCardRef"
      :anchor-mode="currentAnchor"
      :dock-panel-style="inspectorPanelStyle"
      :is-dock-visible="isDockVisible"
      :has-handle="isHandleVisible"
      @drag-start="onInspectorDragStart"
      @drag-move="onInspectorDragMove"
      @drag-end="onInspectorDragEnd"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { buildDetailCards, type DetailEntry } from './buildDetailCards.js'
import { domain, displayText, favicon, faviconInitials } from '../../utils.js'
import { I } from '../../config/icons.js'
import BrandLogo from '../ui/BrandLogo.vue'
import CornerInspectorCard from './CornerInspectorCard.vue'
import { useI18n } from '../../i18n/index.js'
import { openBookmark } from '../../composables/domain/useBookmark.js'
import { openQuickLook } from '../../composables/ui/useUI.js'
import { OFFICIAL_SITE_BM_ID, OFFICIAL_SITE_LANDING_ID, OFFICIAL_SITE_APP_ID } from '../../stores/dataActionsBookmarks.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

const { t, locale: curLocale } = useI18n()
const isZh = computed(() => curLocale.value === 'zh-CN')

const ui = useUIStore()
const ds = useDataStore()

const imgErrors = ref<Record<string, boolean>>({})

// 边缘手柄与展开面板垂直位置与收起状态（持久化记忆）
const HANDLE_STORAGE_KEY = 'ulink_staging_handle_top'
const COLLAPSED_STORAGE_KEY = 'ulink_staging_collapsed'

// 常驻设计：默认展开，只有用户点击 [›] 时才手动收起；若用户收起过则持久化记忆
const isCollapsed = ref(false)

try {
  const savedCollapsed = typeof localStorage !== 'undefined' ? localStorage.getItem(COLLAPSED_STORAGE_KEY) : null
  if (savedCollapsed === '1' || savedCollapsed === 'true') {
    isCollapsed.value = true
  }
} catch {
  // SSR or private mode safety
}

function saveCollapsedState(val: boolean) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, val ? '1' : '0')
  } catch {}
}
const CONTAINER_TOP = 98 // 紧贴顶栏 FilterBar（高 96px）下方，无缝贴合属性栏
const MIN_HANDLE_TOP = 6 // 最小安全顶部距离，仅 6px 间隙即可紧邻属性栏
const DEFAULT_HANDLE_TOP = 24 // 默认位置舒适靠近上方属性栏
const HANDLE_HEIGHT = 62 // 收起手柄自身高度
const MIN_BOTTOM = 24 // 底部保留 24px 安全边距，避免触底或与底部速览卡片挤压

const containerRef = ref<HTMLElement | null>(null)
const handleTop = ref<number>(DEFAULT_HANDLE_TOP)
const dockPanelRef = ref<HTMLElement | null>(null)
const inspectorCardRef = ref<{ getCardHeight: () => number } | null>(null)
const isDraggingHandle = ref(false)
const isDraggingDock = ref(false)

// 高度缓存与预读取（杜绝 pointermove 期间频繁读取 offsetHeight 引起强制同步重排掉帧）
const cachedDockH = ref(0)
const cachedInspH = ref(0)

function measureHeights() {
  if (dockPanelRef.value && dockPanelRef.value.offsetHeight > 0) {
    cachedDockH.value = dockPanelRef.value.offsetHeight
  }
  if (inspectorCardRef.value && typeof inspectorCardRef.value.getCardHeight === 'function') {
    const h = inspectorCardRef.value.getCardHeight()
    if (h > 0) {
      cachedInspH.value = h
    }
  }
}

function getContainerHeight(): number {
  if (containerRef.value && containerRef.value.clientHeight > 0) {
    return containerRef.value.clientHeight
  }
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  return Math.max(200, vh - CONTAINER_TOP)
}

function resolveAnchorMode(topVal: number): 'top' | 'bottom' {
  const ch = getContainerHeight()
  return (topVal + HANDLE_HEIGHT / 2) > ch / 2 ? 'bottom' : 'top'
}

// 小米手机侧边栏锚定模式：在屏幕上半部分时从顶部向下展开，在屏幕下半部分时从底部向上展开
// 响应式动态推导：拖拽过程中实时计算，上下半区自适应翻转，彻底杜绝向下拖拽时详情窗卡住分离
const currentAnchor = computed<'top' | 'bottom'>(() => resolveAnchorMode(handleTop.value))

// 展开暂存栏：智能锁定展开方向（从顶展开 vs 从底展开）
function expandShelf() {
  isCollapsed.value = false
  saveCollapsedState(false)
  if (entries.value.length === 0) {
    userExpandedEmpty.value = true
  }
}

// 收起暂存栏：收起为手柄，并联动关闭左侧详情飞窗
function collapseShelf() {
  isCollapsed.value = true
  saveCollapsedState(true)
  userExpandedEmpty.value = false
  if (ui.modals.quickLook) {
    ui.closeQuickLook()
  }
}

// 统一推导目标物理 Top 坐标：
// 1. 展开态：双飞窗 1:1 绝对贴手跟手移动，上限受制于两者中较高者（杜绝底部穿透与非线性减速滞后）；
// 2. 收起态：手柄移动范围大，详情卡片按平滑过渡曲线贴靠底部安全边距。
function calculateTargetTop(dockH: number, inspH: number): number {
  const ch = getContainerHeight()
  const isInspOpen = !!(ui.modals.quickLook && ui.quickLookBmId)

  if (isDockVisible.value) {
    const effectiveH = isInspOpen ? Math.max(dockH, inspH) : dockH
    const maxPanelTop = Math.max(MIN_HANDLE_TOP, ch - effectiveH - MIN_BOTTOM)
    return Math.max(MIN_HANDLE_TOP, Math.min(maxPanelTop, handleTop.value))
  } else {
    const effectiveH = inspH || 220
    const minTop = MIN_HANDLE_TOP
    const maxHandleTop = Math.max(minTop, ch - HANDLE_HEIGHT - MIN_BOTTOM)
    const maxPanelTop = Math.max(minTop, ch - effectiveH - MIN_BOTTOM)

    const rampStart = Math.min(150, Math.max(minTop, maxHandleTop * 0.4))
    if (handleTop.value <= rampStart) {
      return Math.max(minTop, Math.min(maxPanelTop, handleTop.value))
    } else {
      const travel = Math.max(1, maxHandleTop - rampStart)
      const t = Math.min(1, Math.max(0, (handleTop.value - rampStart) / travel))
      return rampStart + t * (maxPanelTop - rampStart)
    }
  }
}

// 展开面板定位样式（主侧边栏）
const dockPanelStyle = computed(() => {
  const ch = getContainerHeight()
  const dockH = cachedDockH.value || dockPanelRef.value?.offsetHeight || 220
  const inspH = cachedInspH.value || inspectorCardRef.value?.getCardHeight?.() || 380
  const targetTop = calculateTargetTop(dockH, inspH)

  if (currentAnchor.value === 'bottom') {
    const bottomVal = Math.max(MIN_BOTTOM, ch - (targetTop + dockH))
    return {
      top: 'auto',
      bottom: `${Math.round(bottomVal)}px`,
      transformOrigin: 'bottom right',
    }
  } else {
    return {
      top: `${Math.round(targetTop)}px`,
      bottom: 'auto',
      transformOrigin: 'top right',
    }
  }
})

// 详情窗定位样式（副飞窗：根据自身高度精准计算 bottom，物理 top 与主面板绝对水平同步，彻底消除中点翻转撕裂跳跃）
const inspectorPanelStyle = computed(() => {
  const ch = getContainerHeight()
  const dockH = cachedDockH.value || dockPanelRef.value?.offsetHeight || 220
  const inspH = cachedInspH.value || inspectorCardRef.value?.getCardHeight?.() || 380
  const targetTop = calculateTargetTop(dockH, inspH)

  if (currentAnchor.value === 'bottom') {
    const bottomVal = Math.max(MIN_BOTTOM, ch - (targetTop + inspH))
    return {
      top: 'auto',
      bottom: `${Math.round(bottomVal)}px`,
      transformOrigin: 'bottom right',
    }
  } else {
    return {
      top: `${Math.round(targetTop)}px`,
      bottom: 'auto',
      transformOrigin: 'top right',
    }
  }
})

try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(HANDLE_STORAGE_KEY) : null
  if (saved) {
    const val = parseInt(saved, 10)
    if (!isNaN(val) && val >= MIN_HANDLE_TOP && val <= 1600) {
      handleTop.value = val
    }
  }
} catch {
  // SSR or private mode safety
}

function saveHandleTop(val: number) {
  try {
    localStorage.setItem(HANDLE_STORAGE_KEY, String(val))
  } catch {}
}

// 1. 收起态手柄拖拽逻辑
let startY = 0
let startTop = 0
let hasMoved = false

function onHandlePointerDown(e: PointerEvent) {
  if (e.button !== undefined && e.button !== 0) return
  measureHeights()
  startY = e.clientY
  startTop = handleTop.value
  hasMoved = false
  isDraggingHandle.value = true

  const target = e.currentTarget as HTMLElement
  if (target?.setPointerCapture) {
    try {
      target.setPointerCapture(e.pointerId)
    } catch {}
  }
}

function onHandlePointerMove(e: PointerEvent) {
  if (!isDraggingHandle.value) return
  const deltaY = e.clientY - startY
  if (Math.abs(deltaY) > 3) {
    hasMoved = true
  }
  if (hasMoved) {
    const ch = getContainerHeight()
    const maxTop = Math.max(MIN_HANDLE_TOP, ch - HANDLE_HEIGHT - MIN_BOTTOM)
    const next = Math.max(MIN_HANDLE_TOP, Math.min(maxTop, startTop + deltaY))
    handleTop.value = next
  }
}

function onHandlePointerUp(e: PointerEvent) {
  if (!isDraggingHandle.value) return
  isDraggingHandle.value = false

  const target = e.currentTarget as HTMLElement
  if (target?.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId)
    } catch {}
  }

  if (hasMoved) {
    saveHandleTop(handleTop.value)
    setTimeout(() => {
      hasMoved = false
    }, 50)
  }
}

function onHandlePointerCancel(e: PointerEvent) {
  if (!isDraggingHandle.value) return
  isDraggingHandle.value = false
  const target = e.currentTarget as HTMLElement
  if (target?.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId)
    } catch {}
  }
  setTimeout(() => {
    hasMoved = false
  }, 50)
}

function handleHandleClick() {
  if (!hasMoved) {
    expandShelf()
  }
}

// 2. 展开态面板 Header 拖拽逻辑 (展开与收起高度始终无缝一致，1:1 跟随鼠标无迟滞)
let dockStartY = 0
let dockStartTop = 0
let dockHasMoved = false

function onDockPointerDown(e: PointerEvent) {
  if (e.button !== undefined && e.button !== 0) return
  if ((e.target as HTMLElement).closest('button')) return

  measureHeights()
  const ch = getContainerHeight()
  const isInspOpen = !!(ui.modals.quickLook && ui.quickLookBmId)
  const effectiveH = isInspOpen
    ? Math.max(cachedDockH.value || 220, cachedInspH.value || 380)
    : (cachedDockH.value || 220)
  const maxTop = Math.max(MIN_HANDLE_TOP, ch - effectiveH - MIN_BOTTOM)
  if (handleTop.value > maxTop) {
    handleTop.value = maxTop
  }

  dockStartY = e.clientY
  dockStartTop = handleTop.value
  dockHasMoved = false
  isDraggingDock.value = true

  const target = e.currentTarget as HTMLElement
  if (target?.setPointerCapture) {
    try {
      target.setPointerCapture(e.pointerId)
    } catch {}
  }
}

function onDockPointerMove(e: PointerEvent) {
  if (!isDraggingDock.value) return
  const deltaY = e.clientY - dockStartY
  if (Math.abs(deltaY) > 3) {
    dockHasMoved = true
  }
  if (dockHasMoved) {
    const ch = getContainerHeight()
    const isInspOpen = !!(ui.modals.quickLook && ui.quickLookBmId)
    const effectiveH = isInspOpen
      ? Math.max(cachedDockH.value || 220, cachedInspH.value || 380)
      : (cachedDockH.value || 220)
    const maxTop = Math.max(MIN_HANDLE_TOP, ch - effectiveH - MIN_BOTTOM)
    const next = Math.max(MIN_HANDLE_TOP, Math.min(maxTop, dockStartTop + deltaY))
    handleTop.value = next
  }
}

function onDockPointerUp(e: PointerEvent) {
  if (!isDraggingDock.value) return
  isDraggingDock.value = false

  const target = e.currentTarget as HTMLElement
  if (target?.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId)
    } catch {}
  }

  if (dockHasMoved) {
    saveHandleTop(handleTop.value)
    setTimeout(() => {
      dockHasMoved = false
    }, 50)
  }
}

function onDockPointerCancel(e: PointerEvent) {
  if (!isDraggingDock.value) return
  isDraggingDock.value = false
  const target = e.currentTarget as HTMLElement
  if (target?.releasePointerCapture) {
    try {
      target.releasePointerCapture(e.pointerId)
    } catch {}
  }
  setTimeout(() => {
    dockHasMoved = false
  }, 50)
}

function onWindowResize() {
  measureHeights()
  const ch = getContainerHeight()
  const maxTop = Math.max(MIN_HANDLE_TOP, ch - HANDLE_HEIGHT - MIN_BOTTOM)
  if (handleTop.value > maxTop) {
    handleTop.value = maxTop
  }
}

const entries = computed<DetailEntry[]>(() =>
  buildDetailCards(ui.detailCards, ds.groupMap, ds.bookmarkMap, domain),
)

// 1. 当有卡片时，默认常驻展开（isCollapsed 为 false）；
// 2. 当无卡片时，默认收起为右侧边缘手柄；用户主动点击小竖条或拖拽卡片时展开
const userExpandedEmpty = ref(false)

// 面板展示判断：有数据时常驻（除非手动收起）；空态时若用户主动点击展开则展示（移动端无拖拽暂存，彻底隐藏）
const isDockVisible = computed(() => {
  if (ui.isMobile) return false
  if (ui.isDraggingCard) return true
  if (isCollapsed.value) return false
  if (entries.value.length > 0) return true
  return userExpandedEmpty.value
})

// 右侧悬浮手柄可见性：
// 1. 移动端无拖拽暂存诉求，彻底不展示
// 2. 拖拽卡片时不显示手柄（让位给放置区）
// 3. 面板展开时不显示手柄
// 4. 有内容才常驻（entries.length > 0）：当暂存架收起时悬浮展示（带数量徽标）
const isHandleVisible = computed(() => {
  if (ui.isMobile) return false
  if (ui.isDraggingCard) return false
  if (isDockVisible.value) return false
  return entries.value.length > 0 && isCollapsed.value
})

function onDockOutsideClick(e: MouseEvent) {
  if (!isDockVisible.value || ui.isMobile) return
  if (isDraggingDock.value || isDraggingHandle.value || ui.isDraggingCard) return
  const target = e.target as HTMLElement | null
  if (!target) return

  // 点击暂存面板自身内部：不收起
  if (dockPanelRef.value && dockPanelRef.value.contains(target)) return

  // 点击左侧详情窗或悬浮手柄：不收起
  if (target.closest('.corner-inspector-frame, .edge-staging-handle')) return

  // 点击详情呼起按钮：不提前拦截
  if (target.closest('.card-menu-btn, .gic-btn, .card-actions-btn, [data-action="open-detail"]')) return

  collapseShelf()
}

let dockClickTimeoutId: ReturnType<typeof setTimeout> | null = null

watch(
  isDockVisible,
  (visible) => {
    if (dockClickTimeoutId) {
      clearTimeout(dockClickTimeoutId)
      dockClickTimeoutId = null
    }
    if (visible && !ui.isMobile) {
      dockClickTimeoutId = setTimeout(() => {
        window.addEventListener('click', onDockOutsideClick)
      }, 0)
    } else {
      window.removeEventListener('click', onDockOutsideClick)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (dockClickTimeoutId) {
    clearTimeout(dockClickTimeoutId)
  }
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('click', onDockOutsideClick)
})

watch(
  () => [entries.value.length, ui.quickLookBmId, isDockVisible.value],
  () => {
    nextTick(() => {
      measureHeights()
    })
  },
  { flush: 'post' },
)

onMounted(() => {
  window.addEventListener('resize', onWindowResize, { passive: true })
  nextTick(() => {
    measureHeights()
  })
})

// 3. 详情飞窗 Header 拖拽联动 (同步更新 handleTop 与存储，完全无缝 1:1 跟随)
let inspectorStartTop = 0

function onInspectorDragStart() {
  measureHeights()
  const ch = getContainerHeight()
  if (isDockVisible.value) {
    const isInspOpen = !!(ui.modals.quickLook && ui.quickLookBmId)
    const effectiveH = isInspOpen
      ? Math.max(cachedDockH.value || 220, cachedInspH.value || 380)
      : (cachedDockH.value || 220)
    const maxTop = Math.max(MIN_HANDLE_TOP, ch - effectiveH - MIN_BOTTOM)
    if (handleTop.value > maxTop) {
      handleTop.value = maxTop
    }
  }
  inspectorStartTop = handleTop.value
}

function onInspectorDragMove(deltaY: number) {
  const ch = getContainerHeight()
  let maxTop: number
  if (isDockVisible.value) {
    const isInspOpen = !!(ui.modals.quickLook && ui.quickLookBmId)
    const effectiveH = isInspOpen
      ? Math.max(cachedDockH.value || 220, cachedInspH.value || 380)
      : (cachedDockH.value || 220)
    maxTop = Math.max(MIN_HANDLE_TOP, ch - effectiveH - MIN_BOTTOM)
  } else {
    maxTop = Math.max(MIN_HANDLE_TOP, ch - HANDLE_HEIGHT - MIN_BOTTOM)
  }
  const next = Math.max(MIN_HANDLE_TOP, Math.min(maxTop, inspectorStartTop + deltaY))
  handleTop.value = next
}

function onInspectorDragEnd() {
  saveHandleTop(handleTop.value)
}

function isOfficialBrand(bm: Bookmark): boolean {
  return (
    bm.id === OFFICIAL_SITE_BM_ID ||
    bm.id === OFFICIAL_SITE_LANDING_ID ||
    bm.id === OFFICIAL_SITE_APP_ID ||
    bm.icon === '/logo.svg' ||
    bm.icon === '/favicon.svg'
  )
}

function getFaviconUrl(bm: Bookmark): string {
  return favicon(bm.url, bm.icon)
}

function onImgError(rawId: string) {
  imgErrors.value[rawId] = true
}

function getInitials(name: string): string {
  return faviconInitials(displayText(name)) || displayText(name).charAt(0) || '?'
}

function handleRowClick(entry: DetailEntry) {
  // 点击书签或笔记均在暂存架左侧吸附飞窗中展示 1:1 详情卡片
  openQuickLook(entry.rawId)
}

function openBookmarkItem(bm: Bookmark) {
  if (bm.url) {
    openBookmark(bm)
  }
}

function removeEntry(rawId: string) {
  const idx = ui.detailCards.indexOf(rawId)
  if (idx > -1) {
    ui.detailCards.splice(idx, 1)
  }
}

function clearAll() {
  ui.detailCards.splice(0)
}
</script>

<style scoped>
.edge-staging-container {
  position: absolute;
  right: 0;
  top: 98px;
  bottom: 0;
  z-index: 85;
  pointer-events: none;
  user-select: none;
}

/* 1. Drag Drop Target [+] (仅空态滑出) */
.edge-staging-drop-zone.empty-state {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 136px;
  height: 44px;
  background: color-mix(in srgb, var(--surface) 95%, transparent);
  border: 2px dashed var(--accent);
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(44, 40, 36, 0.16);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  padding: 0 12px;
  box-sizing: border-box;
  pointer-events: auto;
}

.edge-staging-drop-zone.empty-state:hover,
.edge-staging-drop-zone.empty-state.detail-drag-over,
.edge-staging-drop-zone.empty-state.drag-over {
  background: var(--accent-light);
  border-style: solid;
  transform: scale(1.02);
}

.drop-plus-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--accent);
}

.drop-plus-icon :deep(svg) {
  width: 18px;
  height: 18px;
  stroke-width: 2.8;
}

.drop-hint-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
}

/* 2. Manual Collapsed Handle (精致小巧悬浮胶囊，不贴边，有内容常驻，支持上下拖拽微调) */
.edge-staging-handle {
  position: absolute;
  right: 10px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 14px;
  height: 58px;
  background: var(--accent);
  color: #ffffff;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  cursor: grab;
  box-shadow: 0 3px 12px rgba(44, 40, 36, 0.18),
              0 1px 3px rgba(44, 40, 36, 0.08);
  transition: width 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s ease, background 0.18s ease;
  outline: none;
  pointer-events: auto;
  touch-action: none;
}

/* 隐形扩容热区：向四周扩充感应区域，无需精准对准极细线条即可触发展开与拖拽 */
.edge-staging-handle::before {
  content: '';
  position: absolute;
  top: -8px;
  bottom: -8px;
  left: -12px;
  right: -5px;
  pointer-events: auto;
}

.edge-staging-handle:hover,
.edge-staging-handle:focus-visible {
  width: 17px;
  background: var(--accent-hover, var(--accent));
  box-shadow: 0 4px 16px rgba(37, 99, 235, 0.32);
  transform: scale(1.02);
}

.edge-staging-handle.is-dragging {
  cursor: grabbing !important;
  transform: scale(1.04);
  box-shadow: 0 6px 20px rgba(37, 99, 235, 0.38);
  transition: none !important;
}

.handle-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 10px;
  height: 10px;
  pointer-events: none;
}

.handle-icon :deep(svg) {
  width: 10px;
  height: 10px;
  stroke: #ffffff;
  stroke-width: 2.5;
  display: block;
}

.handle-badge {
  font-size: 8px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.28);
  padding: 0 2px;
  min-width: 9px;
  height: 10px;
  line-height: 10px;
  border-radius: 9999px;
  pointer-events: none;
}

.handle-chevron {
  font-size: 8.5px;
  font-weight: 700;
  line-height: 1;
  color: #ffffff;
  pointer-events: none;
}

/* 3. Permanent Dock Panel (悬浮不贴边、与主站卡片质感高度一致，智能顶部/底部展开) */
.edge-staging-dock-panel {
  position: absolute;
  right: 8px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  width: 220px;
  max-height: calc(100% - 32px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 14px);
  box-shadow: var(--shadow-xl), 0 0 0 1px var(--border-light);
  box-sizing: border-box;
  overflow: hidden;
  pointer-events: auto;
  will-change: top, bottom;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

/* Dark mode enhancement: 与主站暗色卡片一致的材质感，通过顶部内高光与深度投影强化悬浮层级 */
:global([data-theme="dark"]) .edge-staging-dock-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.12) inset,
              0 0 0 1px var(--border-hover),
              var(--shadow-xl);
}

:global([data-theme="dark"]) .dock-header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

:global([data-theme="dark"]) .edge-staging-handle {
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.edge-staging-dock-panel.is-drag-active {
  border-color: var(--accent);
  box-shadow: -4px 8px 28px rgba(37, 99, 235, 0.2);
}

/* Header */
.dock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border-light);
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.dock-header.is-dragging {
  cursor: grabbing !important;
}

.dock-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dock-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--accent);
}

.dock-title-icon :deep(svg) {
  width: 13px;
  height: 13px;
}

.dock-title-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.2px;
}

.dock-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  background: var(--accent-light);
  color: var(--accent);
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 700;
  box-sizing: border-box;
}

.dock-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dock-grip {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.45;
  letter-spacing: -1px;
  cursor: grab;
  line-height: 1;
  pointer-events: none;
  transition: opacity 0.14s ease, color 0.14s ease;
}

.dock-header:hover .dock-grip {
  opacity: 0.9;
  color: var(--accent);
}

.dock-collapse-btn {
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

.dock-collapse-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.collapse-icon {
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}

.dock-divider {
  width: 100%;
  height: 1px;
  background: var(--border-light);
}

/* Items List */
.dock-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: min(380px, calc(100vh - 240px));
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 8px;
  scrollbar-width: thin;
}

/* Drop Slot when dragging */
.dock-drop-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  background: var(--accent-light);
  border: 1.5px dashed var(--accent);
  border-radius: 8px;
  color: var(--accent);
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  box-sizing: border-box;
  animation: pulseSlot 1.2s infinite ease-in-out;
}

@keyframes pulseSlot {
  0%, 100% { opacity: 0.85; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.02); }
}

.slot-plus {
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}

/* Empty State Slot */
.dock-empty-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 12px;
  text-align: center;
  gap: 6px;
  color: var(--text-muted);
}

.dock-empty-slot .empty-icon :deep(svg) {
  width: 20px;
  height: 20px;
  opacity: 0.5;
}

.dock-empty-slot .empty-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.dock-empty-slot .empty-subtext {
  font-size: 10.5px;
  color: var(--text-muted);
}

/* Staged Row Card */
.staged-card-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  cursor: grab;
  transition: all 0.14s cubic-bezier(0.16, 1, 0.3, 1);
  box-sizing: border-box;
}

.staged-card-row:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  transform: translateX(-2px);
  box-shadow: 0 2px 8px rgba(44, 40, 36, 0.06);
}

.staged-card-row.is-active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent-light) 65%, var(--bg) 35%);
  box-shadow: 0 0 0 1.5px var(--accent), 0 2px 8px rgba(37, 99, 235, 0.12);
  transform: translateX(-3px);
}

.staged-card-row:active {
  cursor: grabbing;
}

.staged-card-row.detail-drag-over {
  border-color: var(--accent);
  background: var(--accent-light);
  transform: scale(1.02);
}

.staged-icon-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 4px;
  background: var(--surface);
  overflow: hidden;
}

.group-folder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
}

.group-folder-icon :deep(svg) {
  width: 15px;
  height: 15px;
}

.staged-img {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

.staged-initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 10px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-light);
  border-radius: 3px;
  text-transform: uppercase;
}

/* Info Box */
.staged-info-box {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.staged-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.group-tag {
  font-size: 9.5px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-light);
  padding: 0 3px;
  border-radius: 3px;
  flex-shrink: 0;
}

.staged-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.staged-sub {
  display: flex;
  align-items: center;
}

.staged-sub-text {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Actions Box */
.staged-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.staged-act-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 5px;
  cursor: pointer;
  padding: 0;
  transition: all 0.12s ease;
}

.staged-act-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.staged-act-btn.inspect:hover {
  color: var(--accent);
  background: var(--accent-light);
}

.staged-act-btn.remove:hover {
  color: var(--rose, #e11d48);
  background: var(--rose-light, #fee2e2);
}

.staged-act-btn :deep(svg) {
  width: 13.5px;
  height: 13.5px;
}

/* Dock Footer */
.dock-footer {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--surface) 90%, var(--bg) 10%);
}

.dock-foot-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border-light);
  background: var(--surface);
  color: var(--text-muted);
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.dock-foot-btn:hover {
  background: var(--surface-hover);
  border-color: var(--border-hover);
  color: var(--text);
}

.dock-foot-btn.clear-all {
  width: 100%;
}

.dock-foot-btn.clear-all:hover {
  color: var(--rose, #e11d48);
  border-color: var(--rose-light, #fee2e2);
  background: var(--rose-light, #fee2e2);
}

.dock-foot-btn .btn-icon :deep(svg) {
  width: 13px;
  height: 13px;
}

/* Transitions */
.drop-zone-slide-enter-active,
.drop-zone-slide-leave-active {
  transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease;
}

.drop-zone-slide-enter-from,
.drop-zone-slide-leave-to {
  opacity: 0;
  transform: translateX(calc(100% + 24px));
}

.dock-panel-slide-enter-active {
  transition: transform 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, box-shadow 0.24s ease;
}

.dock-panel-slide-leave-active {
  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease;
}

.dock-panel-slide-enter-from,
.dock-panel-slide-leave-to {
  opacity: 0;
  transform: translateX(calc(100% + 24px)) scale(0.96);
}

.handle-slide-enter-active {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease;
}

.handle-slide-leave-active {
  transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.15s ease;
}

.handle-slide-enter-from,
.handle-slide-leave-to {
  opacity: 0;
  transform: scale(0.85);
}

@media (max-width: 768px) {
  .edge-staging-drop-zone,
  .edge-staging-handle,
  .edge-staging-dock-panel {
    display: none !important;
  }
  .edge-staging-container {
    position: static !important;
    pointer-events: none !important;
  }
}
</style>
