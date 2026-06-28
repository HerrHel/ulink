<template>
  <div :class="gridClass" id="cardGrid" ref="gridRef">
    <template v-if="useVirtual">
      <div :style="{ height: totalHeight + 'px', position: 'relative' }">
        <GroupCard
          v-for="item in visibleItems.filter(i => i.type === 'group')"
          :key="item.data.id"
          :group="item.data"
          :style="item._virtualStyle"
        />
        <BookmarkCard
          v-for="item in visibleItems.filter(i => i.type === 'bm')"
          :key="item.data.id"
          :bookmark="item.data"
          :style="item._virtualStyle"
        />
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
import { ref } from 'vue'
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

const gridClass = computed(() => {
  if (ui.focusedGroupId) return 'card-grid focus-view' + (isMobile() ? ' focus-mobile' : '')
  return ui.layoutMode === 'list' ? 'card-grid list-view' : 'card-grid grid-view'
})

const useVirtual = computed(() => combinedList.value.length > 100)
const virtualList = computed<CardItem[]>(() => useVirtual.value ? combinedList.value : [])
const { visibleItems, totalHeight } = useVirtualScroll(
  virtualList,
  { itemHeight: isMobile() ? 100 : 140, containerHeight: 800, overscan: 5 }
)

// 移动端批量模式拖拽排序（纯 pointer events）
useMobileDragReorder(normalGridRef, combinedList)
</script>
