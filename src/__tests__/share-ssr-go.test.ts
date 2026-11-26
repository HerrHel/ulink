/**
 * share-ssr 出站跳转 /s/<gid>/go、/s/c/<sid>/go（分享页转化计数）
 *
 * 锁住的契约：
 *   1. 合法 id → 302 到白名单目标（to=save 回应用分享态、to=start 去首页），不缓存、不收录；
 *   2. to 参数无法把访客带到外部地址（防开放重定向）；
 *   3. 只允许 /go 这一个尾段：/go/x、/foo 等仍与「分享不存在」一致返回 404；畸形 id 仍在查库前 404；
 *   4. 非 GET/HEAD → 405；
 *   5. 分享不存在时只做存在性查询，不写统计（防随机 id 往统计表灌行）。
 *
 * 做法同 share-ssr-malformed-404.test.ts：子进程真实启动 index.js，-r 预加载假 SDK
 * （所有 rpc 返回 data:null = 分享不存在，并在 stdout 打 `[fake-rpc] <名>`）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const ENTRY = resolve(ROOT, 'cloudbase/functions/share-ssr/index.js')
const FAKE_SDK = resolve(__dirname, 'helpers/share-ssr-fake-sdk.cjs')
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36'

let child: ChildProcess
let base = ''
let stdout = ''

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createServer()
    srv.once('error', fail)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => done(port))
    })
  })
}

function req(path: string, init?: RequestInit) {
  return fetch(base + path, {
    redirect: 'manual',
    ...init,
    headers: { 'user-agent': CHROME, ...(init?.headers || {}) },
  })
}

/** 统计某段请求期间产生的假 RPC 调用名 */
async function rpcNamesDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const before = stdout.length
  await fn()
  await new Promise((r) => setTimeout(r, 80))
  return [...stdout.slice(before).matchAll(/\[fake-rpc\] (\S+)/g)].map((m) => m[1])
}

beforeAll(async () => {
  const port = await freePort()
  child = spawn(process.execPath, ['-r', FAKE_SDK, ENTRY], {
    cwd: resolve(ROOT, 'cloudbase/functions/share-ssr'),
    env: {
      ...process.env,
      PORT: String(port),
      CLOUDBASE_ENV_ID: 'test-env',
      CLOUDBASE_APIKEY: 'test-key',
      APP_ORIGIN: 'https://ulink.ren',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (d) => (stdout += String(d)))
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => fail(new Error('share-ssr 子进程 10s 内未就绪')), 10_000)
    child.stdout?.on('data', () => {
      if (stdout.includes('listening')) {
        clearTimeout(timer)
        done()
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`share-ssr 子进程提前退出，code=${code}`))
    })
  })
  base = `http://127.0.0.1:${port}`
}, 15_000)

afterAll(() => {
  child?.kill()
})

describe('share-ssr /go 出站跳转', () => {
  it('组分享 to=save → 302 回应用分享态，不缓存、不收录', async () => {
    const res = await req('/s/abc/go?to=save')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://ulink.ren/app?save=1#share/abc')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it('分类分享 to=save → /app?save=1#share/c/<sid>；to=start → 首页', async () => {
    expect((await req('/s/c/abc/go?to=save')).headers.get('location')).toBe('https://ulink.ren/app?save=1#share/c/abc')
    expect((await req('/s/c/abc/go?to=start')).headers.get('location')).toBe('https://ulink.ren/?from=share')
    expect((await req('/s/abc/go?to=start')).headers.get('location')).toBe('https://ulink.ren/?from=share')
  })

  it('to 指向外部地址无效，仍回到站内', async () => {
    for (const to of ['https://evil.example', '//evil.example', 'javascript:alert(1)']) {
      const res = await req(`/s/abc/go?to=${encodeURIComponent(to)}`)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://ulink.ren/app?save=1#share/abc')
    }
  })

  it('只认 /go 一个尾段；畸形 id 在查库前即 404', async () => {
    const baseline = await (await req('/s/abc')).text()
    for (const p of ['/s/abc/go/x', '/s/abc/gox', '/s/c/abc/go/x', '/s/c/abc/foo']) {
      const res = await req(p)
      expect(res.status).toBe(404)
      expect(await res.text()).toBe(baseline)
    }
    const names = await rpcNamesDuring(() => req(encodeURI("/s/abc'/go")))
    expect(names).toEqual([])
  })

  it('非 GET/HEAD → 405', async () => {
    const res = await req('/s/abc/go', { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('分享不存在：只查存在性，不写统计', async () => {
    const g = await rpcNamesDuring(() => req('/s/abc/go?to=save'))
    expect(g).toEqual(['get_share_secret'])
    const c = await rpcNamesDuring(() => req('/s/c/abc/go?to=save'))
    expect(c).toEqual(['get_public_category'])
  })

  it('脚本工具 UA 不触发任何查询', async () => {
    const names = await rpcNamesDuring(() => req('/s/abc/go', { headers: { 'user-agent': 'curl/8.4.0' } }))
    expect(names).toEqual([])
  })
})
