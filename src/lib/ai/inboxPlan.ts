/**
 * inboxPlan.ts — 收件箱清零（整理未分类）归类预案的唯一来源
 * /inbox 指令块（出草稿卡片）与任务计划步骤 applyInboxZeroClustering（确认后直接落盘）共用，
 * 保证两条入口的归类结果、未分类报数口径一致。只计算，不落盘。
 *
 * 两段式归类：
 * 1. 本地规则（域名历史 / 内置词表 / 分类名命中）+ 同站子页嵌套，零成本、离线可用；
 * 2. 规则归不进现有分类的书签与笔记组，交给大模型（inboxLlmClassify）在现有分类里挑，
 *    失败 / 未启用 fail-open，只影响「还剩多少没归类」的如实报数。
 */

import {
  isUncategorized,
  isUncategorizedGroup,
  detectParentChildRelations,
  clusterUncategorizedBookmarks,
  findUncategorizedGroups,
  type BookmarkCluster,
  type ParentChildLink,
} from './localClustering.js'
import { classifyWithLlm } from './inboxLlmClassify.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { getLocale } from '../../i18n/index.js'
import type { Bookmark, Category, SiblingGroup } from '../../types.js'

export type InboxGroupMove = { group: SiblingGroup; categoryId: string; categoryName?: string; ai: boolean }

export interface InboxPlan {
  /** 本地规则命中的书签聚类 */
  localClusters: BookmarkCluster[]
  /** 大模型建议的书签聚类 */
  aiClusters: BookmarkCluster[]
  /** 同站子页嵌套 */
  relations: ParentChildLink[]
  /** 笔记组归类（规则 + 大模型） */
  groupMoves: InboxGroupMove[]
  /** 送审大模型的条数（0 = 未调用） */
  aiSentCount: number
  /** 大模型失败原因：'disabled' = AI 未开启；空 = 成功或未调用 */
  aiError: string
  /** 本预案覆盖不到、仍留在未分类的项（口径对齐侧栏） */
  left: { bookmarks: number; groups: number; total: number }
}

export async function planInboxZero(
  data: { bookmarks: Bookmark[]; siblingGroups?: SiblingGroup[]; categories: Category[] },
  opts?: { signal?: AbortSignal; useLlm?: boolean },
): Promise<InboxPlan> {
  const groups = data.siblingGroups || []
  const groupedIds = new Set<string>()
  for (const g of groups) {
    if (!g.deletedAt && g.bookmarkIds?.length) {
      for (const id of g.bookmarkIds) groupedIds.add(id)
    }
  }
  const activeCats = (data.categories || []).filter(
    (c) => !c.deletedAt && c.id !== CAT_ALL && c.id !== CAT_UNCATEGORIZED,
  )
  const catById = new Map(activeCats.map((c) => [c.id, c]))

  // ── 第 1 段：本地规则 ──
  const uncatIds = new Set(
    data.bookmarks.filter((b) => isUncategorized(b, groupedIds)).map((b) => b.id),
  )
  const relations = detectParentChildRelations(data.bookmarks).filter((r) => uncatIds.has(r.childId))
  const nestedChildIds = new Set(relations.map((r) => r.childId))

  const clusters = clusterUncategorizedBookmarks(
    data.bookmarks.filter((b) => !nestedChildIds.has(b.id)),
    data.categories,
    groupedIds,
  )
  const localClusters = clusters.filter(
    (c) => c.suggestedCategoryId && c.suggestedCategoryId !== CAT_UNCATEGORIZED && c.id !== 'cluster_unassigned',
  )
  const leftoverBookmarks = clusters.find((c) => c.id === 'cluster_unassigned')?.bookmarks || []

  const groupMoves: InboxGroupMove[] = []
  const leftoverGroups: SiblingGroup[] = []
  for (const gi of findUncategorizedGroups(groups, data.categories, data.bookmarks)) {
    if (gi.suggestedCategoryId && catById.has(gi.suggestedCategoryId)) {
      groupMoves.push({ group: gi.group, categoryId: gi.suggestedCategoryId, categoryName: gi.suggestedCategoryName, ai: false })
    } else {
      leftoverGroups.push(gi.group)
    }
  }

  // ── 第 2 段：大模型兜底（仅规则未命中项） ──
  const aiClusters: BookmarkCluster[] = []
  let aiError = ''
  let aiSentCount = 0
  if (opts?.useLlm !== false && (leftoverBookmarks.length || leftoverGroups.length) && activeCats.length) {
    const llm = await classifyWithLlm(
      [
        ...leftoverBookmarks.map((b) => ({ id: `b:${b.id}`, title: b.title, url: b.url })),
        ...leftoverGroups.map((g) => ({ id: `g:${g.id}`, title: g.name })),
      ],
      activeCats,
      { signal: opts?.signal, isZh: getLocale() === 'zh-CN' },
    )
    aiError = llm.error || ''
    aiSentCount = llm.sentCount
    const byCat = new Map<string, Bookmark[]>()
    for (const b of leftoverBookmarks) {
      const catId = llm.assignments.get(`b:${b.id}`)
      if (catId && catById.has(catId)) byCat.set(catId, [...(byCat.get(catId) || []), b])
    }
    let idx = 1
    for (const [catId, bms] of byCat) {
      const cat = catById.get(catId)!
      aiClusters.push({
        id: `cluster_ai_${idx++}`,
        name: cat.name,
        suggestedCategoryId: cat.id,
        suggestedCategoryName: cat.name,
        bookmarks: bms,
      })
    }
    for (const g of leftoverGroups) {
      const catId = llm.assignments.get(`g:${g.id}`)
      const cat = catId ? catById.get(catId) : undefined
      if (cat) groupMoves.push({ group: g, categoryId: cat.id, categoryName: cat.name, ai: true })
    }
  }

  // 本预案覆盖不到的剩余项（口径对齐侧栏计数：顶层书签 + 笔记组）
  const plannedIds = new Set<string>([
    ...localClusters.flatMap((c) => c.bookmarks.map((b) => b.id)),
    ...aiClusters.flatMap((c) => c.bookmarks.map((b) => b.id)),
    ...relations.map((r) => r.childId),
  ])
  const plannedGroupIds = new Set(groupMoves.map((m) => m.group.id))
  const leftB = data.bookmarks.filter((b) => isUncategorized(b) && !plannedIds.has(b.id)).length
  const leftG = groups.filter((g) => isUncategorizedGroup(g) && !plannedGroupIds.has(g.id)).length

  return {
    localClusters,
    aiClusters,
    relations,
    groupMoves,
    aiSentCount,
    aiError,
    left: { bookmarks: leftB, groups: leftG, total: leftB + leftG },
  }
}

/** 预案中待移动的项数（书签 + 笔记组，不含子页嵌套） */
export function inboxPlanMoveCount(plan: InboxPlan): number {
  return [...plan.localClusters, ...plan.aiClusters].reduce((n, c) => n + c.bookmarks.length, 0) + plan.groupMoves.length
}
