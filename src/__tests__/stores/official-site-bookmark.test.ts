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
import { OFFICIAL_SITE_BM_ID, OFFICIAL_SITE_LANDING_ID, OFFICIAL_SITE_APP_ID, OFFICIAL_SITE_EDGE_EXT_ID } from '../../stores/dataActionsBookmarks.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { EDGE_ADDON_URL } from '../../config/urls.js'
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

  it('空库首次调用：写入主书签「与链ulink」及三个子书签（宣传页 / app页 / Edge扩展）并落 flag', () => {
    const ds = useDataStore()
    ds.ensureOfficialSiteBookmark()
    expect(ds.bookmarks).toHaveLength(4)

    // 1. 主书签
    const home = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_BM_ID)
    expect(home).toBeDefined()
    expect(home!.title).toBe('与链ulink')
    expect(home!.url).toBe('https://ulink.ren/?stay=1')
    expect(home!.categoryId).toBe(CAT_UNCATEGORIZED)
    expect(home!.parentId).toBeNull()
    expect(home!.order).toBe(0)
    expect(home!.isExpanded).toBe(true)
    expect(home!.icon).toBe('/logo.svg')

    // 2. 子书签 1：宣传页
    const landing = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_LANDING_ID)
    expect(landing).toBeDefined()
    expect(landing!.title).toBe('宣传页')
    expect(landing!.url).toBe('https://ulink.ren/?stay=1')
    expect(landing!.parentId).toBe(OFFICIAL_SITE_BM_ID)
    expect(landing!.order).toBe(0)
    expect(landing!.icon).toBe('/logo.svg')

    // 3. 子书签 2：app页
    const app = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_APP_ID)
    expect(app).toBeDefined()
    expect(app!.title).toBe('app页')
    expect(app!.url).toBe('https://ulink.ren/app')
    expect(app!.parentId).toBe(OFFICIAL_SITE_BM_ID)
    expect(app!.order).toBe(1)
    expect(app!.icon).toBe('/logo.svg')

    // 4. 子书签 3：Edge扩展
    const edgeExt = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_EDGE_EXT_ID)
    expect(edgeExt).toBeDefined()
    expect(edgeExt!.title).toBe('Edge扩展')
    expect(edgeExt!.url).toBe(EDGE_ADDON_URL)
    expect(edgeExt!.parentId).toBe(OFFICIAL_SITE_BM_ID)
    expect(edgeExt!.order).toBe(2)
    expect(edgeExt!.icon).toBe('/logo.svg')

    expect(localStorage.getItem('lv_landing_bm_done')).toBe('1')
  })

  it('存量用户已有单节点「与链官网」：调用时自动升级标题为「与链ulink」并补齐三个子书签', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      makeBm({
        id: OFFICIAL_SITE_BM_ID,
        title: '与链官网',
        url: 'https://ulink.ren/?stay=1',
        isExpanded: false
      })
    ]
    ds._syncMaps()
    const changed = ds.ensureOfficialSiteBookmark()

    expect(changed).toBe(true)
    expect(ds.bookmarks).toHaveLength(4)
    const home = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_BM_ID)
    expect(home!.title).toBe('与链ulink')
    expect(home!.isExpanded).toBe(true)
    expect(ds.bookmarks.some(b => b.id === OFFICIAL_SITE_LANDING_ID)).toBe(true)
    expect(ds.bookmarks.some(b => b.id === OFFICIAL_SITE_APP_ID)).toBe(true)
    expect(ds.bookmarks.some(b => b.id === OFFICIAL_SITE_EDGE_EXT_ID)).toBe(true)
  })

  it('存量老用户（已有官网书签且仅含宣传页/app页）：调用时自动补齐「Edge扩展」子书签并返回 true', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      makeBm({
        id: OFFICIAL_SITE_BM_ID,
        title: '与链ulink',
        url: 'https://ulink.ren/?stay=1',
        isExpanded: false
      }),
      makeBm({
        id: OFFICIAL_SITE_LANDING_ID,
        title: '宣传页',
        url: 'https://ulink.ren/?stay=1',
        parentId: OFFICIAL_SITE_BM_ID,
        order: 0
      }),
      makeBm({
        id: OFFICIAL_SITE_APP_ID,
        title: 'app页',
        url: 'https://ulink.ren/app',
        parentId: OFFICIAL_SITE_BM_ID,
        order: 1
      }),
    ]
    ds._syncMaps()

    const changed = ds.ensureOfficialSiteBookmark()
    expect(changed).toBe(true)
    expect(ds.bookmarks).toHaveLength(4)

    const home = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_BM_ID)
    expect(home!.isExpanded).toBe(true)

    const edgeExt = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_EDGE_EXT_ID)
    expect(edgeExt).toBeDefined()
    expect(edgeExt!.title).toBe('Edge扩展')
    expect(edgeExt!.url).toBe(EDGE_ADDON_URL)
    expect(edgeExt!.parentId).toBe(OFFICIAL_SITE_BM_ID)
    expect(edgeExt!.order).toBe(2)

    // 再次调用无变动，返回 false
    const changedAgain = ds.ensureOfficialSiteBookmark()
    expect(changedAgain).toBe(false)
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
    expect(ds.bookmarks.filter(b => b.id === OFFICIAL_SITE_LANDING_ID)).toHaveLength(1)
    expect(ds.bookmarks.filter(b => b.id === OFFICIAL_SITE_APP_ID)).toHaveLength(1)
    expect(ds.bookmarks.filter(b => b.id === OFFICIAL_SITE_EDGE_EXT_ID)).toHaveLength(1)
    expect(ds.bookmarks).toHaveLength(4)
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
    expect(ds.bookmarks).toHaveLength(4)
  })

  it('存量用户已有旧 icon（如 data: URI 或空）：升级时自动刷为 OFFICIAL_SITE_ICON (/logo.svg)', () => {
    const ds = useDataStore()
    ds.bookmarks = [
      makeBm({
        id: OFFICIAL_SITE_BM_ID,
        title: '与链ulink',
        url: 'https://ulink.ren/?stay=1',
        icon: 'data:image/svg+xml,<svg>old</svg>',
      }),
      makeBm({
        id: OFFICIAL_SITE_LANDING_ID,
        title: '宣传页',
        url: 'https://ulink.ren/?stay=1',
        icon: '',
        parentId: OFFICIAL_SITE_BM_ID,
      }),
      makeBm({
        id: OFFICIAL_SITE_APP_ID,
        title: 'app页',
        url: 'https://ulink.ren/app',
        icon: 'data:image/svg+xml,<svg>old</svg>',
        parentId: OFFICIAL_SITE_BM_ID,
      }),
      makeBm({
        id: OFFICIAL_SITE_EDGE_EXT_ID,
        title: 'Edge扩展',
        url: EDGE_ADDON_URL,
        icon: 'data:image/svg+xml,<svg>old</svg>',
        parentId: OFFICIAL_SITE_BM_ID,
      }),
    ]
    ds._syncMaps()
    ds.ensureOfficialSiteBookmark()

    const home = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_BM_ID)
    const landing = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_LANDING_ID)
    const app = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_APP_ID)
    const edgeExt = ds.bookmarks.find(b => b.id === OFFICIAL_SITE_EDGE_EXT_ID)

    expect(home!.icon).toBe('/logo.svg')
    expect(landing!.icon).toBe('/logo.svg')
    expect(app!.icon).toBe('/logo.svg')
    expect(edgeExt!.icon).toBe('/logo.svg')
  })
})

