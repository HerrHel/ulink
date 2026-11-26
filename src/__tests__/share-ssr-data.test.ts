/**
 * share-ssr 组分享数据接口 /s/<gid>/data（2026-11-26，修「带密码的分享点保存笔记 → 分享不存在」）
 *
 * 锁住的契约（与分享页验密规则完全一致）：
 *   1. 无密码的公开组 → 200 JSON { group, bookmarks }，不缓存、不收录、无 CORS 头（仅同源可读）
 *   2. 有密码的组：无票据 / 伪造票据 / 改密码后的旧票据 → 401，响应里绝无内容
 *   3. 有密码的组 + 分享页下发的有效票据 cookie → 200 JSON
 *   4. 不存在 → 404；只允许 GET；分类分享没有 /data（与「分享不存在」一致的 404 页）
 *
 * 做法同 share-ssr-go.test.ts：子进程真实启动 index.js，假 SDK 用 FAKE_RPC 预置
 * get_share_secret / get_public_group_verified 的返回。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const ENTRY = resolve(ROOT, 'cloudbase/functions/share-ssr/index.js')
const FAKE_SDK = resolve(__dirname, 'helpers/share-ssr-fake-sdk.cjs')
const require = createRequire(import.meta.url)
const { makeTicket, ticketCookieName } = require(resolve(ROOT, 'cloudbase/functions/share-ssr/share-lock.js')) as {
  makeTicket: (gid: string, secret: string, nowMs?: number, ttlSec?: number, pwVersion?: string) => string
  ticketCookieName: (gid: string) => string
}

const SECRET = 'test-share-lock-secret'
const PW_HASH = 'pbkdf2$fake$hash'
/** 与 index.js ticketVersion 同算法：票据签名绑定当前密码摘要 */
const pwVersion = (hash: string) => createHash('sha256').update(hash, 'utf8').digest('hex').slice(0, 32)

const payload = (id: string) => ({
  group: { id, name: '加密笔记', notes: '<p>秘密</p>', bookmark_ids: ['b1'], is_public: true },
  bookmarks: [{ id: 'b1', title: 'VERT', url: 'https://vert.sh' }],
})
const FAKE_RPC = {
  get_share_secret: {
    gpub: { has_password: false, password_hash: null },
    glock: { has_password: true, password_hash: PW_HASH },
  },
  get_public_group_verified: { gpub: payload('gpub'), glock: payload('glock') },
}

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

function get(path: string, cookie?: string, method = 'GET') {
  return fetch(base + path, { method, redirect: 'manual', headers: cookie ? { cookie } : {} })
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
      SHARE_LOCK_SECRET: SECRET,
      FAKE_RPC: JSON.stringify(FAKE_RPC),
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

describe('share-ssr /s/<gid>/data', () => {
  it('无密码的公开组 → 200 JSON，不缓存、不收录、无 CORS', async () => {
    const res = await get('/s/gpub/data')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    const body = await res.json()
    expect(body.group.id).toBe('gpub')
    expect(body.bookmarks).toHaveLength(1)
  })

  it('有密码、没有票据 → 401，响应不含内容', async () => {
    const res = await get('/s/glock/data')
    expect(res.status).toBe(401)
    const text = await res.text()
    expect(text).not.toContain('秘密')
    expect(JSON.parse(text)).toEqual({ error: 'locked' })
  })

  it('伪造票据 / 改密码后的旧票据 → 401', async () => {
    const name = ticketCookieName('glock')
    const forged = makeTicket('glock', 'wrong-secret', undefined, undefined, pwVersion(PW_HASH))
    expect((await get('/s/glock/data', `${name}=${encodeURIComponent(forged)}`)).status).toBe(401)
    const stale = makeTicket('glock', SECRET, undefined, undefined, pwVersion('old-hash'))
    expect((await get('/s/glock/data', `${name}=${encodeURIComponent(stale)}`)).status).toBe(401)
    // 别的组的票据也不能用
    const other = makeTicket('gpub', SECRET, undefined, undefined, pwVersion(PW_HASH))
    expect((await get('/s/glock/data', `${name}=${encodeURIComponent(other)}`)).status).toBe(401)
  })

  it('有密码 + 分享页下发的有效票据 → 200 JSON', async () => {
    const ticket = makeTicket('glock', SECRET, undefined, undefined, pwVersion(PW_HASH))
    const res = await get('/s/glock/data', `${ticketCookieName('glock')}=${encodeURIComponent(ticket)}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.group.id).toBe('glock')
    expect(body.group.notes).toContain('秘密')
  })

  it('不存在 → 404；非 GET → 405；分类分享没有 /data', async () => {
    expect((await get('/s/gnone/data')).status).toBe(404)
    expect((await get('/s/gpub/data', undefined, 'POST')).status).toBe(405)
    const cat = await get('/s/c/sid1/data')
    expect(cat.status).toBe(404)
    expect(cat.headers.get('content-type')).toMatch(/text\/html/)
  })
})
