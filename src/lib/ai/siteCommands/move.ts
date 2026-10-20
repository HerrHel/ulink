/**
 * siteCommands/move.ts — 指令块 11：批量整理未分类 (/move uncategorized <分类名>)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：targetCategoryRaw 真值后，分类不存在 → 返回失败；无未分类 → 返回空结果；
 * 数量 > 5 经 HITL 二次确认（确认后经 ctx.signal 校验「停止生成」，取消/中止均返回）；
 * 确认通过 → 批量移动、撤销入栈后返回成功。intent 未命中或 targetCategoryRaw 为空 →
 * 返回 null 继续 fall-through（该 fall-through 路径无任何副作用）。
 */

import { parseMoveIntent } from '../siteIntents.js'
import { askConfirm, buildMoveConfirmMessage } from '../siteHitl.js'
import { isOfficialBookmark } from '../localClustering.js'
import { CAT_UNCATEGORIZED } from '../../../config/constants.js'
import { pushUndoAction } from '../siteUndoStack.js'
import { t, tN } from '../../../i18n/index.js'
import type { Category } from '../../../types.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 11. 批量整理未分类 (/move uncategorized <分类名>, 把未分类移动到 [分类名]) ──
export const moveBlock: SiteCommandBlock = async (
  ctx: SiteCommandBlockCtx,
): Promise<SiteCommandResult | null> => {
  const query = ctx.query
  const ds = ctx.ds
  const app = ctx.app
  const moveIntent = parseMoveIntent(query)
  const targetCategoryRaw = moveIntent ? moveIntent.targetCategoryRaw : null

  if (targetCategoryRaw) {
    const targetCat = ds.categories.find(
      (c: Category) =>
        !c.deletedAt &&
        (c.name === targetCategoryRaw || c.name.toLowerCase() === targetCategoryRaw.toLowerCase()),
    )
    if (!targetCat) {
      return {
        handled: true,
        action: 'move_uncategorized',
        success: false,
        reply: t('aiCmd.moveCatNotFound', { name: targetCategoryRaw }),
      }
    }

    const uncatBms = ds.bookmarks.filter(
      (b) =>
        !b.deletedAt &&
        (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) &&
        !b.parentId &&
        !isOfficialBookmark(b),
    )

    if (uncatBms.length === 0) {
      return {
        handled: true,
        action: 'move_uncategorized',
        success: true,
        reply: t('aiCmd.moveNone'),
      }
    }

    // 若未分类数量较大（例如 > 5 个），进行二次确认保护
    if (uncatBms.length > 5) {
      const confirmed = await askConfirm(
        buildMoveConfirmMessage(uncatBms.length, targetCat.name),
      )
      if (ctx.signal?.aborted) {
        return { handled: true, action: 'move_uncategorized', success: false, reply: '' }
      }
      if (!confirmed) {
        return {
          handled: true,
          action: 'move_uncategorized',
          success: false,
          steps: [{ text: t('aiCmd.stepUserCancelMove'), done: true }],
          reply: t('aiCmd.moveCancelled'),
        }
      }
    }

    const previousMap = uncatBms.map((b) => ({ id: b.id, prevCatId: b.categoryId }))
    for (const b of uncatBms) {
      ds.updateBookmark(b.id, { categoryId: targetCat.id })
    }
    app.save()

    pushUndoAction({
      type: 'move_uncategorized',
      description: tN('aiCmd.undoMoveUncatDesc', uncatBms.length, { cat: targetCat.name }),
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
      action: 'move_uncategorized',
      success: true,
      steps: [
        { text: tN('aiCmd.stepFilterUncat', uncatBms.length), done: true },
        { text: t('aiCmd.stepMoveUncat', { cat: targetCat.name }), done: true },
      ],
      reply: tN('aiCmd.moveDone', uncatBms.length, { cat: targetCat.name }),
    }
  }

  return null
}
