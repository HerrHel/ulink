/**
 * siteCommands/types.ts — 站内指令块处理器统一接口（dispatchSiteCommand 拆分进行中）
 * 职责：
 * 1. SiteCommandResult 命令结果类型（自 siteCommander.ts 迁出，公开符号经其 re-export 保持不变）；
 * 2. SiteCommandBlockCtx / SiteCommandBlock：编号意图块处理器的上下文与返回契约
 *    （返回 null = 未命中该块继续 fall-through，返回 SiteCommandResult 即短路）。
 */

import type { useDataStore } from '../../../stores/data.js'
import type { useUIStore } from '../../../stores/ui.js'
import type { useAppStore } from '../../../stores/app.js'
import type { ChatTurnStep, ChatActionCard } from '../chatSessions.js'

export interface SiteCommandResult {
  handled: boolean
  reply: string
  action?: string
  success?: boolean
  details?: Record<string, unknown>
  steps?: ChatTurnStep[]
  actionCard?: ChatActionCard
  suggestedReplies?: string[]
}

/** 指令块处理器上下文（由 dispatchSiteCommand 组装注入） */
export interface SiteCommandBlockCtx {
  query: string
  ds: ReturnType<typeof useDataStore>
  ui: ReturnType<typeof useUIStore>
  app: ReturnType<typeof useAppStore>
  /** 中止信号（来自 dispatchSiteCommand 的 SiteCommanderContext）：HITL 确认后校验「停止生成」 */
  signal?: AbortSignal
}

/** 返回 null 表示未命中该块，继续下一块；返回 SiteCommandResult 即短路 */
export type SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
) => Promise<SiteCommandResult | null> | SiteCommandResult | null
