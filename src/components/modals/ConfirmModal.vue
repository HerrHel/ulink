<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('modal.confirm.ariaLabel')" :class="{ open: store.confirmOpen }" @mousedown="onMaskMouseDown" @click="onMaskClick">
    <div class="modal modal-sm">
      <div class="modal-body modal-body-center">
        <div class="confirm-msg">{{ store.confirmMessage }}</div>
      </div>
      <div class="modal-foot confirm-foot">
        <button class="btn btn-secondary" @click="store.resolveConfirm(false)">{{ t('common.cancel') }}</button>
        <button class="btn btn-danger" @click="store.resolveConfirm(true)">{{ t('common.confirm') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, onUnmounted, nextTick } from 'vue'
import { useToastStore } from '../../stores/toast.js'
import { t } from '../../i18n/index.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'

const store = useToastStore()

function onKeydown(e: KeyboardEvent) {
  if (!store.confirmOpen) return
  // A2-001：stopPropagation 防止全局 Esc 连带关闭底层 Category/Attribute 等模态
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); store.resolveConfirm(false) }
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); store.resolveConfirm(true) }
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

// 遮罩关闭统一走 useMaskClose：只有「在遮罩上按下、又在遮罩上松开」才算点击外部。
// 裸 @click.self 的坑：在弹窗内按下、滑到遮罩上松开时，click 事件的 target 是两者的
// 共同祖先（遮罩），.self 判定照样通过 -> 误关闭，正在填的内容全丢。
const { onMaskMouseDown, onMaskClick } = useMaskClose(() => store.resolveConfirm(false))
</script>
