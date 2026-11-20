/**
 * share-ssr 畸形分享路径回归测试（安全复查 2026-11-20「SQL 注入」高危误报）
 *
 * 背景：原实现对畸形 id / 多余尾段返回 400 + 11 字节纯文本 "bad request"，而「分享不存在」
 * 返回 404 + 约 63KB 未找到页。差异型漏扫发现「加一个引号状态码和响应体就剧变」，
 * 判成了 SQL 注入（commit 8c8c2cd2 修复）。
 *
 * 本测试锁住的契约：
 *   1. 畸形路径（引号、注入 payload、非法字符、多余尾段、缺 id 等）一律 404；
 *   2. 响应状态码、响应体、关键响应头与「合法 id 但分享不存在」**逐字节一致**，
 *      不给差异型扫描器留任何信号；
 *   3. 畸形路径在查库前就返回（不触达 RPC），审计 #30 的防放大目标不变。
 *
 * 做法：以子进程真实启动 cloudbase/functions/share-ssr/index.js（它在模块加载时
 * 就 listen），用 -r 预加载桩替换 @cloudbase/node-sdk，再发真实 HTTP 请求比对。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const ENTRY = resolve(ROOT, 'cloudbase/functions/share-ssr/index.js')
const FAKE_SDK = resolve(__dirname, 'helpers/share-ssr-fake-sdk.cjs')

let child: ChildProcess
let base = ''
let stdout = ''

/** 向系统要一个空闲端口（share-ssr 的 PORT=0 会回落到 9000，不能直接用 0） */
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

interface Snapshot {
  status: number
  body: string
  contentType: string | null
  cacheControl: string | null
  shareCache: string | null
  robots: string | null
}

async function get(path: string, init?: RequestInit): Promise<Snapshot> {
  const res = await fetch(base + path, { redirect: 'manual', ...init })
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type'),
    cacheControl: res.headers.get('cache-control'),
    shareCache: res.headers.get('x-share-cache'),
    robots: res.headers.get('x-robots-tag'),
  }
}

/** 统计某段请求期间产生的假 RPC 调用次数 */
async function rpcCallsDuring(fn: () => Promise<unknown>): Promise<number> {
  const before = stdout.length
  await fn()
  // 子进程 stdout 异步到达，给一个很短的冲刷窗口
  await new Promise((r) => setTimeout(r, 50))
  return (stdout.slice(before).match(/\[fake-rpc\]/g) || []).length
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

/** 畸形输入：扫描器常用的注入 payload + 结构性畸形 */
const MALFORMED: Array<[string, string]> = [
  ['单引号', "/s/abc'"],
  ['双单引号', "/s/abc''"],
  ['双引号', '/s/abc"'],
  ['分号', '/s/abc;'],
  ['右括号', '/s/abc)'],
  ['布尔真', "/s/abc' AND '1'='1"],
  ['布尔假', "/s/abc' AND '1'='2"],
  ['OR 恒真', "/s/abc' OR '1'='1"],
  ['注释截断', "/s/abc'--"],
  ['时间盲注', "/s/abc' AND SLEEP(3)--"],
  ['UNION', "/s/abc' UNION SELECT NULL--"],
  ['单字符 id', '/s/a'],
  ['超长 id', `/s/${'a'.repeat(65)}`],
  ['多余尾段', '/s/abc/extra'],
  ['分类缺 id', '/s/c'],
  ['分类单引号', "/s/c/abc'"],
  ['分类多余尾段', '/s/c/abc/extra'],
  ['前缀非 s', '/x/abc'],
]

describe('share-ssr 畸形路径与「分享不存在」响应一致', () => {
  it('基线：合法格式 id 但分享不存在 → 404 未找到页（查库）', async () => {
    let snap!: Snapshot
    const calls = await rpcCallsDuring(async () => {
      snap = await get('/s/abc')
    })
    expect(snap.status).toBe(404)
    expect(snap.contentType).toMatch(/text\/html/)
    expect(snap.body.length).toBeGreaterThan(1000)
    expect(snap.shareCache).toBe('MISS')
    expect(snap.robots).toBe('noindex, nofollow')
    // 合法 id 必须真的去查库，基线才有意义
    expect(calls).toBeGreaterThan(0)
  })

  it.each(MALFORMED)('%s：%s → 与基线逐字节一致', async (_label, rawPath) => {
    const baseline = await get('/s/abc')
    const snap = await get(encodeURI(rawPath))
    expect(snap).toEqual(baseline)
  })

  it('畸形路径在查库前返回，不触达 RPC', async () => {
    const calls = await rpcCallsDuring(async () => {
      for (const [, rawPath] of MALFORMED) await get(encodeURI(rawPath))
    })
    expect(calls).toBe(0)
  })

  it('不再出现旧的 400 "bad request" 纯文本响应', async () => {
    for (const [, rawPath] of MALFORMED) {
      const snap = await get(encodeURI(rawPath))
      expect(snap.status).not.toBe(400)
      expect(snap.body).not.toBe('bad request')
    }
  })

  it('分类分享：合法格式但不存在与畸形 id 也一致', async () => {
    const baseline = await get('/s/c/abc')
    expect(baseline.status).toBe(404)
    expect(await get(encodeURI("/s/c/abc' OR '1'='1"))).toEqual(baseline)
  })

  it('?lang=en 下畸形路径同样返回英文未找到页，与英文基线一致', async () => {
    const baseline = await get('/s/abc?lang=en')
    expect(baseline.status).toBe(404)
    expect(await get(`${encodeURI("/s/abc'")}?lang=en`)).toEqual(baseline)
  })
})
