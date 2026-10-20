/**
 * siteCommands/trash.ts — 指令块 5：回收站管理 (/trash, 清空回收站, 打开回收站)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：'clear' 分支 4 条路径均返回（空回收站/中止/取消/清空完成，HITL 二次确认后经
 * ctx.signal 校验「停止生成」）；'open' 分支置面板后返回；trashIntent 为 null → 返回 null
 * 继续 fall-through（该 fall-through 路径无任何副作用）。
 */

import { parseTrashIntent } from '../siteIntents.js'
import {
  askConfirm,
  buildTrashClearConfirmMessage,
  buildTrashActionCard,
} from '../siteHitl.js'
import { t, tN } from '../../../i18n/index.js'
import type { Category } from '../../../types.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 5. 回收站管理 (/trash, 清空回收站, 打开回收站) ──
export const trashBlock: SiteCommandBlock = async (
  ctx: SiteCommandBlockCtx,
): Promise<SiteCommandResult | null> => {
  const query = ctx.query
  const ds = ctx.ds
  const ui = ctx.ui
  const app = ctx.app
  const trashIntent = parseTrashIntent(query)
  if (trashIntent === 'clear') {
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats
    if (total === 0) {
      return {
        handled: true,
        action: 'trash_clear',
        steps: [{ text: t('aiCmd.stepCheckTrash'), done: true }],
        reply: t('aiCmd.trashEmpty'),
      }
    }

    // Agent 危险操作人机确认 (Human-in-the-Loop)
    const confirmed = await askConfirm(buildTrashClearConfirmMessage(total, bms, grps, cats))
    if (ctx.signal?.aborted) {
      return { handled: true, action: 'trash_clear', success: false, reply: '' }
    }
    if (!confirmed) {
      return {
        handled: true,
        action: 'trash_clear',
        success: false,
        steps: [{ text: t('aiCmd.stepUserCancelTrash'), done: true }],
        reply: t('aiCmd.trashClearCancelled'),
      }
    }

    ds.emptyTrash()
    app.save()
    return {
      handled: true,
      action: 'trash_clear',
      steps: [
        { text: tN('aiCmd.stepVerifyTrash', total), done: true },
        { text: t('aiCmd.stepHitlPassed'), done: true },
        { text: t('aiCmd.stepDoEmptyTrash'), done: true },
      ],
      reply: tN('aiCmd.trashCleared', total, { total, bm: bms, grp: grps, cat: cats }),
    }
  }

  if (trashIntent === 'open') {
    ui.panels.trash = true
    const bms = ds.bookmarks.filter((b) => b.deletedAt).length
    const grps = ds.siblingGroups.filter((g) => g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => c.deletedAt).length
    const total = bms + grps + cats

    return {
      handled: true,
      action: 'trash_open',
      steps: [{ text: t('aiCmd.stepOpenTrash'), done: true }],
      actionCard:
        total > 0
          ? buildTrashActionCard({ total, bm: bms, grp: grps })
          : undefined,
      reply: total > 0 ? tN('aiCmd.trashOpened', total) : t('aiCmd.trashOpenedEmpty'),
    }
  }

  return null
}
