/**
 * fetchPinned（check-link）护栏：连接必须固定到 DNS 预检 IP，且保留原始 Host。
 *
 * 用本地 HTTP server 精确复现：URL 的 hostname 是**无法解析的** `pinned.example.test`，
 * 只有把连接 pin 到 127.0.0.1 才能请求成功 —— 若实现退化回「按域名二次解析」，
 * 测试会直接失败（这正是 DNS rebinding 要防的 TOCTOU）。
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'

const require = createRequire(import.meta.url)
const { fetchPinned } = require('../../../cloudbase/functions/check-link/pinned-fetch.js')

function withServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  return new Promise<{ port: number; seen: { host?: string; url?: string }; close: () => Promise<void> }>((resolve) => {
    const seen: { host?: string; url?: string } = {}
    const server = http.createServer((req, res) => {
      seen.host = req.headers.host
      seen.url = req.url
      handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        seen,
        close: () => new Promise<void>((r) => server.close(() => r())),
      })
    })
  })
}

function makeUrl(port: number, records: string[], path = '/p?q=1') {
  const url = new URL(`http://pinned.example.test:${port}${path}`)
  ;(url as unknown as { __pinnedRecords: string[] }).__pinnedRecords = records
  return url
}

describe('fetchPinned', () => {
  it('连接固定到预检 IP，且 Host 仍是原始域名（不是 IP）', async () => {
    const srv = await withServer((_req, res) => { res.writeHead(200); res.end('ok') })
    try {
      const res = await fetchPinned(makeUrl(srv.port, ['127.0.0.1']), { method: 'HEAD', timeoutMs: 3000 })
      expect(res.status).toBe(200)
      expect(srv.seen.host).toBe(`pinned.example.test:${srv.port}`)
      expect(srv.seen.url).toBe('/p?q=1')
    } finally { await srv.close() }
  })

  it('重定向 Location 可被读出（redirect 不自动跟随）', async () => {
    const srv = await withServer((_req, res) => {
      res.writeHead(302, { Location: 'https://example.com/next' }); res.end()
    })
    try {
      const res = await fetchPinned(makeUrl(srv.port, ['127.0.0.1']), { timeoutMs: 3000 })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://example.com/next')
      expect(res.headers.get('Location')).toBe('https://example.com/next')
      expect(res.headers.get('x-not-there')).toBeNull()
    } finally { await srv.close() }
  })

  it('没有预检 IP 时 fail-closed 拒绝发起请求', async () => {
    await expect(fetchPinned(makeUrl(1, []), { timeoutMs: 1000 })).rejects.toThrow(/pinned DNS address/)
  })

  it('预检里混入 IPv6 时优先选 IPv4', async () => {
    const srv = await withServer((_req, res) => { res.writeHead(204); res.end() })
    try {
      const res = await fetchPinned(makeUrl(srv.port, ['::1', '127.0.0.1']), { timeoutMs: 3000 })
      expect(res.status).toBe(204)
    } finally { await srv.close() }
  })
})
