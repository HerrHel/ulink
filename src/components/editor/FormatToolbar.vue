<template>
  <template v-if="isMobile">
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
        <button class="mfb-color-reset" @click="applyColor(null)">默认</button>
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

<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { isMobile } from '../../utils.js'
import { useAppStore } from '../../stores/app.js'
import { EditorManager } from '../../lib/editor.js'
import { I } from '../../config/icons.js'
import { saveGroupBody } from '../../composables/domain/useGroup.js'
import { setMfbAPI } from '../../composables/bridge.js'
import { useEditorFormat, PALETTE } from '../../composables/ui/useEditorFormat.js'
import ColorPalette from './ColorPalette.vue'

const store = useAppStore()

const injectedEditor = inject('tiptapEditor', ref(null))

const gid = computed(() => store.focusedGroupId)

const toolbarRef = ref(null)
const mfbColorBtnRef = ref(null)

const icons = { bold: I.bold, underline: I.underline, ol: I.ol, ul: I.ul, taskList: I.taskList, textColor: I.textColor }

function getEditor() {
  const focusGid = store.focusedGroupId || document.activeElement?.closest?.('.group-body')?.dataset?.gid
  if (focusGid) return EditorManager.get(focusGid)
  return injectedEditor.value
}

const { fmt: state, colorOpen: paletteOpen, syncFmt: syncState, fmtToggle: _fmtToggle, applyColor: _applyColor } = useEditorFormat(getEditor)

const palette = PALETTE

function toggle(f) {
  _fmtToggle(f)
  const saveGid = store.focusedGroupId || document.activeElement?.closest?.('.group-body')?.dataset?.gid
  if (saveGid) saveGroupBody(saveGid)
}

function applyColor(hex) { _applyColor(hex) }

function toggleMfbPalette() {
  paletteOpen.value = !paletteOpen.value
}

function onDocClick(e) {
  // Desktop: close palette when clicking outside
  if (paletteOpen.value && toolbarRef.value && !toolbarRef.value.contains(e.target)) {
    paletteOpen.value = false
  }
}
function _mfbOnDocTouch(e) {
  if (!paletteOpen.value) return
  const mfb = document.querySelector('.mfb')
  if (mfb && !mfb.contains(e.target)) paletteOpen.value = false
}

const isVisible = ref(false)
const kbBottom = ref(0)
let _showTimer = null

function updateViewport() {
  const vv = window.visualViewport
  if (!vv) return
  kbBottom.value = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
}

function show() {
  if (!isMobile()) return
  isVisible.value = true
  syncState()
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
  if (_showTimer) { clearTimeout(_showTimer); _showTimer = null }
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', updateViewport)
    window.visualViewport.removeEventListener('scroll', updateViewport)
  }
}

let _fmtHandler = null
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

watch(gid, (v, old) => {
  if (isMobile()) return
  paletteOpen.value = false
  if (v) _attachSync()
  else _detachSync()
}, { immediate: true })

onMounted(() => {
  if (!isMobile()) {
    document.addEventListener('click', onDocClick, true)
  } else {
    document.addEventListener('touchstart', _mfbOnDocTouch, true)
    setMfbAPI({ show, hide })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('touchstart', _mfbOnDocTouch, true)
  _detachSync()
  if (isMobile()) { hide(); setMfbAPI(null) }
})

defineExpose({ show, hide, syncState })
</script>
