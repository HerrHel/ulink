/**
 * supabase.ts 契约测试 —— src/lib/supabase.ts 自身真实逻辑此前零直接测试（全仓 10 文件
 * vi.mock 掉此模块取 fake client），9.67% Stmts / 0% Func 覆盖率根源即此。
 *
 * 锁两分支真实安全降级契约：
 * 1) 未配置 Supabase（env VITE_SUPABASE_URL/ANON_KEY 无效）→ createNullClient() 返回 Proxy，
 *    所有 from()/rpc() 链式任意深 + await 出 {data:null, error:Error('Supabase 未配置'),
 *    count:null, status:0, statusText:''}（D1-002 注释明示：与官方 SDK 空结果形状对齐，
 *    避免 data.session 读 null 崩溃）；auth 各方法返空 session/user；proxy `then` 返 undefined
 *    防 null client 被当 thenable 误 await。
 * 2) 已配置（env 两值皆真值）→ 调真 createClient(url, key, {auth:{autoRefreshToken,
 *    persistSession, storage:localStorage, storageKey:'linkvault_auth'}})。
 * 3) 仅一值（url 或 key 缺一）→ 仍走 createNullClient（三元 && 双条件）。
 *
 * supabase 导出是模块顶层三元一次绑定死，测两分支须 vi.resetModules + vi.stubEnv + 动态 import
 * 重求值；已配置分支 mock @supabase/supabase-js 的 createClient 捕获 config（避免真起 SDK client）。
 * 参照 theme.test.ts resetModules+动态 import 隔离模块级单例范式。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const NULL_ERR_MSG = 'Supabase 未配置'

/** 解析 import('../../lib/supabase.js') 的动态导入辅助：每次先 resetModules 隔离 */
async function importSupabase() {
  vi.resetModules()
  return await import('../../lib/supabase.js')
}

describe('supabase.ts 未配置分支——createNullClient 安全降级契约', () => {
  beforeEach(() => {
    // jsdom + vitest 默认 import.meta.env.VITE_SUPABASE_URL/ANON_KEY 为 undefined（空三元走 null 分支）
    // 确保 env 两值非真值：显式置空字符串兜底（防 CI 注入真值污染）
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.doUnmock('@supabase/supabase-js')
  })

  it('from(表).select().eq().gt() 链式任意深 await 出 nullQuery 空结果形状（D1-002 防 data.session 读 null 崩）', async () => {
    const { supabase } = await importSupabase()
    const r = await supabase.from('bookmarks').select('*').eq('id', 1).gt('updated_at_num', 0)
    expect(r).toEqual({ data: null, error: new Error(NULL_ERR_MSG), count: null, status: 0, statusText: '' })
    // error 是 Supabase 未配置 Error 实例
    expect(r.error).toBeInstanceOf(Error)
    expect((r.error as Error).message).toBe(NULL_ERR_MSG)
  })

  it('from() 结端操作 upsert/update/delete 链式 await 同出 nullQuery 空结果', async () => {
    const { supabase } = await importSupabase()
    const up = await supabase.from('bookmarks').upsert([{ id: 'x' }])
    const del = await supabase.from('bookmarks').delete().eq('id', 'x')
    expect(up).toEqual({ data: null, error: new Error(NULL_ERR_MSG), count: null, status: 0, statusText: '' })
    expect(del).toEqual({ data: null, error: new Error(NULL_ERR_MSG), count: null, status: 0, statusText: '' })
  })

  it('rpc() 链式 thenable await 出 nullQuery 空结果', async () => {
    const { supabase } = await importSupabase()
    const r = await supabase.rpc('some_function', { arg: 1 })
    expect(r).toEqual({ data: null, error: new Error(NULL_ERR_MSG), count: null, status: 0, statusText: '' })
  })

  it('from() 链中段不 await 取 query 是 thenable proxy 可继续链', async () => {
    const { supabase } = await importSupabase()
    const q = supabase.from('bookmarks').select('*')
    // 含 then → 是 thenable
    expect(typeof q.then).toBe('function')
    // 继续链不崩
    const q2 = q.eq('id', 1)
    expect(typeof q2.then).toBe('function')
    const r = await q2
    expect(r.data).toBeNull()
  })

  it('auth.getUser 返空 user + Supabase 未配置 error', async () => {
    const { supabase } = await importSupabase()
    const r = await supabase.auth.getUser()
    expect(r.data).toEqual({ user: null })
    expect(r.error).toBeInstanceOf(Error)
    expect((r.error as Error).message).toBe(NULL_ERR_MSG)
  })

  it('auth.getSession 返空 session + Supabase 未配置 error', async () => {
    const { supabase } = await importSupabase()
    const r = await supabase.auth.getSession()
    expect(r.data).toEqual({ session: null })
    expect(r.error).toBeInstanceOf(Error)
    expect((r.error as Error).message).toBe(NULL_ERR_MSG)
  })

  it('auth.signInWithOtp/verifyOtp/signOut 返空 user+session + Supabase 未配置 error', async () => {
    const { supabase } = await importSupabase()
    for (const fn of ['signInWithOtp', 'verifyOtp', 'signOut'] as const) {
      const r = await (supabase.auth[fn] as () => Promise<any>)()
      expect(r.data).toEqual({ user: null, session: null })
      expect(r.error).toBeInstanceOf(Error)
      expect((r.error as Error).message).toBe(NULL_ERR_MSG)
    }
  })

  it('auth.onAuthStateChange 返含 unsubscribe 的 subscription（防回调泄漏）', async () => {
    const { supabase } = await importSupabase()
    const { data } = supabase.auth.onAuthStateChange(() => {})
    expect(typeof data.subscription.unsubscribe).toBe('function')
    // unsubscribe 不抛
    expect(() => data.subscription.unsubscribe()).not.toThrow()
  })

  it('null client proxy 的 then 属性返 undefined（防被当 thenable 误 await null client 对象）', async () => {
    const { supabase } = await importSupabase()
    // supabase 对象本身 Proxy 的 then 必须 undefined，否则 `await supabase` 会走 then 而非 resolve supabase
    expect((supabase as any).then).toBeUndefined()
  })

  it('其他未知属性访问返 () => Promise.resolve(nullQuery) 兜底', async () => {
    const { supabase } = await importSupabase()
    // 未知方法（非 from/rpc/auth）→ 返函数 → 调用返 Promise<nullQuery>
    const r = await (supabase as any).someUnknownMethod()
    expect(r).toEqual({ data: null, error: new Error(NULL_ERR_MSG), count: null, status: 0, statusText: '' })
  })

  it('from() 返的 query 被当函数直接调用 → Proxy apply 返 Promise<nullQuery>（line 24 apply handler）', async () => {
    const { supabase } = await importSupabase()
    // createNullQuery 的 Proxy apply：query 被「当函数调用」时返 Promise.resolve(nullQueryResult)
    // （区别于 .then thenable path，是「把 query 自身当函数调」的边界，应用层不长这般用但 apply 兜底须稳）
    const query = supabase.from('bookmarks')
    const r = await (query as any)('unexpected-direct-call')
    expect(r).toEqual({ data: null, error: new Error(NULL_ERR_MSG), count: null, status: 0, statusText: '' })
  })
})

describe('supabase.ts 已配置分支——createClient config 契约', () => {
  let createClientSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    // mock 真 SDK createClient：resetModules 后 doMock 在动态 import 前注册生效
    createClientSpy = vi.fn(() => ({ _fake: true }) as any)
    vi.doMock('@supabase/supabase-js', () => ({ createClient: createClientSpy }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.doUnmock('@supabase/supabase-js')
  })

  it('env 两值皆真值 → 调 createClient 传 (url, key, {auth 配置 localStorage 存储键})', async () => {
    const { supabase } = await importSupabase()
    expect(createClientSpy).toHaveBeenCalledTimes(1)
    const [url, key, config] = createClientSpy.mock.calls[0]
    expect(url).toBe('https://test.supabase.co')
    expect(key).toBe('test-anon-key')
    expect(config).toEqual({
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storage: localStorage,
        storageKey: 'linkvault_auth',
      },
    })
    // supabase 即 mock client 返回值（验三元真值分支输出）
    expect(supabase).toEqual({ _fake: true })
  })
})

describe('supabase.ts 三元 && 双条件——仅一值则仍走 createNullClient', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('仅设 URL（缺 ANON_KEY）→ 走 createNullClient', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { supabase } = await importSupabase()
    const r = await supabase.from('bookmarks').select('*')
    expect(r.error).toBeInstanceOf(Error)
    expect((r.error as Error).message).toBe(NULL_ERR_MSG)
  })

  it('仅设 ANON_KEY（缺 URL）→ 走 createNullClient', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    const { supabase } = await importSupabase()
    const r = await supabase.from('bookmarks').select('*')
    expect(r.error).toBeInstanceOf(Error)
    expect((r.error as Error).message).toBe(NULL_ERR_MSG)
  })

  it('env 两值皆 undefined（jsdom 默认态）→ 走 createNullClient', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', undefined as unknown as string)
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', undefined as unknown as string)
    const { supabase } = await importSupabase()
    const r = await supabase.from('bookmarks').select('*')
    expect(r.error).toBeInstanceOf(Error)
    expect((r.error as Error).message).toBe(NULL_ERR_MSG)
  })
})
