/**
 * chatSessions.ts — AI 侧边栏历史会话管理与本地持久化
 * 职责：
 * 1. 负责多会话 (Sessions) 的创建、切换、更新与清理；
 * 2. 自动由首句输入提炼会话标题；
 * 3. 严格限制会话数 (20) 与单会话消息数 (30)，防 localStorage 溢出；
 * 4. 纯净函数 + storageSafe 兜底，与测试环境无缝兼容。
 */

import { safeGetItem, safeSetItem } from '../storageSafe.js'
import type { AiCandidateBookmark } from '../../types/ai.js'
import type { AiSendSummary } from './sendSummary.js'
import type { AttachedMediaFile } from './attachmentHelper.js'
import type { ToolExecStatus } from './toolResult.js'
import { redactSensitivePatterns } from './secretFilter.js'
import { isThreePartCipher } from '../../crypto.js'

export type { AttachedMediaFile }

export const K_AI_SESSIONS = 'lv_ai_sessions_v1'
export const K_AI_CUR_SESSION = 'lv_ai_cur_session_v1'
const MAX_SESSIONS = 20
const MAX_TURNS_PER_SESSION = 30

export interface ChatTurnStep {
  text: string
  done?: boolean
}

export interface ChatActionCard {
  type: 'dedup' | 'trash' | 'move' | 'clean' | 'custom' | 'draft_diff' | 'dag_plan'
  title: string
  desc?: string
  buttonText: string
  actionName: string
  executing?: boolean
  completed?: boolean
  resultGid?: string
  resultCatId?: string
  selectedCandidateUrls?: string[]
  payload?: Record<string, unknown>
}

/** 模型发起的工具调用（随 assistant 轮持久化，供多轮历史回传） */
export interface ChatToolCall {
  id: string
  name: string
  arguments?: Record<string, unknown>
}

/** 工具真实执行结果（随 assistant 轮持久化，多轮对话不再失忆） */
export interface ChatToolResult {
  toolCallId: string
  name: string
  resultText: string
  /** 语义状态：只有 executed 代表操作真的落地；proposed 只生成了待确认卡片 */
  status?: ToolExecStatus
}

export interface AttachedCardMeta {
  type: 'bm' | 'group' | 'cat'
  id: string
  title: string
  url?: string
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 拖拽关联的卡片/笔记附件元数据（持久化于历史会话） */
  attachedCards?: AttachedCardMeta[]
  /** 附加的文件/图片/视频列表 */
  attachedFiles?: AttachedMediaFile[]
  /** 包含完整注入附件数据的后台提示词（供多轮对话历史精准回溯） */
  promptContent?: string
  /** 发送前透明摘要：本次实际发给 AI 的数据构成（可展开查看，隐私透明） */
  sendSummary?: AiSendSummary
  candidates?: AiCandidateBookmark[]
  loading?: boolean
  timestamp: number
  steps?: ChatTurnStep[]
  actionCard?: ChatActionCard
  _traceOpen?: boolean
  reasoning?: string
  reasoningTimeMs?: number
  isThinking?: boolean
  _thinkingOpen?: boolean
  /** 本轮模型自主发起的工具调用 */
  toolCalls?: ChatToolCall[]
  /** 工具执行的真实结果（含展示用 resultText 与回传用 toolResultText） */
  toolResults?: ChatToolResult[]
  /** 工具调用前模型的首轮文本（多轮回传时还原 assistant→tool→assistant 协议链用） */
  preToolContent?: string
  /** 预判用户下一步最可能说的快捷小按钮 (Smart Quick-Action / Follow-up Pills) */
  suggestedReplies?: string[]
}

export interface AiChatSession {
  id: string
  title: string
  turns: ChatTurn[]
  createdAt: number
  updatedAt: number
}

/**
 * 会话是否仍为「未命名」空标题：空串为当前语义（标题文案由展示侧走 i18n），
 * '新会话' 为存量数据中的旧默认标题，仅作兼容识别，不作为新标题写入。
 */
export function isDefaultSessionTitle(title: string | undefined | null): boolean {
  return !title || title === '新会话'
}

/** 提取前 16 个字符作为会话标题（无可用文本时留空，展示侧回退到 i18n 默认标题） */
export function extractSessionTitle(query: string): string {
  const clean = query.trim().replace(/^[\/\s]+/, '')
  if (!clean || isThreePartCipher(clean)) return ''
  return clean.length > 16 ? clean.slice(0, 16) + '…' : clean
}

/** 从本地存储加载所有会话（元素级校验：坏数据/半截 JSON 不进会话列表） */
export function loadSessions(): AiChatSession[] {
  try {
    const raw = safeGetItem(K_AI_SESSIONS)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list
      .filter(
        (s): s is AiChatSession =>
          !!s && typeof s === 'object' && typeof s.id === 'string' && Array.isArray(s.turns),
      )
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } catch {
    return []
  }
}

/** 保存会话列表到本地存储 */
export function saveSessions(sessions: AiChatSession[]): void {
  try {
    // 缺陷2：可选文本字段统一脱敏，保持 undefined（字段缺失）语义与展示结构
    const redactText = (v: string | undefined): string | undefined =>
      v === undefined ? undefined : redactSensitivePatterns(v)
    // toolCalls.arguments 是对象：仅对其中字符串值脱敏，其余类型原样保留
    const redactArgs = (args: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
      if (!args) return args
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(args)) out[k] = typeof v === 'string' ? redactSensitivePatterns(v) : v
      return out
    }
    const trimmed = sessions.slice(0, MAX_SESSIONS).map((s) => ({
      ...s,
      turns: (s.turns || []).slice(-MAX_TURNS_PER_SESSION).map((t) => ({
        ...t,
        loading: false, // 存盘时 loading 必须置 false
        isThinking: false, // 存盘时 isThinking 置 false
        // 缺陷2：落盘前对全部文本字段统一脱敏（旧实现只覆盖 promptContent 与
        // toolResults[].resultText，content/steps/reasoning/... 曾明文落盘）。
        content: redactSensitivePatterns(t.content).slice(0, 20000),
        reasoning: redactText(t.reasoning)?.slice(0, 8000),
        preToolContent: redactText(t.preToolContent)?.slice(0, 8000),
        steps: t.steps?.map((step) => ({ ...step, text: redactSensitivePatterns(step.text).slice(0, 2000) })),
        toolCalls: t.toolCalls?.map((c) => ({ ...c, arguments: redactArgs(c.arguments) })),
        suggestedReplies: t.suggestedReplies?.map((r) => redactSensitivePatterns(r)),
        actionCard: t.actionCard
          ? { ...t.actionCard, desc: redactText(t.actionCard.desc) }
          : t.actionCard,
        // 避免多模态超大图片 Base64 击穿 localStorage 5MB 配额（保留 dataUrl 裁剪与 textContent 截断）
        attachedFiles: t.attachedFiles?.map((f) => ({
          ...f,
          dataUrl: f.dataUrl && f.dataUrl.length > 32768 ? undefined : f.dataUrl,
          textContent: f.textContent ? redactSensitivePatterns(f.textContent.slice(0, 4000)).slice(0, 4000) : undefined,
        })),
        promptContent: t.promptContent
          ? redactSensitivePatterns(t.promptContent.slice(0, 8000))
          : t.promptContent,
        toolResults: t.toolResults?.map((r) => ({
          ...r,
          resultText: redactSensitivePatterns(r.resultText).slice(0, 8000),
        })),
      })),
    }))
    // 配额护栏：localStorage 约 5MB（UTF-16 字符数口径）。单轮 reasoning/工具结果无上限时，
    // 长对话 + 多会话会直接超限；旧实现忽略 safeSetItem 返回值，内存里正常、刷新后整段丢失。
    const MAX_JSON_CHARS = 4_500_000
    let payload = trimmed
    let json = JSON.stringify(payload)
    while (json.length > MAX_JSON_CHARS && payload.length > 1) {
      payload = payload.slice(0, -1) // 丢最旧会话
      json = JSON.stringify(payload)
    }
    if (json.length > MAX_JSON_CHARS) {
      // 单个会话仍超限：只保留最近 5 轮并去掉可重建/大体积字段
      payload = payload.map((s) => ({
        ...s,
        turns: (s.turns || []).slice(-5).map((t) => ({
          ...t,
          reasoning: t.reasoning?.slice(0, 2000),
          content: t.content?.slice(0, 8000),
          promptContent: undefined,
          attachedFiles: undefined,
          toolResults: undefined,
        })),
      }))
      json = JSON.stringify(payload)
    }
    if (!safeSetItem(K_AI_SESSIONS, json)) {
      console.error('[ulink] saveSessions: localStorage 写入失败（配额满），本次会话未持久化')
    }
  } catch (e) {
    console.warn('[ulink] saveSessions failed:', e)
  }
}

/** 获取当前激活的会话 ID */
export function getCurrentSessionId(): string | null {
  return safeGetItem(K_AI_CUR_SESSION) || null
}

/** 设置当前激活的会话 ID */
export function setCurrentSessionId(id: string): void {
  safeSetItem(K_AI_CUR_SESSION, id)
}

/** 创建新会话 */
export function createNewSession(initialTitle?: string): AiChatSession {
  const now = Date.now()
  const session: AiChatSession = {
    id: 'session-' + now + '-' + Math.random().toString(36).slice(2, 6),
    title: initialTitle || '',
    turns: [],
    createdAt: now,
    updatedAt: now,
  }
  const all = loadSessions()
  all.unshift(session)
  saveSessions(all)
  setCurrentSessionId(session.id)
  return session
}

/** 更新会话的聊天记录与标题 */
export function updateSession(
  sessionId: string,
  turns: ChatTurn[],
  customTitle?: string,
): AiChatSession[] {
  const all = loadSessions()
  const idx = all.findIndex((s) => s.id === sessionId)
  const now = Date.now()

  if (idx > -1) {
    const cur = all[idx]
    const title = customTitle || (isDefaultSessionTitle(cur.title) && turns.length > 0 ? extractSessionTitle(turns[0].content) : cur.title)
    all[idx] = {
      ...cur,
      title,
      turns: turns.slice(-MAX_TURNS_PER_SESSION),
      updatedAt: now,
    }
  } else {
    const title = customTitle || (turns.length > 0 ? extractSessionTitle(turns[0].content) : '')
    all.unshift({
      id: sessionId,
      title,
      turns: turns.slice(-MAX_TURNS_PER_SESSION),
      createdAt: now,
      updatedAt: now,
    })
  }

  saveSessions(all)
  return all
}

/** 删除指定会话 */
export function deleteSessionById(sessionId: string): AiChatSession[] {
  const all = loadSessions().filter((s) => s.id !== sessionId)
  saveSessions(all)
  if (getCurrentSessionId() === sessionId) {
    if (all.length > 0) {
      setCurrentSessionId(all[0].id)
    } else {
      safeSetItem(K_AI_CUR_SESSION, '')
    }
  }
  return all
}

/** 清空全部会话 */
export function clearAllSessions(): void {
  safeSetItem(K_AI_SESSIONS, JSON.stringify([]))
  safeSetItem(K_AI_CUR_SESSION, '')
}
