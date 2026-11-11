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

export interface VisibleTurnAnchor extends TurnAnchor {
  /** 在完整会话中的序号（0 起），用于「第 N 轮」的无障碍标签 */
  index: number
  /** 窗口上方还有被折叠的轮次 → 用这个点做「更上面还有」的淡化提示 */
  fadeTop: boolean
  /** 窗口下方还有被折叠的轮次 → 用这个点做「更下面还有」的淡化提示 */
  fadeBottom: boolean
}

/**
 * 点列窗口化：会话再多也只铺 maxDots 个点，用两端淡化表示「还有」。
 *
 * 规则（与设计约定一致）：
 *   - 当前轮在开头、下面还有 → 最后一个点淡化；
 *   - 当前轮在中间、上下都有 → 首尾都淡化；
 *   - 当前轮在末尾、上面还有 → 第一个点淡化；
 *   - 当前轮本身永远不淡化（它是当前定位）。
 *
 * 窗口以当前轮为中心滑动，并 clamp 在 [0, total - maxDots]，保证窗口内始终
 * 是连续的 maxDots 轮。
 */
export function computeVisibleAnchors(
  anchors: readonly TurnAnchor[],
  activeId: string | null,
  maxDots: number,
): VisibleTurnAnchor[] {
  const limit = Math.max(2, Math.floor(Number(maxDots) || 0))
  const total = anchors.length
  if (total <= limit) {
    return anchors.map((a, i) => ({ ...a, index: i, fadeTop: false, fadeBottom: false }))
  }

  const found = anchors.findIndex(a => a.id === activeId)
  const activeIdx = found < 0 ? 0 : found
  const start = Math.max(0, Math.min(Math.round(activeIdx - (limit - 1) / 2), total - limit))
  const hasAbove = start > 0
  const hasBelow = start + limit < total

  return anchors.slice(start, start + limit).map((a, i) => ({
    ...a,
    index: start + i,
    fadeTop: hasAbove && i === 0 && a.id !== activeId,
    fadeBottom: hasBelow && i === limit - 1 && a.id !== activeId,
  }))
}
