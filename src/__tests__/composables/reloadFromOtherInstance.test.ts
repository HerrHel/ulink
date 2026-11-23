/**
 * useAppLifecycle.reloadFromOtherInstance — 其他实例落盘后的被动重载
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const loaded = {
  categories: [{ id: 'c-new', name: '新分类', icon: '', color: '', order: 0 }],
  bookmarks: [{ id: 'b-new', title: '另一实例写的', url: 'https://new.example' }],
  customAttributes: [],
  siblingGroups: [],
}

vi.mock('../../stores/persist.js', async (orig) => ({
  ...(await orig<typeof import('../../stores/persist.js')>()),
  loadData: vi.fn(async () => loaded),
}))

import { reloadFromOtherInstance } from '../../composables/useAppLifecycle'
import { useDataStore } from '../../stores/data'
import { useUIStore } from '../../stores/ui'
import { useSyncStore } from '../../stores/sync'
import { __testMarkDataReady, __testResetDataReady } from '../../lib/dataReady'
import * as persist from '../../stores/persist.js'

beforeEach(() => {
  vi.useFakeTimers()
  __testMarkDataReady()
})
afterEach(() => {
  vi.useRealTimers()
  __testResetDataReady()
})

describe('reloadFromOtherInstance', () => {
  it('空闲时从 IDB 重新载入主页数据', async () => {
    const ds = useDataStore()
    await reloadFromOtherInstance()
    expect(persist.loadData).toHaveBeenCalledWith('main')
    expect(ds.bookmarks.map((b) => b.id)).toEqual(['b-new'])
    expect(ds.categories.map((c) => c.id)).toEqual(['c-new'])
  })

  it('有未落盘编辑时不重载（避免丢本实例修改），稍后重试', async () => {
    const ds = useDataStore()
    ds._saveTimer = setTimeout(() => {}, 10_000)
    await reloadFromOtherInstance()
    expect(persist.loadData).not.toHaveBeenCalled()
    // 编辑落盘后重试成功
    clearTimeout(ds._saveTimer)
    ds._saveTimer = null
    await vi.advanceTimersByTimeAsync(1000)
    expect(persist.loadData).toHaveBeenCalledTimes(1)
  })

  it('云同步进行中时推迟', async () => {
    useSyncStore().setSyncStatus('syncing')
    await reloadFromOtherInstance()
    expect(persist.loadData).not.toHaveBeenCalled()
  })

  it('私密空间与分享只读态不重载', async () => {
    const ui = useUIStore()
    ui.curSpace = 'vault'
    await reloadFromOtherInstance()
    ui.curSpace = 'main'
    ui.shareMode = { gid: 'g' } as never
    await reloadFromOtherInstance()
    expect(persist.loadData).not.toHaveBeenCalled()
  })

  it('数据尚未水合时不重载（启动加载会读到最新）', async () => {
    __testResetDataReady()
    await reloadFromOtherInstance()
    expect(persist.loadData).not.toHaveBeenCalled()
  })
})
