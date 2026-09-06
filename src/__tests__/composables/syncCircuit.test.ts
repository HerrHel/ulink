/**
 * syncCircuit — 客户端同步熔断器单测
 *
 * 锁定三态状态机契约：阈值熔断、退避递增、half-open 单飞探活、
 * 恢复置位（编排层据此自动补推死信）、错误分类启发式。
 * 时间控制：vi.useFakeTimers + setSystemTime（recordSyncFailure 内部取 Date.now）；
 * canAttemptSync 支持显式 now 注入，便于精确卡退避边界。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  canAttemptSync, recordSyncFailure, recordSyncSuccess, takeSyncRecovered,
  classifySyncError, getSyncCircuitSnapshot, __resetSyncCircuit,
  SYNC_CIRCUIT_THRESHOLD, SYNC_CIRCUIT_BACKOFF_MS,
} from '../../composables/domain/syncCircuit.js'

const T0 = 1_700_000_000_000

describe('syncCircuit 三态熔断状态机', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    __resetSyncCircuit()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('closed 态放行一切同步', () => {
    expect(canAttemptSync()).toBe(true)
    expect(getSyncCircuitSnapshot().state).toBe('closed')
  })

  it(`连续 ${SYNC_CIRCUIT_THRESHOLD - 1} 轮失败不熔断（瞬时抖动不触发退避）`, () => {
    for (let i = 0; i < SYNC_CIRCUIT_THRESHOLD - 1; i++) recordSyncFailure('Failed to fetch')
    expect(getSyncCircuitSnapshot().state).toBe('closed')
    expect(canAttemptSync()).toBe(true)
  })

  it('达到阈值熔断 → open 拦截，快照给出距下次探活毫秒数', () => {
    for (let i = 0; i < SYNC_CIRCUIT_THRESHOLD; i++) recordSyncFailure('429 Too Many Requests')
    expect(getSyncCircuitSnapshot().state).toBe('open')
    expect(canAttemptSync()).toBe(false)
    const snap = getSyncCircuitSnapshot()
    expect(snap.msUntilRetry).toBe(SYNC_CIRCUIT_BACKOFF_MS[0])
  })

  it('退避期内拦截；到期转 half-open 放行一次探活（单飞，并发触发不再放行）', () => {
    for (let i = 0; i < SYNC_CIRCUIT_THRESHOLD; i++) recordSyncFailure('429 Too Many Requests')
    expect(canAttemptSync(T0 + SYNC_CIRCUIT_BACKOFF_MS[0] - 1)).toBe(false)
    expect(canAttemptSync(T0 + SYNC_CIRCUIT_BACKOFF_MS[0])).toBe(true)
    expect(getSyncCircuitSnapshot().state).toBe('half-open')
    expect(canAttemptSync(T0 + SYNC_CIRCUIT_BACKOFF_MS[0] + 1)).toBe(false)
  })

  it('探活失败 → 回 open、退避升一档（1min → 2min）', () => {
    for (let i = 0; i < SYNC_CIRCUIT_THRESHOLD; i++) recordSyncFailure('boom')
    expect(canAttemptSync(T0 + SYNC_CIRCUIT_BACKOFF_MS[0])).toBe(true)
    // 恰在到期点探活失败：reopenAt = 到期点 + 下一档退避
    vi.setSystemTime(T0 + SYNC_CIRCUIT_BACKOFF_MS[0])
    recordSyncFailure('boom again')
    expect(getSyncCircuitSnapshot().state).toBe('open')
    const t2 = SYNC_CIRCUIT_BACKOFF_MS[1]
    expect(canAttemptSync(T0 + SYNC_CIRCUIT_BACKOFF_MS[0] + t2 - 1)).toBe(false)
    expect(canAttemptSync(T0 + SYNC_CIRCUIT_BACKOFF_MS[0] + t2)).toBe(true)
  })

  it('探活成功 → closed + recovered 置位（编排层据此自动补推死信），取走即清', () => {
    for (let i = 0; i < SYNC_CIRCUIT_THRESHOLD; i++) recordSyncFailure('boom')
    canAttemptSync(T0 + SYNC_CIRCUIT_BACKOFF_MS[0])
    recordSyncSuccess()
    expect(getSyncCircuitSnapshot().state).toBe('closed')
    expect(takeSyncRecovered()).toBe(true)
    expect(takeSyncRecovered()).toBe(false)
  })

  it('未熔断场景的一次失败后成功 → 不置 recovered（不滥发补推）', () => {
    recordSyncFailure('x')
    recordSyncFailure('x')
    recordSyncSuccess()
    expect(takeSyncRecovered()).toBe(false)
    expect(getSyncCircuitSnapshot().failures).toBe(0)
  })

  it('退避表封顶：多次熔断后退避不再增长（30min 上限）', () => {
    // 反复「熔断→探活失败」把 openCount 推过退避表长度；系统时钟逐档真实前推
    for (let round = 0; round < SYNC_CIRCUIT_BACKOFF_MS.length + 2; round++) {
      for (let i = 0; i < SYNC_CIRCUIT_THRESHOLD; i++) recordSyncFailure('boom')
      const expected = SYNC_CIRCUIT_BACKOFF_MS[Math.min(round, SYNC_CIRCUIT_BACKOFF_MS.length - 1)]
      expect(getSyncCircuitSnapshot().msUntilRetry).toBe(expected)
      vi.setSystemTime(Date.now() + expected)
      expect(canAttemptSync()).toBe(true)
      recordSyncFailure('probe fail')
    }
  })

  it('__resetSyncCircuit 整体复位', () => {
    for (let i = 0; i < SYNC_CIRCUIT_THRESHOLD; i++) recordSyncFailure('boom')
    __resetSyncCircuit()
    expect(getSyncCircuitSnapshot()).toEqual({ state: 'closed', failures: 0, kind: null, msUntilRetry: 0 })
    expect(canAttemptSync()).toBe(true)
  })
})

describe('classifySyncError 错误分类启发式', () => {
  it('network：离线/断网', () => {
    expect(classifySyncError('网络离线')).toBe('network')
    expect(classifySyncError('Failed to fetch')).toBe('network')
  })

  it('quota：限流/配额/空间（触顶归因的文案触发面）', () => {
    expect(classifySyncError('429 Too Many Requests')).toBe('quota')
    expect(classifySyncError('quota exceeded')).toBe('quota')
    expect(classifySyncError('Request rate limit reached')).toBe('quota')
  })

  it('auth：JWT/RLS/权限', () => {
    expect(classifySyncError('JWT expired')).toBe('auth')
    expect(classifySyncError('new row violates row-level security policy')).toBe('auth')
    expect(classifySyncError('permission denied')).toBe('auth')
  })

  it('其余归 server（兜底，不误抛到前三类）', () => {
    expect(classifySyncError('database connection lost')).toBe('server')
    expect(classifySyncError('')).toBe('server')
  })
})
