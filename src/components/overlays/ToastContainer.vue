<template>
  <div class="toasts" id="toasts" role="status" aria-live="polite">
    <div v-for="toast in store.toasts" :key="toast.id"
         :class="['toast', toast.ok ? 'ok' : 'err']"
         :style="{ opacity: toast.opacity, transform: toast.transform, transition: toast.transition || '' }">
      <span aria-hidden="true" v-html="toast.ok ? I.external : I.trash" class="toast-icon"></span>
      <span v-text="toast.msg"></span>
    </div>
  </div>

  <div v-if="store.undoToast" class="undo-toast" :class="store.undoToast.cls" role="status" aria-live="polite">
    <span class="undo-toast-msg">{{ store.undoToast.msg }}</span>
    <button class="undo-toast-btn undo-toast-undo" @click="onUndoClick">{{ t('toast.undo') }}</button>
    <button class="undo-toast-btn undo-toast-confirm" @click="store.dismissUndo()">{{ t('common.confirm') }}</button>
    <span class="undo-toast-countdown">{{ store.undoToast.countdown }}s</span>
  </div>
</template>

<script setup lang="ts">
import { useToastStore } from '../../stores/toast.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'

const store = useToastStore()

function onUndoClick() {
  if (store.undoToast?.undoFn) {
    store.undoToast.undoFn()
  }
  store.dismissUndo()
}
</script>
