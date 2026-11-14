<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('modal.confirm.ariaLabel')" :class="{ open: store.confirmOpen }" @mousedown="onMaskMouseDown" @click="onMaskClick">
    <div class="modal modal-sm" ref="dialogRef">
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
import { ref, watch, onUnmounted, nextTick } from 'vue'
import { useToastStore } from '../../stores/toast.js'
import { t } from '../../i18n/index.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'

const store = useToastStore()
const dialogRef = ref<HTMLElement | null>(null)

function onKeydown(e: KeyboardEvent) {
  if (!store.confirmOpen) return
  // 根因：全局 keydown 在 document 冒泡阶段先注册，同元素 stopPropagation 拦不住它，
  // 一次 Esc 会连带关闭底层编辑弹窗丢失未保存内容。改用 capture 抢占捕获阶段 +
  // stopImmediatePropagation 彻底阻断后续（含全局）监听，交还本弹窗自处理。
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); store.resolveConfirm(false) }
  if (e.key === 'Enter') {
    // 焦点归属：仅当焦点仍在本 confirm 弹窗内时才确认。多层弹窗下焦点可能逃到
    // 背景，此时 Enter 在 capture 阶段会被误判为「确认危险删除」。
    if (!dialogRef.value?.contains(document.activeElement)) return
    e.preventDefault(); e.stopImmediatePropagation(); store.resolveConfirm(true)
  }
}

watch(() => store.confirmOpen, (open) => {
  if (open) {
    document.addEventListener('keydown', onKeydown, { capture: true })
    nextTick(() => {
      const btn = document.querySelector('.confirm-foot .btn-danger') as HTMLElement
      btn?.focus()
    })
  } else {
    document.removeEventListener('keydown', onKeydown, { capture: true })
  }
})

onUnmounted(() => document.removeEventListener('keydown', onKeydown, { capture: true }))

// 遮罩关闭统一走 useMaskClose：只有「在遮罩上按下、又在遮罩上松开」才算点击外部。
// 裸 @click.self 的坑：在弹窗内按下、滑到遮罩上松开时，click 事件的 target 是两者的
// 共同祖先（遮罩），.self 判定照样通过 -> 误关闭，正在填的内容全丢。
const { onMaskMouseDown, onMaskClick } = useMaskClose(() => store.resolveConfirm(false))
</script>
