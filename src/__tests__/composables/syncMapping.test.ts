/**
 * syncMapping.test.ts — 本地 <-> 远端密码字段映射回归测试
 *
 * 锁定一个已修复的严重 bug：E2E 启用且解锁时，本地 bookmark.password 是
 * EncryptedPassword 对象；旧版 toRemoteRow 用 JSON.stringify(item.password)
 * 把对象降级成 JSON 文本字符串存云端，回程 parsePassword 见 string 直接返回，
 * autoMigratePassword 走 string 分支 safeDecodePassword 解码成乱码，密码永久损坏。
 *
 * 修复后：push 端把 EncryptedPassword 对象规整成 "salt.iv.data" 三段串；
 * pull 端分层识别（JSON 文本 → 对象 / 三段串 → 对象 / 旧 base64 → string / 空）。
 */
import { describe, it, expect } from 'vitest'
import { toRemoteRow, fromRemoteBookmark, fromRemoteGroup, type RemoteBookmarkRow, type RemoteGroupRow } from '../../composables/domain/useSyncMapping.js'
import type { EncryptedPassword } from '../../types.js'

// 构造一个合法的 EncryptedPassword 对象（字段值无需真的能解密，只测映射形状）
function makeEP(): EncryptedPassword {
  return { encrypted: true, salt: 'saltAAA', iv: 'ivBBB', data: 'dataCCC' }
}

// 构造一个最小可用 bookmark 行（本地形态）
function makeLocalItem(password: unknown): Record<string, unknown> {
  return {
    id: 'bm-1', _userId: 'u-1',
    title: 't', url: 'https://x.com',
    username: '', password,
    notes: '', icon: '',
    categoryId: 'cat', parentId: null,
    order: 0, useCount: 0, attributes: {},
    isExpanded: false, createdAt: 1000, updatedAt: 2000, deletedAt: undefined,
  }
}

describe('toRemoteRow password 序列化', () => {
  it('EncryptedPassword 对象 → salt.iv.data 三段串（非 JSON 文本）', () => {
    const row = toRemoteRow('bookmark', makeLocalItem(makeEP()), false) as RemoteBookmarkRow
    expect(row.password).toBe('saltAAA.ivBBB.dataCCC')
    // 关键：绝不再是 JSON 文本（这是旧 bug 的损坏形态）
    expect(row.password!.startsWith('{')).toBe(false)
  })

  it('string password → 原样透传', () => {
    const row = toRemoteRow('bookmark', makeLocalItem('legacy-base64-pw'), false) as RemoteBookmarkRow
    expect(row.password).toBe('legacy-base64-pw')
  })

  it('已有三段串 string password → 原样透传', () => {
    const row = toRemoteRow('bookmark', makeLocalItem('s.i.d'), false) as RemoteBookmarkRow
    expect(row.password).toBe('s.i.d')
  })

  it('空 password → 空字符串', () => {
    const row = toRemoteRow('bookmark', makeLocalItem(''), false) as RemoteBookmarkRow
    expect(row.password).toBe('')
    const rowNil = toRemoteRow('bookmark', makeLocalItem(null), false) as RemoteBookmarkRow
    expect(rowNil.password).toBe('')
  })

  it('缺字段 EncryptedPassword 对象 → 空字符串（不输出残缺三段串）', () => {
    const broken = { encrypted: true, salt: 's', iv: '', data: 'd' } as unknown as EncryptedPassword
    const row = toRemoteRow('bookmark', makeLocalItem(broken), false) as RemoteBookmarkRow
    expect(row.password).toBe('')
  })
})

describe('fromRemoteBookmark password 反序列化', () => {
  function rowWith(password: string): RemoteBookmarkRow {
    return {
      id: 'bm-1', user_id: 'u-1', title: 't', url: 'https://x.com',
      username: '', password, notes: '', icon: '',
      category_id: 'cat', parent_id: null,
      order: 0, use_count: 0, attributes: {},
      is_expanded: false, created_at_num: 1000, updated_at_num: 2000, deleted_at: null,
    } as RemoteBookmarkRow
  }

  it('三段串 → 还原成 EncryptedPassword 对象（与本地保存路径一致）', () => {
    const bm = fromRemoteBookmark(rowWith('saltAAA.ivBBB.dataCCC'))
    expect(bm).not.toBeNull()
    expect(bm!.password).toEqual(makeEP())
  })

  it('历史损坏数据：JSON 文本 {"encrypted":true,...} → 还原成对象（自救）', () => {
    // 模拟旧版 toRemoteRow 用 JSON.stringify 存入云端的损坏形态
    const corrupted = JSON.stringify(makeEP())
    expect(corrupted.startsWith('{')).toBe(true) // 确认是损坏形态
    const bm = fromRemoteBookmark(rowWith(corrupted))
    expect(bm).not.toBeNull()
    // 关键：还原成对象，而非残留 JSON 文本字符串
    expect(typeof bm!.password).toBe('object')
    expect(bm!.password).toEqual(makeEP())
  })

  it('旧版 base64 string → 保留 string（由 autoMigratePassword 解码）', () => {
    const bm = fromRemoteBookmark(rowWith(btoa('legacy-pw')))
    expect(bm).not.toBeNull()
    expect(typeof bm!.password).toBe('string')
    expect(bm!.password).toBe(btoa('legacy-pw'))
  })

  it('空 → 空字符串', () => {
    const bm = fromRemoteBookmark(rowWith(''))
    expect(bm).not.toBeNull()
    expect(bm!.password).toBe('')
  })
})

describe('push/pull 对称性（roundtrip）', () => {
  it('EncryptedPassword 对象经 push → pull 后还原成相等的对象', () => {
    const ep = makeEP()
    const row = toRemoteRow('bookmark', makeLocalItem(ep), false) as RemoteBookmarkRow
    const back = fromRemoteBookmark(row)
    expect(back).not.toBeNull()
    expect(back!.password).toEqual(ep)
  })
})

// AUDIT-R5：pinnedAt 跨端同步。togglePin 写入 pinnedAt 并 _trackChange('pinnedAt')，
// toRemoteRow 应映射至 pinned_at、fromRemote* 应回填 pinnedAt，使置顶态跨设备同步。
describe('pinnedAt 跨端映射 (AUDIT-R5)', () => {
  it('bookmark toRemoteRow: 有 pinnedAt → 映射 pinned_at', () => {
    const item = makeLocalItem('')
    item.pinnedAt = 1700000000000
    const row = toRemoteRow('bookmark', item, false) as RemoteBookmarkRow
    expect(row.pinned_at).toBe(1700000000000)
  })

  it('bookmark toRemoteRow: 无 pinnedAt → pinned_at = null（未置顶）', () => {
    const row = toRemoteRow('bookmark', makeLocalItem(''), false) as RemoteBookmarkRow
    expect(row.pinned_at).toBeNull()
  })

  it('bookmark fromRemoteBookmark: pinned_at → 还原 pinnedAt', () => {
    const row = {
      id: 'bm-1', user_id: 'u-1', title: 't', url: 'https://x.com',
      username: '', password: '', notes: '', icon: '',
      category_id: 'cat', parent_id: null,
      order: 0, use_count: 0, attributes: {},
      is_expanded: false, created_at_num: 1000, updated_at_num: 2000,
      pinned_at: 1700000000000, deleted_at: null,
    } as RemoteBookmarkRow
    const bm = fromRemoteBookmark(row)
    expect(bm).not.toBeNull()
    expect(bm!.pinnedAt).toBe(1700000000000)
  })

  it('bookmark fromRemoteBookmark: pinned_at = null → pinnedAt = undefined（与本地未置顶等价）', () => {
    const row = {
      id: 'bm-1', user_id: 'u-1', title: 't', url: 'https://x.com',
      username: '', password: '', notes: '', icon: '',
      category_id: 'cat', parent_id: null,
      order: 0, use_count: 0, attributes: {},
      is_expanded: false, created_at_num: 1000, updated_at_num: 2000,
      pinned_at: null, deleted_at: null,
    } as RemoteBookmarkRow
    const bm = fromRemoteBookmark(row)
    expect(bm).not.toBeNull()
    expect(bm!.pinnedAt).toBeUndefined()
  })

  it('bookmark pinned_at roundtrip: push → pull 后置顶态保留', () => {
    const item = makeLocalItem('')
    item.pinnedAt = 1700000000000
    const row = toRemoteRow('bookmark', item, false) as RemoteBookmarkRow
    const back = fromRemoteBookmark(row)
    expect(back).not.toBeNull()
    expect(back!.pinnedAt).toBe(1700000000000)
  })

  it('group toRemoteRow: 有 pinnedAt → 映射 pinned_at', () => {
    const item = {
      id: 'g-1', _userId: 'u-1', name: '组', categoryId: 'cat',
      icon: '', order: 0, isExpanded: false, attributes: {},
      bookmarkIds: [], notes: '', useCount: 0, isPublic: false,
      updatedAt: 2000, pinnedAt: 1800000000000, deletedAt: undefined,
    }
    const row = toRemoteRow('group', item, false) as RemoteGroupRow
    expect(row.pinned_at).toBe(1800000000000)
  })

  it('group fromRemoteGroup: pinned_at → 还原 pinnedAt', () => {
    const row = {
      id: 'g-1', user_id: 'u-1', name: '组', category_id: 'cat',
      icon: '', order: 0, is_expanded: false, attributes: {},
      bookmark_ids: [], notes: '', use_count: 0, is_public: false,
      updated_at_num: 2000, pinned_at: 1800000000000, deleted_at: null,
    } as RemoteGroupRow
    const g = fromRemoteGroup(row)
    expect(g).not.toBeNull()
    expect(g!.pinnedAt).toBe(1800000000000)
  })

  it('group pinned_at roundtrip: push → pull 后置顶态保留', () => {
    const item = {
      id: 'g-1', _userId: 'u-1', name: '组', categoryId: 'cat',
      icon: '', order: 0, isExpanded: false, attributes: {},
      bookmarkIds: [], notes: '', useCount: 0, isPublic: false,
      updatedAt: 2000, pinnedAt: 1800000000000, deletedAt: undefined,
    }
    const row = toRemoteRow('group', item, false) as RemoteGroupRow
    const back = fromRemoteGroup(row)
    expect(back).not.toBeNull()
    expect(back!.pinnedAt).toBe(1800000000000)
  })
})
