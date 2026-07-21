<template>
  <div class="attr-chips" id="attrChips" ref="chipsRef">
    <span v-for="chip in activeChips" :key="chip.id" class="attr-chip"
          @click="onToggleFilter(chip.id)">
      <span class="attr-chip-txt">{{ chip.name }}</span>
      <span class="attr-chip-x" aria-hidden="true" v-html="I.close"></span>
    </span>
    <span v-for="chip in excludedChips" :key="chip.id" class="attr-chip attr-chip-excluded"
          @click="onToggleExclude(chip.id)">
      <span class="attr-chip-txt">{{ chip.name }}</span>
      <span class="attr-chip-x" aria-hidden="true" v-html="I.close"></span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { toggleAttrFilter, toggleAttrExclude } from '../../composables/domain/useAttrFilter.js'
import { I } from '../../config/icons.js'
import type { CustomAttribute } from '../../types.js'

const store = useAppStore()
const chipsRef = ref<HTMLElement | null>(null)

const activeChips = computed<CustomAttribute[]>(() => {
  const map = store.attributeMap
  return store.activeAttrs
    .map(aid => map[aid])
    .filter((c): c is CustomAttribute => c !== undefined)
})

const excludedChips = computed<CustomAttribute[]>(() => {
  const map = store.attributeMap
  return store.excludedAttrs
    .map(aid => map[aid])
    .filter((c): c is CustomAttribute => c !== undefined)
})

function onToggleFilter(id: string) { toggleAttrFilter(id) }
function onToggleExclude(id: string) { toggleAttrExclude(id) }

// 渐变遮罩
function updateChipsFade() {
  const el = chipsRef.value
  if (!el) return
  if (el.scrollWidth > el.clientWidth + 1) {
    const fade = Math.max(24, Math.round(el.clientWidth * 0.1)) + 'px'
    el.style.webkitMaskImage = el.style.maskImage = 'linear-gradient(to right,black calc(100% - ' + fade + '),transparent 100%)'
    el.style.webkitMaskRepeat = el.style.maskRepeat = 'no-repeat'
  } else {
    el.style.webkitMaskImage = el.style.maskImage = ''
    el.style.webkitMaskRepeat = el.style.maskRepeat = ''
  }
}

// 滚轮水平滚动
function onChipsWheel(e: WheelEvent) {
  const el = chipsRef.value
  if (!el || el.scrollWidth <= el.clientWidth) return
  e.preventDefault()
  el.scrollLeft += e.deltaY || e.deltaX
  updateChipsFade()
}

// 鼠标拖拽滚动
let _drag: { x: number; s: number } | null = null
function onChipsMouseDown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.attr-chip')) return
  const el = chipsRef.value
  if (!el) return
  _drag = { x: e.clientX, s: el.scrollLeft }
  el.style.cursor = 'grabbing'
  e.preventDefault()
}
function onChipsMouseMove(e: MouseEvent) {
  if (!_drag) return
  const el = chipsRef.value
  if (!el) return
  el.scrollLeft = _drag.s - (e.clientX - _drag.x)
  updateChipsFade()
}
function onChipsMouseUp() {
  if (!_drag) return
  _drag = null
  const el = chipsRef.value
  if (el) el.style.cursor = ''
}

onMounted(() => {
  const el = chipsRef.value
  if (el) el.addEventListener('wheel', onChipsWheel, { passive: false })
  document.addEventListener('mousemove', onChipsMouseMove)
  document.addEventListener('mouseup', onChipsMouseUp)
  if (el) el.addEventListener('mousedown', onChipsMouseDown)
  window.addEventListener('resize', updateChipsFade)
  nextTick(updateChipsFade)
})

onUnmounted(() => {
  const el = chipsRef.value
  if (el) el.removeEventListener('wheel', onChipsWheel)
  document.removeEventListener('mousemove', onChipsMouseMove)
  document.removeEventListener('mouseup', onChipsMouseUp)
  if (el) el.removeEventListener('mousedown', onChipsMouseDown)
  window.removeEventListener('resize', updateChipsFade)
})

// 属性变化时更新遮罩
watch([activeChips, excludedChips], () => nextTick(updateChipsFade))
</script>
