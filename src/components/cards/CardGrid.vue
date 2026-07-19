<template>
  <div :class="gridClass" id="cardGrid" data-testid="lv-card-grid" ref="gridRef" role="list">
    <template v-if="useVirtual">
      <!-- 虚拟模式：固定行高 absolute 列表（绑 #panelContent 滚动，见 useVirtualScroll） -->
      <div class="card-grid-virtual" :style="{ height: totalHeight + 'px', position: 'relative' }">
        <template v-for="item in visibleItems" :key="(item.type === 'group' ? 'g-' : 'b-') + item.data.id">
          <GroupCard
            v-if="item.type === 'group'"
            :group="item.data"
            :style="item._virtualStyle"
          />
          <BookmarkCard
            v-else
            :bookmark="item.data"
            :style="item._virtualStyle"
          />
        </template>
      </div>
    </template>
    <template v-else-if="combinedList.length">
      <div ref="normalGridRef" class="card-list-inner">
        <template v-for="item in combinedList" :key="(item.type === 'group' ? 'g-' : 'b-') + item.data.id">
          <GroupCard v-if="item.type === 'group'" :group="item.data" />
          <BookmarkCard v-else :bookmark="item.data" />
        </template>
      </div>
    </template>
    <div v-else class="empty">
      <div class="empty-icon" v-html="bookmarkIcon"></div>
      <h3>暂无书签</h3>
      <p>点击 + 按钮开始收藏</p>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue'
import { I } from '../../config/icons.js'
import { useUIStore } from '../../stores/ui.js'
import { useCombinedList } from '../../composables/useCombinedList.js'
import { useVirtualScroll } from '../../composables/useVirtualScroll.js'
import { useMobileDragReorder } from '../../composables/interaction/useMobileDragReorder.js'
import type { CardItem } from '../../types.js'
import BookmarkCard from './BookmarkCard.vue'
import GroupCard from './GroupCard.vue'

const ui = useUIStore()
const bookmarkIcon = I.emptyBookmark
const gridRef = ref(null)
const normalGridRef = ref(null)
const { combinedList } = useCombinedList()

// H13 修复：虚拟滚动用 absolute 定位 + 仅渲染可见项，useMobileDragReorder 依赖
// 容器 children 真实 DOM 顺序与 listRef 一一对应，虚拟模式下 getItems 只拿得到
// 可见片段且索引与 combinedList 错位，reorder 必然错误。批量模式本就需要全量 DOM
// 才能拖拽排序，故 batchMode 时强制走非虚拟完整列表（normalGridRef 挂载），>100 项
// 仅在非批量时启用虚拟滚动。
const useVirtual = computed(() => combinedList.value.length > 100 && !ui.batchMode)
const virtualList = computed<CardItem[]>(() => useVirtual.value ? combinedList.value : [])
// A1-005：行高跟 isMobile 响应，避免 setup 时 isMobile() 写死；虚拟模式强制 list-view
const virtualItemHeight = computed(() => (ui.isMobile ? 100 : 140))
const { visibleItems, totalHeight } = useVirtualScroll(
  virtualList,
  {
    itemHeight: virtualItemHeight,
    containerHeight: 800,
    overscan: 5,
    scrollRootSelector: '#panelContent',
  }
)

const gridClass = computed(() => {
  if (ui.focusedGroupId) return 'card-grid focus-view' + (ui.isMobile ? ' focus-mobile' : '')
  // 虚拟滚动依赖 absolute 行堆叠，强制 list 语义避免与 multi-col grid 冲突
  if (useVirtual.value) return 'card-grid list-view virtual-scroll'
  if (ui.layoutMode === 'mini-grid') return 'card-grid mini-grid-view'
  return ui.layoutMode === 'list' ? 'card-grid list-view' : 'card-grid grid-view'
})

// 移动端批量模式拖拽排序（纯 pointer events）
// 绑定 normalGridRef：batchMode 时 useVirtual 为 false，该 ref 一定挂载
useMobileDragReorder(normalGridRef, combinedList)
</script>
