/**
 * cloudAiClient.ts — 与链商业化 AI 矩阵云端客户端服务（Facade）
 * 封装：意图寻站、类似平替挖掘、视频收割提取、存量书签主动补齐
 * 核心机制：全自动利用当前用户的 categories 与 attributes 进行上下文预匹配，
 * 生成对齐与链 Schema 的候选卡片，支持用户一键零摩擦秒存。
 *
 * 分层实现（本文件只做公开导出聚合，保证调用方模块 ID 不变）：
 * - cloudCandidates.ts — 候选站点生成（意图寻站 / 平替挖掘 / 偏好过滤与上下文预匹配）
 * - deepLinkExtract.ts — 文本深挖链接纯函数（来源分区标注）
 * - videoHarvest.ts    — 视频/分享内容收割（extractBookmarksFromVideo）
 * - bookmarkEnrich.ts  — 存量书签补齐（enrichBookmarkMetadata）
 */

export { searchWebsitesByIntent, findSimilarWebsites } from './cloudCandidates.js'
export { extractDeepLinksFromText } from './deepLinkExtract.js'
export type { DeepLinkSource, DeepLinkHit } from './deepLinkExtract.js'
export { extractBookmarksFromVideo } from './videoHarvest.js'
export { enrichBookmarkMetadata } from './bookmarkEnrich.js'
