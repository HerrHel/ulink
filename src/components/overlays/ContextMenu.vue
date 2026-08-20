<template>
  <div class="ctx-menu" id="ctxMenu" v-show="ctx.open" role="menu" aria-label="操作菜单"
       :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <template v-for="item in visibleItems" :key="item.action">
      <div v-if="item.divider" class="ctx-divider" role="separator"></div>
      <button v-else class="ctx-item" :class="{ 'ctx-danger': item.danger }"
              role="menuitem" :data-action="item.action" @click="onItemClick(item.action)">
        {{ item.text }}
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, nextTick } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { ACTIONS } from '../../config/constants.js'
import { MENU_RULES, MENU_ITEMS, dispatchMenuAction, canAddSub } from '../../lib/menuConfig.js'

const ctx = useContextMenuStore()
const uiStore = useUIStore()

// 视口边缘 clamp：contextMenu.show 用 e.clientX/Y 作 left/top，右/下边缘右键时菜单
// 固定定位会溢出视口（右下 1/3 区域高频）。菜单高度随 type 动态（card=6 项、rail-empty=1 项），
// 故在 open 切为 true 后 nextTick 读 #ctxMenu 实际 offsetWidth/Height 反算 clamp，比硬编码更准。
// 对照 AddPopover(useMention 同样 Math.min(innerWidth-innerHeight - 预估)) 做法一致。
const pos = ref({ x: 0, y: 0 })
// 审计 R14：原 watch 仅监听 ctx.open，连续右键不同坐标时 ctx.show 每次更新 x/y 但恒置 open=true，
// open true→true 不触发 → pos 保持第一次坐标，菜单偏位、可能误点错菜单项。改为监听 [open,x,y]：
// open=false 时 menu 不可见读不到尺寸故仍 return；open=true 且 x/y 变化时同 tick 重算 clamp。
watch(() => [ctx.open, ctx.x, ctx.y], async ([open]) => {
  if (!open) return
  // 先按原始 clientX/Y 摆位（菜单可见后才能测尺寸）
  pos.value = { x: ctx.x, y: ctx.y }
  await nextTick()
  const el = document.getElementById('ctxMenu')
  if (!el) return
  const w = el.offsetWidth, h = el.offsetHeight
  const margin = 8
  pos.value = {
    x: Math.min(ctx.x, window.innerWidth - w - margin),
    y: Math.min(ctx.y, window.innerHeight - h - margin),
  }
})

// 菜单项由 menuConfig 单一来源驱动（MENU_RULES 顺序 + MENU_ITEMS 文案/危险标记）
const visibleItems = computed(() => {
  const rules = MENU_RULES[ctx.type] || []
  const dataStore = useDataStore()
  const items: Array<{ action: string; text: string; danger?: boolean; divider?: boolean }> = []
  for (const entry of rules) {
    // 私密空间内不显示「移入私密空间」（已经在私密空间）
    if (entry.action === ACTIONS.MOVE_TO_SPACE && uiStore.curSpace !== 'main') continue
    // 添加子网站仅顶层书签（子书签无此能力）
    if (entry.action === ACTIONS.ADD_SUB && !canAddSub(ctx.id)) continue
    let text = entry.label || MENU_ITEMS[entry.action]?.label || entry.action
    // 动态标签：置顶/取消置顶
    if (entry.action === ACTIONS.PIN) {
      const isPinned = ctx.type === 'card'
        ? !!dataStore.bookmarkMap[ctx.id]?.pinnedAt
        : ctx.type === 'group'
          ? !!dataStore.groupMap[ctx.id]?.pinnedAt
          : false
      text = isPinned ? '取消置顶' : '置顶'
    }
    items.push({ action: entry.action, text, danger: entry.danger ?? MENU_ITEMS[entry.action]?.danger })
  }
  return items
})

function onItemClick(action: string) {
  const tid = ctx.id
  const ttype = ctx.type
  ctx.hide()
  dispatchMenuAction(ttype, action, tid)
}

function _onDocClick(e: MouseEvent) { if (!(e.target as HTMLElement).closest('#ctxMenu')) ctx.hide() }

onMounted(() => {
  document.addEventListener('click', _onDocClick)
})

onUnmounted(() => {
  document.removeEventListener('click', _onDocClick)
})
</script>
