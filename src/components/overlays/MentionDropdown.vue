<template>
  <div id="mentionDrop" class="mention-drop" v-show="isVisible"
       :style="{ left: pos.x + 'px', top: pos.y + 'px' }">
    <div v-for="(item, idx) in candidates" :key="item.id"
         class="mention-item" :class="{ active: idx === activeIdx, 'has-sub': item.subItems?.length }"
         @mousedown.prevent="onItemMousedown(idx, $event)">
      <template v-if="mentionType === 'group'">
        <img v-if="item.icon" :src="item.icon" alt="">
        <span v-else class="note-icon" v-html="noteIcon"></span>
        <span class="mi-name">{{ item.name || '未命名组' }}</span>
        <span class="mi-url">{{ item.bookmarkIds?.length || 0 }}个书签</span>
      </template>
      <template v-else>
        <img :src="item.icon || favicon(item.url || '')" alt="" @error="onFaviconError($event, item.title || item.url)">
        <span class="mi-name">{{ item.title || '' }}</span>
        <span class="mi-url">{{ domain(item.url || '') }}</span>
        <div v-if="item.subItems?.length" class="mention-sub-menu">
          <div v-for="(sub, subIdx) in item.subItems" :key="sub.id"
               class="mention-item mention-sub-item"
               :class="{ active: subIdx === activeSubIdx && idx === activeIdx }"
               @mousedown.prevent.stop="onSubItemMousedown(sub, $event)">
            <img :src="sub.icon || favicon(sub.url || '')" alt="" @error="onFaviconError($event, sub.title || sub.url)">
            <span class="mi-name">{{ sub.title || '' }}</span>
            <span class="mi-url">{{ domain(sub.url || '') }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { I } from '../../config/icons.js'
import { favicon, domain, faviconInitials } from '../../utils.js'
import { useMention } from '../../composables/domain/useMention.js'

const {
  isVisible, candidates, activeIdx, activeSubIdx, mentionType, pos,
  selectBookmark, selectGroupRef,
  onTrigger, onInput, onKeydown
} = useMention()

const noteIcon = I.note

function onItemMousedown(idx: number, event: MouseEvent) {
  const item = candidates.value[idx]
  if (!item) return
  if (item.subItems?.length && (event.target as HTMLElement).closest('.mention-sub-menu')) return
  item.type === 'group' ? selectGroupRef(item.id) : selectBookmark(item.id)
}

function onSubItemMousedown(sub: { id: string }, event: MouseEvent) {
  event.preventDefault(); event.stopPropagation()
  selectBookmark(sub.id)
}

// favicon 加载失败（第三方服务挂 / 隐私拦截）时降级为首字母占位，避免破图
function onFaviconError(e: Event, name?: string) {
  const img = e.target as HTMLImageElement
  if (!img.dataset.fallback) {
    img.dataset.fallback = '1'
    img.src = faviconInitials(name)
  }
}

function _onKeydown(e: KeyboardEvent) { onTrigger(e); onKeydown(e) }
function _onScroll() {
  if (!isVisible.value) return
  const sel = window.getSelection()
  if (sel && sel.rangeCount) {
    const r = sel.getRangeAt(0).getClientRects()[0]
    if (r) pos.value = { x: Math.min(r.left, window.innerWidth - 310), y: Math.min(r.bottom + 4, window.innerHeight - 220) }
  }
}

// 缓存挂载时拿到的滚动容器引用——卸载时若 #panelContent 已被重建（聚焦态分支切换、
// 容器 key 变化），getElementById 会查到新元素或 null，挂载时绑在旧元素上的监听无人移除，
// scroll 回调泄漏到死元素上继续触发读 window.getSelection()。一致引用保证解绑命中同一节点。
let _scrollEl: HTMLElement | null = null

onMounted(() => {
  document.addEventListener('keydown', _onKeydown)
  document.addEventListener('input', onInput)
  _scrollEl = document.getElementById('panelContent')
  _scrollEl?.addEventListener('scroll', _onScroll)
})
onUnmounted(() => {
  document.removeEventListener('keydown', _onKeydown)
  document.removeEventListener('input', onInput)
  _scrollEl?.removeEventListener('scroll', _onScroll)
  _scrollEl = null
})
</script>
