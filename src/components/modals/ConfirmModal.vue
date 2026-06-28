<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="确认操作" :class="{ open: store.confirmOpen }" @click.self="store.resolveConfirm(false)">
    <div class="modal modal-sm">
      <div class="modal-body modal-body-center">
        <div class="confirm-msg">{{ store.confirmMessage }}</div>
      </div>
      <div class="modal-foot confirm-foot">
        <button class="btn btn-secondary" @click="store.resolveConfirm(false)">取消</button>
        <button class="btn btn-danger" @click="store.resolveConfirm(true)">确认</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, onUnmounted, nextTick } from 'vue'
import { useToastStore } from '../../stores/toast.js'

const store = useToastStore()

function onKeydown(e: KeyboardEvent) {
  if (!store.confirmOpen) return
  if (e.key === 'Escape') { e.preventDefault(); store.resolveConfirm(false) }
  if (e.key === 'Enter') { e.preventDefault(); store.resolveConfirm(true) }
}

watch(() => store.confirmOpen, (open) => {
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
