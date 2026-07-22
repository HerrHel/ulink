/**
 * toast.ts — Toast / Confirm / Choice 快捷入口
 *
 * 简洁的同步函数签名，内部委托至 useToastStore。
 * 调用方无需在 setup 内使用 useToastStore()。
 */
import { useToastStore } from '../stores/toast.js'

export function toast(msg: string, ok = true): void {
  try { useToastStore().show(msg, ok) } catch { /* Pinia 未初始化 */ }
}

export function toastWithUndo(msg: string, undoFn: () => void, duration = 6000): void {
  try { useToastStore().showWithUndo(msg, undoFn, duration) } catch { /* Pinia 未初始化 */ }
}

export function showConfirm(msg: string): Promise<boolean> {
  try { return useToastStore().showConfirm(msg) } catch { return Promise.resolve(false) }
}

export function showChoice(message: string, options: Array<{ id: string; label: string; description?: string }>, cancelLabel = '取消'): Promise<string | null> {
  try { return useToastStore().showChoice(message, options, cancelLabel) } catch { return Promise.resolve(null) }
}
