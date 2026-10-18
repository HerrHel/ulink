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

export const K_AI_SESSIONS = 'lv_ai_sessions_v1'
export const K_AI_CUR_SESSION = 'lv_ai_cur_session_v1'
const MAX_SESSIONS = 20
const MAX_TURNS_PER_SESSION = 30

export interface ChatTurnStep {
  text: string
  done?: boolean
}

export interface ChatActionCard {
  type: 'dedup' | 'trash' | 'move' | 'clean' | 'custom'
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
}

export interface AttachedCardMeta {
  type: 'bm' | 'group'
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
  /** 包含完整注入附件数据的后台提示词（供多轮对话历史精准回溯） */
  promptContent?: string
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
}

export interface AiChatSession {
  id: string
  title: string
  turns: ChatTurn[]
  createdAt: number
  updatedAt: number
}

/** 提取前 16 个字符作为会话标题 */
export function extractSessionTitle(query: string): string {
  const clean = query.trim().replace(/^[\/\s]+/, '')
  if (!clean) return '新会话'
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
    const trimmed = sessions.slice(0, MAX_SESSIONS).map((s) => ({
      ...s,
      turns: (s.turns || []).slice(-MAX_TURNS_PER_SESSION).map((t) => ({
        ...t,
        loading: false, // 存盘时 loading 必须置 false
        isThinking: false, // 存盘时 isThinking 置 false
      })),
    }))
    safeSetItem(K_AI_SESSIONS, JSON.stringify(trimmed))
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
    title: initialTitle || '新会话',
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
    const title = customTitle || (cur.title === '新会话' && turns.length > 0 ? extractSessionTitle(turns[0].content) : cur.title)
    all[idx] = {
      ...cur,
      title,
      turns: turns.slice(-MAX_TURNS_PER_SESSION),
      updatedAt: now,
    }
  } else {
    const title = customTitle || (turns.length > 0 ? extractSessionTitle(turns[0].content) : '新会话')
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
