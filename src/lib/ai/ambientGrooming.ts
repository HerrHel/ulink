/**
 * ambientGrooming.ts — 环境智能静默治理扫描器 (Ambient Knowledge Grooming)
 *
 * 核心目标：
 * 在用户浏览或空闲时段，端侧静默体检书签资产，识别潜在的结构性臃肿与自愈机会：
 * 1. 分类臃肿与漂移 (Category Drift / Splitting)：识别积压过多（≥25 条）的分类并建议拆分；
 * 2. 收件箱积压警戒 (Inbox Overflow)：未分类项达阈值时提醒智能归类；
 * 3. 模糊与未命名卡片 (Vague Bookmarks)：纯 URL 或未命名书签识别；
 * 4. 重复冗余堆积 (Duplicate Bloat)：无痛查重合并建议。
 */

import type { Bookmark, Category, SiblingGroup } from '../../types.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { findDuplicateCandidates, isUncategorized } from './localClustering.js'
import { t } from '../../i18n/index.js'

export type GroomingInsightType = 'drift' | 'inbox' | 'vague' | 'duplicates'

export interface GroomingInsight {
  id: string
  type: GroomingInsightType
  title: string
  description: string
  count: number
  targetCategoryId?: string
  suggestedActionCommand?: string
  suggestedActionName?: string
  severity: 'suggestion' | 'attention'
}

/**
 * 运行全库环境治理扫描
 */
export function runAmbientGroomingScan(params: {
  bookmarks: Bookmark[]
  groups: SiblingGroup[]
  categories: Category[]
}): GroomingInsight[] {
  const { bookmarks, groups, categories } = params
  const validBookmarks = bookmarks.filter((b) => !b.deletedAt)
  const insights: GroomingInsight[] = []

  const groupedIds = new Set<string>()
  for (const g of groups) {
    if (!g.deletedAt && g.bookmarkIds?.length) {
      for (const id of g.bookmarkIds) groupedIds.add(id)
    }
  }

  // 1. 收件箱积压扫描 (Inbox Overflow)
  const uncatBookmarks = validBookmarks.filter((b) => isUncategorized(b, groupedIds))
  if (uncatBookmarks.length >= 8) {
    insights.push({
      id: `groom-inbox-${Date.now()}`,
      type: 'inbox',
      title: t('ai.ambientInboxTitle', { count: uncatBookmarks.length }),
      description: t('ai.ambientInboxDesc', { count: uncatBookmarks.length }),
      count: uncatBookmarks.length,
      suggestedActionCommand: '/inbox',
      suggestedActionName: 'inbox_zero',
      severity: 'attention',
    })
  }

  // 2. 超大分类臃肿与拆分扫描 (Category Drift)
  const catCountMap = new Map<string, Bookmark[]>()
  for (const b of validBookmarks) {
    if (b.categoryId && b.categoryId !== CAT_ALL && b.categoryId !== CAT_UNCATEGORIZED) {
      if (!catCountMap.has(b.categoryId)) {
        catCountMap.set(b.categoryId, [])
      }
      catCountMap.get(b.categoryId)!.push(b)
    }
  }

  for (const [catId, bms] of catCountMap.entries()) {
    if (bms.length >= 25) {
      const cat = categories.find((c) => c.id === catId && !c.deletedAt)
      if (cat) {
        insights.push({
          id: `groom-drift-${catId}`,
          type: 'drift',
          title: t('ai.ambientDriftTitle', { name: cat.name, count: bms.length }),
          description: t('ai.ambientDriftDesc', { name: cat.name }),
          count: bms.length,
          targetCategoryId: catId,
          suggestedActionCommand: `/pack ${cat.name}`,
          suggestedActionName: 'create_workspace',
          severity: 'suggestion',
        })
      }
    }
  }

  // 3. 纯 URL / 模糊未命名书签扫描
  const vagueBms = validBookmarks.filter((b) => {
    const title = (b.title || '').trim()
    return !title || /^https?:\/\//i.test(title) || title === '未命名书签' || title === 'Untitled'
  })

  if (vagueBms.length >= 3) {
    insights.push({
      id: `groom-vague-${Date.now()}`,
      type: 'vague',
      title: t('ai.ambientVagueTitle', { count: vagueBms.length }),
      description: t('ai.ambientVagueDesc', { count: vagueBms.length }),
      count: vagueBms.length,
      suggestedActionCommand: '/health',
      suggestedActionName: 'audit_vault',
      severity: 'suggestion',
    })
  }

  // 4. 重复冗余书签扫描
  const dups = findDuplicateCandidates(validBookmarks)
  const totalDups = dups.reduce((acc, d) => acc + d.duplicates.length, 0)
  if (totalDups >= 2) {
    insights.push({
      id: `groom-dups-${Date.now()}`,
      type: 'duplicates',
      title: t('ai.ambientDupsTitle', { count: totalDups }),
      description: t('ai.ambientDupsDesc', { count: totalDups }),
      count: totalDups,
      suggestedActionCommand: '/dedup',
      suggestedActionName: 'merge_dedup',
      severity: 'suggestion',
    })
  }

  return insights
}
