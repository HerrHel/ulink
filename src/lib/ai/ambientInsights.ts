/**
 * ambientInsights.ts — 环境智能聚合中枢与生命周期管理 (Ambient Insights Hub)
 *
 * 核心目标：
 * 统一收敛与调度来自「知识偶遇引擎」与「静默治理扫描器」的环境洞察，
 * 提供本地持久化、防重复弹出、忽略与单键直达行动。
 */

import { safeGetItem, safeSetItem, safeJsonParse } from '../storageSafe.js'
import type { Bookmark, Category, SiblingGroup } from '../../types.js'
import { runAmbientGroomingScan } from './ambientGrooming.js'
import { findSerendipityMatches } from './serendipityEngine.js'
import { t } from '../../i18n/index.js'
import { ref } from 'vue'

export const K_AI_AMBIENT = 'lv_ai_ambient_v1'

export type AmbientInsightCategory = 'serendipity' | 'grooming'

export interface AmbientInsightItem {
  id: string
  category: AmbientInsightCategory
  type: string
  title: string
  description: string
  severity: 'suggestion' | 'attention' | 'serendipity'
  sourceId?: string
  targetId?: string
  actionCommand?: string
  actionName?: string
  actionPayload?: Record<string, unknown>
  createdAt: number
  dismissed?: boolean
}

/** 响应式活跃环境洞察列表 */
export const activeAmbientInsights = ref<AmbientInsightItem[]>([])

export class AmbientInsightsHub {
  private insights: AmbientInsightItem[] = []
  private dismissedIds: Set<string> = new Set()

  constructor() {
    this.loadFromStorage()
  }

  private syncReactive(): void {
    activeAmbientInsights.value = this.getActiveInsights()
  }

  public loadFromStorage(): void {
    const raw = safeJsonParse<{
      insights?: AmbientInsightItem[]
      dismissed?: string[]
    }>(safeGetItem(K_AI_AMBIENT), { insights: [], dismissed: [] })

    this.insights = Array.isArray(raw.insights) ? raw.insights : []
    this.dismissedIds = new Set(Array.isArray(raw.dismissed) ? raw.dismissed : [])
    this.syncReactive()
  }

  public saveToStorage(): void {
    safeSetItem(
      K_AI_AMBIENT,
      JSON.stringify({
        insights: this.insights.slice(0, 30),
        dismissed: [...this.dismissedIds].slice(0, 100),
      }),
    )
    this.syncReactive()
  }

  /**
   * 获取所有未被忽略的有效洞察列表
   */
  public getActiveInsights(): AmbientInsightItem[] {
    return this.insights.filter((i) => !i.dismissed && !this.dismissedIds.has(i.id))
  }

  /**
   * 当用户保存/更新书签时，触发单点偶遇探测
   */
  public triggerSerendipityCheck(target: Bookmark, allBookmarks: Bookmark[]): AmbientInsightItem | null {
    const matches = findSerendipityMatches(target, allBookmarks, { maxMatches: 1 })
    if (matches.length === 0) return null

    const match = matches[0]
    const insightId = `serendipity-${target.id}-${match.candidate.id}`
    if (this.dismissedIds.has(insightId)) return null

    // 检查是否已存在同类洞察
    const exists = this.insights.some((i) => i.id === insightId)
    if (exists) return null

    const conceptsStr = match.commonConcepts.length ? `（交集: ${match.commonConcepts.join(' / ')}）` : ''
    const item: AmbientInsightItem = {
      id: insightId,
      category: 'serendipity',
      type: 'serendipity',
      title: t('ai.ambientSerendipityTitle', { current: target.title || '当前书签', related: match.candidate.title }),
      description: `${match.reason}${conceptsStr}。建议建立两者的对比沉淀或放入同一工作台。`,
      severity: 'serendipity',
      sourceId: target.id,
      targetId: match.candidate.id,
      actionCommand: `帮我深度对比「${target.title}」与「${match.candidate.title}」的定位与差异`,
      actionName: 'compare_cards',
      createdAt: Date.now(),
    }

    this.insights.unshift(item)
    this.saveToStorage()
    return item
  }

  /**
   * 刷新环境静默治理洞察
   */
  public refreshGroomingScan(params: {
    bookmarks: Bookmark[]
    groups: SiblingGroup[]
    categories: Category[]
  }): void {
    const rawGrooming = runAmbientGroomingScan(params)
    // 移除旧的非偶遇洞察并替换为最新扫描结果
    const serendipityItems = this.insights.filter((i) => i.category === 'serendipity')

    const newGroomingItems: AmbientInsightItem[] = rawGrooming
      .filter((g) => !this.dismissedIds.has(g.id))
      .map((g) => ({
        id: g.id,
        category: 'grooming',
        type: g.type,
        title: g.title,
        description: g.description,
        severity: g.severity,
        targetId: g.targetCategoryId,
        actionCommand: g.suggestedActionCommand,
        actionName: g.suggestedActionName,
        createdAt: Date.now(),
      }))

    this.insights = [...newGroomingItems, ...serendipityItems]
    this.saveToStorage()
  }

  /**
   * 忽略单条洞察
   */
  public dismissInsight(id: string): void {
    this.dismissedIds.add(id)
    const target = this.insights.find((i) => i.id === id)
    if (target) {
      target.dismissed = true
    }
    this.saveToStorage()
  }

  /**
   * 清空全部洞察
   */
  public clearAll(): void {
    for (const i of this.insights) {
      this.dismissedIds.add(i.id)
    }
    this.insights = []
    this.saveToStorage()
  }
}

/** 全局单例环境智能聚合中枢 */
export const ambientHub = new AmbientInsightsHub()
