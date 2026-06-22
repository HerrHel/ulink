<template>
  <div class="toasts" id="toasts">
    <div v-for="t in toasts" :key="t.id" 
         :class="['toast', t.ok ? 'ok' : 'err']"
         v-html="t.html"
         :style="{ opacity: t.opacity, transform: t.transform, transition: t.transition || '' }">
    </div>
  </div>
  
  <div v-if="undoToast" class="undo-toast" :class="undoToast.cls">
    <span class="undo-toast-msg">{{ undoToast.msg }}</span>
    <button class="undo-toast-btn undo-toast-undo" @click="onUndoClick">撤回</button>
    <button class="undo-toast-btn undo-toast-confirm" @click="onConfirmClick">确认</button>
    <span class="undo-toast-countdown">{{ undoToast.countdown }}s</span>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { setToastAPI } from '../../composables/bridge.js'
import { I } from '../../config/icons.js'
import { TOAST_FADE_MS, TOAST_REMOVE_MS } from '../../config/constants.js'
import { esc } from '../../utils.js'

const store = useAppStore()
const toasts = ref([])
const undoToast = ref(null)
let toastIdCounter = 0

function _toastImpl(msg, ok = true) {
  const id = ++toastIdCounter
  const html = (ok ? I.external : I.trash) + esc(msg)
  const toastItem = { id, ok, html, opacity: '1', transform: '', transition: '' }
  toasts.value.push(toastItem)
  
  setTimeout(() => {
    toastItem.opacity = '0'
    toastItem.transform = 'translateX(30px)'
    toastItem.transition = 'all 0.25s ease-in'
  }, TOAST_FADE_MS)
  
  setTimeout(() => {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }, TOAST_REMOVE_MS)
}

let dismissTimer = null
let countdownTimer = null
let _undoGeneration = 0

function _toastWithUndoImpl(msg, undoFn, duration = 6000) {
  dismissToast()

  const gen = ++_undoGeneration
  undoToast.value = {
    msg,
    undoFn,
    countdown: Math.ceil(duration / 1000),
    cls: ''
  }

  setTimeout(() => {
    if (undoToast.value && gen === _undoGeneration) undoToast.value.cls = 'undo-toast-in'
  }, 10)

  let remaining = duration
  countdownTimer = setInterval(() => {
    remaining -= 1000
    if (gen !== _undoGeneration) { clearInterval(countdownTimer); countdownTimer = null; return }
    if (undoToast.value && remaining > 0) {
      undoToast.value.countdown = Math.ceil(remaining / 1000)
    }
  }, 1000)

  dismissTimer = setTimeout(() => {
    if (gen === _undoGeneration) dismissToast()
  }, duration)
}

function dismissToast() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = null
  }
  if (undoToast.value) {
    undoToast.value.cls = 'undo-toast-out'
    setTimeout(() => {
      undoToast.value = null
    }, 300)
  }
}

function _showConfirmImpl(msg, onConfirm) {
  store.confirmModalMessage = msg
  store.confirmModalCallback = onConfirm
  store.confirmModalOpen = true
}

function onUndoClick() {
  if (undoToast.value?.undoFn) {
    undoToast.value.undoFn()
  }
  dismissToast()
}

function onConfirmClick() {
  dismissToast()
}

onMounted(() => {
  setToastAPI({ toast: _toastImpl, toastWithUndo: _toastWithUndoImpl, showConfirm: _showConfirmImpl })
})

onUnmounted(() => {
  setToastAPI(null)
  dismissToast()
})
</script>