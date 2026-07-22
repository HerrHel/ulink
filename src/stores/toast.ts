/**
 * toast.ts — Toast / Confirm / Undo / Choice 状态 Store
 *
 * 替代 bridge.ts toastAPI 服务定位器模式。
 * 所有 toast 操作通过 Pinia action 调用，消除模块级可变状态。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { TOAST_FADE_MS, TOAST_REMOVE_MS } from '../config/constants.js'

interface ToastItem {
  id: number
  ok: boolean
  msg: string
  opacity: string
  transform: string
  transition: string
}

interface UndoToast {
  msg: string
  undoFn: () => void
  countdown: number
  cls: string
}

interface ChoiceOption {
  id: string
  label: string
  description?: string
}

interface ChoiceDialog {
  message: string
  options: ChoiceOption[]
  cancelLabel?: string
}

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<ToastItem[]>([])
  const undoToast = ref<UndoToast | null>(null)
  const confirmOpen = ref(false)
  const confirmMessage = ref('')
  const choiceOpen = ref(false)
  const choiceDialog = ref<ChoiceDialog | null>(null)

  let toastIdCounter = 0
  let _confirmResolve: ((value: boolean) => void) | null = null
  let _choiceResolve: ((value: string | null) => void) | null = null
  let _dismissTimer: ReturnType<typeof setTimeout> | null = null
  let _countdownTimer: ReturnType<typeof setInterval> | null = null
  let _undoGeneration = 0

  // ── Toast ──

  function show(msg: string, ok = true) {
    const id = ++toastIdCounter
    const item: ToastItem = {
      id, ok, msg,
      opacity: '1', transform: '', transition: '',
    }
    toasts.value.push(item)

    setTimeout(() => {
      item.opacity = '0'
      item.transform = 'translateX(30px)'
      item.transition = 'all 0.25s ease-in'
    }, TOAST_FADE_MS)

    setTimeout(() => {
      const idx = toasts.value.findIndex(t => t.id === id)
      if (idx !== -1) toasts.value.splice(idx, 1)
    }, TOAST_REMOVE_MS)
  }

  // ── Undo Toast ──

  function showWithUndo(msg: string, undoFn: () => void, duration = 6000) {
    dismissUndo()

    const gen = ++_undoGeneration
    undoToast.value = {
      msg,
      undoFn,
      countdown: Math.ceil(duration / 1000),
      cls: '',
    }

    setTimeout(() => {
      if (undoToast.value && gen === _undoGeneration) {
        undoToast.value.cls = 'undo-toast-in'
      }
    }, 10)

    let remaining = duration
    _countdownTimer = setInterval(() => {
      remaining -= 1000
      if (gen !== _undoGeneration) {
        if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null }
        return
      }
      if (undoToast.value && remaining > 0) {
        undoToast.value.countdown = Math.ceil(remaining / 1000)
      }
    }, 1000)

    _dismissTimer = setTimeout(() => {
      if (gen === _undoGeneration) dismissUndo()
    }, duration)
  }

  function dismissUndo() {
    if (_countdownTimer) {
      clearInterval(_countdownTimer)
      _countdownTimer = null
    }
    if (_dismissTimer) {
      clearTimeout(_dismissTimer)
      _dismissTimer = null
    }
    if (undoToast.value) {
      undoToast.value.cls = 'undo-toast-out'
      // 动画 300ms 后清除 DOM —— 必须赋给 _dismissTimer 受管，否则下次
      // showWithUndo → dismissUndo 清不掉此 timer：新 toast 设完后 300ms 旧 timer
      // fire 把 undoToast.value = null，连新 toast 一并清掉（B-13 根因）。
      _dismissTimer = setTimeout(() => {
        _dismissTimer = null
        undoToast.value = null
      }, 300)
    }
  }

  // ── Confirm Dialog ──

  function showConfirm(msg: string): Promise<boolean> {
    confirmMessage.value = msg
    confirmOpen.value = true

    return new Promise((resolve) => {
      // 若已有挂起的 confirm 则先拒绝
      if (_confirmResolve) _confirmResolve(false)
      _confirmResolve = resolve
    })
  }

  function resolveConfirm(confirmed: boolean) {
    confirmOpen.value = false
    if (_confirmResolve) {
      _confirmResolve(confirmed)
      _confirmResolve = null
    }
  }

  function onConfirmOpenChange(open: boolean) {
    confirmOpen.value = open
    if (!open && _confirmResolve) {
      _confirmResolve(false)
      _confirmResolve = null
    }
  }

  // ── Choice Dialog ──

  function showChoice(message: string, options: ChoiceOption[], cancelLabel = '取消'): Promise<string | null> {
    choiceDialog.value = { message, options, cancelLabel }
    choiceOpen.value = true

    return new Promise((resolve) => {
      // 若已有挂起的 choice 则先取消
      if (_choiceResolve) _choiceResolve(null)
      _choiceResolve = resolve
    })
  }

  function resolveChoice(optionId: string | null) {
    choiceOpen.value = false
    if (_choiceResolve) {
      _choiceResolve(optionId)
      _choiceResolve = null
    }
  }

  function onChoiceOpenChange(open: boolean) {
    choiceOpen.value = open
    if (!open && _choiceResolve) {
      _choiceResolve(null)
      _choiceResolve = null
    }
  }

  return {
    toasts, undoToast, confirmOpen, confirmMessage, choiceOpen, choiceDialog,
    show, showWithUndo, dismissUndo,
    showConfirm, resolveConfirm, onConfirmOpenChange,
    showChoice, resolveChoice, onChoiceOpenChange,
  }
})
