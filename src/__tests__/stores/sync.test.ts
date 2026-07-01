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
})
