<template>
  <div class="toasts" id="toasts">
    <div v-for="t in store.toasts" :key="t.id"
         :class="['toast', t.ok ? 'ok' : 'err']"
         v-html="t.html"
         :style="{ opacity: t.opacity, transform: t.transform, transition: t.transition || '' }">
    </div>
  </div>

  <div v-if="store.undoToast" class="undo-toast" :class="store.undoToast.cls">
    <span class="undo-toast-msg">{{ store.undoToast.msg }}</span>
    <button class="undo-toast-btn undo-toast-undo" @click="onUndoClick">撤回</button>
    <button class="undo-toast-btn undo-toast-confirm" @click="store.dismissUndo()">确认</button>
    <span class="undo-toast-countdown">{{ store.undoToast.countdown }}s</span>
  </div>
</template>

<script setup lang="ts">
import { useToastStore } from '../../stores/toast.js'

const store = useToastStore()

function onUndoClick() {
  if (store.undoToast?.undoFn) {
    store.undoToast.undoFn()
  }
  store.dismissUndo()
}
</script>
