/**
 * siteCommands/batchMove.ts — 指令块 10：上下文感知批量移动选中书签
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：守卫（intent 命中且 batchMode 开启且有选中）通过后，分类不存在 → 返回失败；
 * movedCount > 0 → 撤销入栈后返回成功；其余两条 fall-through（intent 未命中/守卫不满足、
 * 守卫通过但 movedCount === 0）→ 返回 null 继续 fall-through。
 * 两条 fall-through 路径均无任何副作用：守卫前仅有纯解析，movedCount === 0 时循环内
 * updateBookmark 仅在 bm && !bm.deletedAt 分支调用（与 movedCount++ 同分支），save/清空
 * batchSelected/撤销入栈全部收在 if (movedCount > 0) 内。
 */

import { parseBatchMoveIntent } from '../siteIntents.js'
import { pushUndoAction } from '../siteUndoStack.js'
import { t, tN } from '../../../i18n/index.js'
import type { Category } from '../../../types.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 10. 上下文感知：批量移动选中的书签 ──
export const batchMoveBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ds = ctx.ds
  const ui = ctx.ui
  const app = ctx.app
  const batchMoveIntent = parseBatchMoveIntent(query)
  if (batchMoveIntent && ui.batchMode && ui.batchSelected && ui.batchSelected.length > 0) {
    const targetName = batchMoveIntent.targetName
    const targetCat = ds.categories.find(
      (c: Category) =>
        !c.deletedAt &&
        (c.name === targetName || c.name.toLowerCase() === targetName.toLowerCase()),
    )
    if (!targetCat) {
      return {
        handled: true,
        action: 'batch_move',
        success: false,
        reply: t('aiCmd.batchMoveCatNotFound', { name: targetName }),
      }
    }

    const selectedIds = [...ui.batchSelected]
    const previousMap: Array<{ id: string; prevCatId?: string }> = []
    let movedCount = 0

    for (const id of selectedIds) {
      const bm = ds.bookmarkMap[id]
      if (bm && !bm.deletedAt) {
        previousMap.push({ id, prevCatId: bm.categoryId })
        ds.updateBookmark(id, { categoryId: targetCat.id })
        movedCount++
      }
    }

    if (movedCount > 0) {
      app.save()
      ui.batchMode = false
      ui.batchSelected = []

      pushUndoAction({
        type: 'batch_move',
        description: tN('aiCmd.undoBatchMoveDesc', movedCount, { cat: targetCat.name }),
        revert: () => {
          for (const item of previousMap) {
            ds.updateBookmark(item.id, { categoryId: item.prevCatId })
          }
          app.save()
          return tN('aiCmd.undoMoveRevert', previousMap.length)
        },
      })

      return {
        handled: true,
        action: 'batch_move',
        success: true,
        steps: [
          { text: tN('aiCmd.stepBatchDetected', movedCount), done: true },
          { text: t('aiCmd.stepBatchMove', { cat: targetCat.name }), done: true },
        ],
        reply: tN('aiCmd.batchMoveDone', movedCount, { cat: targetCat.name }),
      }
    }
  }

  return null
}
