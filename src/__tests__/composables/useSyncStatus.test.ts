/**
 * useSyncStatus — useSyncState 离线语义单测
 *
 * 锁定收敛点：
 * 1. 删除旧版 useSyncDotClass 死导出（导出面仅留 useSyncState）。
 * 2. useSyncState offline 分支取消 pending>0 前置门槛：断网但无积压
 *    也应报 offline（而非落到 ok 报绿点）—— #4-B 盲区。
 *
 * mock useCloudSync 返回可控 ref 对象；navigator.onLine 用 defineProperty 在 case 间 reset。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

// ── 可控 mock 状态 ──
let _onLine = true
let _syncStatus = 'idle'
let _realtimeStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected'
let _pendingCount = 0
let _conflicts: unknown[] = []
let _syncLabel = '已同步'

vi.mock('../../composables/domain/useCloudSync.js', () => ({
  useCloudSync: () => ({
    syncStatus: ref(_syncStatus),
    realtimeStatus: ref(_realtimeStatus),
    pendingCount: ref(_pendingCount),
    conflicts: ref(_conflicts),
    syncLabel: ref(_syncLabel),
  }),
}))

import * as mod from '../../composables/ui/useSyncStatus.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'

const _origOnLine = navigator.onLine
function setOnLine(v: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true, writable: true })
}

function state() {
  return (useSyncState() as any).value
}

function setCtx(opts: {
  onLine?: boolean
  syncStatus?: string
  realtime?: 'disconnected' | 'connecting' | 'connected' | 'error'
  pending?: number
  conflicts?: unknown[]
}) {
  _onLine = opts.onLine ?? true
  _syncStatus = opts.syncStatus ?? 'idle'
  _realtimeStatus = opts.realtime ?? 'connected'
  _pendingCount = opts.pending ?? 0
  _conflicts = opts.conflicts ?? []
  setOnLine(_onLine)
}

describe('useSyncState 离线语义', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    setCtx({})
  })
  afterEach(() => {
    setOnLine(_origOnLine === undefined ? true : _origOnLine)
  })

  it('断网 + 有积压 → offline·带 count·badge', () => {
    setCtx({ onLine: false, realtime: 'connected', pending: 3 })
    const s = state()
    expect(s.level).toBe('offline')
    expect(s.label).toBe('离线 · 3 项待同步')
    expect(s.count).toBe(3)
    expect(s.showBadge).toBe(true)
    expect(s.dotClass).toBe('dot-offline')
  })

  it('断网 + 无积压 → offline（非 ok），label="离线"，无 badge（#4-B 核心）', () => {
    setCtx({ onLine: false, realtime: 'connected', pending: 0 })
    const s = state()
    expect(s.level).toBe('offline')
    expect(s.label).toBe('离线')
    expect(s.count).toBe(0)
    expect(s.showBadge).toBe(false)
    expect(s.dotClass).toBe('dot-offline')
  })

  it('联网 + realtime error → offline', () => {
    setCtx({ onLine: true, realtime: 'error', pending: 0 })
    expect(state().level).toBe('offline')
  })

  it('联网 + realtime disconnected + pending → offline·带 count', () => {
    setCtx({ onLine: true, realtime: 'disconnected', pending: 5 })
    const s = state()
    expect(s.level).toBe('offline')
    expect(s.count).toBe(5)
    expect(s.label).toBe('离线 · 5 项待同步')
  })

  it('联网 + realtime disconnected + pending=0 → ok（防止 offline 过宽，回归护栏）', () => {
    setCtx({ onLine: true, realtime: 'disconnected', pending: 0 })
    expect(state().level).toBe('ok')
  })

  it('联网恢复后离开 offline（无粘滞）', () => {
    setCtx({ onLine: false, realtime: 'connected', pending: 0 })
    expect(state().level).toBe('offline')
    setCtx({ onLine: true, realtime: 'connected', pending: 0 })
    expect(state().level).toBe('ok')
  })

  it('syncStatus=error 优先于 offline', () => {
    setCtx({ onLine: false, syncStatus: 'error', realtime: 'error', pending: 0 })
    expect(state().level).toBe('error')
  })

  it('conflict 优先于一切（含 error 与 offline）', () => {
    setCtx({ onLine: false, syncStatus: 'error', realtime: 'error', pending: 0, conflicts: [{ id: 'c1' }] })
    const s = state()
    expect(s.level).toBe('conflict')
    expect(s.count).toBe(1)
  })

  it('联网 + pending>0 + realtime 正常 → pending（非 offline）', () => {
    setCtx({ onLine: true, realtime: 'connected', pending: 2 })
    expect(state().level).toBe('pending')
  })

  it('联网 + syncing → syncing', () => {
    setCtx({ onLine: true, syncStatus: 'syncing', realtime: 'connected', pending: 0 })
    expect(state().level).toBe('syncing')
  })

  it('联网 + 全空 → ok，label 取 syncLabel', () => {
    setCtx({ onLine: true, syncStatus: 'idle', realtime: 'connected', pending: 0 })
    const s = state()
    expect(s.level).toBe('ok')
    expect(s.label).toBe(_syncLabel)
  })
})

describe('导出面：死导出 useSyncDotClass 已删除', () => {
  it('模块不再导出 useSyncDotClass，仅留 useSyncState', () => {
    expect((mod as any).useSyncDotClass).toBeUndefined()
    expect(typeof mod.useSyncState).toBe('function')
  })
})
