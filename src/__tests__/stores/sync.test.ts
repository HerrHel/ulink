/**
 * sync.test.ts — 同步状态 Store 测试
 *
 * 验证：
 * - 同步状态管理
 * - 冲突管理
 * - 状态重置
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSyncStore } from '../../stores/sync.js'

describe('SyncStore', () => {
  let store: ReturnType<typeof useSyncStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSyncStore()
  })

  describe('初始状态', () => {
    it('所有状态应为默认值', () => {
      expect(store.syncStatus).toBe('idle')
      expect(store.lastSyncAt).toBe(0)
      expect(store.syncError).toBeNull()
      expect(store.autoSync).toBe(true)
      expect(store.pendingCount).toBe(0)
      expect(store.realtimeStatus).toBe('disconnected')
      expect(store.conflicts).toEqual([])
      expect(store.conflictBannerDismissed).toBe(false)
    })
  })

  describe('同步状态', () => {
    it('setSyncStatus 应更新状态', () => {
      store.setSyncStatus('syncing')
      expect(store.syncStatus).toBe('syncing')
    })

    it('setSyncError 应设置错误信息', () => {
      store.setSyncError('网络离线')
      expect(store.syncError).toBe('网络离线')
    })

    it('setLastSyncAt 应更新时间戳', () => {
      const ts = Date.now()
      store.setLastSyncAt(ts)
      expect(store.lastSyncAt).toBe(ts)
    })

    it('setAutoSync 应切换自动同步', () => {
      store.setAutoSync(false)
      expect(store.autoSync).toBe(false)
    })

    it('setPendingCount 应更新待同步计数', () => {
      store.setPendingCount(5)
      expect(store.pendingCount).toBe(5)
    })

    it('setRealtimeStatus 应更新连接状态', () => {
      store.setRealtimeStatus('connected')
      expect(store.realtimeStatus).toBe('connected')
    })
  })

  describe('冲突管理', () => {
    const mockConflict = {
      id: 'bm1',
      type: 'bookmark' as const,
      local: { title: '本地' },
      remote: { title: '远端' },
    }

    it('addConflict 应添加冲突到列表', () => {
      store.addConflict(mockConflict)
      expect(store.conflicts).toHaveLength(1)
      expect(store.conflicts[0].id).toBe('bm1')
    })

    it('removeConflict 应按 ID 移除指定冲突', () => {
      store.addConflict(mockConflict)
      store.addConflict({ id: 'bm2', type: 'group', local: {}, remote: {} })
      store.removeConflict('bm1')
      expect(store.conflicts).toHaveLength(1)
      expect(store.conflicts[0].id).toBe('bm2')
    })

    it('clearConflicts 应清空所有冲突', () => {
      store.addConflict(mockConflict)
      store.addConflict({ id: 'bm2', type: 'group', local: {}, remote: {} })
      store.clearConflicts()
      expect(store.conflicts).toEqual([])
    })

    it('冲突列表应只读', () => {
      // 通过 add/remove action 操作，确保 readonly 正常工作
      store.addConflict(mockConflict)
      store.removeConflict('bm1')
      expect(store.conflicts).toHaveLength(0)
    })
  })

  describe('冲突横幅', () => {
    it('dismissConflictBanner 应标记已忽略', () => {
      store.dismissConflictBanner()
      expect(store.conflictBannerDismissed).toBe(true)
    })

    it('resetConflictBanner 应重新展示横幅', () => {
      store.dismissConflictBanner()
      store.resetConflictBanner()
      expect(store.conflictBannerDismissed).toBe(false)
    })
  })

  describe('resetSyncState', () => {
    it('应重置所有同步状态到默认值', () => {
      store.setSyncStatus('error')
      store.setSyncError('test error')
      store.setLastSyncAt(Date.now())
      store.addConflict({ id: 'b1', type: 'bookmark', local: {}, remote: {} })

      store.resetSyncState()

      expect(store.syncStatus).toBe('idle')
      expect(store.lastSyncAt).toBe(0)
      expect(store.syncError).toBeNull()
      expect(store.conflicts).toEqual([])
      expect(store.conflictBannerDismissed).toBe(false)
    })
  })

  // ── D2 行为契约：sync store setter/getter/resetSyncState 字段范围护栏 ──
  // 既有 sync.test.ts 只测 6 setter 的基本 set + resetSyncState 5 字段重置 + add/remove/clear。
  // 真缺口（git grep 零命中）：① setPendingLockedCount（锁定积压计数设置 useSyncStatus 归因依赖）
  // ② setReencrypting（重加密期短路远端变更标志）③ getConflict（按 id 查冲突）④ resetSyncState
  // **字段范围契约**——重置 lastSyncAt/syncStatus/syncError/conflicts/banner/pendingLockedCount 共 6，
  // 但**保留** realtimeStatus/autoSync/pendingCount/isReencrypting 共 4（登出切账号后保留有意义或由
  // 其他路径重算）。登出残留若误把 resetSyncState 改成全字段重置或漏重置某字段会让切账号状态污染
  // UI（pendingCount 残留误显"N 项待同步" / 漏重置 pendingLockedCount 致归因文案错）。纯加测试锁契约。
  describe('setPendingLockedCount / setReencrypting setter', () => {
    it('setPendingLockedCount 应更新锁定积压计数', () => {
      store.setPendingLockedCount(3)
      expect(store.pendingLockedCount).toBe(3)
    })

    it('setPendingLockedCount 置 0 归零（解锁后重推清空归因文案）', () => {
      store.setPendingLockedCount(5)
      store.setPendingLockedCount(0)
      expect(store.pendingLockedCount).toBe(0)
    })

    it('setReencrypting 应更新重加密标志', () => {
      store.setReencrypting(true)
      expect(store.isReencrypting).toBe(true)
      store.setReencrypting(false)
      expect(store.isReencrypting).toBe(false)
    })
  })

  describe('getConflict 按 id 查找', () => {
    it('命中：返回对应冲突对象', () => {
      store.addConflict({ id: 'hit-1', type: 'bookmark', local: { a: 1 }, remote: { b: 2 } })
      const found = store.getConflict('hit-1')
      expect(found).toBeDefined()
      expect(found?.id).toBe('hit-1')
      expect(found?.type).toBe('bookmark')
      expect((found?.local as { a: number }).a).toBe(1)
      expect((found?.remote as { b: number }).b).toBe(2)
    })

    it('未命中：返回 undefined 不抛', () => {
      expect(store.getConflict('nope')).toBeUndefined()
    })

    it('多个冲突中按精确 id 取对应项不串', () => {
      store.addConflict({ id: 'c1', type: 'bookmark', local: {}, remote: {} })
      store.addConflict({ id: 'c2', type: 'group', local: {}, remote: {} })
      expect(store.getConflict('c1')?.type).toBe('bookmark')
      expect(store.getConflict('c2')?.type).toBe('group')
    })
  })

  describe('resetSyncState 字段范围契约', () => {
    it('重置 pendingLockedCount 归零（审计归因计数）', () => {
      store.setPendingLockedCount(7)
      store.resetSyncState()
      expect(store.pendingLockedCount).toBe(0)
    })

    it('保留 realtimeStatus（连接状态不应因登出丢失语义——重连路径另管）', () => {
      store.setRealtimeStatus('connected')
      store.resetSyncState()
      expect(store.realtimeStatus).toBe('connected')
    })

    it('保留 autoSync（用户偏好不随登出重置）', () => {
      store.setAutoSync(false)
      store.resetSyncState()
      expect(store.autoSync).toBe(false)
    })

    it('保留 pendingCount（由 pushFromQueue 重新算，不由 resetSyncState 清）', () => {
      store.setPendingCount(9)
      store.resetSyncState()
      expect(store.pendingCount).toBe(9)
    })

    it('保留 isReencrypting（重加密期中途不因 reset 退出标志）', () => {
      store.setReencrypting(true)
      store.resetSyncState()
      expect(store.isReencrypting).toBe(true)
    })

    it('保留 pendingLockedCount 之外的离散 setter 联动：冲突横幅重置独立于 banner dismiss', () => {
      store.dismissConflictBanner()
      store.resetSyncState()
      expect(store.conflictBannerDismissed).toBe(false)
    })

    it('resetSyncState 幂等：连续两次状态一致', () => {
      store.setSyncStatus('syncing')
      store.setPendingLockedCount(4)
      store.resetSyncState()
      const after1 = {
        syncStatus: store.syncStatus,
        pendingLockedCount: store.pendingLockedCount,
        conflicts: store.conflicts.slice(),
      }
      store.resetSyncState()
      expect(store.syncStatus).toBe(after1.syncStatus)
      expect(store.pendingLockedCount).toBe(after1.pendingLockedCount)
      expect(store.conflicts).toEqual(after1.conflicts)
    })
  })
})

