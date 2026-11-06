/**
 * sendSummary.ts — 发送前透明摘要（纯函数，零网络）
 * 职责：在请求发往模型前，如实汇总「本次发送给 AI 的数据」：注入的分类/标签条数、
 * 工作台/多选切片条数与截断情况、关联卡片数、全库检索注入量、历史上下文轮数与字符规模。
 * 供 ChatStream 用户气泡下的可展开摘要条展示（放心 / 隐私透明）。
 *
 * 「披露的即所发」：历史裁剪复用 mimoStream.selectHistorySlice，系统提示词按
 * buildUlinkSystemPrompt 真实组装口径统计，避免摘要与实际请求脱节。
 * 2026-11-07 修正：补上历史实现漏统计的 tools schema、媒体块、按关键词触发的
 * 隐式情境注入（未打标/回收站书签）、心智模型画像，以及分类/标签截断后的真实条数。
 */
import type { Category, CustomAttribute } from '../../types.js'
import { buildUlinkSystemPrompt, MAX_CATEGORY_NAMES, MAX_ATTR_NAMES, type DynamicContextSlice } from './mimoPrompt.js'
import { selectHistorySlice, type MiMoChatMessage } from './mimoStream.js'
import { ULINK_AGENT_TOOLS } from './tools.js'

export interface AiSendSummary {
  /** 注入系统提示词的分类条数（含虚拟项，供展示原始规模） */
  categoriesCount: number
  /** 注入系统提示词的标签属性条数 */
  attributesCount: number
  /** 分类名实际注入条数（截断后） */
  categoriesInjected: number
  /** 标签名实际注入条数（截断后） */
  attributesInjected: number
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
  /** 是否注入隐式心智模型画像 */
  hasMentalModel?: boolean
  /** 心智模型画像注入字符数 */
  mentalModelChars: number
  /** 按提问关键词触发的未打标书签注入条数（0 = 未注入） */
  untaggedInjected: number
  /** 按提问关键词触发的回收站书签注入条数（0 = 未注入） */
  trashedInjected: number
  /** 每轮必发的工具定义 schema 字符数（历史实现漏统计） */
  toolsSchemaChars: number
  /** 本轮媒体块个数（图片 / 音视频，历史实现漏统计） */
  mediaPartsCount: number
  /** 历史上下文实际注入条数（经最近轮次 + 字符预算裁剪后） */
  historyTurnsIncluded: number
  /** 本轮用户提问（含附件展开）字符数 */
  userPromptChars: number
  /** 系统提示词字符数 */
  systemPromptChars: number
  /** 估算发送总字符数（系统提示 + 本轮提问 + 历史切片 + 检索 + tools + 媒体） */
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
  /** 本轮媒体块个数（图片 / 音视频） */
  mediaPartsCount?: number
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
  const toolsSchemaChars = JSON.stringify(ULINK_AGENT_TOOLS).length
  const mediaPartsCount = input.mediaPartsCount || 0
  // 媒体块体积无法在此纯函数里准确估算（data URL / base64 由调用方生成），
  // 只计字符占位：避免摘要对外宣称「披露的即所发」却漏掉整块多模态载荷。
  const mentalModelChars = slice.mentalModelPrompt?.length || 0

  const categoriesCount = input.categories.filter(
    (c) => c.id !== 'all' && c.id !== 'uncategorized',
  ).length
  const attributesCount = input.customAttributes.length
  const categoriesInjected = Math.min(categoriesCount, MAX_CATEGORY_NAMES)
  const attributesInjected = Math.min(attributesCount, MAX_ATTR_NAMES)

  return {
    categoriesCount,
    attributesCount,
    categoriesInjected,
    attributesInjected,
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
    hasMentalModel: !!slice.mentalModelPrompt,
    mentalModelChars,
    untaggedInjected: slice.untaggedBookmarks?.length || 0,
    trashedInjected: slice.trashedBookmarks?.length || 0,
    toolsSchemaChars,
    mediaPartsCount,
    historyTurnsIncluded: historySlice.length,
    userPromptChars,
    systemPromptChars,
    estimatedTotalChars:
      systemPromptChars + userPromptChars + historyChars + vaultKnowledgeChars + toolsSchemaChars,
  }
}
