<template>
  <!-- A5-001：用响应式 mobile 布尔，禁止 v-if="isMobile" 把函数当真值永久挂桌面栏 -->
  <template v-if="mobile">
    <div class="mfb" :class="{ visible: isVisible }" :style="{ bottom: kbBottom + 'px' }"
         @mousedown.prevent>
      <button class="ft-btn" @click="toggle('bold')" title="加粗" v-html="icons.bold"></button>
      <button class="ft-btn" @click="toggle('underline')" title="下划线" v-html="icons.underline"></button>
      <button class="ft-btn" @click="toggle('h1')" title="大标题">H1</button>
      <button class="ft-btn" @click="toggle('h2')" title="中标题">H2</button>
      <button class="ft-btn" @click="toggle('h3')" title="小标题">H3</button>
      <span class="ft-sep"></span>
      <button class="ft-btn" @click="toggle('ol')" title="有序列表" v-html="icons.ol"></button>
      <button class="ft-btn" @click="toggle('ul')" title="无序列表" v-html="icons.ul"></button>
      <button class="ft-btn" @click="toggle('task')" title="待办清单" v-html="icons.taskList"></button>
      <span class="ft-sep"></span>
      <button ref="mfbColorBtnRef" class="ft-btn ft-color-btn" :class="{ active: !!state.color }"
              :style="state.color ? { '--ft-color': state.color } : {}"
              @click="toggleMfbPalette" title="文字颜色" v-html="icons.textColor"></button>
      <template v-if="paletteOpen">
        <span class="ft-sep"></span>
        <button v-for="c in palette" :key="c.hex" class="mfb-color-dot"
                :class="{ active: c.hex === state.color }"
                :style="{ background: c.hex }" @click="applyColor(c.hex)"></button>
        <button class="mfb-color-reset" @click="applyColor('')">默认</button>
      </template>
    </div>
  </template>
  <div v-else class="format-toolbar" ref="toolbarRef" @mousedown.prevent>
    <button class="ft-btn ft-sb-btn" :class="{ active: state.bold }" title="加粗 Ctrl+B" @click="toggle('bold')">
      <strong>B</strong>
    </button>
    <button class="ft-btn ft-sb-btn" :class="{ active: state.underline }" title="下划线 Ctrl+U" @click="toggle('underline')">
      <span v-html="icons.underline"></span>
    </button>
    <button class="ft-btn ft-sb-btn" :class="{ active: state.h1 }" title="大标题" @click="toggle('h1')">H1</button>
    <button class="ft-btn ft-sb-btn" :class="{ active: state.h2 }" title="中标题" @click="toggle('h2')">H2</button>
    <button class="ft-btn ft-sb-btn" :class="{ active: state.h3 }" title="小标题" @click="toggle('h3')">H3</button>
    <div class="ft-sb-sep"></div>
    <button class="ft-btn ft-sb-btn" :class="{ active: state.ol }" title="有序列表" @click="toggle('ol')" v-html="icons.ol"></button>
    <button class="ft-btn ft-sb-btn" :class="{ active: state.ul }" title="无序列表" @click="toggle('ul')" v-html="icons.ul"></button>
    <button class="ft-btn ft-sb-btn" :class="{ active: state.task }" title="待办清单" @click="toggle('task')" v-html="icons.taskList"></button>
    <div class="ft-sb-sep"></div>
    <div class="ft-color-wrap">
      <button class="ft-btn ft-sb-btn ft-color-btn" :class="{ active: !!state.color }" :style="state.color ? { '--ft-color': state.color } : {}" title="文字颜色" @click.stop="paletteOpen = !paletteOpen" v-html="icons.textColor"></button>
      <Transition name="cpalette">
        <ColorPalette v-show="paletteOpen" :activeColor="state.color" @apply="applyColor" />
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { isMobile } from '../../utils.js'
import { useAppStore } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import { EditorManager } from '../../lib/editor.js'
import { I } from '../../config/icons.js'
import { saveGroupBody } from '../../composables/domain/useGroup.js'
import { useEditorFormat, PALETTE } from '../../composables/ui/useEditorFormat.js'
import { useMfbStore } from '../../stores/overlay.js'
import type { FormatKey } from '../../composables/ui/useEditorFormat.js'
import ColorPalette from './ColorPalette.vue'

const store = useAppStore()
const ui = useUIStore()
// A5-001：优先 uiStore 响应式布尔
const mobile = computed(() => ui.isMobile)

const injectedEditor = inject('tiptapEditor', ref(null))

const gid = computed(() => store.focusedGroupId)

const toolbarRef = ref<HTMLElement | null>(null)
const mfbColorBtnRef = ref<HTMLElement | null>(null)

const icons = { bold: I.bold, underline: I.underline, ol: I.ol, ul: I.ul, taskList: I.taskList, textColor: I.textColor }

function getEditor() {
  const focusGid = store.focusedGroupId || (document.activeElement as HTMLElement)?.closest?.('.group-body')?.getAttribute('data-gid') || undefined
  if (focusGid) return EditorManager.get(focusGid)
  return injectedEditor.value
}

const { fmt: state, colorOpen: paletteOpen, syncFmt: syncState, fmtToggle: _fmtToggle, applyColor: _applyColor } = useEditorFormat(getEditor)

const palette = PALETTE

function toggle(f: FormatKey) {
  _fmtToggle(f)
  const saveGid = store.focusedGroupId || (document.activeElement as HTMLElement)?.closest?.('.group-body')?.getAttribute('data-gid') || undefined
  if (saveGid) saveGroupBody(saveGid)
}

function applyColor(hex: string) { _applyColor(hex) }

function toggleMfbPalette() {
  paletteOpen.value = !paletteOpen.value
}

function onDocClick(e: MouseEvent) {
  // Desktop: close palette when clicking outside
  if (paletteOpen.value && toolbarRef.value && !toolbarRef.value.contains(e.target as Node)) {
    paletteOpen.value = false
  }
}
function _mfbOnDocTouch(e: TouchEvent) {
  if (!paletteOpen.value) return
  const mfb = document.querySelector('.mfb')
  if (mfb && !mfb.contains(e.target as Node)) paletteOpen.value = false
}

const isVisible = ref(false)
const kbBottom = ref(0)
let _showTimer: ReturnType<typeof setTimeout> | null = null

function updateViewport() {
  const vv = window.visualViewport
  if (!vv) return
  kbBottom.value = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
}

function show() {
  if (!mobile.value && !isMobile()) return
  hide()
  isVisible.value = true
  // A5-007：移动端同样挂 selectionUpdate，避免格式钮 active 与选区脱节
  _attachSync()
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewport)
    window.visualViewport.addEventListener('scroll', updateViewport)
  }
  requestAnimationFrame(() => updateViewport())
  if (_showTimer) clearTimeout(_showTimer)
  _showTimer = setTimeout(updateViewport, 300)
}

function hide() {
  isVisible.value = false
  kbBottom.value = 0
  paletteOpen.value = false
  _detachSync()
  if (_showTimer) { clearTimeout(_showTimer); _showTimer = null }
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', updateViewport)
    window.visualViewport.removeEventListener('scroll', updateViewport)
  }
}

let _fmtHandler: (() => void) | null = null
function _attachSync() {
  _detachSync()
  const ed = getEditor()
  if (!ed) return
  _fmtHandler = () => syncState()
  ed.on('selectionUpdate', _fmtHandler)
  syncState()
}
function _detachSync() {
  if (_fmtHandler) {
    const ed = getEditor()
    if (ed) ed.off('selectionUpdate', _fmtHandler)
    _fmtHandler = null
  }
}

// A5-007：桌面跟 gid；移动端由 show/hide 管 _attachSync，gid 变化时若 mfb 已开则重绑
watch(gid, (v) => {
  paletteOpen.value = false
  if (mobile.value) {
    const mfb = useMfbStore()
    if (mfb.open && v) _attachSync()
    else if (!v) _detachSync()
    return
  }
  if (v) _attachSync()
  else _detachSync()
}, { immediate: true })

function bindDesktop() {
  document.addEventListener('click', onDocClick, true)
}
function unbindDesktop() {
  document.removeEventListener('click', onDocClick, true)
}
// A5-002：不覆盖 mfbStore.show/hide，watch open 驱动本组件可见副作用
let _mfbWatchStop: (() => void) | null = null
function bindMobile() {
  document.addEventListener('touchstart', _mfbOnDocTouch, true)
  if (_mfbWatchStop) { _mfbWatchStop(); _mfbWatchStop = null }
  const mfb = useMfbStore()
  _mfbWatchStop = watch(() => mfb.open, (open) => {
    if (open) show()
    else hide()
  }, { immediate: true })
}
function unbindMobile() {
  document.removeEventListener('touchstart', _mfbOnDocTouch, true)
  if (_mfbWatchStop) { _mfbWatchStop(); _mfbWatchStop = null }
  hide()
}

// A5-001：断点变化时补绑/解绑 mfb 与桌面监听
watch(mobile, (m, prev) => {
  if (prev === undefined) return
  if (m) {
    unbindDesktop()
    _detachSync()
    bindMobile()
  } else {
    unbindMobile()
    bindDesktop()
    if (gid.value) _attachSync()
  }
})

onMounted(() => {
  if (mobile.value) bindMobile()
  else {
    bindDesktop()
    if (gid.value) _attachSync()
  }
})

onBeforeUnmount(() => {
  unbindDesktop()
  unbindMobile()
  _detachSync()
  hide()
})

defineExpose({ show, hide, syncState })
</script>
