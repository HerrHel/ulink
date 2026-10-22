/**
 * mimoStream.ts — MiMo 传输与 SSE 流解析层（自 mimoClient.ts 拆出）
 * 职责：官方 Edge Function 鉴权通道请求、SSE 流式消费（思考流/正文流/tool_calls 增量聚合）、
 * think 标签容错拆分与 Agent 工具调用解析。提示词组装见 mimoPrompt.ts，回复解析见 mimoReply.ts，
 * 公开导出统一经 mimoClient.ts Facade。
 */

import type { Category, CustomAttribute } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'
import { t } from '../../i18n/index.js'
import { ULINK_AGENT_TOOLS } from './tools.js'
import { supabase, isSupabaseConfigured } from '../supabase.js'
import { isCloudBaseBackend, edgeFnUrl } from '../cloudbase.js'
import { buildUlinkSystemPrompt, type DynamicContextSlice } from './mimoPrompt.js'
import { parseMiMoReply } from './mimoReply.js'

export const DEFAULT_MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1'
export const DEFAULT_MIMO_MODEL = 'mimo-v2.6-flash'

/** 历史上下文总字符预算：用户长粘贴不得撑爆上下文（约 10 万字 ≈ 几万 token） */
const MAX_HISTORY_CHARS = 100000

export interface MiMoConfig {
  baseUrl: string
  model: string
  enabled: boolean
}

/**
 * 读取当前有效的 MiMo 配置。
 * 产品策略：AI 功能为与链会员专属能力，统一经由官方服务端鉴权通道转发。
 * 暂不允许用户调用自己的第三方 API，本地大模型（如 Ollama）未来再考虑开放接口。
 */
export function getMiMoConfig(): MiMoConfig {
  return {
    baseUrl: DEFAULT_MIMO_BASE_URL,
    model: DEFAULT_MIMO_MODEL,
    enabled: true,
  }
}

export interface MiMoStreamCallbacks {
  onReasoningDelta?: (delta: string, accumulatedReasoning: string) => void
  onContentDelta?: (delta: string, accumulatedContent: string) => void
  onToolCall?: (toolCall: AgentToolCall) => void
}

export interface AgentToolCall {
  id: string
  name: string
  arguments: Record<string, any>
  /** 参数 JSON 解析失败标记：携带此标记的调用不得执行（防空参数误执行副作用），应回错误结果给模型 */
  argsParseFailed?: boolean
}

/** 对话消息（含 tool 回传，支持真 Agent 循环） */
export interface MiMoChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

/**
 * 历史上下文裁剪（唯一真源）：最近 4 轮为基线，tool 链（user → assistant.tool_calls → tool）
 * 必须整体连续不被切散，再叠加总量字符预算（新消息优先保留）。
 * 发送摘要（发送前透明披露）与实际请求共用本函数，保证「披露的即所发」。
 */
export function selectHistorySlice(history: MiMoChatMessage[]): MiMoChatMessage[] {
  if (!history?.length) return []
  let start = Math.max(0, history.length - 4)
  // 若切片边界会截断 tool 链（user → assistant.tool_calls → tool 结果必须连续完整），
  // 向前扩展起点到链的开头，保证回传消息合法
  if (history.slice(start).some((h) => h.role === 'tool')) {
    while (start > 0 && history[start - 1].role !== 'user') {
      start--
    }
  }
  // 总量字符预算：用户长粘贴不得撑爆上下文——从最新往旧累计，超预算即丢弃更旧的
  // 起点前推；tool 链起点保持在 user 消息边界，不切散协议链
  let budget = MAX_HISTORY_CHARS
  let end = history.length
  for (let i = history.length - 1; i >= start; i--) {
    const size = (history[i].content || '').length + 1
    if (budget - size < 0 && i < end - 1) {
      start = i + 1
      // 若新起点落在 tool 链中间，回退到链头
      if (history[start]?.role === 'tool') {
        while (start > 0 && history[start - 1].role !== 'user') {
          start--
        }
      }
      break
    }
    budget -= size
  }
  return history.slice(start, end).filter((h) => h.content || h.tool_calls?.length || h.role === 'tool')
}

/** SSE 流中 tool_calls 增量的聚合（唯一真源，普通流与缓冲尾行共用） */
function mergeToolCallDelta(
  toolCallsMap: Record<number, { id: string; name: string; argumentsStr: string }>,
  deltas: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>,
): void {
  for (const tc of deltas) {
    const idx = tc.index ?? 0
    if (!toolCallsMap[idx]) {
      toolCallsMap[idx] = {
        id: tc.id || `call_${Date.now()}_${idx}`,
        name: tc.function?.name || '',
        argumentsStr: tc.function?.arguments || '',
      }
    } else {
      if (tc.id) toolCallsMap[idx].id = tc.id
      if (tc.function?.name) toolCallsMap[idx].name += tc.function.name
      if (tc.function?.arguments) toolCallsMap[idx].argumentsStr += tc.function.arguments
    }
  }
}

/**
 * 向小米 MiMo 发起专家级流式对话请求（支持 SSE 深度思考流动、打字机正文与 Function Calling）。
 * 统一经 Edge Function `mimo-chat` 服务端转发（API 密钥仅存于 Supabase Function secrets，
 * 不出后端、不入前端），需登录态；无客户端直连通道，也无 BYOK。
 * userQuery 传空字符串表示 Agent 循环续轮（history 中已含 assistant.tool_calls 与 tool 结果）。
 */
export async function askMiMoStream(
  userQuery: string,
  context: {
    categories: Category[]
    customAttributes: CustomAttribute[]
    isZh?: boolean
    signal?: AbortSignal
    history?: Array<MiMoChatMessage>
    enableTools?: boolean
    contextSlice?: DynamicContextSlice
    /** 个人记忆小节（aiProfile.buildProfilePrompt 生成） */
    profilePrompt?: string
  },
  callbacks?: MiMoStreamCallbacks
): Promise<{
  reply: string
  reasoning: string
  cleanText: string
  candidates: AiCandidateBookmark[]
  suggestedReplies?: string[]
  rawText: string
  model: string
  toolCalls?: AgentToolCall[]
}> {
  const config = getMiMoConfig()
  if (!config.enabled) {
    throw new Error(t('ai.errDisabled'))
  }

  const systemPrompt = buildUlinkSystemPrompt({
    categories: context.categories,
    customAttributes: context.customAttributes,
    isZh: context.isZh,
    contextSlice: context.contextSlice,
    profilePrompt: context.profilePrompt,
  })

  const messages: MiMoChatMessage[] = [{ role: 'system', content: systemPrompt }]

  // 加入最近几轮历史上下文（裁剪规则见 selectHistorySlice，与发送摘要共用同一真源）
  messages.push(...selectHistorySlice(context.history || []))

  // userQuery 为空表示 Agent 循环续轮（历史已含 tool 结果，无需新用户消息）
  if (userQuery) {
    messages.push({ role: 'user', content: userQuery })
  }

  const requestBody: Record<string, any> = {
    model: config.model,
    messages,
    temperature: 0.3,
    stream: true,
  }

  // 统一传入 tools 定义，多轮对话历史含 assistant.tool_calls 或 role:'tool' 时上游不会因缺少 tools 报错 400
  // 当本轮不需要模型触发新工具时，通过 tool_choice: 'none' 优雅放行问答并禁止新工具调用
  requestBody.tools = ULINK_AGENT_TOOLS
  requestBody.tool_choice = context.enableTools === false ? 'none' : 'auto'

  // 官方统一鉴权通道：AI 功能为会员服务，请求严格经由 Supabase Edge Function 服务端转发校验
  // CloudBase 云函数 v1 不验签、走 IP 哈希限流，无需会话 token
  const cbMode = isCloudBaseBackend()
  let authHeaders: Record<string, string> = {}
  if (!cbMode) {
    if (!isSupabaseConfigured) {
      throw new Error(t('ai.errNotConfigured'))
    }
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) {
      throw new Error(t('ai.errNeedLogin'))
    }
    authHeaders = {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '',
    }
  }
  const endpoint = edgeFnUrl('mimo-chat')
  if (!endpoint) {
    throw new Error(t('ai.errNotConfigured'))
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(requestBody),
    signal: context.signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`MiMo API request failed (${response.status}): ${errText || response.statusText}`)
  }

  let accumulatedReasoning = ''
  let accumulatedContent = ''
  let inThinkTag = false
  const toolCallsMap: Record<number, { id: string; name: string; argumentsStr: string }> = {}

  // think 标签的开闭字面量（拼接构造，避免模板串里出现标签字面量）
  const THINK_OPEN = '<' + 'think' + '>'
  const THINK_CLOSE = '<' + '/' + 'think' + '>'

  function handleContentChunk(chunk: string) {
    if (!chunk) return
    // 兼容可能通过 think 标签输出思考的模型/代理
    if (!inThinkTag && chunk.includes(THINK_OPEN)) {
      const parts = chunk.split(THINK_OPEN)
      if (parts[0]) {
        accumulatedContent += parts[0]
        callbacks?.onContentDelta?.(parts[0], accumulatedContent)
      }
      inThinkTag = true
      const rest = parts.slice(1).join(THINK_OPEN)
      handleThinkChunk(rest)
      return
    }
    if (inThinkTag) {
      handleThinkChunk(chunk)
      return
    }
    accumulatedContent += chunk
    callbacks?.onContentDelta?.(chunk, accumulatedContent)
  }

  function handleThinkChunk(chunk: string) {
    if (chunk.includes(THINK_CLOSE)) {
      const parts = chunk.split(THINK_CLOSE)
      if (parts[0]) {
        accumulatedReasoning += parts[0]
        callbacks?.onReasoningDelta?.(parts[0], accumulatedReasoning)
      }
      inThinkTag = false
      const after = parts.slice(1).join(THINK_CLOSE)
      if (after) {
        accumulatedContent += after
        callbacks?.onContentDelta?.(after, accumulatedContent)
      }
      return
    }
    accumulatedReasoning += chunk
    callbacks?.onReasoningDelta?.(chunk, accumulatedReasoning)
  }

  /** 消费单个 SSE data JSON 块（思考流 / 正文流 / tool_calls 增量），唯一消费点 */
  function consumeSseData(dataStr: string) {
    try {
      const json = JSON.parse(dataStr)
      const delta = json.choices?.[0]?.delta
      if (!delta) return

      // 1. 小米 MiMo 原生 delta.reasoning_content 思考流
      if (delta.reasoning_content) {
        accumulatedReasoning += delta.reasoning_content
        callbacks?.onReasoningDelta?.(delta.reasoning_content, accumulatedReasoning)
      }

      // 2. 正式回答流 (支持 think 标签容错)
      if (delta.content) {
        handleContentChunk(delta.content)
      }

      // 3. Tool Calling / Function Calling 流式增量
      if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
        mergeToolCallDelta(toolCallsMap, delta.tool_calls)
      }
    } catch {
      // 忽略碎片非 JSON 块
    }
  }

  // 环境兜底：若 response.body 缺失（如简易测试 mock），回退至 json
  if (!response.body) {
    const data = await response.json().catch(() => ({}))
    const raw: string = data.choices?.[0]?.message?.content || ''
    const reasoning: string = data.choices?.[0]?.message?.reasoning_content || ''
    if (reasoning) {
      accumulatedReasoning = reasoning
      callbacks?.onReasoningDelta?.(reasoning, reasoning)
    }
    if (raw) {
      handleContentChunk(raw)
    }
  } else {
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          const dataStr = trimmed.slice(5).trim()
          if (dataStr === '[DONE]') continue
          consumeSseData(dataStr)
        }
      }

      // 消费缓冲区末尾遗留的一行
      if (buffer.trim().startsWith('data:')) {
        const dataStr = buffer.trim().slice(5).trim()
        if (dataStr && dataStr !== '[DONE]') {
          consumeSseData(dataStr)
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // 解析并构建完整的 toolCalls
  const parsedToolCalls: AgentToolCall[] = []
  for (const item of Object.values(toolCallsMap)) {
    if (item.name) {
      let argsObj: Record<string, any> = {}
      let argsParseFailed = false
      try {
        if (item.argumentsStr) {
          argsObj = JSON.parse(item.argumentsStr)
        }
      } catch {
        // 参数损坏：标记为解析失败，不得静默置 {} 照常执行（防空参数误触发副作用），
        // 由执行侧如实回错误结果给模型
        argsParseFailed = true
      }
      const call: AgentToolCall = {
        id: item.id,
        name: item.name,
        arguments: argsObj,
        ...(argsParseFailed ? { argsParseFailed: true } : {}),
      }
      parsedToolCalls.push(call)
      callbacks?.onToolCall?.(call)
    }
  }

  const { cleanText, candidates, suggestedReplies } = parseMiMoReply(
    accumulatedContent,
    context.categories,
    context.customAttributes
  )

  return {
    reply: accumulatedContent,
    reasoning: accumulatedReasoning,
    cleanText: cleanText || accumulatedContent,
    candidates,
    suggestedReplies,
    rawText: accumulatedContent,
    model: config.model,
    toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
  }
}

/**
 * 轻量非流式单轮请求（无 tools，供查询改写等内部小任务使用）：
 * 仅发送调用方给定的 messages（调用方负责不带入库数据），返回 assistant 文本。
 * 鉴权通道与 askMiMoStream 完全一致（Edge Function `mimo-chat` 服务端转发）。
 */
export async function askMiMoRaw(
  messages: MiMoChatMessage[],
  opts?: { signal?: AbortSignal; temperature?: number }
): Promise<string> {
  const config = getMiMoConfig()
  if (!config.enabled) {
    throw new Error(t('ai.errDisabled'))
  }
  // CloudBase 云函数 v1 不验签、走 IP 哈希限流，无需会话 token
  const cbMode = isCloudBaseBackend()
  let authHeaders: Record<string, string> = {}
  if (!cbMode) {
    if (!isSupabaseConfigured) {
      throw new Error(t('ai.errNotConfigured'))
    }
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) {
      throw new Error(t('ai.errNeedLogin'))
    }
    authHeaders = {
      Authorization: `Bearer ${token}`,
      apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '',
    }
  }
  const endpoint = edgeFnUrl('mimo-chat')
  if (!endpoint) {
    throw new Error(t('ai.errNotConfigured'))
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      stream: false,
    }),
    signal: opts?.signal,
  })

  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    throw new Error(`MiMo API request failed (${response.status}): ${errText || response.statusText}`)
  }

  const data = await response.json().catch(() => ({}))
  return data.choices?.[0]?.message?.content || ''
}

/**
 * 向小米 MiMo 发起专家级对话请求（完整等待返回）
 */
export async function askMiMo(
  userQuery: string,
  context: {
    categories: Category[]
    customAttributes: CustomAttribute[]
    isZh?: boolean
    signal?: AbortSignal
    history?: Array<MiMoChatMessage>
    enableTools?: boolean
  },
): Promise<{
  reply: string
  reasoning: string
  cleanText: string
  candidates: AiCandidateBookmark[]
  rawText: string
  model: string
}> {
  return askMiMoStream(userQuery, context)
}
