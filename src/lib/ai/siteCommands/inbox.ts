/**
 * siteCommands/inbox.ts — 指令块 9.2：收件箱清零与智能归拢 (/inbox, 智能归类)
 * 出口路径：命中 parseInboxIntent → 块内 2 条路径均返回（无可归拢项 / 归拢计划 + 行动卡片）；
 * 未命中 → 返回 null 继续 fall-through。只出预案不落盘（草稿卡片勾选确认后才应用，可撤销）。
 * 归类预案（本地规则 + 大模型兜底）统一来自 inboxPlan.ts。
 */

import { parseInboxIntent } from '../siteIntents.js'
import { planInboxZero, inboxPlanMoveCount } from '../inboxPlan.js'
import type { BookmarkCluster } from '../localClustering.js'
import { buildInboxZeroActionCard } from '../siteHitl.js'
import { createInboxZeroDraftDiff } from '../draftDiff.js'
import { t, tN } from '../../../i18n/index.js'
import type { ChatTurnStep } from '../chatSessions.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 9.2 收件箱清零与智能归拢 (/inbox, 智能归类) ──
export const inboxBlock: SiteCommandBlock = async (
  ctx: SiteCommandBlockCtx,
): Promise<SiteCommandResult | null> => {
  const ds = ctx.ds
  if (!parseInboxIntent(ctx.query)) return null

  const plan = await planInboxZero(ds, { signal: ctx.signal })
  const { localClusters, aiClusters, relations, groupMoves, aiError, left } = plan
  const totalToMove = inboxPlanMoveCount(plan)

  const aiSteps: ChatTurnStep[] =
    plan.aiSentCount > 0 ? [{ text: tN('aiCmd.stepInboxAi', plan.aiSentCount), done: !aiError }] : []

  if (totalToMove === 0 && relations.length === 0) {
    // 没有可归拢的项 ≠ 未分类为零：必须如实报数，不能谎称「为零」
    let reply = left.total === 0
      ? t('aiCmd.inboxZeroDone')
      : t('aiCmd.inboxNoSuggestion', { n: left.total, b: left.bookmarks, g: left.groups })
    if (left.total > 0 && aiError) {
      reply += '\n\n' + t('aiCmd.inboxAiFailed', { reason: aiError === 'disabled' ? t('aiCmd.inboxAiDisabled') : aiError })
    }
    return {
      handled: true,
      action: 'inbox_zero',
      steps: [{ text: t('aiCmd.stepScanUncat'), done: true }, ...aiSteps],
      reply,
    }
  }

  const sep = t('msg.listSeparator')
  const lines: string[] = [t('aiCmd.inboxPlanHeader'), '']
  const pushClusterLine = (c: BookmarkCluster, ai: boolean) => {
    const titles = c.bookmarks.slice(0, 3).map((b) => b.title || b.url).join(sep)
    const more =
      c.bookmarks.length > 3
        ? t('aiCmd.inboxPlanMore', { n: c.bookmarks.length })
        : tN('aiCmd.inboxPlanCount', c.bookmarks.length)
    lines.push(t('aiCmd.inboxPlanLine', { cat: c.suggestedCategoryName, titles, more }) + (ai ? t('aiCmd.inboxAiTag') : ''))
  }
  for (const c of localClusters) pushClusterLine(c, false)
  for (const c of aiClusters) pushClusterLine(c, true)
  for (const m of groupMoves) {
    lines.push(t('aiCmd.inboxGroupPlanLine', { name: (m.group.name || '').trim() || t('cards.unnamedGroup'), cat: m.categoryName || '' }) + (m.ai ? t('aiCmd.inboxAiTag') : ''))
  }
  if (relations.length > 0) {
    lines.push(tN('aiCmd.inboxNestPlanLine', relations.length))
  }
  if (left.total > 0) {
    lines.push(tN('aiCmd.inboxLeftLine', left.total))
  }
  if (aiError && aiError !== 'disabled') {
    lines.push('', t('aiCmd.inboxAiFailed', { reason: aiError }))
  }
  lines.push('')
  lines.push(t('aiCmd.inboxCta'))

  const inboxSteps: ChatTurnStep[] = [
    { text: tN('aiCmd.stepInboxDetected', totalToMove + relations.length), done: true },
    { text: t('aiCmd.stepInboxClustered'), done: true },
    ...aiSteps,
  ]
  if (relations.length > 0) {
    inboxSteps.push({ text: t('aiCmd.stepInboxNested'), done: true })
  }

  const diffPayload = createInboxZeroDraftDiff({
    assignableClusters: [...localClusters, ...aiClusters],
    relations,
    groupMoves,
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
