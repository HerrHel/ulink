<template>
  <div :class="gridClass" id="cardGrid" ref="gridRef" role="list">
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
import { isMobile } from '../../utils.js'
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

const useVirtual = computed(() => combinedList.value.length > 100)
const virtualList = computed<CardItem[]>(() => useVirtual.value ? combinedList.value : [])
const { visibleItems, totalHeight } = useVirtualScroll(
  virtualList,
  {
    itemHeight: isMobile() ? 100 : 140,
    containerHeight: 800,
    overscan: 5,
    scrollRootSelector: '#panelContent',
  }
)

const gridClass = computed(() => {
  if (ui.focusedGroupId) return 'card-grid focus-view' + (isMobile() ? ' focus-mobile' : '')
  // 虚拟滚动依赖 absolute 行堆叠，强制 list 语义避免与 multi-col grid 冲突
  if (useVirtual.value) return 'card-grid list-view virtual-scroll'
  return ui.layoutMode === 'list' ? 'card-grid list-view' : 'card-grid grid-view'
})

// 移动端批量模式拖拽排序（纯 pointer events）
useMobileDragReorder(normalGridRef, combinedList)
</script>
