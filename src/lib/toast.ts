import { toastAPI } from '../composables/bridge.js'

export function toast(msg: string, ok = true): void {
  toastAPI?.toast(msg, ok)
}

export function toastWithUndo(msg: string, undoFn: () => void, duration = 6000): void {
  toastAPI?.toastWithUndo(msg, undoFn, duration)
}

export function showConfirm(msg: string, onConfirm: () => void): void {
  toastAPI?.showConfirm(msg, onConfirm)
}