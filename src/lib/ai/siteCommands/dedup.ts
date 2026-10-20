/**
 * siteCommands/dedup.ts — 指令块 6：查重巡检 (/dedup, 查找重复书签)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseDedupIntent → 块内 2 条路径均返回（无重复/有重复报告）；
 * 未命中 → 返回 null 继续 fall-through。
 */

import { parseDedupIntent } from '../siteIntents.js'
import { findDuplicateCandidates } from '../localClustering.js'
import { buildDedupActionCard } from '../siteHitl.js'
import { t, tN } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 6. 查重巡检 (/dedup, 查找重复书签) ──
export const dedupBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ds = ctx.ds
  if (parseDedupIntent(query)) {
    const dups = findDuplicateCandidates(ds.bookmarks)
    if (!dups || dups.length === 0) {
      return {
        handled: true,
        action: 'dedup',
        steps: [
          { text: t('aiCmd.stepScanUrls'), done: true },
          { text: t('aiCmd.stepNoDupFound'), done: true },
        ],
        reply: t('aiCmd.dedupClean'),
      }
    }
    const dupCount = dups.reduce((acc, d) => acc + d.duplicates.length, 0)
    const lines = [
      tN('aiCmd.dedupReport', dupCount, { groups: dups.length, count: dupCount }),
      '',
    ]
    const previewItems = dups.slice(0, 5)
    for (let i = 0; i < previewItems.length; i++) {
      const d = previewItems[i]
      lines.push(`${i + 1}. ${d.primary.title || t('aiCmd.untitled')}`)
      lines.push(t('aiCmd.dedupMainUrl', { url: d.normalizedUrl }))
      lines.push(
        tN('aiCmd.dedupCopies', d.duplicates.length, {
          titles: d.duplicates.map((dup) => dup.title || t('aiCmd.untitled')).join(', '),
        }),
      )
    }
    if (dups.length > 5) {
      lines.push(tN('aiCmd.dedupMore', dups.length - 5))
    }

    return {
      handled: true,
      action: 'dedup',
      steps: [
        { text: t('aiCmd.stepScanUrls'), done: true },
        { text: tN('aiCmd.stepDupFound', dups.length), done: true },
      ],
      actionCard: buildDedupActionCard({ dupCount, groups: dups.length }),
      reply: lines.join('\n'),
    }
  }

  return null
}
