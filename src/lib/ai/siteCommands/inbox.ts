/**
 * siteCommands/inbox.ts — 指令块 9.2：收件箱清零与智能归拢 (/inbox, 智能归类)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseInboxIntent → 块内 2 条路径均返回（无可归拢项 / 归拢计划 + 行动卡片）；
 * 未命中 → 返回 null 继续 fall-through。无 HITL 确认、不使用中止信号。
 */

import { parseInboxIntent } from '../siteIntents.js'
import {
  isUncategorized,
  detectParentChildRelations,
  clusterUncategorizedBookmarks,
} from '../localClustering.js'
import { buildInboxZeroActionCard } from '../siteHitl.js'
import { createInboxZeroDraftDiff } from '../draftDiff.js'
import { CAT_UNCATEGORIZED } from '../../../config/constants.js'
import { t, tN } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 9.2 收件箱清零与智能归拢 (/inbox, 智能归类) ──
export const inboxBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ds = ctx.ds
  if (parseInboxIntent(query)) {
    const groupedIds = new Set<string>()
    for (const g of ds.siblingGroups || []) {
      if (!g.deletedAt && g.bookmarkIds?.length) {
        for (const id of g.bookmarkIds) groupedIds.add(id)
      }
    }

    // 同站子页从属关系：识别「同一站点下的子页」，归入其主页面下
    const uncatIds = new Set(
      ds.bookmarks.filter((b) => isUncategorized(b, groupedIds)).map((b) => b.id),
    )
    const relations = detectParentChildRelations(ds.bookmarks).filter((r) => uncatIds.has(r.childId))
    const nestedChildIds = new Set(relations.map((r) => r.childId))

    const clusters = clusterUncategorizedBookmarks(
      ds.bookmarks.filter((b) => !nestedChildIds.has(b.id)),
      ds.categories,
      groupedIds,
    )
    const assignableClusters = clusters.filter(
      (c) => c.suggestedCategoryId && c.suggestedCategoryId !== CAT_UNCATEGORIZED && c.id !== 'cluster_unassigned',
    )

    const totalToMove = assignableClusters.reduce((acc, c) => acc + c.bookmarks.length, 0)

    if (totalToMove === 0 && relations.length === 0) {
      return {
        handled: true,
        action: 'inbox_zero',
        steps: [{ text: t('aiCmd.stepScanUncat'), done: true }],
        reply: t('aiCmd.inboxZeroDone'),
      }
    }

    const lines: string[] = [
      t('aiCmd.inboxPlanHeader'),
      '',
    ]
    for (const c of assignableClusters) {
      const titles = c.bookmarks.slice(0, 3).map((b) => b.title || b.url).join(t('msg.listSeparator'))
      const more =
        c.bookmarks.length > 3
          ? t('aiCmd.inboxPlanMore', { n: c.bookmarks.length })
          : tN('aiCmd.inboxPlanCount', c.bookmarks.length)
      lines.push(t('aiCmd.inboxPlanLine', { cat: c.suggestedCategoryName, titles, more }))
    }
    if (relations.length > 0) {
      lines.push(tN('aiCmd.inboxNestPlanLine', relations.length))
    }
    lines.push('')
    lines.push(t('aiCmd.inboxCta'))

    const inboxSteps = [
      { text: tN('aiCmd.stepInboxDetected', totalToMove + relations.length), done: true },
      { text: t('aiCmd.stepInboxClustered'), done: true },
    ]
    if (relations.length > 0) {
      inboxSteps.push({ text: t('aiCmd.stepInboxNested'), done: true })
    }

    const diffPayload = createInboxZeroDraftDiff({
      assignableClusters,
      relations,
      bookmarkMap: ds.bookmarkMap || {},
      categoryMap: ds.categoryMap || {},
    })

    return {
      handled: true,
      action: 'inbox_zero',
      steps: inboxSteps,
      reply: lines.join('\n'),
      actionCard: buildInboxZeroActionCard(totalToMove + relations.length, diffPayload),
    }
  }
  return null
}
