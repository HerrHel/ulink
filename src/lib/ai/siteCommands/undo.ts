/**
 * siteCommands/undo.ts — 指令块 13：对话式撤销 (/undo, 撤销操作, 恢复原样)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：parseUndoIntent 命中后三条路径均返回（「停止生成」中止前置校验 → 返回空回复；
 * 撤销事务栈有值 → 执行 revert 后返回；栈空则尝试全局 undoToast → 有则触发后返回，
 * 无则返回无可撤销）。命中前无副作用，未命中 → 返回 null 继续 fall-through。
 * 注意：popUndoAction 会改状态，故 signal 中止校验必须前置（与原实现一致）。
 */

import { parseUndoIntent } from '../siteIntents.js'
import { popUndoAction, getUndoStackDepth } from '../siteUndoStack.js'
import { useToastStore } from '../../../stores/toast.js'
import { t, tN } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 13. 对话式撤销 (/undo, 撤销操作, 恢复原样) ──
export const undoBlock: SiteCommandBlock = async (
  ctx: SiteCommandBlockCtx,
): Promise<SiteCommandResult | null> => {
  const query = ctx.query
  if (parseUndoIntent(query)) {
    // 「停止生成」后不再执行撤销副作用（popUndoAction 会改状态，必须前置校验）
    if (ctx.signal?.aborted) {
      return { handled: true, action: 'undo', success: false, reply: '' }
    }
    const actionToRevert = popUndoAction()
    if (actionToRevert) {
      const msg = await actionToRevert.revert()
      const remaining = getUndoStackDepth()
      const suffix = remaining > 0 ? tN('aiCmd.undoRemaining', remaining) : ''
      return {
        handled: true,
        action: 'undo',
        success: true,
        steps: [{ text: t('aiCmd.stepRevertAction', { desc: actionToRevert.description }), done: true }],
        reply: `${msg}${suffix}`,
      }
    }

    try {
      const toastStore = useToastStore()
      if (toastStore.undoToast) {
        const msg = toastStore.undoToast.msg
        toastStore.undoToast.undoFn()
        toastStore.dismissUndo()
        return {
          handled: true,
          action: 'undo',
          success: true,
          steps: [{ text: t('aiCmd.stepGlobalUndo'), done: true }],
          reply: t('aiCmd.undoGlobalDone', { msg }),
        }
      }
    } catch {
      // Pinia 未初始化
    }

    return {
      handled: true,
      action: 'undo',
      success: false,
      reply: t('aiCmd.undoNone'),
    }
  }

  return null
}
