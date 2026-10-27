/**
 * semanticSearch.ts — 本地自然语言意图与语义检索引擎
 * 让用户通过自然语言（如：“找做流程图的”、“AI生图工具”、“前端状态管理”）
 * 快速召回相关书签，无需精准记住名称或拼写。
 * 纯本地计算，零延迟，零隐私泄漏。
 */

import type { Bookmark, SiblingGroup } from '../../types.js'
import { domain } from '../../utils.js'
import { isThreePartCipher } from '../../crypto.js'
import type { ConceptCluster } from './knowledge.js'
import { CONCEPT_ONTOLOGY } from './knowledge.js'
import { evolvingGraph } from './evolvingGraph.js'

function _plain(v?: string): string {
  if (!v) return ''
  return isThreePartCipher(v) ? '' : v
}

export interface SemanticMatch {
  id: string
  title: string
  url: string
  notes?: string
  icon?: string
  categoryId?: string
  isGroup: boolean
  score: number
  matchedConcept: string
  reason: string
}

/**
 * 过滤自然语言提问中的停用词与助词
 */
function cleanNaturalLanguageQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/(我想找|请问有没有|有没有|有没有什么|找找|找一下|帮我找|求一个|推荐个|推荐|有哪些|哪个|做|看|关于|相关的工具|的工具|的网站|平台|适合小白的|好用的)/g, ' ')
    .trim()
}

/**
 * 计算纯文本匹配度
 */
function textMatchScore(source: string, target: string): number {
  if (!source || !target) return 0
  const s = source.toLowerCase()
  const t = target.toLowerCase()
  if (s === t) return 100
  if (s.includes(t)) return 80
  // 单词重合率：查询词中的关键词必须在文本中出现
  const sWords = s.split(/[\s\-_\/|·]+/).filter(Boolean)
  const tWords = t.split(/[\s\-_\/|·]+/).filter(Boolean)
  let hits = 0
  for (const tw of tWords) {
    if (tw.length < 2) continue
    if (sWords.some(sw => sw === tw || (sw.length >= tw.length && sw.includes(tw)))) hits++
  }
  return hits > 0 ? (hits / tWords.length) * 60 : 0
}

/**
 * 自然语言语义搜书签
 */
export function searchSemanticBookmarks(
  rawQuery: string,
  bookmarks: Bookmark[],
  groups: SiblingGroup[] = [],
): SemanticMatch[] {
  const query = rawQuery.trim().toLowerCase()
  if (!query || query.length < 2 || isThreePartCipher(rawQuery)) return []

  const cleaned = cleanNaturalLanguageQuery(query)
  const activeBms = bookmarks.filter(b => !b.deletedAt)
  const activeGroups = groups.filter(g => !g.deletedAt)

  // 1. 识别命中的概念网络
  const matchedClusters: ConceptCluster[] = []
  for (const cluster of CONCEPT_ONTOLOGY) {
    // 检查查询词是否命中该概念的关键词或相关词
    const hasKw = cluster.keywords.some(kw => query.includes(kw) || (cleaned && cleaned.includes(kw)))
    const hasTerm = cluster.relatedTerms.some(term => query.includes(term.toLowerCase()))
    if (hasKw || hasTerm) {
      matchedClusters.push(cluster)
    }
  }

  // 2. 从端侧自进化图谱获取关联邻居实体（针对个性化/冷门自建领域）
  const queryTokens = [query, cleaned].filter(Boolean).flatMap(q => q.split(/[\s\-_\/|·]+/).filter(w => w.length >= 2))
  const graphNeighbors = evolvingGraph ? evolvingGraph.getRelatedNeighbors(queryTokens, 6) : []

  const results: SemanticMatch[] = []

  // 3. 匹配书签
  for (const b of activeBms) {
    const rawTitle = _plain(b.title)
    const rawNotes = _plain(b.notes)
    const rawUrl = _plain(b.url)
    const bmHost = domain(rawUrl).toLowerCase()
    const bmTitle = rawTitle.toLowerCase()
    const bmNotes = rawNotes.replace(/<[^>]+>/g, '').toLowerCase()

    let bestScore = 0
    let bestReason = ''
    let bestConcept = ''

    // A. 概念集群语义碰撞
    for (const cluster of matchedClusters) {
      let clusterScore = 0
      const reasons: string[] = []

      // 域名精确命中概念核心站
      if (cluster.domains.some(d => bmHost === d || bmHost.includes(d))) {
        clusterScore += 70
        reasons.push('核心同源服务')
      }

      // 标题或笔记中含有该概念的相关词
      const hitKw = cluster.keywords.find(kw => bmTitle.includes(kw) || bmNotes.includes(kw))
      if (hitKw) {
        clusterScore += 40
        reasons.push(`包含概念词「${hitKw}」`)
      }

      const hitTerm = cluster.relatedTerms.find(term => bmTitle.includes(term) || bmHost.includes(term))
      if (hitTerm) {
        // 相关词是站点别名/俗称（如 omofun），单点命中即须越过 35 召回线，
        // 否则模糊搜索（「看番的」找 omofun）会被阈值吞掉
        clusterScore += 40
        reasons.push(`匹配术语「${hitTerm}」`)
      }

      if (clusterScore > bestScore) {
        bestScore = clusterScore
        bestConcept = cluster.name
        bestReason = `语义意图 · ${cluster.name}（${reasons.join(' · ')}）`
      }
    }

    // B. 自进化图谱拓扑关联提权 (Evolving Graph Boost)
    if (graphNeighbors.length > 0) {
      for (const neighbor of graphNeighbors) {
        const nName = neighbor.name.toLowerCase()
        if (nName.length >= 2 && (bmTitle.includes(nName) || bmNotes.includes(nName) || bmHost.includes(nName))) {
          const graphBoost = Math.min(65, 40 + neighbor.weight * 5)
          if (graphBoost > bestScore) {
            bestScore = graphBoost
            bestConcept = neighbor.name
            bestReason = `知识图谱 · 智能关联「${neighbor.name}」`
          }
        }
      }
    }

    // C. 直搜文本相似度加成
    const titleScore = textMatchScore(bmTitle, query) || (cleaned ? textMatchScore(bmTitle, cleaned) : 0)
    const notesScore = textMatchScore(bmNotes, query) || (cleaned ? textMatchScore(bmNotes, cleaned) : 0)
    const hostScore = textMatchScore(bmHost, query)

    const directScore = Math.max(titleScore * 1.0, notesScore * 0.7, hostScore * 0.8)

    if (directScore >= 50) {
      if (directScore > bestScore) {
        bestScore = directScore
        bestConcept = '文本高相关'
        bestReason = '标题/内容精准吻合'
      } else {
        bestScore = Math.min(100, bestScore + directScore * 0.3)
      }
    }

    if (bestScore >= 35) {
      results.push({
        id: b.id,
        title: b.title,
        url: b.url,
        notes: b.notes ? b.notes.replace(/<[^>]+>/g, '').slice(0, 100) : '',
        icon: b.icon,
        categoryId: b.categoryId,
        isGroup: false,
        score: Math.round(bestScore),
        matchedConcept: bestConcept || '意图相关',
        reason: bestReason || '自然语言相关度匹配',
      })
    }
  }

  // 3. 匹配笔记组
  for (const g of activeGroups) {
    const rawGName = _plain(g.name)
    const rawGNotes = _plain(g.notes)
    const gName = rawGName.toLowerCase()
    const gNotes = rawGNotes.replace(/<[^>]+>/g, '').toLowerCase()

    let gScore = 0
    let gReason = ''
    let gConcept = ''

    for (const cluster of matchedClusters) {
      if (cluster.keywords.some(kw => gName.includes(kw) || gNotes.includes(kw))) {
        gScore = 65
        gConcept = cluster.name
        gReason = `笔记主题包含「${cluster.name}」`
        break
      }
    }

    if (graphNeighbors.length > 0) {
      for (const neighbor of graphNeighbors) {
        const nName = neighbor.name.toLowerCase()
        if (nName.length >= 2 && (gName.includes(nName) || gNotes.includes(nName))) {
          const boost = Math.min(65, 45 + neighbor.weight * 5)
          if (boost > gScore) {
            gScore = boost
            gConcept = neighbor.name
            gReason = `知识图谱 · 笔记关联「${neighbor.name}」`
          }
        }
      }
    }

    const titleScore = textMatchScore(gName, query)
    if (titleScore >= 50) {
      gScore = Math.max(gScore, titleScore)
      gConcept = '组名高相关'
      gReason = '笔记组标题吻合'
    }

    if (gScore >= 40) {
      results.push({
        id: g.id,
        title: g.name,
        url: '',
        notes: g.notes ? g.notes.replace(/<[^>]+>/g, '').slice(0, 100) : '',
        icon: g.icon,
        categoryId: g.categoryId,
        isGroup: true,
        score: Math.round(gScore),
        matchedConcept: gConcept || '主题相近',
        reason: gReason,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 12)
}
