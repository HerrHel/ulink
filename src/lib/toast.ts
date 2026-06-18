import { toastAPI } from '../composables/bridge.js'

interface BridgeToastAPI {
  toast(msg: string, ok?: boolean): void
  toastWithUndo(msg: string, undoFn: () => void, duration?: number): void
  showConfirm(msg: string, onConfirm: () => void): void
}

const api = toastAPI as unknown as BridgeToastAPI | null

export function toast(msg: string, ok = true): void {
  api?.toast(msg, ok)
}

export function toastWithUndo(msg: string, undoFn: () => void, duration = 6000): void {
  api?.toastWithUndo(msg, undoFn, duration)
}

export function showConfirm(msg: string, onConfirm: () => void): void {
  api?.showConfirm(msg, onConfirm)
}