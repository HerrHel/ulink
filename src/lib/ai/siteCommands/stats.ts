/**
 * siteCommands/stats.ts — 指令块 9：全库统计 (/stats, 书签统计)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseStatsIntent → 返回统计报告；未命中 → 返回 null 继续 fall-through。
 */

import { parseStatsIntent } from '../siteIntents.js'
import { CAT_UNCATEGORIZED } from '../../../config/constants.js'
import { t } from '../../../i18n/index.js'
import type { Category } from '../../../types.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 9. 全库统计 (/stats, 书签统计) ──
export const statsBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ds = ctx.ds
  if (parseStatsIntent(query)) {
    const topBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    const subBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && b.parentId).length
    const groups = ds.siblingGroups.filter((g) => !g.deletedAt).length
    const cats = ds.categories.filter((c: Category) => !c.deletedAt).length
    const uncat = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    const trashTotal =
      ds.bookmarks.filter((b) => b.deletedAt).length +
      ds.siblingGroups.filter((g) => g.deletedAt).length +
      ds.categories.filter((c: Category) => c.deletedAt).length

    const reply = [
      t('aiCmd.statsTitle'),
      '',
      t('aiCmd.statsTop', { n: topBookmarks }),
      t('aiCmd.statsSub', { n: subBookmarks }),
      t('aiCmd.statsGroups', { n: groups }),
      t('aiCmd.statsCats', { n: cats }),
      t('aiCmd.statsUncat', { n: uncat }),
      t('aiCmd.statsTrash', { n: trashTotal }),
      '',
      t('aiCmd.statsTidiness') +
        (uncat === 0 && trashTotal === 0 ? t('aiCmd.statsTidinessGood') : t('aiCmd.statsTidinessFair')),
    ].join('\n')

    return {
      handled: true,
      action: 'stats',
      steps: [{ text: t('aiCmd.stepStats'), done: true }],
      reply,
    }
  }
  return null
}
