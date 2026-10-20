/**
 * siteCommands/health.ts — 指令块 9.1：全库资产体检中心 (/health, 资产体检)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseHealthIntent → 返回体检报告（含按问题优先级构造的行动卡片）；
 * 未命中 → 返回 null 继续 fall-through。无 HITL 确认、不使用中止信号。
 */

import { parseHealthIntent } from '../siteIntents.js'
import { calculateVaultHealth, isOfficialBookmark } from '../localClustering.js'
import {
  buildHealthInboxCard,
  buildHealthDedupCard,
  buildHealthTrashCard,
} from '../siteHitl.js'
import { t } from '../../../i18n/index.js'
import type { Category } from '../../../types.js'
import type { ChatActionCard } from '../chatSessions.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 9.1 全库资产体检中心 (/health, 资产体检) ──
export const healthBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ds = ctx.ds
  if (parseHealthIntent(query)) {
    const groupedIds = new Set<string>()
    for (const g of ds.siblingGroups || []) {
      if (!g.deletedAt && g.bookmarkIds?.length) {
        for (const id of g.bookmarkIds) groupedIds.add(id)
      }
    }

    const healthStats = calculateVaultHealth(
      ds.bookmarks,
      ds.categories,
      groupedIds,
      ds.siblingGroups,
    )

    const activeBookmarks = ds.bookmarks.filter((b) => !b.deletedAt && !isOfficialBookmark(b))
    const totalCount = activeBookmarks.length

    const tagCoveredCount = activeBookmarks.filter(
      (b) => b.attributes && Object.keys(b.attributes).length > 0,
    ).length
    const tagCoverage = totalCount > 0 ? Math.round((tagCoveredCount / totalCount) * 100) : 100

    const trashTotal =
      ds.bookmarks.filter((b) => b.deletedAt).length +
      ds.siblingGroups.filter((g) => g.deletedAt).length +
      ds.categories.filter((c: Category) => c.deletedAt).length

    // 计算综合健康指数 (0 ~ 100)
    let score = 100
    if (totalCount > 0) {
      score -= Math.min(30, healthStats.uncategorizedCount * 3)
      score -= Math.min(25, healthStats.duplicateCount * 5)
      if (tagCoverage < 50) score -= 15
      else if (tagCoverage < 75) score -= 5
      if (trashTotal > 15) score -= 10
      score = Math.max(10, Math.min(100, score))
    }

    const level =
      score >= 90
        ? t('aiCmd.levelExcellent')
        : score >= 75
          ? t('aiCmd.levelGood')
          : score >= 60
            ? t('aiCmd.levelFair')
            : t('aiCmd.levelPoor')

    const reply = [
      t('aiCmd.healthTitle'),
      '',
      t('aiCmd.healthScore', { score, level }),
      '',
      t('aiCmd.healthDetail'),
      t('aiCmd.healthTotal', { n: totalCount }),
      t('aiCmd.healthUncat', {
        n: healthStats.uncategorizedCount,
        hint: healthStats.uncategorizedCount > 0 ? t('aiCmd.healthUncatHint') : t('aiCmd.healthUncatOk'),
      }),
      t('aiCmd.healthDup', {
        n: healthStats.duplicateCount,
        hint: healthStats.duplicateCount > 0 ? t('aiCmd.healthDupHint') : t('aiCmd.healthDupOk'),
      }),
      t('aiCmd.healthTagCoverage', {
        pct: tagCoverage,
        hint: tagCoverage < 60 ? t('aiCmd.healthTagHint') : t('aiCmd.healthTagOk'),
      }),
      t('aiCmd.healthTrash', {
        n: trashTotal,
        hint: trashTotal > 10 ? t('aiCmd.healthTrashHint') : '',
      }),
      '',
      healthStats.uncategorizedCount > 0
        ? t('aiCmd.healthAdviceInbox')
        : healthStats.duplicateCount > 0
          ? t('aiCmd.healthAdviceDedup')
          : t('aiCmd.healthPraise'),
    ].join('\n')

    let actionCard: ChatActionCard | undefined
    if (healthStats.uncategorizedCount > 0) {
      actionCard = buildHealthInboxCard(healthStats.uncategorizedCount)
    } else if (healthStats.duplicateCount > 0) {
      actionCard = buildHealthDedupCard(healthStats.duplicateCount)
    } else if (trashTotal > 0) {
      actionCard = buildHealthTrashCard(trashTotal)
    }

    return {
      handled: true,
      action: 'health',
      steps: [
        { text: t('aiCmd.stepHealthScan'), done: true },
        { text: t('aiCmd.stepHealthScore'), done: true },
      ],
      reply,
      actionCard,
    }
  }
  return null
}
