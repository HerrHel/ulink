/**
 * ai.ts — 与链商业化 AI 矩阵核心类型定义
 */

/** 智能寻站与平替挖掘的偏好预设标签 */
export type AiSearchPreference =
  | 'free'          // 完全免费（无隐藏付费套路）
  | 'no_proxy'      // 国内免翻（国内网络直连）
  | 'lightweight'   // 轻量免登（免安装无客户端、纯网页开箱即用）
  | 'open_source'   // 极客开源（GitHub 高星、可自建部署）
  | 'professional'  // 专业商业（成熟生态、团队协同标杆）

/** AI 探宝/相似推荐的候选书签实体（与链卡片形态展示，支持点击秒存） */
export interface AiCandidateBookmark {
  id?: string
  title: string
  url: string
  notes: string
  categoryId?: string
  suggestedAttrIds?: string[]
  icon?: string
  tag?: string          // 业务胶囊，如“开源平替”、“国内直连”、“免登即用”
  highlight?: string    // 核心亮点一句话说明
  generic?: boolean     // 通用发现入口（非个性化结果），UI 摘要不得称「甄选」
  isAdded?: boolean     // 前端运行时状态：是否已被一键存入站内
}

/** 存量书签主动补齐 Diff 对比实体 */
export interface AiEnrichDiff {
  bookmarkId: string
  currentTitle: string
  suggestedTitle?: string
  currentNotes: string
  suggestedNotes: string
  currentCategoryId: string
  suggestedCategoryId?: string
  suggestedAttrIds: string[]
  reason?: string
}

/** 视频链接解析提炼结果 */
export interface AiVideoExtractResult {
  sourceUrl: string
  videoTitle: string
  groupTitle: string
  groupNotes: string
  bookmarks: AiCandidateBookmark[]
  /** 文字源总结速览（简介/字幕/评论区 → 大模型），无可用 AI 通道或失败时缺省 */
  summary?: string
}
