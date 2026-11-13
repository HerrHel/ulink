/**
 * probe-core 回归测试（海外探针）
 *
 * 背景：探针从 CF Pages 迁到独立 Worker（probe-worker/），逻辑抽到
 * functions/_lib/probe-core.ts 后，Pages 薄壳与 Worker 共用同一份实现。
 * 这里锁住最容易出事的三类行为：
 *   1. 三态判定口径：只有 2xx/3xx 算 alive，404/410 算 dead，403/5xx 必须 error
 *      （把反爬页当活站会让「被墙」误判反过来污染死链结论）；
 *   2. SSRF 防护：私网字面量 / 解析到内网的域名 / 非 http(s) 协议一律拒绝；
 *   3. Worker 形态的 Origin 门槛：无 Origin 直接 403，别变成开放代理。
 *
 * 网络全部 stub：DoH 走 cloudflare-dns.com，目标探测走目标 URL，按 URL 分流。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleProbe } from '../../../functions/_lib/probe-core.js'

/** DoH 响应：公网 A 记录 */
function dohPublic(): Response {
  return new Response(JSON.stringify({ Answer: [{ type: 1, data: '93.184.216.34' }] }), {
    status: 200,
    headers: { 'content-type': 'application/dns-json' },
  })
}

/** DoH 响应：解析到内网 */
function dohPrivate(): Response {
  return new Response(JSON.stringify({ Answer: [{ type: 1, data: '10.0.0.7' }] }), {
    status: 200,
    headers: { 'content-type': 'application/dns-json' },
  })
}

/** 构造一次探测请求（Worker 形态默认带 Origin） */
function probeRequest(url: string, init: { origin?: string | null; method?: string } = {}): Request {
  const headers = new Headers()
  const origin = init.origin === undefined ? 'https://ulink.ren' : init.origin
  if (origin) headers.set('Origin', origin)
  return new Request(`https://ulink-probe.test/?url=${encodeURIComponent(url)}`, {
    method: init.method ?? 'GET',
    headers,
  })
}

/** stub 全局 fetch：DoH 返回指定记录，目标请求返回指定响应 */
function stubFetch(target: () => Response, opts?: { doh?: () => Response }) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push(href)
    if (href.includes('cloudflare-dns.com')) return (opts?.doh ?? dohPublic)()
    return target()
  }))
  return calls
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('三态判定口径', () => {
  it('2xx → alive', async () => {
    stubFetch(() => new Response('ok', { status: 200 }))
    const res = await handleProbe(probeRequest('https://example.com/'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ outcome: 'alive', status: 200 })
  })

  it('3xx（不跟随到非法目标时按状态码判定）→ alive', async () => {
    // 无 Location 的 302：不构成跳转，直接按 3xx 判 alive
    stubFetch(() => new Response(null, { status: 302 }))
    const res = await handleProbe(probeRequest('https://example.com/'))
    await expect(res.json()).resolves.toMatchObject({ outcome: 'alive', status: 302 })
  })

  it('404 → dead', async () => {
    stubFetch(() => new Response('not found', { status: 404 }))
    const res = await handleProbe(probeRequest('https://example.com/'))
    await expect(res.json()).resolves.toMatchObject({ outcome: 'dead', status: 404 })
  })

  it('410 → dead', async () => {
    stubFetch(() => new Response('gone', { status: 410 }))
    const res = await handleProbe(probeRequest('https://example.com/'))
    await expect(res.json()).resolves.toMatchObject({ outcome: 'dead', status: 410 })
  })

  it('403 / 503 必须是 error，不能当 alive（风控页/故障页）', async () => {
    for (const status of [403, 503]) {
      stubFetch(() => new Response('blocked', { status }))
      const res = await handleProbe(probeRequest('https://example.com/'))
      const body = await res.json() as { outcome: string; status: number }
      expect(body.outcome).toBe('error')
      expect(body.status).toBe(status)
    }
  })

  it('非法 URL → dead/400；非 http(s) 协议 → 400 拒绝', async () => {
    // ftp:// 不满足 startsWith('http')，在入口就被 invalid_url 拦下（同样是拒绝，不发请求）
    const bad = await handleProbe(probeRequest('ftp://example.com/x'))
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ error: 'invalid_url', outcome: 'dead' })

    // httpfoo:// 能过 startsWith('http')，但协议白名单必须拦成 error
    const weird = await handleProbe(probeRequest('httpfoo://example.com/x'))
    expect(weird.status).toBe(400)
    await expect(weird.json()).resolves.toMatchObject({ error: 'private_ip_forbidden', outcome: 'error' })

    const empty = await handleProbe(probeRequest(''))
    expect(empty.status).toBe(400)
  })
})

describe('SSRF 防护', () => {
  it('私网 IP 字面量直接拒绝，且不发出目标请求', async () => {
    const calls = stubFetch(() => new Response('should-not-reach', { status: 200 }))
    for (const url of ['http://127.0.0.1/', 'http://10.1.2.3/', 'http://[::1]/', 'http://169.254.169.254/']) {
      const res = await handleProbe(probeRequest(url))
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'private_ip_forbidden' })
    }
    // 只可能有过 DoH 查询，绝不能打到目标本身
    expect(calls.some((c) => c.includes('127.0.0.1') || c.includes('169.254'))).toBe(false)
  })

  it('域名解析到内网（DoH 返回 10.x）同样拒绝', async () => {
    stubFetch(() => new Response('ok', { status: 200 }), { doh: dohPrivate })
    const res = await handleProbe(probeRequest('https://localtest.me/'))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'private_ip_forbidden', outcome: 'error' })
  })

  it('DoH 无记录（域名不存在）判 dead，不是 SSRF 拒绝', async () => {
    stubFetch(() => new Response('ok', { status: 200 }), {
      doh: () => new Response(JSON.stringify({ Answer: [] }), { status: 200 }),
    })
    const res = await handleProbe(probeRequest('https://no-such-host.invalid/'))
    // 200 + dead：让前端能确认「海外视角下域名不存在」= 死链，
    // 而不是 400 error（旧实现把 nxdomain 与私网混为一谈，白丢这条能力）
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ outcome: 'dead', status: 0 })
  })

  it('重定向到内网被拦（每跳重校验）', async () => {
    // HEAD 返回 302 指向内网 → 必须在第二跳被拒，而不是跟过去
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (href.includes('cloudflare-dns.com')) {
        // 首次校验 example.com 给公网，第二跳 host 给内网
        return href.includes('evil') ? new Response(JSON.stringify({ Answer: [{ type: 1, data: '10.0.0.9' }] }), { status: 200 }) : dohPublic()
      }
      seen.push(href)
      return new Response(null, { status: 302, headers: { Location: 'http://evil.internal-target.test/' } })
    }))
    const res = await handleProbe(probeRequest('https://example.com/'))
    const body = await res.json() as { outcome: string }
    // 不能返回 alive；视为 error（unsafe_redirect 被吞进 catch）
    expect(body.outcome).not.toBe('alive')
    expect(seen.some((h) => h.includes('evil.internal-target.test'))).toBe(false)
  })
})

describe('Worker 形态的 Origin 门槛', () => {
  it('无 Origin 直接 403（requireOrigin:true）', async () => {
    stubFetch(() => new Response('ok', { status: 200 }))
    const res = await handleProbe(probeRequest('https://example.com/', { origin: null }), {
      requireOrigin: true,
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'origin_required' })
  })

  it('非白名单 Origin 403（CORS 白名单生效）', async () => {
    stubFetch(() => new Response('ok', { status: 200 }))
    const res = await handleProbe(probeRequest('https://example.com/', { origin: 'https://evil.com' }), {
      requireOrigin: true,
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'origin_forbidden' })
  })

  it('白名单 Origin 成功并回显 ACAO（不是 *）', async () => {
    stubFetch(() => new Response('ok', { status: 200 }))
    const res = await handleProbe(probeRequest('https://example.com/'), { requireOrigin: true })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://ulink.ren')
  })

  it('OPTIONS 预检：合法 Origin 204 + Allow-Methods，非法 Origin 403', async () => {
    const ok = await handleProbe(probeRequest('https://example.com/', { method: 'OPTIONS' }), { requireOrigin: true })
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-methods')).toContain('GET')

    const bad = await handleProbe(
      probeRequest('https://example.com/', { method: 'OPTIONS', origin: 'https://evil.com' }),
      { requireOrigin: true },
    )
    expect(bad.status).toBe(403)
  })
})
