/**
 * `signOutAndReset`：登出必须**无条件**清同步态。
 *
 * 回归背景：authStore.signOut() 在远端失败时返回 false（本地已登出，见「本地登出权威」
 * 语义）。原调用点是 `if (ok) await sync.resetSyncState()` —— 离线登出会跳过清理，
 * 把 A 账号残留的 syncOps / _pendingSyncIds 留给 B 账号推上云（审计 R1 原样复现）。
 * 本用例锁：无论 auth.signOut() 返回真假，同步态都必须被清干净。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSyncStore } from '../../stores/sync.js'
import { markConflictResolved, isConflictVersionResolved } from '../../lib/syncResolvedConflicts.js'
import { _remoteSnapshots } from '../../composables/domain/useSyncConflict.js'
import { rememberDeadDelete, isDeadDelete, clearAllDeadDeletes } from '../../composables/domain/syncPending.js'
import { __resetSyncCircuit, recordSyncFailure, getSyncCircuitSnapshot } from '../../composables/domain/syncCircuit.js'

const signOutMock = vi.hoisted(() => vi.fn())
const clearOpsMock = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('../../stores/auth.js', () => ({
  useAuthStore: () => ({ signOut: signOutMock, isLoggedIn: true, user: { id: 'user-A' } }),
  // 其它模块可能从 auth 导入工具函数，给个空实现兜底
}))

vi.mock('../../stores/storage.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>()
  return { ...actual, clearAllSyncOps: clearOpsMock }
})

import { useCloudSync } from '../../composables/domain/useCloudSync.js'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  // 造一点「上一个账号的残留」
  const sync = useSyncStore()
  sync.setLastSyncAt(12345) // 只读 ref，必须走 setter（直接赋值会触发 Vue 只读告警）
  sync.addConflict({ id: 'bm-1', type: 'bookmark', local: { title: 'L' }, remote: { title: 'R' } })
  markConflictResolved('bookmark', 'bm-1', 100)
  _remoteSnapshots.set('bookmark:bm-1', { stale: true })
  // 再造 A 账号的死信墓碑与 open 熔断
  clearAllDeadDeletes()
  rememberDeadDelete('bookmarks', 'bm-dead-A')
  __resetSyncCircuit()
  recordSyncFailure('offline')
  recordSyncFailure('offline')
  recordSyncFailure('offline')
})

describe('signOutAndReset', () => {
  it('远端登出失败（返回 false）也必须清同步态', async () => {
    signOutMock.mockResolvedValue(false)

    const ok = await useCloudSync().signOutAndReset()

    expect(ok).toBe(false) // 返回值仍如实反映远端未确认
    expect(clearOpsMock).toHaveBeenCalledTimes(1) // 同步队列已清
    const sync = useSyncStore()
    expect(sync.lastSyncAt).toBe(0)
    expect(sync.conflicts).toHaveLength(0)
    expect(isConflictVersionResolved('bookmark', 'bm-1', 100)).toBe(false) // 裁决记忆已清
    expect(_remoteSnapshots.size).toBe(0) // 跨账号快照已清
    expect(isDeadDelete('bookmarks', 'bm-dead-A')).toBe(false) // 死信墓碑已清
    expect(getSyncCircuitSnapshot().state).toBe('closed') // 熔断已复位
  })

  it('远端登出成功同样清干净，且返回 true', async () => {
    signOutMock.mockResolvedValue(true)

    const ok = await useCloudSync().signOutAndReset()

    expect(ok).toBe(true)
    expect(clearOpsMock).toHaveBeenCalledTimes(1)
    expect(useSyncStore().lastSyncAt).toBe(0)
  })

  it('清理过程抛错不阻断登出返回值（异常不外溢）', async () => {
    signOutMock.mockResolvedValue(false)
    clearOpsMock.mockRejectedValueOnce(new Error('IDB blocked'))

    await expect(useCloudSync().signOutAndReset()).resolves.toBe(false)
  })
})
