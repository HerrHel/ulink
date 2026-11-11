/**
 * 左侧消息锚点：把一轮轮对话压成「用户提问」列表（2026-11-11）。
 *
 * 纯函数，不依赖 i18n / DOM，便于单测。只取 role==='user' 的轮次：
 * 模型回复依附于提问，按提问定位才符合「快速翻看以前说了什么」的心智。
 */

import type { ChatTurn } from './chatSessions.js'

export interface TurnAnchor {
  id: string
  /** 单行摘要；无文本（纯附件消息）时为空串，由 UI 用 i18n 兜底 */
  label: string
}

/** 摘要最长字符数：面板里单行省略号截断，避免长 prompt 撑爆浮层 */
const MAX_LABEL_LEN = 60

export function buildTurnAnchors(
  turns: readonly Pick<ChatTurn, 'id' | 'role' | 'content'>[],
): TurnAnchor[] {
  const out: TurnAnchor[] = []
  for (const turn of turns) {
    if (!turn || turn.role !== 'user') continue
    const text = String(turn.content ?? '').replace(/\s+/g, ' ').trim()
    out.push({
      id: turn.id,
      label: text.length > MAX_LABEL_LEN ? `${text.slice(0, MAX_LABEL_LEN)}…` : text,
    })
  }
  return out
}
