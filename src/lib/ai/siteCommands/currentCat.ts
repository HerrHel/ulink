/**
 * siteCommands/currentCat.ts — 指令块 12：上下文感知当前分类查询
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：parseCurrentCatIntent 命中后两条路径均返回（当前分类 → 分类名 + 数量；
 * 全部视图 → 总数）；未命中 → 返回 null 继续 fall-through（该 fall-through 路径无任何副作用）。
 */

import { parseCurrentCatIntent } from '../siteIntents.js'
import { CAT_UNCATEGORIZED, CAT_ALL } from '../../../config/constants.js'
import { t, tN } from '../../../i18n/index.js'
import type { Category } from '../../../types.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 12. 上下文感知：当前分类查询 ──
export const currentCatBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ds = ctx.ds
  const ui = ctx.ui
  if (parseCurrentCatIntent(query)) {
    if (ui.curCat && ui.curCat !== CAT_ALL) {
      const cat = ds.categories.find((c: Category) => c.id === ui.curCat)
      const catName = cat ? cat.name : (ui.curCat === CAT_UNCATEGORIZED ? t('aiCmd.catListUncategorized') : ui.curCat)
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === ui.curCat).length
      return {
        handled: true,
        action: 'current_cat',
        steps: [{ text: t('aiCmd.stepReadContext'), done: true }],
        reply: tN('aiCmd.currentCat', count, { name: catName }),
      }
    }
    const totalCount = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    return {
      handled: true,
      action: 'current_cat',
      steps: [{ text: t('aiCmd.stepReadGlobalContext'), done: true }],
      reply: tN('aiCmd.currentAll', totalCount),
    }
  }

  return null
}
