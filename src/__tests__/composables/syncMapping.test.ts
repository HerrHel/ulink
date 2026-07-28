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
import { describe, it, expect, vi } from 'vitest'
import { toRemoteRow, fromRemoteBookmark, fromRemoteGroup, fromRemoteCategory, fromRemoteAttribute, type RemoteBookmarkRow, type RemoteGroupRow, type RemoteCategoryRow, type RemoteAttributeRow } from '../../composables/domain/useSyncMapping.js'
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

// D1-3：category / attribute 的 toRemoteRow/fromRemote* roundtrip + 兜底护栏。
// 七轮 sync 序列化护栏都集中在 bookmark/group 的 password/pinned_at，分类与自定义属性
// 的映射契约（color/order 字段、type 兜底）从未有测试覆盖——它们同样走 FROM_REMOTE 表，
// pull/realtime 都依赖。补齐为后续 sync 边界优化铺路。
describe('category 跨端映射 roundtrip (D1-3)', () => {
  function makeLocalCategory(): Record<string, unknown> {
    return {
      id: 'cat-1', _userId: 'u-1',
      name: '工作', icon: 'briefcase', color: '#3b82f6',
      order: 2, updatedAt: 3000, deletedAt: undefined,
    }
  }

  it('toRemoteRow category: camelCase → snake_case 全字段映射', () => {
    const row = toRemoteRow('category', makeLocalCategory(), false) as RemoteCategoryRow
    expect(row.id).toBe('cat-1')
    expect(row.user_id).toBe('u-1')
    expect(row.name).toBe('工作')
    expect(row.icon).toBe('briefcase')
    expect(row.color).toBe('#3b82f6')
    expect(row.order).toBe(2)
    expect(row.updated_at_num).toBe(3000)
    expect(row.deleted_at).toBeNull()
  })

  it('toRemoteRow category: 缺省字段兜底（icon/color 空、order 0、updatedAt 现 now）', () => {
    const item = { id: 'cat-2', _userId: 'u-1', name: '默认', updatedAt: 0 } as Record<string, unknown>
    const row = toRemoteRow('category', item, false) as RemoteCategoryRow
    expect(row.icon).toBe('')
    expect(row.color).toBe('')
    expect(row.order).toBe(0)
    // updatedAt 为 0/缺省时回退 Date.now()——锁定「现 now」兜底契约（不写 0 进远端）
    expect(row.updated_at_num).toBeGreaterThan(0)
  })

  it('fromRemoteCategory: 远端行还原本地 Category（全字段）', () => {
    const row: RemoteCategoryRow = {
      id: 'cat-1', user_id: 'u-1', name: '工作', icon: 'briefcase', color: '#3b82f6',
      order: 2, updated_at_num: 3000, deleted_at: null,
    }
    const c = fromRemoteCategory(row)
    expect(c).not.toBeNull()
    expect(c).toMatchObject({ id: 'cat-1', name: '工作', icon: 'briefcase', color: '#3b82f6', order: 2, updatedAt: 3000 })
    expect(c!.deletedAt).toBeUndefined()
  })

  it('category roundtrip: push → pull 后分类元信息保留', () => {
    const item = makeLocalCategory()
    const row = toRemoteRow('category', item, false) as RemoteCategoryRow
    const back = fromRemoteCategory(row)
    expect(back).not.toBeNull()
    expect(back!.id).toBe('cat-1')
    expect(back!.name).toBe('工作')
    expect(back!.icon).toBe('briefcase')
    expect(back!.color).toBe('#3b82f6')
    expect(back!.order).toBe(2)
    expect(back!.updatedAt).toBe(3000)
  })

  it('category deleted_at roundtrip: 软删时间戳经 ISO 互转仍可还原', () => {
    const ts = 1700000000000
    const item = { ...makeLocalCategory(), deletedAt: ts } as Record<string, unknown>
    const row = toRemoteRow('category', item, false) as RemoteCategoryRow
    // 远端存 ISO 字符串
    expect(typeof row.deleted_at).toBe('string')
    expect(row.deleted_at).not.toBeNull()
    // 回程 parseTimestamp 还原成 number
    const back = fromRemoteCategory(row)
    expect(back).not.toBeNull()
    expect(back!.deletedAt).toBe(ts)
  })

  // 真实行为：CategorySchema.id/name 是 z.string()（允许空串），故空 id/name 能过
  // 校验 → fromRemoteCategory 返回空字段对象而非 null。锁定此当前行为。
  // 注：空 id/name 对象被接受是否该收紧 schema 拒绝（z.string().min(1)）见
  //   needs-user-review 清单「sync 坏远端数据污染面」，属 schema 收紧需人工裁。
  it('fromRemoteCategory: 空 id/name 经 schema 放行返空字段对象（非 null，schema 当前允许空串）', () => {
    const broken = { id: '', name: '' } as unknown as RemoteCategoryRow
    const c = fromRemoteCategory(broken)
    expect(c).not.toBeNull()
    expect(c?.id).toBe('')
    expect(c?.name).toBe('')
  })
})

describe('attribute 跨端映射 roundtrip (D1-3)', () => {
  function makeLocalAttribute(): Record<string, unknown> {
    return {
      id: 'attr-1', _userId: 'u-1',
      name: '已读', type: 'boolean',
      updatedAt: 4000, deletedAt: undefined,
    }
  }

  it('toRemoteRow attribute: 字段映射（type 透传 boolean）', () => {
    const row = toRemoteRow('attribute', makeLocalAttribute(), false) as RemoteAttributeRow
    expect(row.id).toBe('attr-1')
    expect(row.user_id).toBe('u-1')
    expect(row.name).toBe('已读')
    expect(row.type).toBe('boolean')
    expect(row.updated_at_num).toBe(4000)
    expect(row.deleted_at).toBeNull()
  })

  it('toRemoteRow attribute: type 缺省兜底为 boolean', () => {
    const item = { id: 'attr-2', _userId: 'u-1', name: '收藏' } as Record<string, unknown>
    const row = toRemoteRow('attribute', item, false) as RemoteAttributeRow
    expect(row.type).toBe('boolean')
  })

  it('fromRemoteAttribute: 远端行还原本地 CustomAttribute', () => {
    const row: RemoteAttributeRow = {
      id: 'attr-1', user_id: 'u-1', name: '已读', type: 'boolean',
      updated_at_num: 4000, deleted_at: null,
    }
    const a = fromRemoteAttribute(row)
    expect(a).not.toBeNull()
    expect(a).toMatchObject({ id: 'attr-1', name: '已读', type: 'boolean', updatedAt: 4000 })
    expect(a!.deletedAt).toBeUndefined()
  })

  it('attribute roundtrip: push → pull 后属性保留', () => {
    const row = toRemoteRow('attribute', makeLocalAttribute(), false) as RemoteAttributeRow
    const back = fromRemoteAttribute(row)
    expect(back).not.toBeNull()
    expect(back!.id).toBe('attr-1')
    expect(back!.name).toBe('已读')
    expect(back!.type).toBe('boolean')
    expect(back!.updatedAt).toBe(4000)
  })

  // M15 兜底契约：当前产品仅 boolean，远端若出现非 boolean type（如将来 schema 演进遗留、
  // 或别端误写）不整条丢弃——强制兜底成 'boolean' 保留 id/name 引用，并 console.warn 提示。
  // 锁定此行为：它是「新旧端混跑时属性不丢」的安全网，护栏记录防有人误把兜底当 bug 删掉。
  it('fromRemoteAttribute: 非 boolean type 兜底为 boolean + warn（不丢条目）', () => {
    const row: RemoteAttributeRow = {
      id: 'attr-x', user_id: 'u-1', name: '未来类型', type: 'string',
      updated_at_num: 5000, deleted_at: null,
    }
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = fromRemoteAttribute(row)
    expect(a).not.toBeNull()
    // 不丢：id/name 保留
    expect(a!.id).toBe('attr-x')
    expect(a!.name).toBe('未来类型')
    // type 强制兜底成 boolean（schema 当前唯一合法值）
    expect(a!.type).toBe('boolean')
    // warn 留迹，提示 type 字面值（schema 演进时据此扩展）
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('attr-x'))
    spy.mockRestore()
  })

  // 真实行为：CustomAttributeSchema.id/name 是 z.string()（允许空串），空 id/name
  // 能过校验 → fromRemoteAttribute 返回空字段对象而非 null。锁定此当前行为。
  // 注：是否收紧 schema 拒绝空 id/name 见 needs-user-review 清单（同 category）。
  it('fromRemoteAttribute: 空 id/name 经 schema 放行返空字段对象（非 null）', () => {
    const broken = { id: '', name: '' } as unknown as RemoteAttributeRow
    const a = fromRemoteAttribute(broken)
    expect(a).not.toBeNull()
    expect(a?.id).toBe('')
    expect(a?.name).toBe('')
  })
})
