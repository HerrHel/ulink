/**
 * 分享只读态的边界：影子数据只由 share.ts 的 _teardown 清理，switchSpace 碰不到它。
 *
 * 影子 Map 是分享内容的数据容器（不写进 dataStore 数组，只被 bookmarkMap /
 * groupMap 合并进返回值）。审计时曾怀疑「切空间只清 shareMode、不清影子」会留下
 * 他人的书签；实际 switchSpace 入口就有 `if (ui.shareMode) return`，分享态根本
 * 进不到切换流程，退出路径只有 _teardown（它会 shadowClear）。
 * 这里把这条真实契约锁住，避免以后有人放开这个 guard 又忘了清影子。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { shadowSet, shadowClear, shadowHasAny } from '../../stores/shareShadow.js'
import type { Bookmark } from '../../types.js'

const SHARED_BM = {
  id: 'shared-bm-1',
  title: '别人分享的书签',
  url: 'https://shared.example',
  username: '', password: '', notes: '', icon: '',
  categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0,
  attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
} as Bookmark

beforeEach(() => {
  setActivePinia(createPinia())
  shadowClear()
})

describe('分享态下 switchSpace 的边界', () => {
  it('分享态禁止切空间：curSpace 不变、影子数据保留（退出靠 _teardown）', async () => {
    const ui = useUIStore()
    const ds = useDataStore()
    ui.shareMode = { kind: 'group', id: 'g-shared' }
    shadowSet({ bookmarks: { [SHARED_BM.id]: SHARED_BM }, groups: {}, categories: {} })
    const before = ui.curSpace

    await ds.switchSpace('vault')

    expect(ui.curSpace).toBe(before) // 真被拦住了，不是「切了又清」
    expect(ui.shareMode).not.toBeNull() // 仍处于分享只读态
    expect(shadowHasAny()).toBe(true) // 影子数据由 _teardown 负责，切换流程不动它
    expect(ds.bookmarkMap[SHARED_BM.id]).toBeTruthy()
  })

  it('非分享态可正常切空间（guard 不影响正常路径）', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.shareMode = null
    await ds.switchSpace('vault')
    expect(ui.curSpace).toBe('vault')
  })

  it('shadowClear 幂等：非分享态调用无副作用', () => {
    expect(shadowHasAny()).toBe(false)
    expect(() => shadowClear()).not.toThrow()
    expect(shadowHasAny()).toBe(false)
  })
})
