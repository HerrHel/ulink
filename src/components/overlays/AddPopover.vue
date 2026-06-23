<template>
  <div class="popover-mask" :class="{ 'popover-mask-visible': isMobileDevice && sheetEnter }" v-show="visible" @click="close">
    <div class="popover-card" :class="cardClasses" :style="cardStyle" @click.stop>
      <!-- 类型切换标签 -->
      <div class="popover-tabs">
        <button class="popover-tab" :class="{ active: tab === 'bm' }" @click="switchTab('bm')">书签</button>
        <button class="popover-tab" :class="{ active: tab === 'group' }" @click="switchTab('group')">组</button>
      </div>
      <!-- 搜索栏 -->
      <div class="popover-search-row">
        <input ref="searchInputRef" type="text" class="form-input" v-model="query"
               :placeholder="tab === 'bm' ? '搜索书签…' : '搜索组…'"
               :aria-label="tab === 'bm' ? '搜索书签' : '搜索组'" autocomplete="off">
        <button class="btn btn-ghost btn-sm" @click="close">取消</button>
        <button v-if="tab === 'bm'" class="btn btn-primary btn-sm" @click="onAddNew">+ 新建</button>
      </div>
      <!-- 结果列表 -->
      <div class="popover-results">
        <!-- 书签结果 -->
        <template v-if="tab === 'bm'">
          <div v-if="!bookmarkResults.length" class="popover-result popover-empty">
            {{ query ? '无匹配' : '输入关键词搜索…' }}
          </div>
          <div v-for="b in bookmarkResults" :key="b.id" class="popover-result"
               @click="onSelectBm(b.id)">
            <img :src="b.icon || favicon(b.url)" alt="">
            <span class="pr-name">{{ b.title }}</span>
            <span class="pr-url">{{ domain(b.url) }}</span>
          </div>
        </template>
        <!-- 组结果 -->
        <template v-else>
          <div v-if="!groupResults.length" class="popover-result popover-empty">
            {{ query ? '无匹配的组' : '输入关键词搜索…' }}
          </div>
          <div v-for="g in groupResults" :key="g.id" class="popover-result"
               @click="onSelectGroup(g.id)">
            <img v-if="g.icon" :src="g.icon" alt="" class="pr-img">
            <span v-else class="pr-icon-fallback" v-html="I.note"></span>
            <span class="pr-name">{{ g.name || '未命名组' }}</span>
            <span class="pr-meta">{{ g.bookmarkIds?.length || 0 }} 个书签</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import { favicon, domain } from '../../utils.js'
import { addToGroupDirect, addGroupRefToGroup } from '../../composables/domain/useGroup.js'
import { openBmModal, bmForm } from '../../composables/domain/useBookmark.js'
import { I } from '../../config/icons.js'

const store = useAppStore()
const uiStore = useUIStore()
const visible = ref(false)
const query = ref('')
const tab = ref('bm')
const searchInputRef = ref<HTMLInputElement | null>(null)
const sheetEnter = ref(false)
let _closeTimer: ReturnType<typeof setTimeout> | null = null

const isMobileDevice = computed(() => uiStore.isMobile)

const cardClasses = computed(() => ({
  'popover-sheet': isMobileDevice.value,
  'popover-sheet-enter': isMobileDevice.value && sheetEnter.value
}))

/** 卡片定位样式（桌面端跟随按钮，移动端为底部弹出） */
const cardStyle = computed(() => {
  if (isMobileDevice.value) return {}
  const t = store._addPopoverTrigger
  if (!t) return { top: '80px', left: '50%', transform: 'translateX(-50%)' }
  const maxLeft = window.innerWidth - 370
  const maxTop = window.innerHeight - 370
  return {
    top: Math.min(t.top + 4, maxTop) + 'px',
    left: Math.min(t.left, maxLeft) + 'px',
    transform: 'none'
  }
})

/** 书签搜索结果 */
const bookmarkResults = computed(() => {
  const q = query.value.toLowerCase()
  let results = store.bookmarks.slice()
  if (q) results = results.filter(b =>
    b.title.toLowerCase().includes(q) ||
    b.url.toLowerCase().includes(q) ||
    (b.notes || '').toLowerCase().includes(q)
  )
  return results.slice(0, 20)
})

/** 组搜索结果 —— 排除当前目标组自身 */
const groupResults = computed(() => {
  const q = query.value.toLowerCase()
  let results = store.siblingGroups.slice()
  if (store.addToGid) results = results.filter(g => g.id !== store.addToGid)
  if (q) results = results.filter(g =>
    (g.name || '').toLowerCase().includes(q)
  )
  return results.slice(0, 20)
})

/** 监听 store.addBmPopoverOpen，驱动弹窗显隐 */
watch(() => store.addBmPopoverOpen, (v) => {
  if (v) {
    // 打开 —— 先显示元素，下一帧触发入场动画
    if (_closeTimer) clearTimeout(_closeTimer)
    visible.value = true
    query.value = ''
    tab.value = 'bm'
    if (isMobileDevice.value) {
      nextTick(() => {
        requestAnimationFrame(() => {
          sheetEnter.value = true
          searchInputRef.value?.focus()
        })
      })
    } else {
      nextTick(() => {
        searchInputRef.value?.focus()
      })
    }
  } else {
    // 关闭 —— 先触发离场动画，等动画结束后隐藏
    if (isMobileDevice.value) {
      sheetEnter.value = false
      _closeTimer = setTimeout(() => {
        visible.value = false
      }, 300)
    } else {
      visible.value = false
    }
  }
})

function switchTab(t: string) {
  tab.value = t
  query.value = ''
  nextTick(() => {
    searchInputRef.value?.focus()
  })
}

function show(targetGid: string) {
  visible.value = true
  store.addToGid = targetGid
  query.value = ''
}

function close() {
  store.addBmPopoverOpen = false
  store.addToGid = null
  store._addPopoverTrigger = null
}

function onSelectBm(bmId: string) {
  if (bmId && store.addToGid) {
    addToGroupDirect(bmId, store.addToGid)
    close()
  }
}

function onSelectGroup(refGid: string) {
  if (refGid && store.addToGid) {
    addGroupRefToGroup(refGid, store.addToGid)
    close()
  }
}

function onAddNew() {
  if (!store.addToGid) return
  store.saveToGroup = store.addToGid
  openBmModal(undefined)
  bmForm.addToGroupMode = true
  close()
}

defineExpose({ show, close })
</script>
