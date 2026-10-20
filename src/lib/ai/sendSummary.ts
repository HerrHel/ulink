/**
 * sendSummary.ts — 发送前透明摘要（纯函数，零网络）
 * 职责：在请求发往模型前，如实汇总「本次发送给 AI 的数据」：注入的分类/标签条数、
 * 工作台/多选切片条数与截断情况、关联卡片数、全库检索注入量、历史上下文轮数与字符规模。
 * 供 ChatStream 用户气泡下的可展开摘要条展示（放心 / 隐私透明）。
 *
 * 「披露的即所发」：历史裁剪复用 mimoStream.selectHistorySlice，系统提示词按
 * buildUlinkSystemPrompt 真实组装口径统计，避免摘要与实际请求脱节。
 */
import type { Category, CustomAttribute } from '../../types.js'
import { buildUlinkSystemPrompt, type DynamicContextSlice } from './mimoPrompt.js'
import { selectHistorySlice, type MiMoChatMessage } from './mimoStream.js'

export interface AiSendSummary {
  /** 注入系统提示词的分类条数（不含 all/uncategorized 虚拟项） */
  categoriesCount: number
  /** 注入系统提示词的标签属性条数 */
  attributesCount: number
  /** 聚焦工作台切片：shown = 实际注入条数，total = 组内有效书签总数（shown < total 即被截断） */
  focusedGroup?: { name: string; shown: number; total: number }
  /** 多选书签切片：shown = 实际注入条数，total = 勾选总数 */
  selected?: { shown: number; total: number }
  /** 用户拖入关联卡片/笔记条数 */
  attachedCardsCount: number
  /** 全库知识检索注入字符数（0 = 未注入） */
  vaultKnowledgeChars: number
  /** 个人记忆实际注入条数（0 = 未注入） */
  profileEntries: number
  /** 历史上下文实际注入条数（经最近轮次 + 字符预算裁剪后） */
  historyTurnsIncluded: number
  /** 本轮用户提问（含附件展开）字符数 */
  userPromptChars: number
  /** 系统提示词字符数 */
  systemPromptChars: number
  /** 估算发送总字符数（系统提示 + 本轮提问 + 历史切片 + 全库检索） */
  estimatedTotalChars: number
}

export interface AiSendSummaryInput {
  categories: Category[]
  customAttributes: CustomAttribute[]
  contextSlice: DynamicContextSlice
  /** 聚焦工作台内有效书签总数（截断前）；缺省按注入条数视为未截断 */
  focusedGroupTotal?: number
  /** 多选书签总数（截断前）；缺省按注入条数视为未截断 */
  selectedTotal?: number
  /** 未裁剪的历史消息 */
  history: MiMoChatMessage[]
  /** 本轮实际发送的用户消息（含附件展开） */
  userPrompt: string
  /** 注入系统提示词的个人记忆小节（aiProfile.buildProfilePrompt 产物，与请求同源） */
  profilePrompt?: string
}

/** 汇总本次发送给 AI 的数据摘要（与实际请求同口径组装） */
export function buildSendSummary(input: AiSendSummaryInput): AiSendSummary {
  const slice = input.contextSlice || {}
  const systemPrompt = buildUlinkSystemPrompt({
    categories: input.categories,
    customAttributes: input.customAttributes,
    contextSlice: slice,
    profilePrompt: input.profilePrompt,
  })
  const historySlice = selectHistorySlice(input.history || [])
  const historyChars = historySlice.reduce((n, m) => n + (m.content || '').length, 0)
  const vaultKnowledgeChars = slice.retrievedVaultKnowledge?.length || 0
  const userPromptChars = (input.userPrompt || '').length
  const systemPromptChars = systemPrompt.length

  return {
    // 与 buildUlinkSystemPrompt 的分类注入口径一致（虚拟项不注入）
    categoriesCount: input.categories.filter((c) => c.id !== 'all' && c.id !== 'uncategorized').length,
    attributesCount: input.customAttributes.length,
    focusedGroup: slice.focusedGroupName
      ? {
          name: slice.focusedGroupName,
          shown: slice.focusedGroupBookmarks?.length || 0,
          total: input.focusedGroupTotal ?? slice.focusedGroupBookmarks?.length ?? 0,
        }
      : undefined,
    selected: slice.selectedBookmarks?.length
      ? {
          shown: slice.selectedBookmarks.length,
          total: input.selectedTotal ?? slice.selectedBookmarks.length,
        }
      : undefined,
    attachedCardsCount: slice.attachedCards?.length || 0,
    vaultKnowledgeChars,
    // 如实统计实际注入的个人记忆条数（与请求同源的 profilePrompt 逐行计数）
    profileEntries: (input.profilePrompt || '').split('\n').filter((l) => l.startsWith('- ')).length,
    historyTurnsIncluded: historySlice.length,
    userPromptChars,
    systemPromptChars,
    estimatedTotalChars: systemPromptChars + userPromptChars + historyChars + vaultKnowledgeChars,
  }
}
