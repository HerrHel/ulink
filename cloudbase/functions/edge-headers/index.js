/**
 * edge-headers — HTML 文档边缘代理（2026-10-31）
 *
 * 为什么需要：CloudBase 静态托管不支持自定义响应头，而 X-Content-Type-Options
 * 与 CSP frame-ancestors 没有 <meta> 等价物（后者 meta 不支持，前者无 meta 形式）。
 * 静态站点的入口 HTML（/app、/legal/*）改由本函数反代：向静态托管取原文件，
 * 原样透传 body，同时补上安全响应头。静态资源（/assets/* 等）仍直连静态托管，
 * 不经过本函数，避免给所有资源增加一跳。
 *
 * 部署：
 *   node scripts/deploy-cloudbase-fn.mjs edge-headers --path /app
 *   bash <tcb> routes edit -e <env> --data '{"domain":"*","routes":[{"path":"/app","enablePathTransmission":true}]}'
 *   bash <tcb> routes add  -e <env> --data '{"domain":"*","routes":[{"path":"/legal","upstreamResourceType":"WEB_SCF","upstreamResourceName":"edge-headers","enablePathTransmission":true}]}'
 *
 * 回滚：删除 /app、/legal 两条路由，静态托管的兜底路由会重新接管。
 */
const http = require('http')

const PORT = Number(process.env.PORT) || 9000
const STATIC_ORIGIN = (process.env.STATIC_ORIGIN || 'https://ulink-d1g5srvjo54b1886a-1436146693.tcloudbaseapp.com').replace(/\/+$/, '')

/** 与 vite securityMetaPlugin 的 CSP 保持一致，并补上 meta 不支持的 frame-ancestors */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https: wss://*.supabase.co",
  "font-src 'self' https://fonts.gstatic.com",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'self'",
].join('; ')

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000',
}

/** 只允许代理入口文档，避免变成开放代理 */
function isAllowed(pathname) {
  return pathname === '/app' || pathname === '/app/' || pathname === '/legal' || pathname.startsWith('/legal/')
}

function passHeaders(upstream, body) {
  const out = { ...SECURITY_HEADERS }
  const keep = ['content-type', 'cache-control', 'etag', 'last-modified', 'vary']
  for (const key of keep) {
    const v = upstream.headers.get(key)
    if (v) out[key] = v
  }
  if (!out['content-type']) out['content-type'] = 'text/html; charset=utf-8'
  out['content-length'] = String(body.length)
  // 由 Node 重新计算长度；避免上游压缩头与实际 body 不一致
  return out
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' })
      res.end()
      return
    }
    const url = new URL(req.url || '/', 'http://edge.local')
    if (!isAllowed(url.pathname)) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      res.end('not found')
      return
    }

    const upstreamUrl = STATIC_ORIGIN + url.pathname + url.search
    let upstream
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { accept: req.headers.accept || 'text/html,application/xhtml+xml' },
      })
    } catch (e) {
      // 上游不可用时优先保可用性：302 到静态托管原文（代价是缺安全头）
      console.error('[edge-headers] upstream failed:', e && e.message)
      res.writeHead(302, { Location: upstreamUrl })
      res.end()
      return
    }

    const buf = Buffer.from(await upstream.arrayBuffer())
    const headers = passHeaders(upstream, buf)
    res.writeHead(upstream.status, headers)
    if (req.method === 'HEAD') res.end()
    else res.end(buf)
  } catch (e) {
    console.error('[edge-headers] unhandled:', e)
    if (!res.headersSent) {
      res.writeHead(502, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' })
      res.end('bad gateway')
    }
  }
})

server.listen(PORT, () => {
  console.log('[edge-headers] listening on :' + PORT + ' → ' + STATIC_ORIGIN)
})
