/**
 * 收费准备阶段新增逻辑的单测
 *
 * 覆盖三块：
 * 1) AI 服务商清单配置：非空、字段完整（隐私政策 §3.3 的告知对象）
 * 2) useSharePassword：请求头/体、错误码映射
 * 3) useAccountDeletion：成功/失败路径的判定
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/lib/cloudbase.js', () => ({
  isCloudBaseBackend: () => true,
  edgeFnUrl: (name: string) => `https://fn.example.com/${name}`,
}))

vi.mock('../../src/lib/supabase.js', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}))

import { AI_PROVIDERS, AI_PROVIDERS_UPDATED_AT, LEGAL_DOC_LINKS } from '../config/aiProviders'
import { setSharePassword, getSharePasswordState, isSharePasswordAcceptable } from '../composables/domain/useSharePassword'
import { purgeAccount } from '../composables/domain/useAccountDeletion'

describe('AI 服务商清单', () => {
  it('非空且每项字段完整（缺一项即无法满足告知义务）', () => {
    expect(AI_PROVIDERS.length).toBeGreaterThan(0)
    for (const p of AI_PROVIDERS) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.product).toBeTruthy()
      expect(p.website).toMatch(/^https:\/\//)
      expect(p.filing).toBeTruthy()
    }
  })

  it('有更新时间戳（用户需能判断信息新鲜度）', () => {
    expect(AI_PROVIDERS_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('法律文档链接覆盖协议/隐私/退款三份', () => {
    const paths = LEGAL_DOC_LINKS.map((d) => d.path)
    // 指向渲染后的 HTML 页（裸 .md 用户不可读，见 renderLegalDoc.ts 说明）
    expect(paths).toContain('/legal/terms-of-service.html')
    expect(paths).toContain('/legal/privacy-policy.html')
    expect(paths).toContain('/legal/refund-policy.html')
    for (const p of paths) expect(p.endsWith('.md')).toBe(false)
  })
})

describe('分享密码：密码策略', () => {
  it('长度边界与前端一致（4~128）', () => {
    expect(isSharePasswordAcceptable('abcd')).toBe(true)
    expect(isSharePasswordAcceptable('abc')).toBe(false)
    expect(isSharePasswordAcceptable('a'.repeat(128))).toBe(true)
    expect(isSharePasswordAcceptable('a'.repeat(129))).toBe(false)
  })
})

describe('分享密码：设置 / 查询', () => {
  let calls: Array<{ url: string; init: RequestInit }> = []
  beforeEach(() => {
    calls = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true, has_password: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('设置密码：POST 到 share-admin，带 Bearer 头与明文密码', async () => {
    const r = await setSharePassword('g-abc', 'mypassword')
    expect(r.ok).toBe(true)
    expect(r.hasPassword).toBe(true)
    expect(calls[0].url).toContain('/share-admin')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ gid: 'g-abc', password: 'mypassword' })
  })

  it('清除密码：password 传 null', async () => {
    await setSharePassword('g-abc', null)
    expect(JSON.parse(String(calls[0].init.body)).password).toBeNull()
  })

  it('查询状态：action=get', async () => {
    const r = await getSharePasswordState('g-abc')
    expect(r.ok).toBe(true)
    expect(JSON.parse(String(calls[0].init.body)).action).toBe('get')
  })

  it('错误码映射：401→unauthorized，403→forbidden，429→rate_limited', async () => {
    const mk = (status: number) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))
    mk(401)
    expect((await setSharePassword('g', 'abcd')).error).toBe('unauthorized')
    mk(403)
    expect((await setSharePassword('g', 'abcd')).error).toBe('forbidden')
    mk(429)
    expect((await setSharePassword('g', 'abcd')).error).toBe('rate_limited')
  })

  it('网络异常 → network（不谎报成功）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const r = await setSharePassword('g', 'abcd')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('network')
  })
})

describe('账号注销', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('成功路径：ok + 账号待人工删除标记', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ ok: true, dataDeleted: true, accountPendingDeletion: true }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    const r = await purgeAccount()
    expect(r.ok).toBe(true)
    expect(r.dataDeleted).toBe(true)
    expect(r.accountPendingDeletion).toBe(true)
  })

  it('服务端 5xx 时不谎报成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    const r = await purgeAccount()
    expect(r.ok).toBe(false)
    expect(r.error).toBe('failed')
  })

  it('网络异常 → network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    const r = await purgeAccount()
    expect(r.ok).toBe(false)
    expect(r.error).toBe('network')
  })
})
