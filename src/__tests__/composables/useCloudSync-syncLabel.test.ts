/**
 * 行为契约护栏：useCloudSync.syncLabel 7 分支时间感 + pending 聚合计算
 *
 * Explore agentId a72cc7887c578005d 扫真缺口候选 #2：
 * syncLabel 是 useCloudSync() returned computed（src/composables/domain/useCloudSync.ts:56-69，
 * 返回口 :220），全测试目录仅 useSyncStatus.test.ts:22/31/157/161 把 syncLabel 当
 * ref('已同步') mock 桩掉从未跑真实 computed，0 直断言。
 * 生产调用方 useSyncStatus.ts:60 `label: sync.syncLabel.value` —— AppHeader/SettingsPanel/
 * SyncStatusPopover 的「上次同步时间」展示真值源，是用户可见的同步状态指示器。
 *
 * computed 承载 7 分支运行时计算：
 *   1. syncStatus==='syncing' → '同步中...'
 *   2. syncStatus==='error' → '同步失败'
 *   3. pending = _dirtyIds.size + _deletedIds.size + _newIds.size > 0 → `${pending} 项待同步`
 *      （聚合三类 dirty id set，用户可见「N 项待同步」徽章数据源）
 *   4. lastSyncAt && diff < 60000 → '刚刚同步'
 *   5. diff < 3600000 → `${Math.floor(diff/60000)} 分钟前同步`
 *   6. 否则 → `${Math.floor(diff/3600000)} 小时前同步`
 *   7. lastSyncAt falsy → '未同步'
 *
 * 纯加测试零源文件改动：syncLabel 经 useCloudSync().syncLabel.value 暴露无需改 useCloudSync.ts。
 * mock 仅桩：supabase + storage 队列（让 useCloudSync 顶层 import 副作用不挂，syncLabel computed
 * 本身不读这两上 supabase/storage）；用真实 useDataStore + useSyncStore + useCloudSync，
 * 经 store 直接 assign 三 id Sets / Map + syncStore setter 设 syncStatus/lastSyncAt，
 * fake timers 钉 Date.now() 让时间感分支确定性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── supabase + storage minimal stub：useCloudSync 顶层 import 链挂 supabase/storage，但 syncLabel computed
//   本身不读这两者（只读 syncStore + dataStore），仅装 stub 让 import 不抛 ──
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ data: null, error: null }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => Promise.resolve({ data: null, error: null }),
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }), data: null }),
      delete: () => Promise.resolve({ data: null, error: null }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }),
    removeChannel: () => {},
  },
}))

let _ops = 0
vi.mock('../../stores/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/storage.js')>()
  return {
    ...actual,
    enqueueSyncOps: async () => {},
    drainSyncOps: async () => [],
    removeSyncOps: async () => {},
    updateSyncOpRetry: async () => {},
    syncOpsCount: async () => _ops,
    clearAllSyncOps: async () => { _ops = 0 },
  }
})

import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { useCloudSync, __resetInitialSync } from '../../composables/domain/useCloudSync.js'

describe('syncLabel 7 分支护栏', () => {
  let syncStore: ReturnType<typeof useSyncStore>
  let dataStore: ReturnType<typeof useDataStore>

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    __resetInitialSync()
    syncStore = useSyncStore()
    dataStore = useDataStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** helper：清三 id 标签独立测试互不污染（dataStore setup 初始即空，但显式归零防漂移） */
  function clearPending() {
    dataStore._dirtyIds = new Set()
    dataStore._deletedIds = new Map()
    dataStore._newIds = new Set()
  }

  it('分支 1：syncStatus==="syncing" → "同步中..."（优先于 pending 与 lastSyncAt）', () => {
    clearPending()
    // 即使有 pending 与过期 lastSyncAt，syncing 字面优先
    syncStore.setSyncStatus('syncing')
    syncStore.setLastSyncAt(1000) // 远古 lastSyncAt
    dataStore._dirtyIds = new Set(['a', 'b'])
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('同步中...')
  })

  it('分支 2：syncStatus==="error" → "同步失败"（优先于 pending 与 lastSyncAt）', () => {
    clearPending()
    syncStore.setSyncStatus('error')
    syncStore.setLastSyncAt(Date.now() - 1000)
    dataStore._dirtyIds = new Set(['a'])
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('同步失败')
  })

  it('分支 3：pending=三 id 集合 size 之和 > 0 → "${pending} 项待同步"，聚合 dirty+deleted+new', () => {
    clearPending()
    syncStore.setSyncStatus('success') // 非 syncing/error，落 pending 判
    syncStore.setLastSyncAt(Date.now()) // 有 lastSyncAt 也会被 pending 抢先
    dataStore._dirtyIds = new Set(['d1', 'd2'])
    dataStore._deletedIds = new Map([['del1', 'bookmarks'], ['del2', 'bookmarks'], ['del3', 'bookmarks']])
    dataStore._newIds = new Set(['n1'])
    const { syncLabel } = useCloudSync()
    // 2 dirty + 3 deleted + 1 new = 6 项
    expect(syncLabel.value).toBe('6 项待同步')
  })

  it('分支 3 各类独立：仅 _dirtyIds 非空', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    syncStore.setLastSyncAt(0)
    dataStore._dirtyIds = new Set(['x'])
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('1 项待同步')
  })

  it('分支 3 各类独立：仅 _deletedIds（Map）非空', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    syncStore.setLastSyncAt(0)
    dataStore._deletedIds = new Map([['y', 'bookmarks']])
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('1 项待同步')
  })

  it('分支 3 各类独立：仅 _newIds 非空', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    syncStore.setLastSyncAt(0)
    dataStore._newIds = new Set(['z'])
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('1 项待同步')
  })

  it('分支 4：lastSyncAt 存在 + diff < 60000 → "刚刚同步"', () => {
    clearPending()
    syncStore.setSyncStatus('success')
    const now = 1700000000000
    vi.setSystemTime(now)
    syncStore.setLastSyncAt(now - 30000) // 30s 前
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('刚刚同步')
  })

  it('分支 4 边界：diff 恰好 59999ms 仍属 < 60000 "刚刚同步"', () => {
    clearPending()
    syncStore.setSyncStatus('success')
    const now = 1700000000000
    vi.setSystemTime(now)
    syncStore.setLastSyncAt(now - 59999)
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('刚刚同步')
  })

  it('分支 4→5 边界：diff 恰好 60000ms 不属 < 60000 → 走"分钟前"分支（1 分钟前）', () => {
    clearPending()
    syncStore.setSyncStatus('success')
    const now = 1700000000000
    vi.setSystemTime(now)
    syncStore.setLastSyncAt(now - 60000)
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('1 分钟前同步')
  })

  it('分支 5：lastSyncAt + 60000 <= diff < 3600000 → "${floor(diff/60000)} 分钟前同步"', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    const now = 1700000000000
    vi.setSystemTime(now)
    syncStore.setLastSyncAt(now - 300000) // 5 分钟前
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('5 分钟前同步')
  })

  it('分支 5：diff=3500000（近 59 分钟）→ "58 分钟前同步"', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    const now = 1700000000000
    vi.setSystemTime(now)
    syncStore.setLastSyncAt(now - 3500000)
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('58 分钟前同步')
  })

  it('分支 5→6 边界：diff 恰好 3600000ms 不属 < 3600000 → 走"小时前"分支（1 小时前）', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    const now = 1700000000000
    vi.setSystemTime(now)
    syncStore.setLastSyncAt(now - 3600000)
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('1 小时前同步')
  })

  it('分支 6：lastSyncAt + diff >= 3600000 → "${floor(diff/3600000)} 小时前同步"', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    const now = 1700000000000
    vi.setSystemTime(now)
    syncStore.setLastSyncAt(now - 7200000) // 2 小时前
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('2 小时前同步')
  })

  it('分支 6：diff=3.5 小时 → "3 小时前同步"（Math.floor 截断非四舍五入）', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    const now = 1700000000000
    vi.setSystemTime(now)
    syncStore.setLastSyncAt(now - 12600000) // 3.5 小时
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('3 小时前同步')
  })

  it('分支 7：lastSyncAt falsy（0）且 pending=0 → "未同步"', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    syncStore.setLastSyncAt(0)
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('未同步')
  })

  it('分支优先级：error 优先于 syncing 之外的所有分支（含 pending 与 lastSyncAt）', () => {
    clearPending()
    syncStore.setSyncStatus('error')
    syncStore.setLastSyncAt(Date.now()) // 新 lastSyncAt 会落「刚刚同步」若 error 不优先
    dataStore._dirtyIds = new Set(['a']) // pending 会落「1 项待同步」若 error 不优先
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('同步失败')
  })

  it('响应式：syncStatus 切换后 syncLabel.value 跟随重算（computed 真响应式不缓存上值）', async () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    syncStore.setLastSyncAt(0)
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('未同步')

    syncStore.setSyncStatus('syncing')
    expect(syncLabel.value).toBe('同步中...')

    syncStore.setSyncStatus('success')
    syncStore.setLastSyncAt(Date.now())
    expect(syncLabel.value).toBe('刚刚同步')
  })

  it('响应式：三 id 集合动态变化后 pending 标签跟随重算', () => {
    clearPending()
    syncStore.setSyncStatus('idle')
    syncStore.setLastSyncAt(0)
    const { syncLabel } = useCloudSync()
    expect(syncLabel.value).toBe('未同步')

    dataStore._dirtyIds = new Set(['x1', 'x2', 'x3'])
    expect(syncLabel.value).toBe('3 项待同步')

    dataStore._newIds = new Set(['y1'])
    expect(syncLabel.value).toBe('4 项待同步')
  })
})
