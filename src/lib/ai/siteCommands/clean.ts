/**
 * siteCommands/clean.ts — 指令块 14：孤儿与无效引用自检清理 (/clean, 清理孤立数据)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：parseCleanIntent 命中后两条路径均返回（有修复 → save 后返回修复计数；
 * 无修复 → 返回一致性正常）；未命中 → 返回 null 继续 fall-through
 * （该 fall-through 路径无任何副作用）。
 */

import { parseCleanIntent } from '../siteIntents.js'
import { t } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 14. 孤儿与无效引用自检清理 (/clean, 清理孤立数据) ──
export const cleanBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ds = ctx.ds
  const app = ctx.app
  if (parseCleanIntent(query)) {
    let fixedGroupRefs = 0
    let fixedParentRefs = 0

    // 检查组内的失效 bookmarkIds
    for (const grp of ds.siblingGroups) {
      if (!grp.bookmarkIds || grp.bookmarkIds.length === 0) continue
      const validIds = grp.bookmarkIds.filter(
        (id: string) => !!ds.bookmarkMap[id] && !ds.bookmarkMap[id].deletedAt,
      )
      if (validIds.length !== grp.bookmarkIds.length) {
        fixedGroupRefs += grp.bookmarkIds.length - validIds.length
        ds.updateGroup(grp.id, { bookmarkIds: validIds })
      }
    }

    // 检查书签中的失效 parentId
    for (const bm of ds.bookmarks) {
      if (bm.parentId && (!ds.bookmarkMap[bm.parentId] || ds.bookmarkMap[bm.parentId].deletedAt)) {
        fixedParentRefs++
        ds.updateBookmark(bm.id, { parentId: undefined })
      }
    }

    if (fixedGroupRefs > 0 || fixedParentRefs > 0) {
      app.save()
      return {
        handled: true,
        action: 'clean_orphans',
        steps: [
          { text: t('aiCmd.stepAuditGroupRefs'), done: true },
          { text: t('aiCmd.stepFixOrphans'), done: true },
        ],
        reply: t('aiCmd.cleanFixed', { grp: fixedGroupRefs, par: fixedParentRefs }),
      }
    }

    return {
      handled: true,
      action: 'clean_orphans',
      steps: [{ text: t('aiCmd.stepConsistencyOk'), done: true }],
      reply: t('aiCmd.cleanOk'),
    }
  }

  return null
}
