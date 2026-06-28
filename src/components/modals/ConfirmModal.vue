<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="确认操作" :class="{ open: store.confirmModalOpen }" @click.self="onCancel">
    <div class="modal modal-sm">
      <div class="modal-body modal-body-center">
        <div class="confirm-msg">{{ store.confirmModalMessage }}</div>
      </div>
      <div class="modal-foot confirm-foot">
        <button class="btn btn-secondary" @click="onCancel">取消</button>
        <button class="btn btn-danger" @click="onOk">确认</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { watch, nextTick, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { getAndClearConfirmCallback } from '../../composables/_confirmState.js'
const store = useAppStore()

function onOk() {
  const cb = getAndClearConfirmCallback()
  store.confirmModalOpen = false
  if (cb) cb()
}
function onCancel() {
  getAndClearConfirmCallback()
  store.confirmModalOpen = false
}

function onKeydown(e: KeyboardEvent) {
  if (!store.confirmModalOpen) return
  if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  if (e.key === 'Enter') { e.preventDefault(); onOk() }
}

watch(() => store.confirmModalOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown)
    nextTick(() => {
      const btn = document.querySelector('.confirm-foot .btn-danger') as HTMLElement
      btn?.focus()
    })
  } else {
    document.removeEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>
