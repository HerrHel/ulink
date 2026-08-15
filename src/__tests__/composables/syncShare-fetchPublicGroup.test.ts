/**
 * syncShare — fetchPublicGroup 行为契约锁现状补测（不改 sync 写路径逻辑）
 *
 * 覆盖 syncShare.ts 既有 syncShare-setGroupPublic.test.ts 6 测只锁 setGroupPublic
 * 未触达的 fetchPublicGroup 整函数（行 31-49，Stmts 33.33%/Br 30% Func 缺口根源）：
 *  ① gid 不合法 → isValidShareGroupId false → return null 不发 rpc（防非法 gid 查远端）
 *  ② rpc error → console.warn + return null（带 warn 排障，不发后续解析）
 *  ③ data==null（远端无 / RPC 返空） → return null（无 warn：无 error 时不噪音）
 *  ④ payload.group 缺失 → return null
 *  ⑤ fromRemoteGroup(group 行非法) → return null（Zod 校验拒非法组行不崩）
 *  ⑥ 正常路径：group + bookmarks 返回，且**核心安全契约**：公开分享的书签
 *     username/password 被强制剥空（防私密凭证经公开分享泄漏给匿名访问者）
 *  ⑦ payload.bookmarks 缺失 → bookmarks=[]（防 undefined 进下游）
 *
 * 守则：sync 写路径只锁现状不改逻辑，本文件纯补测不碰 syncShare.ts 源码。
 * fetchPublicGroup 未经 SyncRemotePort 直调 supabase.rpc，桩 supabase.rpc 链可控。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── supabase mock：rpc可控 {data, error}，from().update()链保留供 setGroupPublic 复用 ──
const _supa = vi.hoisted(() => ({
  rpcReturn: { data: null, error: null } as { data: unknown; error: unknown },
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}))
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      _supa.rpcCalls.push({ fn, args })
      // thenable：await 触发 .then 返回 setReturn
      return {
        then: (res: any, rej: any) => Promise.resolve(_supa.rpcReturn).then(res, rej),
      }
    },
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ then: (res: any) => Promise.resolve({ error: null }).then(res) }) }),
      }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

beforeEach(async () => {
  setActivePinia(createPinia())
  _supa.rpcReturn = { data: null, error: null }
  _supa.rpcCalls = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

const GID_OK = 'valid-group-1' // 满足 SHARE_GID_RE = /^[a-zA-Z0-9_-]{2,64}$/

function remoteGroup(over: Record<string, unknown> = {}) {
  return {
    id: GID_OK,
    name: '公开组',
    category_id: 'uncategorized',
    icon: '',
    order: 0,
    is_expanded: false,
    attributes: {},
    bookmark_ids: [],
    notes: '',
    use_count: 0,
    updated_at_num: 9000,
    is_public: true,
    deleted_at: null,
    ...over,
  }
}

function remoteBookmark(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: '分享书签 ' + id,
    url: 'https://share.example/' + id,
    username: 'secret-user-' + id,
    password: 'secret-pw-plain',
    notes: 'note',
    icon: '',
    category_id: 'uncategorized',
    parent_id: null,
    order: 0,
    use_count: 0,
    attributes: {},
    is_expanded: false,
    created_at_num: 1000,
    updated_at_num: 9000,
    deleted_at: null,
    ...over,
  }
}

describe('fetchPublicGroup gid 守门', () => {
  it('gid 不合法（含特殊字符） → return null，不发 rpc', async () => {
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')
    const ok = await fetchPublicGroup('bad gid with space')
    expect(ok).toBeNull()
    expect(_supa.rpcCalls.length).toBe(0) // 不合法 gid 不发远端查询
  })

  it('gid 为空串 → return null，不发 rpc', async () => {
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')
    const ok = await fetchPublicGroup('')
    expect(ok).toBeNull()
    expect(_supa.rpcCalls.length).toBe(0)
  })

  it('gid 合法但 rpc 返回 error → console.warn + return null', async () => {
    _supa.rpcReturn = { data: null, error: { message: 'rpc denied' } }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')

    const ok = await fetchPublicGroup(GID_OK)
    expect(ok).toBeNull()
    // rpc 被调用（合法 gid 发远端查询）
    expect(_supa.rpcCalls).toContainEqual({ fn: 'get_public_group', args: { p_gid: GID_OK } })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('rpc 返回 data==null 且无 error → return null 不 warn（无噪音）', async () => {
    _supa.rpcReturn = { data: null, error: null }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')

    const ok = await fetchPublicGroup(GID_OK)
    expect(ok).toBeNull()
    // 无 error 时不 warn（data==null 是正常「远端无此公开组」语义，不噪音）
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('fetchPublicGroup payload 解析守门', () => {
  it('payload.group 缺失 → return null', async () => {
    _supa.rpcReturn = { data: { bookmarks: [remoteBookmark('bm-x')] }, error: null }
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')

    const ok = await fetchPublicGroup(GID_OK)
    expect(ok).toBeNull()
  })

  it('fromRemoteGroup 对非法 group 行（name 缺失被 Zod 拒）→ return null', async () => {
    _supa.rpcReturn = {
      data: { group: { ...remoteGroup(), name: undefined } as any, bookmarks: [] },
      error: null,
    }
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')

    const ok = await fetchPublicGroup(GID_OK)
    expect(ok).toBeNull()
  })

  it('payload.bookmarks 缺失 → bookmarks=[]（防 undefined 进下游）', async () => {
    _supa.rpcReturn = { data: { group: remoteGroup() }, error: null } // 无 bookmarks 字段
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')

    const ok = await fetchPublicGroup(GID_OK)
    expect(ok).not.toBeNull()
    expect(ok!.bookmarks).toEqual([])
  })
})

describe('fetchPublicGroup 正常路径 + 私密凭证剥空安全契约', () => {
  it('正常返回 group + bookmarks，username/password 被强制剥空（防泄露给匿名访问者）', async () => {
    _supa.rpcReturn = {
      data: {
        group: remoteGroup(),
        bookmarks: [remoteBookmark('bm-1'), remoteBookmark('bm-2')],
      },
      error: null,
    }
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')

    const ok = await fetchPublicGroup(GID_OK)
    expect(ok).not.toBeNull()
    expect(ok!.group.id).toBe(GID_OK)
    expect(ok!.group.name).toBe('公开组')
    expect(ok!.bookmarks.length).toBe(2)
    // 核心安全契约：公开分享的书签私密凭证（username/password）被强制剥空
    // 防经公开分享 URL 把用户存的账号密码泄漏给任何持有分享链接的匿名访问者
    for (const b of ok!.bookmarks) {
      expect(b.username).toBe('')
      expect(b.password).toBe('')
    }
    // 非敏感字段保留（标题/url 供展示）
    expect(ok!.bookmarks[0].url).toBe('https://share.example/bm-1')
    expect(ok!.bookmarks[0].title).toBe('分享书签 bm-1')
  })

  it('bookmarks 含非法行被 fromRemoteBookmark 滤掉（filter Boolean）', async () => {
    _supa.rpcReturn = {
      data: {
        group: remoteGroup(),
        bookmarks: [
          remoteBookmark('bm-good'),
          { ...remoteBookmark('bm-bad'), url: undefined } as any, // url 缺失被 Zod 拒 → fromRemoteBookmark 返 null → 滤
          remoteBookmark('bm-good2'),
        ],
      },
      error: null,
    }
    const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')

    const ok = await fetchPublicGroup(GID_OK)
    expect(ok).not.toBeNull()
    expect(ok!.bookmarks.length).toBe(2)
    expect(ok!.bookmarks.map(b => b.id).sort()).toEqual(['bm-good', 'bm-good2'])
  })
})
