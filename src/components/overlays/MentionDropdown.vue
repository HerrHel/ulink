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
        <img :src="item.icon || favicon(item.url || '')" alt="">
        <span class="mi-name">{{ item.title || '' }}</span>
        <span class="mi-url">{{ domain(item.url || '') }}</span>
        <div v-if="item.subItems?.length" class="mention-sub-menu">
          <div v-for="(sub, subIdx) in item.subItems" :key="sub.id"
               class="mention-item mention-sub-item"
               :class="{ active: subIdx === activeSubIdx && idx === activeIdx }"
               @mousedown.prevent.stop="onSubItemMousedown(sub, $event)">
            <img :src="sub.icon || favicon(sub.url || '')" alt="">
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
import { setMentionAPI } from '../../composables/bridge.js'
import { I } from '../../config/icons.js'
import { favicon, domain } from '../../utils.js'
import { useMention } from '../../composables/domain/useMention.js'

const {
  isVisible, candidates, activeIdx, activeSubIdx, mentionType, pos,
  hide, selectBookmark, selectGroupRef,
  onTrigger, onInput, onKeydown
} = useMention()

const noteIcon = I.note

function onItemMousedown(idx, event) {
  const item = candidates.value[idx]
  if (!item) return
  if (item.subItems?.length && event.target.closest('.mention-sub-menu')) return
  item.type === 'group' ? selectGroupRef(item.id) : selectBookmark(item.id)
}

function onSubItemMousedown(sub, event) {
  event.preventDefault(); event.stopPropagation()
  selectBookmark(sub.id)
}

function _onKeydown(e) { onTrigger(e); onKeydown(e) }
function _onScroll() {
  if (!isVisible.value) return
  const sel = window.getSelection()
  if (sel.rangeCount) {
    const r = sel.getRangeAt(0).getClientRects()[0]
    if (r) pos.value = { x: Math.min(r.left, window.innerWidth - 310), y: Math.min(r.bottom + 4, window.innerHeight - 220) }
  }
}

onMounted(() => {
  setMentionAPI({ hide, init() {}, destroy() {} })
  document.addEventListener('keydown', _onKeydown)
  document.addEventListener('input', onInput)
  document.getElementById('panelContent')?.addEventListener('scroll', _onScroll)
})
onUnmounted(() => {
  document.removeEventListener('keydown', _onKeydown)
  document.removeEventListener('input', onInput)
  document.getElementById('panelContent')?.removeEventListener('scroll', _onScroll)
  setMentionAPI(null)
})
</script>
