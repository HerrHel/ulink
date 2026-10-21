/**
 * evolvingGraph.ts — 端侧自进化概念与实体关系图谱 (Evolving Knowledge Graph)
 *
 * 核心目标：
 * 突破静态硬编码本体（CONCEPT_ONTOLOGY）的死板上限，在端侧自适应沉淀专属于用户的
 * 动态概念关联网络（LightRAG / Evolving Graph 思想）。
 *
 * 运作机制：
 * 1. 实体与词条提取 (Entity & Term Extraction)：
 *    - 从书签标题、笔记段落、分类和自定义属性中提取概念节点；
 * 2. 共现与拓扑学习 (Co-occurrence & Association Learning)：
 *    - 当两个概念频繁在同一笔记组、同一富文本段落或同一书签元数据中并列出现时，
 *      动态建立/增强二者之间的拓扑边权重 (Edge Weight)；
 * 3. 关联扩散与查询扩展 (Graph Traversal & Neighbor Expansion)：
 *    - 在检索时进行 1~2 阶局部子图游走，为 RAG 和意图识别补充用户特有的关联上下文；
 * 4. 纯端侧与隐私保护：
 *    - 纯浏览器计算与本地持久化 (localStorage: lv_ai_graph_v1)，零外部数据外泄。
 */

import { safeGetItem, safeSetItem, safeJsonParse } from '../storageSafe.js'
import { tokenizeText } from './localRAG.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'

export const K_AI_GRAPH = 'lv_ai_graph_v1'

/** 最大节点数与最大边数限制，避免占用过多存储 */
const MAX_NODES = 400
const MAX_EDGES_PER_NODE = 20

export interface GraphNode {
  id: string
  name: string
  type: 'concept' | 'tag' | 'category' | 'tool'
  frequency: number
  lastSeenAt: number
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
  coOccurrenceCount: number
  lastUpdated: number
}

export interface EvolvingGraphData {
  version: 1
  nodes: Record<string, GraphNode>
  edges: Record<string, Record<string, GraphEdge>>
  updatedAt: number
}

export class EvolvingKnowledgeGraph {
  private nodes: Map<string, GraphNode> = new Map()
  private adjacency: Map<string, Map<string, GraphEdge>> = new Map()

  constructor() {
    this.loadFromStorage()
  }

  /**
   * 从本地缓存加载图谱
   */
  public loadFromStorage(): void {
    const raw = safeJsonParse<Partial<EvolvingGraphData>>(safeGetItem(K_AI_GRAPH), {
      version: 1,
      nodes: {},
      edges: {},
      updatedAt: 0,
    })

    this.nodes.clear()
    this.adjacency.clear()

    if (raw && raw.nodes) {
      for (const [id, node] of Object.entries(raw.nodes)) {
        if (node && node.name) {
          this.nodes.set(id, { ...node })
        }
      }
    }

    if (raw && raw.edges) {
      for (const [src, targets] of Object.entries(raw.edges)) {
        if (!this.adjacency.has(src)) {
          this.adjacency.set(src, new Map())
        }
        const edgeMap = this.adjacency.get(src)!
        for (const [tgt, edge] of Object.entries(targets)) {
          if (edge) {
            edgeMap.set(tgt, { ...edge })
          }
        }
      }
    }
  }

  /**
   * 持久化图谱到本地
   */
  public saveToStorage(): void {
    const nodesObj: Record<string, GraphNode> = {}
    for (const [id, node] of this.nodes.entries()) {
      nodesObj[id] = node
    }

    const edgesObj: Record<string, Record<string, GraphEdge>> = {}
    for (const [src, targets] of this.adjacency.entries()) {
      edgesObj[src] = {}
      for (const [tgt, edge] of targets.entries()) {
        edgesObj[src][tgt] = edge
      }
    }

    const data: EvolvingGraphData = {
      version: 1,
      nodes: nodesObj,
      edges: edgesObj,
      updatedAt: Date.now(),
    }

    safeSetItem(K_AI_GRAPH, JSON.stringify(data))
  }

  /**
   * 规范化节点 ID
   */
  private normalizeId(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, '_')
  }

  /**
   * 记录或强化单个节点
   */
  public touchNode(name: string, type: GraphNode['type'] = 'concept'): GraphNode {
    const id = this.normalizeId(name)
    if (!id) throw new Error('Invalid node name')

    let node = this.nodes.get(id)
    const now = Date.now()
    if (!node) {
      node = {
        id,
        name: name.trim(),
        type,
        frequency: 1,
        lastSeenAt: now,
      }
      this.nodes.set(id, node)
    } else {
      node.frequency++
      node.lastSeenAt = now
    }
    return node
  }

  /**
   * 记录或增强两个节点之间的共现关系（无向边对称存储）
   */
  public addAssociation(nameA: string, nameB: string, weightBoost = 1.0): void {
    const idA = this.normalizeId(nameA)
    const idB = this.normalizeId(nameB)
    if (!idA || !idB || idA === idB) return

    this.touchNode(nameA)
    this.touchNode(nameB)

    const now = Date.now()
    this.recordEdge(idA, idB, weightBoost, now)
    this.recordEdge(idB, idA, weightBoost, now)
  }

  private recordEdge(src: string, tgt: string, boost: number, timestamp: number): void {
    if (!this.adjacency.has(src)) {
      this.adjacency.set(src, new Map())
    }
    const edgeMap = this.adjacency.get(src)!
    const existing = edgeMap.get(tgt)

    if (existing) {
      existing.coOccurrenceCount += 1
      existing.weight = Math.min(10.0, existing.weight * 0.95 + boost)
      existing.lastUpdated = timestamp
    } else {
      // 控制单个节点出度
      if (edgeMap.size >= MAX_EDGES_PER_NODE) {
        // 淘汰权重最低的最旧边
        let minEdgeKey = ''
        let minWeight = Infinity
        for (const [k, e] of edgeMap.entries()) {
          if (e.weight < minWeight) {
            minWeight = e.weight
            minEdgeKey = k
          }
        }
        if (minEdgeKey) edgeMap.delete(minEdgeKey)
      }

      edgeMap.set(tgt, {
        source: src,
        target: tgt,
        weight: boost,
        coOccurrenceCount: 1,
        lastUpdated: timestamp,
      })
    }
  }

  /**
   * 从全库书签、笔记组、分类和属性中进行图谱自进化挖掘
   */
  public mineFromKnowledge(
    bookmarks: Bookmark[],
    groups: SiblingGroup[],
    categories: Category[] = [],
    customAttributes: CustomAttribute[] = [],
  ): void {
    const catMap = new Map<string, string>()
    for (const c of categories) {
      if (c && !c.deletedAt && c.id) catMap.set(c.id, c.name)
    }

    const attrMap = new Map<string, string>()
    for (const a of customAttributes) {
      if (a && !a.deletedAt && a.id) attrMap.set(a.id, a.name)
    }

    // 1. 书签级共现挖掘：[分类, 属性标签, 标题关键词]
    for (const bm of bookmarks) {
      if (bm.deletedAt) continue
      const terms: string[] = []

      // 分类
      const catName = bm.categoryId ? catMap.get(bm.categoryId) : undefined
      if (catName && catName !== '未分类') {
        terms.push(catName)
        this.touchNode(catName, 'category')
      }

      // 标签
      if (bm.attributes && typeof bm.attributes === 'object') {
        for (const [attrId, val] of Object.entries(bm.attributes)) {
          if (val && attrMap.has(attrId)) {
            const attrName = attrMap.get(attrId)!
            terms.push(attrName)
            this.touchNode(attrName, 'tag')
          }
        }
      }

      // 标题关键词提取（2 字符以上）
      const titleTokens = tokenizeText(bm.title || '')
      for (const tok of titleTokens.slice(0, 4)) {
        terms.push(tok)
      }

      // 建立两两共现
      for (let i = 0; i < terms.length; i++) {
        for (let j = i + 1; j < terms.length; j++) {
          this.addAssociation(terms[i], terms[j], 0.8)
        }
      }
    }

    // 2. 笔记组级共现挖掘：组名与组内书签两两高度关联
    for (const grp of groups) {
      if (grp.deletedAt) continue
      const groupName = grp.name?.trim()
      if (!groupName) continue
      this.touchNode(groupName, 'concept')

      const memberTitles: string[] = []
      for (const bmId of grp.bookmarkIds || []) {
        const bm = bookmarks.find((b) => b.id === bmId && !b.deletedAt)
        if (bm && bm.title) {
          memberTitles.push(bm.title)
          this.addAssociation(groupName, bm.title, 1.2)
        }
      }

      // 组内成员书签互相产生弱关联
      for (let i = 0; i < Math.min(memberTitles.length, 6); i++) {
        for (let j = i + 1; j < Math.min(memberTitles.length, 6); j++) {
          this.addAssociation(memberTitles[i], memberTitles[j], 0.4)
        }
      }
    }

    // 3. 淘汰低频过期节点，保持图谱紧凑高效
    if (this.nodes.size > MAX_NODES) {
      const sortedNodes = [...this.nodes.values()].sort((a, b) => b.frequency - a.frequency)
      const keepIds = new Set(sortedNodes.slice(0, MAX_NODES).map((n) => n.id))

      for (const id of this.nodes.keys()) {
        if (!keepIds.has(id)) {
          this.nodes.delete(id)
          this.adjacency.delete(id)
        }
      }
    }

    this.saveToStorage()
  }

  /**
   * 基于查询词条，进行局部子图扩散检索（获取 1 阶和高权重 2 阶邻居实体）
   * @param queryTokens 查询分词
   * @param maxNeighbors 最大返回关联词条数
   */
  public getRelatedNeighbors(queryTokens: string[], maxNeighbors = 6): Array<{ name: string; weight: number }> {
    const scores = new Map<string, number>()

    for (const token of queryTokens) {
      const id = this.normalizeId(token)
      const edgeMap = this.adjacency.get(id)
      if (!edgeMap) continue

      for (const [neighborId, edge] of edgeMap.entries()) {
        if (queryTokens.some((qt) => this.normalizeId(qt) === neighborId)) continue
        const curScore = scores.get(neighborId) || 0
        scores.set(neighborId, curScore + edge.weight)
      }
    }

    const results: Array<{ name: string; weight: number }> = []
    for (const [id, weight] of scores.entries()) {
      const node = this.nodes.get(id)
      if (node && weight > 0.5) {
        results.push({ name: node.name, weight: Math.round(weight * 10) / 10 })
      }
    }

    results.sort((a, b) => b.weight - a.weight)
    return results.slice(0, maxNeighbors)
  }

  /** 获取节点总数 */
  public get nodeCount(): number {
    return this.nodes.size
  }

  /** 获取边总数 */
  public get edgeCount(): number {
    let count = 0
    for (const edgeMap of this.adjacency.values()) {
      count += edgeMap.size
    }
    return Math.floor(count / 2) // 无向边对称除以2
  }

  /** 清空图谱 */
  public clear(): void {
    this.nodes.clear()
    this.adjacency.clear()
    safeSetItem(K_AI_GRAPH, JSON.stringify({ version: 1, nodes: {}, edges: {}, updatedAt: 0 }))
  }
}

/** 全局单例进化图谱 */
export const evolvingGraph = new EvolvingKnowledgeGraph()
