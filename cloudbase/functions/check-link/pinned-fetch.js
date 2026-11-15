/**
 * pinned-fetch.js — 用「DNS 预检得到的 IP」发起连接，杜绝 DNS rebinding TOCTOU。
 *
 * 问题：原实现先 `_dnsCheck()` 解析并判定全部为公网，再调用全局 `fetch(url)`。
 * fetch 会以域名**重新解析一次**；攻击者自持 TTL=0 的域名，第一次回公网 IP 通过
 * 校验，第二次回 127.0.0.1 / 169.254.169.254，即可打到云函数所在内网或元数据端点。
 * 逐跳重定向重校验也挡不住「同一跳内」的二次解析。
 *
 * 做法：用 Node 内置 http/https 模块，通过 `lookup` 把该次连接固定到预检 IP；
 * 同时保留 Host 头与 TLS SNI/证书校验用的原始域名（不能把 hostname 换成 IP，
 * 否则证书必然校验失败）。只返回 check-link 真正需要的 status + headers.get()。
 */
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')

/**
 * @param {URL} urlObj 已通过形状 + DNS 安全校验的 URL；`__pinnedRecords` 为预检 IP 字符串数组
 * @param {{ method?: string, headers?: Record<string,string>, timeoutMs?: number }} options
 * @returns {Promise<{ status: number, headers: { get: (name: string) => string | null } }>}
 */
function fetchPinned(urlObj, options = {}) {
  const { method = 'GET', headers = {}, timeoutMs = 8000 } = options
  const records = Array.isArray(urlObj.__pinnedRecords) ? urlObj.__pinnedRecords : []
  // 预检时已确认**全部**记录都是公网地址；优先 IPv4，取不到再用 IPv6
  const address = records.find((r) => net.isIP(r) === 4) || records.find((r) => net.isIP(r) === 6)
  if (!address) return Promise.reject(new Error('pinned DNS address missing'))

  const family = net.isIP(address)
  const isHttps = urlObj.protocol === 'https:'
  const mod = isHttps ? https : http

  return new Promise((resolve, reject) => {
    let settled = false
    const done = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const req = mod.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname, // 证书校验 / SNI 用原域名，绝不能用 IP
        servername: urlObj.hostname,
        port: Number(urlObj.port) || (isHttps ? 443 : 80),
        path: (urlObj.pathname || '/') + (urlObj.search || ''),
        method,
        headers: { ...headers, Host: urlObj.host },
        // 关键：不再解析域名，直接连预检通过的那个 IP
        lookup: (_hostname, opts, cb) => {
          if (opts && opts.all) cb(null, [{ address, family }])
          else cb(null, address, family)
        },
        timeout: timeoutMs,
      },
      (res) => {
        // check-link 只需要状态码与 Location；body 立即丢弃，避免连接悬挂
        res.resume()
        const headersObj = {
          get: (name) => {
            const v = res.headers[String(name).toLowerCase()]
            if (Array.isArray(v)) return v[0] ?? null
            return v == null ? null : String(v)
          },
        }
        done(resolve, { status: res.statusCode || 0, headers: headersObj })
      },
    )
    req.on('timeout', () => req.destroy(new Error('upstream timeout')))
    req.on('error', (e) => done(reject, e))
    req.end()
  })
}

module.exports = { fetchPinned }
