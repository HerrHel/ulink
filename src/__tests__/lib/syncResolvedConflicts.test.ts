/**
 * 已决冲突记忆：同一远端版本不再重复弹冲突，远端版本前进后仍照常弹。
 * 背景见 src/lib/syncResolvedConflicts.ts 头注释（E2E「冲突横幅 UI」在 CI 卡住的根因）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  markConflictResolved,
  isConflictVersionResolved,
  clearResolvedConflicts,
} from '../../lib/syncResolvedConflicts.js'

beforeEach(() => clearResolvedConflicts())

describe('syncResolvedConflicts', () => {
  it('未裁决过 → 不算已解决', () => {
    expect(isConflictVersionResolved('bookmark', 'b1', 100)).toBe(false)
  })

  it('裁决同一远端版本 → 已解决（不再重复弹）', () => {
    markConflictResolved('bookmark', 'b1', 100)
    expect(isConflictVersionResolved('bookmark', 'b1', 100)).toBe(true)
  })

  it('远端版本前进 → 重新判定为冲突', () => {
    markConflictResolved('bookmark', 'b1', 100)
    expect(isConflictVersionResolved('bookmark', 'b1', 101)).toBe(false)
  })

  it('远端版本更旧（乱序到达）→ 视为已解决，不打扰用户', () => {
    markConflictResolved('bookmark', 'b1', 100)
    expect(isConflictVersionResolved('bookmark', 'b1', 90)).toBe(true)
  })

  it('按 (type + id) 隔离：不同实体互不影响', () => {
    markConflictResolved('bookmark', 'b1', 100)
    expect(isConflictVersionResolved('bookmark', 'b2', 100)).toBe(false)
    expect(isConflictVersionResolved('group', 'b1', 100)).toBe(false)
  })

  it('非法 updatedAt（NaN / undefined）按 0 处理，不抛错', () => {
    markConflictResolved('bookmark', 'b1', Number.NaN)
    expect(isConflictVersionResolved('bookmark', 'b1', Number.NaN)).toBe(true)
    expect(isConflictVersionResolved('bookmark', 'b1', 1)).toBe(false)
  })

  it('空 id 不记录（防脏键污染）', () => {
    markConflictResolved('bookmark', '', 100)
    expect(isConflictVersionResolved('bookmark', '', 100)).toBe(false)
  })

  it('条目数上限 500：超出后淘汰最早的，不无限增长', () => {
    for (let i = 0; i < 520; i++) markConflictResolved('bookmark', `b${i}`, 1)
    // 最早的 b0 已被淘汰（视为未裁决），较新的仍在
    expect(isConflictVersionResolved('bookmark', 'b0', 1)).toBe(false)
    expect(isConflictVersionResolved('bookmark', 'b519', 1)).toBe(true)
  })

  it('clearResolvedConflicts 全清（换账号不串记忆）', () => {
    markConflictResolved('bookmark', 'b1', 100)
    clearResolvedConflicts()
    expect(isConflictVersionResolved('bookmark', 'b1', 100)).toBe(false)
  })
})
