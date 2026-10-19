/**
 * mimoClient.ts — 小米 MiMo (mimo-v2.6-flash) 与链专属大模型客户端（Facade）
 *
 * 核心架构与商业化策略：
 * 1. 会员专属服务与统一托管通道：
 *    AI 功能定位为与链未来 Pro 会员专属能力，所有大模型调用严格由官方 Supabase Edge Function
 *    `mimo-chat` 进行服务端鉴权、配额管控与请求代理。
 *    暂不允许客户端调用用户自己的第三方 API，本地模型（如 Ollama）未来再考虑开放接口。
 * 2. 深度绑定「与链专家」提示词架构，动态注入端侧轻量混合 RAG 召回片段、工作台情境与操作规范；
 * 3. 用户数据注入前统一 sanitize（防提示词注入）并经 secretFilter 脱敏（防敏感凭证外泄）；
 * 4. 自动提炼与解析 ulink-card 结构化推荐卡片，无缝对接与链 Schema；
 * 5. 具备完备的超时控制、AbortSignal 中断响应以及优雅降级容错机制。
 *
 * 分层实现（本文件只做公开导出聚合，保证调用方模块 ID 不变）：
 * - mimoPrompt.ts — 提示词组装与数据消毒（buildUlinkSystemPrompt / sanitize*）
 * - mimoStream.ts — 官方通道传输与 SSE 流解析（askMiMoStream / askMiMo / getMiMoConfig）
 * - mimoReply.ts  — 回复解析（parseMiMoReply：ulink-card 候选卡提炼）
 */

export {
  DEFAULT_MIMO_BASE_URL,
  DEFAULT_MIMO_MODEL,
  getMiMoConfig,
  askMiMoStream,
  askMiMo,
} from './mimoStream.js'
export type { MiMoConfig, MiMoStreamCallbacks, AgentToolCall, MiMoChatMessage } from './mimoStream.js'

export { sanitizeForPrompt, sanitizeToolResult, buildUlinkSystemPrompt } from './mimoPrompt.js'
export type { DynamicContextSlice } from './mimoPrompt.js'

export { parseMiMoReply } from './mimoReply.js'
