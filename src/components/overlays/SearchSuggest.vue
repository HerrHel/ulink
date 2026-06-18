<template>
  <div class="search-suggest" v-show="visible && results.length > 0">
    <div class="search-suggest-item" v-for="b in results" :key="b.id" @click="select(b)">
      <img :src="b.icon || favicon(b.url)" alt="">
      <span class="ss-name">{{ b.title }}</span>
      <span class="ss-url">{{ domain(b.url) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { favicon, domain } from '../../utils.js'
import { openBookmark } from '../../composables/domain/useBookmark.js'
import { MAX_SUGGESTIONS } from '../../config/constants.js'

const store = useAppStore()
const visible = ref(false)

const results = computed(() => {
  if (store.focusedGroupId) return []
  const q = (store.searchQuery || '').trim().toLowerCase()
  if (!q) return []
  return store.bookmarks.filter(b =>
    b.title.toLowerCase().includes(q) ||
    b.url.toLowerCase().includes(q) ||
    (b.notes || '').toLowerCase().includes(q) ||
    (b.username || '').toLowerCase().includes(q)
  ).slice(0, MAX_SUGGESTIONS)
})

function updateVisibility() {
  visible.value = !!store.searchQuery?.trim() && !store.focusedGroupId && results.value.length > 0
}

watch(() => store.searchQuery, updateVisibility)

function select(bm) {
  visible.value = false
  store.searchQuery = ''
  openBookmark(bm)
}

// 点击搜索框外部时隐藏
function hide() { visible.value = false }

function onDocClick(e) { if (!e.target.closest('.search-wrapper')) visible.value = false }

// 搜索框 focus 时也显示建议（使用 CSS 类选择器，不依赖 ID）
function onFocusIn(e) { if (e.target.matches('.search-input')) updateVisibility() }

// 键盘导航：Enter 选中第一个建议，Escape 关闭
function onKeydown(e) {
  if (!visible.value) return
  if (e.key === 'Enter' && results.value.length > 0) {
    e.preventDefault()
    select(results.value[0])
  }
  if (e.key === 'Escape') {
    visible.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('keydown', onKeydown)
})

defineExpose({ hide, visible })
</script>
