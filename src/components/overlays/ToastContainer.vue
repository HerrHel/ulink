<template>
  <div class="toasts" id="toasts" role="status" aria-live="polite">
    <div v-for="t in store.toasts" :key="t.id"
         :class="['toast', t.ok ? 'ok' : 'err']"
         :style="{ opacity: t.opacity, transform: t.transform, transition: t.transition || '' }">
      <span aria-hidden="true" v-html="t.ok ? I.external : I.trash" class="toast-icon"></span>
      <span v-text="t.msg"></span>
    </div>
  </div>

  <div v-if="store.undoToast" class="undo-toast" :class="store.undoToast.cls" role="status" aria-live="polite">
    <span class="undo-toast-msg">{{ store.undoToast.msg }}</span>
    <button class="undo-toast-btn undo-toast-undo" @click="onUndoClick">撤回</button>
    <button class="undo-toast-btn undo-toast-confirm" @click="store.dismissUndo()">确认</button>
    <span class="undo-toast-countdown">{{ store.undoToast.countdown }}s</span>
  </div>
</template>

<script setup lang="ts">
import { useToastStore } from '../../stores/toast.js'
import { I } from '../../config/icons.js'

const store = useToastStore()

function onUndoClick() {
  if (store.undoToast?.undoFn) {
    store.undoToast.undoFn()
  }
  store.dismissUndo()
}
</script>
