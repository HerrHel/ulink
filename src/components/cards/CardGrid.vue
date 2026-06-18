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
import { computed, ref } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { isMobile } from '../../utils.js'
import { I } from '../../config/icons.js'
import { useVirtualScroll } from '../../composables/useVirtualScroll.js'
import { useMobileDragReorder } from '../../composables/interaction/useMobileDragReorder.js'
import BookmarkCard from './BookmarkCard.vue'
import GroupCard from './GroupCard.vue'
const store = useAppStore()
const dataStore = useDataStore()
const bookmarkIcon = I.emptyBookmark
const gridRef = ref(null)
const normalGridRef = ref(null)
const gridClass = computed(() => {
  if (store.focusedGroupId) return 'card-grid focus-view' + (isMobile() ? ' focus-mobile' : '')
  return store.layoutMode === 'list' ? 'card-grid list-view' : 'card-grid grid-view'
})
const combinedList = computed(() => {
  if (store.focusedGroupId) {
    const group = store.groupMap[store.focusedGroupId]
    return group ? [{ type: 'group', data: group }] : []
  }
  // 有自定义顺序时，按自定义顺序重建（支持跨类型排序）
  const customOrder = dataStore._customCardOrder
  if (customOrder != null && store.sortMode === 'order') {
    const bmMap = store.bookmarkMap
    const gMap = store.groupMap
    const usedBms = new Set()
    const usedGs = new Set()
    const combined = []
    customOrder.forEach(entry => {
      if (entry.t === 'g' && gMap[entry.id]) { combined.push({ type: 'group', data: gMap[entry.id] }); usedGs.add(entry.id) }
      else if (entry.t === 'b' && bmMap[entry.id] && !bmMap[entry.id].parentId) { combined.push({ type: 'bm', data: bmMap[entry.id] }); usedBms.add(entry.id) }
    })
    // 追加不在自定义顺序中的新项
    store.siblingGroups.forEach(g => { if (!usedGs.has(g.id)) combined.push({ type: 'group', data: g }) })
    store.bookmarks.filter(b => !b.parentId).forEach(b => { if (!usedBms.has(b.id)) combined.push({ type: 'bm', data: b }) })
    return combined
  }
  const groups = store.filteredGroups
  const topLevel = store.filteredBookmarks.filter(b => !b.parentId)
  const combined = []
  groups.forEach(g => combined.push({ type: 'group', data: g }))
  topLevel.forEach(b => combined.push({ type: 'bm', data: b }))
  return combined
})

const useVirtual = computed(() => combinedList.value.length > 100)
const { visibleItems, totalHeight } = useVirtualScroll(
  computed(() => useVirtual.value ? combinedList.value : []),
  { itemHeight: isMobile() ? 100 : 140, containerHeight: 800, overscan: 5 }
)

// 移动端批量模式拖拽排序（纯 pointer events）
useMobileDragReorder(normalGridRef, combinedList)
</script>
