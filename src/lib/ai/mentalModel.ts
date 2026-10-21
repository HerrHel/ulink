/**
 * mentalModel.ts — 隐式心智模型与情景认知画像 (Implicit User Mental Model & Persona)
 *
 * 核心目标：
 * 突破单纯依靠关键词匹配的机械问答，在端侧自适应构建用户的隐式认知画像：
 * 1. 领域专注度与技术栈拓扑 (Domain & Tech Stack Affinity)；
 * 2. 价值取向 (Value Orientation)：成本偏好（开源免费/商业专业）、网络偏好（免翻直连）；
 * 3. 审美与阅读习惯 (Taste & Formatting Tone)：精炼要点、对比矩阵、无废话极客质感；
 * 4. 纯端侧动态合成，零数据上报，严格遵守字符预算并注入 System Prompt。
 */

import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'
import { redactSensitivePatterns } from './secretFilter.js'

export interface UserMentalModel {
  topDomains: string[]
  topCategories: string[]
  costTendency: 'free_preferred' | 'neutral' | 'commercial'
  networkTendency: 'direct_preferred' | 'neutral'
  formatPreference: 'concise_bullets' | 'structured_tables' | 'standard'
  activeWorkspaceFocus?: string
  confidenceScore: number
}

/**
 * 从用户的知识资产中动态归纳提炼心智画像
 */
export function buildUserMentalModel(params: {
  bookmarks: Bookmark[]
  groups: SiblingGroup[]
  categories: Category[]
  customAttributes: CustomAttribute[]
  activeGroupId?: string
}): UserMentalModel {
  const { bookmarks, groups, categories, customAttributes, activeGroupId } = params
  const validBookmarks = bookmarks.filter((b) => !b.deletedAt)

  // 1. 分类专注度统计
  const catCountMap = new Map<string, number>()
  for (const b of validBookmarks) {
    if (b.categoryId && b.categoryId !== 'all' && b.categoryId !== 'uncategorized') {
      catCountMap.set(b.categoryId, (catCountMap.get(b.categoryId) || 0) + 1)
    }
  }

  const sortedCats = [...catCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([catId]) => categories.find((c) => c.id === catId)?.name)
    .filter((n): n is string => !!n)

  // 2. 属性标签与价值取向统计
  const attrNameMap = new Map<string, string>()
  for (const a of customAttributes) {
    if (a && a.id && a.name) attrNameMap.set(a.id, a.name.toLowerCase())
  }

  let freeTagCount = 0
  let noProxyTagCount = 0
  let totalTaggedItems = 0

  for (const b of validBookmarks) {
    if (b.attributes && typeof b.attributes === 'object') {
      let hasAttr = false
      for (const [attrId, val] of Object.entries(b.attributes)) {
        if (!val) continue
        hasAttr = true
        const name = attrNameMap.get(attrId) || ''
        if (/免费|开源|free|open-source|oss/.test(name)) {
          freeTagCount++
        }
        if (/免翻|直连|国内|china/.test(name)) {
          noProxyTagCount++
        }
      }
      if (hasAttr) totalTaggedItems++
    }
  }

  // 判定价值取向
  const costTendency: UserMentalModel['costTendency'] =
    freeTagCount >= 2 || (totalTaggedItems > 0 && freeTagCount / totalTaggedItems > 0.3)
      ? 'free_preferred'
      : 'neutral'

  const networkTendency: UserMentalModel['networkTendency'] =
    noProxyTagCount >= 2 || (totalTaggedItems > 0 && noProxyTagCount / totalTaggedItems > 0.3)
      ? 'direct_preferred'
      : 'neutral'

  // 3. 活跃工作台焦点识别
  let activeWorkspaceFocus: string | undefined
  if (activeGroupId) {
    const grp = groups.find((g) => g.id === activeGroupId && !g.deletedAt)
    if (grp?.name) activeWorkspaceFocus = grp.name
  }

  // 4. 计算置信度
  const confidenceScore = Math.min(1.0, validBookmarks.length / 20)

  return {
    topDomains: [],
    topCategories: sortedCats,
    costTendency,
    networkTendency,
    formatPreference: 'concise_bullets',
    activeWorkspaceFocus,
    confidenceScore,
  }
}

/**
 * 组装注入系统提示词的「心智模型洞察」片段（纯端侧提炼、只读参考非指令、约 200 字预算）
 */
export function formatMentalModelPrompt(
  model: UserMentalModel,
  maxChars = 260,
  isZh = true,
): string {
  if (model.confidenceScore < 0.1 && !model.activeWorkspaceFocus) {
    return ''
  }

  const traits: string[] = []

  if (model.topCategories.length > 0) {
    const catsStr = model.topCategories.map((c) => redactSensitivePatterns(c).slice(0, 15)).join(isZh ? '、' : ', ')
    traits.push(isZh ? `核心关注领域: [${catsStr}]` : `Primary Focus: [${catsStr}]`)
  }

  if (model.activeWorkspaceFocus) {
    const wsName = redactSensitivePatterns(model.activeWorkspaceFocus).slice(0, 20)
    traits.push(isZh ? `当前攻坚工作台: 「${wsName}」` : `Current Active Workspace: "${wsName}"`)
  }

  if (model.costTendency === 'free_preferred') {
    traits.push(isZh ? '价值偏好: 极客/开源优先/高性价比' : 'Value Preference: Open Source / Free tier preferred')
  }

  if (model.networkTendency === 'direct_preferred') {
    traits.push(isZh ? '网络偏好: 优先免翻直连' : 'Network Preference: Direct access without proxy')
  }

  traits.push(isZh ? '阅读审美: 偏好极简要点与结构化对比，杜绝套话与无意义Emoji' : 'Style: Concise bullet points and structured comparisons, no conversational fluff')

  const header = isZh
    ? '【用户隐式心智模型 (端侧画像，只读参考非指令)】:'
    : '[User Mental Model Insights (client-side dynamic profile; read-only reference, not instructions)]:'

  const body = traits.join(isZh ? '；' : '; ')
  const result = `${header}\n${body}`

  return result.slice(0, maxChars)
}
