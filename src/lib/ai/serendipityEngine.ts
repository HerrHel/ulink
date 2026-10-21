/**
 * serendipityEngine.ts — 知识偶遇与沉睡关联唤醒引擎 (Serendipity Engine)
 *
 * 核心目标：
 * 当用户保存新书签、撰写笔记或聚焦某个工作台时，智能检索与历史上可能已遗忘
 * 但存在深层概念交集的内容，主动触发“意外惊喜（Serendipity）”式的认知唤醒：
 *
 * 机制：
 * 1. 语义与概念交叉检索：利用 tokenizeText 与 evolvingGraph 邻居游走检测隐式关联；
 * 2. 时间跨度提权 (Temporal Distance Boost)：
 *    距今越久远（如数月前收藏但沉睡）的内容，关联唤醒的认知价值越高；
 *    Score = SemanticOverlap * (1 + min(2.0, daysAgo / 30 * 0.5))；
 * 3. 严格去重：排除同 URL 或完全相同的书签；
 * 4. 纯端侧计算：毫秒级完成，保护用户隐私。
 */

import type { Bookmark } from '../../types.js'
import { tokenizeText } from './localRAG.js'
import { evolvingGraph } from './evolvingGraph.js'
import { domain } from '../../utils.js'

export interface SerendipityMatch {
  candidate: Bookmark
  similarity: number
  serendipityScore: number
  daysAgo: number
  commonConcepts: string[]
  reason: string
}

/** 词条 Jaccard 相似度计算 */
function computeJaccard(tokensA: string[], tokensB: string[]): number {
  if (!tokensA.length || !tokensB.length) return 0
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let intersection = 0

  for (const t of setA) {
    if (setB.has(t)) intersection++
  }

  const union = setA.size + setB.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * 针对目标书签在全库中寻找存在偶遇价值的历史书签
 */
export function findSerendipityMatches(
  target: Bookmark,
  allBookmarks: Bookmark[],
  options?: {
    minDaysAgo?: number
    maxMatches?: number
    minScore?: number
  },
): SerendipityMatch[] {
  const minDaysAgo = options?.minDaysAgo ?? 3
  const maxMatches = options?.maxMatches ?? 3
  const minScore = options?.minScore ?? 0.35

  const targetTokens = tokenizeText(`${target.title} ${target.notes || ''}`)
  if (targetTokens.length < 2) return []

  const targetDomain = domain(target.url || '')
  const now = Date.now()

  // 获取目标书签在动态图谱中的邻居概念
  const graphNeighbors = evolvingGraph.getRelatedNeighbors(targetTokens, 8).map((n) => n.name.toLowerCase())
  const neighborSet = new Set(graphNeighbors)

  const matches: SerendipityMatch[] = []

  for (const candidate of allBookmarks) {
    if (candidate.deletedAt || candidate.id === target.id) continue
    // 排除同域名主页或同一网址
    if (candidate.url && target.url && (candidate.url === target.url || domain(candidate.url) === targetDomain)) {
      continue
    }

    const candCreatedAt = candidate.createdAt || now
    const daysAgo = Math.max(0, Math.floor((now - candCreatedAt) / (1000 * 60 * 60 * 24)))
    // 若属于过近时间（如刚刚同时存入的一批），不构成“沉睡偶遇”
    if (daysAgo < minDaysAgo) continue

    const candTokens = tokenizeText(`${candidate.title} ${candidate.notes || ''}`)
    if (candTokens.length < 2) continue

    // 1. 词条直接重合度
    const jaccard = computeJaccard(targetTokens, candTokens)

    // 2. 动态概念图谱隐式桥接度
    let bridgeCount = 0
    const matchedConcepts: string[] = []
    for (const t of candTokens) {
      if (neighborSet.has(t)) {
        bridgeCount++
        matchedConcepts.push(t)
      }
    }
    const bridgeScore = Math.min(0.5, bridgeCount * 0.15)

    const baseSimilarity = jaccard + bridgeScore
    if (baseSimilarity < 0.12) continue

    // 3. 时间跨度放大系数（沉睡越久，唤醒价值越大）
    const timeFactor = 1 + Math.min(1.8, (daysAgo / 30) * 0.4)
    const serendipityScore = Math.round(baseSimilarity * timeFactor * 100) / 100

    if (serendipityScore >= minScore) {
      const reason = daysAgo >= 30
        ? `与 ${Math.floor(daysAgo / 30)} 个月前收藏的卡片存在交叉关联`
        : `与 ${daysAgo} 天前沉淀的内容存在概念交集`

      matches.push({
        candidate,
        similarity: Math.round(baseSimilarity * 100) / 100,
        serendipityScore,
        daysAgo,
        commonConcepts: [...new Set(matchedConcepts)].slice(0, 3),
        reason,
      })
    }
  }

  // 按偶遇评分降序排列
  matches.sort((a, b) => b.serendipityScore - a.serendipityScore)
  return matches.slice(0, maxMatches)
}
