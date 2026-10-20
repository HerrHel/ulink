/**
 * siteCommands/deadlink.ts — 指令块 7：死链检测与自愈 (/deadlink, 检查死链, 死链自愈)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseDeadlinkIntent → 块内 2 条路径均返回（无死链（顺带开死链面板）/
 * 死链报告 + 云端平替推荐）；未命中 → 返回 null 继续 fall-through。
 */

import { parseDeadlinkIntent } from '../siteIntents.js'
import { findSimilarWebsites } from '../cloudAiClient.js'
import { buildHealDeadlinkCard } from '../siteHitl.js'
import { t, tN } from '../../../i18n/index.js'
import type { Bookmark } from '../../../types.js'
import type { ChatActionCard } from '../chatSessions.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 7. 死链检测与自愈 (/deadlink, 检查死链, 死链自愈) ──
export const deadlinkBlock: SiteCommandBlock = async (
  ctx: SiteCommandBlockCtx,
): Promise<SiteCommandResult | null> => {
  const query = ctx.query
  const ds = ctx.ds
  const ui = ctx.ui
  if (parseDeadlinkIntent(query)) {
    const deadBookmarks = ds.bookmarks.filter(
      (b: Bookmark) =>
        !b.deletedAt && b.attributes?.['dead-link'] && !b.attributes?.['dead-link-ignored'],
    )

    if (deadBookmarks.length === 0) {
      ui.overlays.deadLinks = true
      return {
        handled: true,
        action: 'deadlinks',
        steps: [{ text: t('aiCmd.stepScanDeadlinks'), done: true }],
        reply: t('aiCmd.deadNone'),
      }
    }

    const firstDead = deadBookmarks[0]
    const alts = await findSimilarWebsites(
      firstDead.url,
      firstDead.title,
      [],
      ds.categories,
      ds.customAttributes,
    )
    const bestAlt = alts[0]

    const lines = [
      tN('aiCmd.deadReport', deadBookmarks.length),
      '',
    ]
    for (let i = 0; i < Math.min(3, deadBookmarks.length); i++) {
      const b = deadBookmarks[i]
      const wbUrl = `https://web.archive.org/web/*/${encodeURIComponent(b.url)}`
      lines.push(t('aiCmd.deadItem', { i: i + 1, title: b.title || t('aiCmd.untitled'), url: b.url }))
      lines.push(t('aiCmd.deadSnapshot', { url: wbUrl }))
    }
    if (deadBookmarks.length > 3) {
      lines.push(tN('aiCmd.deadMore', deadBookmarks.length - 3))
    }

    if (bestAlt) {
      lines.push('')
      lines.push(t('aiCmd.deadAltIntro', { title: firstDead.title }))
      lines.push(t('aiCmd.deadAltRec', { title: bestAlt.title, url: bestAlt.url }))
      lines.push(
        t('aiCmd.deadAltHighlight', {
          desc: bestAlt.notes || bestAlt.highlight || t('aiCmd.deadAltDefaultHighlight'),
        }),
      )
      lines.push('')
      lines.push(t('aiCmd.deadCta'))
    }

    let actionCard: ChatActionCard | undefined
    if (bestAlt) {
      actionCard = buildHealDeadlinkCard({
        deadBmId: firstDead.id,
        fromTitle: firstDead.title,
        toTitle: bestAlt.title,
        replacement: bestAlt,
      })
    }

    return {
      handled: true,
      action: 'deadlinks',
      steps: [
        { text: tN('aiCmd.stepDeadFound', deadBookmarks.length), done: true },
        { text: t('aiCmd.stepDeadSearchAlt', { title: firstDead.title }), done: true },
      ],
      reply: lines.join('\n'),
      actionCard,
    }
  }

  return null
}
