/**
 * stores/official-site-bookmark.test.ts — ensureOfficialSiteBookmark 护栏测试
 *
 * 双入口改造配套：给每个库补一条官网落地页书签（?stay=1 免返客秒跳）。
 * 锁定幂等三重护栏的契约（实现见 dataActionsBookmarks.ensureOfficialSiteBookmark）：
 *   1. 首次调用：写入固定 id 书签（未分类置顶 + ?stay=1 URL）并落 flag；
 *   2. 重复调用：不产生副本；
 *   3. 同 id 已存在（含软删墓碑）：不重加、只落 flag；
 *   4. flag 已存在：书签不在也绝不复活（用户「彻底删除」后不被启动时重灌）；
 *   5. 分享只读态（_denyWrite）：不写入、不落 flag（下次非分享态重试）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { OFFICIAL_SITE_BM_ID } from '../../stores/dataActionsBookmarks.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import type { Bookmark } from '../../types.js'

function makeBm(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'x', title: '测试书签', url: 'https://example.com', username: '', password: '',
    notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0,
    useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    ...over,
  }
}

describe('ensureOfficialSiteBookmark', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('空库首次调用：写入官网书签（固定 id / ?stay=1 / 未分类 / order 0）并落 flag', () => {
    const ds = useDataStore()
    ds.ensureOfficialSiteBookmark()
    expect(ds.bookmarks).toHaveLength(1)
    const bm = ds.bookmarks[0]
    expect(bm.id).toBe(OFFICIAL_SITE_BM_ID)
    expect(bm.url).toBe('https://ulink.ren/?stay=1')
    expect(bm.categoryId).toBe(CAT_UNCATEGORIZED)
    expect(bm.parentId).toBeNull()
    expect(bm.order).toBe(0)
    expect(localStorage.getItem('lv_landing_bm_done')).toBe('1')
  })

  it('未分类已有书签时置顶（同级最小 order - 1）', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      makeBm({ id: 'a', order: 3 }),
      makeBm({ id: 'b', order: 7 }),
    ]
    ds._syncMaps()
    ds.ensureOfficialSiteBookmark()
    const bm = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_BM_ID)
    expect(bm).toBeDefined()
    expect(bm!.order).toBe(2)
  })

  it('重复调用幂等：不产生副本', () => {
    const ds = useDataStore()
    ds.ensureOfficialSiteBookmark()
    ds.ensureOfficialSiteBookmark()
    expect(ds.bookmarks.filter(b => b.id === OFFICIAL_SITE_BM_ID)).toHaveLength(1)
  })

  it('同 id 已存在（软删墓碑）→ 不重加，仅落 flag', () => {
    const ds = useDataStore()
    ds.bookmarks = [makeBm({ id: OFFICIAL_SITE_BM_ID, deletedAt: Date.now() })]
    ds._syncMaps()
    ds.ensureOfficialSiteBookmark()
    expect(ds.bookmarks).toHaveLength(1) // 只有墓碑，无新增
    expect(localStorage.getItem('lv_landing_bm_done')).toBe('1')
  })

  it('flag 已存在且书签不在 → 不复活（彻底删除后不被启动重灌）', () => {
    localStorage.setItem('lv_landing_bm_done', '1')
    const ds = useDataStore()
    ds.ensureOfficialSiteBookmark()
    expect(ds.bookmarks).toHaveLength(0)
  })

  it('分享只读态（_denyWrite）→ 不写入、不落 flag，退出后可重试', () => {
    const ui = useUIStore()
    ui.shareMode = { gid: 'g1', kind: 'group' } as never
    const ds = useDataStore()
    ds.ensureOfficialSiteBookmark()
    expect(ds.bookmarks).toHaveLength(0)
    expect(localStorage.getItem('lv_landing_bm_done')).toBeNull()
    ui.shareMode = null
    ds.ensureOfficialSiteBookmark()
    expect(ds.bookmarks).toHaveLength(1)
  })
})
