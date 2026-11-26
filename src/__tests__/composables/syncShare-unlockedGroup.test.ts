/**
 * fetchPublicGroup 的「验密后取数」回退（2026-11-26，修「带密码的分享点保存笔记 → 分享不存在」）
 *
 * get_public_group RPC 一律不返回设了访问密码的组。访客在分享页输对密码后持有 share-ssr 下发的
 * 验密票据 cookie，同源请求 /s/<gid>/data 会自动带上。锁住的契约：
 *   1. RPC 有数据 → 直接用，不发回退请求
 *   2. RPC 拿不到 → 同源 GET /s/<gid>/data（credentials: same-origin），解析同一份 { group, bookmarks }
 *   3. 回退路径同样强制剥空书签 username/password
 *   4. 回退返回 401 / 非 JSON / 网络异常 → null（照旧显示「分享不存在」）
 *   5. 非同源（开发环境等）不发回退请求
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _rpc = vi.hoisted(() => ({ ret: { data: null, error: null } as { data: unknown; error: unknown } }))
vi.mock('../../lib/dbApi.js', () => ({
  dbFrom: vi.fn(),
  dbRpc: () => Promise.resolve(_rpc.ret),
}))
const _urls = vi.hoisted(() => ({ base: '' }))
vi.mock('../../config/urls.js', async (orig) => {
  const real = await orig<typeof import('../../config/urls.js')>()
  return {
    ...real,
    get SHARE_BASE() { return _urls.base },
  }
})

const row = (id: string) => ({
  group: { id, name: '加密笔记', category_id: 'uncategorized', bookmark_ids: ['b1'], notes: '<p>秘密</p>', is_public: true },
  bookmarks: [{ id: 'b1', title: 'VERT', url: 'https://vert.sh', username: 'leak', password: 'leak' }],
})

function jsonRes(status: number, body: unknown, type = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': type } })
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  _rpc.ret = { data: null, error: null }
  _urls.base = `${window.location.origin}/s` // 同源（生产形态）
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function load() {
  const { fetchPublicGroup } = await import('../../composables/domain/syncShare.js')
  return fetchPublicGroup
}

describe('fetchPublicGroup 验密后取数回退', () => {
  it('RPC 有数据：直接用，不发回退请求', async () => {
    _rpc.ret = { data: row('g1'), error: null }
    const r = await (await load())('g1')
    expect(r?.group.id).toBe('g1')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('RPC 拿不到：同源 GET /s/<gid>/data 带 cookie，解析并剥空账号密码', async () => {
    fetchSpy.mockResolvedValue(jsonRes(200, row('glock')))
    const r = await (await load())('glock')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/s/glock/data')
    expect(init.credentials).toBe('same-origin')
    expect(r?.group.id).toBe('glock')
    expect(r?.group.notes).toContain('秘密')
    expect(r?.bookmarks[0].username).toBe('')
    expect(r?.bookmarks[0].password).toBe('')
  })

  it('回退 401 / 非 JSON / 网络异常 → null', async () => {
    const fetchPublicGroup = await load()
    fetchSpy.mockResolvedValueOnce(jsonRes(401, { error: 'locked' }))
    expect(await fetchPublicGroup('glock')).toBeNull()
    fetchSpy.mockResolvedValueOnce(jsonRes(200, '<html>', 'text/html'))
    expect(await fetchPublicGroup('glock')).toBeNull()
    fetchSpy.mockRejectedValueOnce(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await fetchPublicGroup('glock')).toBeNull()
  })

  it('非同源（开发环境等）：不发回退请求', async () => {
    _urls.base = 'https://ulink.ren/s'
    expect(await (await load())('glock')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
