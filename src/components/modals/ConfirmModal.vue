<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="Confirm" :class="{ open: store.confirmModalOpen }" @click.self="onCancel">
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
<script setup>
import { useAppStore } from '../../stores/app.js'
const store = useAppStore()

function onOk() {
  const cb = store.confirmModalCallback
  store.confirmModalOpen = false
  store.confirmModalCallback = null
  if (cb) cb()
}
function onCancel() {
  store.confirmModalOpen = false
  store.confirmModalCallback = null
}
</script>
