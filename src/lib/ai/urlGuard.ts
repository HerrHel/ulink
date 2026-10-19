/**
 * urlGuard.ts — AI 外部抓取与网络请求安全防线
 *
 * 职责：
 * 1. 检测是否属于内网/环回/私有/链路本地地址（防范 SSRF、内网拓扑探测）；
 * 2. 对外部第三方服务（如 Jina Reader）发出的 URL 进行私密参数过滤（防凭证泄漏）；
 * 3. 校验 AI 推荐候选 URL 是否安全合法（拒绝非 http(s)、内网私有地址等）。
 */

export const PRIVATE_LITERAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata',
])

const PRIVATE_DOMAIN_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.home.arpa',
  '.corp',
  '.localhost',
]

export function isPrivateIPv4(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some(o => o < 0 || o > 255)) return false
  const [a, b] = octets
  if (a === 127) return true // loopback
  if (a === 10) return true // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 169 && b === 254) return true // link-local
  if (a === 0) return true // this network
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true // benchmark
  if (a >= 224) return true // multicast / reserved (class D/E)
  return false
}

export function parseIPv4Hostname(hostname: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (m) {
    const octets = m.slice(1).map(Number)
    if (octets.some(o => Number.isNaN(o) || o > 255)) return null
    return octets
  }
  return null
}

export function isPrivateIPv6(hextets: number[]): boolean {
  if (hextets.length !== 8) return false
  const a = hextets[0]
  const b = hextets[1]
  // ::1 loopback
  if (hextets.slice(0, 7).every(h => h === 0) && hextets[7] === 1) return true
  // :: unspecified
  if (hextets.every(h => h === 0)) return true
  // fc00::/7 ULA
  if ((a & 0xfe00) === 0xfc00) return true
  // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfe80) return true
  // 2001:db8::/32 doc
  if (a === 0x2001 && b === 0x0db8) return true
  // IPv4-mapped / IPv4-compatible
  if (hextets.slice(0, 5).every(h => h === 0) && (hextets[5] === 0xffff || hextets[5] === 0)) {
    const ipv4 = [(hextets[6] >> 8) & 0xff, hextets[6] & 0xff, (hextets[7] >> 8) & 0xff, hextets[7] & 0xff]
    return isPrivateIPv4(ipv4)
  }
  return false
}

export function parseIPv6Hostname(hostname: string): number[] | null {
  let h = hostname.toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (!h.includes(':')) return null
  const parts = h.split('::')
  if (parts.length > 2) return null

  function expandLastDottedQuad(segs: string[]): string[] | null {
    if (segs.length === 0) return segs
    const last = segs[segs.length - 1]
    if (last.includes('.')) {
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(last)
      if (!m) return null
      const octets = m.slice(1).map(Number)
      if (octets.some(o => Number.isNaN(o) || o > 255)) return null
      const hi = (octets[0] << 8) | octets[1]
      const lo = (octets[2] << 8) | octets[3]
      return [...segs.slice(0, -1), hi.toString(16), lo.toString(16)]
    }
    return segs
  }

  if (parts.length === 2) {
    let left: string[] | null = parts[0] ? parts[0].split(':') : []
    let right: string[] | null = parts[1] ? parts[1].split(':') : []
    left = expandLastDottedQuad(left)
    right = expandLastDottedQuad(right)
    if (left === null || right === null) return null
    const fill = 8 - left.length - right.length
    if (fill < 1) return null
    h = [...left, ...Array(fill).fill('0'), ...right].join(':')
  } else {
    const segs = expandLastDottedQuad(parts[0].split(':'))
    if (segs === null) return null
    h = segs.join(':')
  }

  const segs = h.split(':')
  if (segs.length !== 8) return null
  const hextets = segs.map(s => {
    const v = parseInt(s, 16)
    return Number.isNaN(v) || v < 0 || v > 0xffff ? null : v
  })
  if (hextets.some(x => x === null)) return null
  return hextets as number[]
}

export function isPrivateHost(hostname: string): boolean {
  if (!hostname) return true
  let lower = hostname.toLowerCase().trim()
  if (lower.startsWith('[') && lower.endsWith(']')) lower = lower.slice(1, -1)
  if (PRIVATE_LITERAL_HOSTS.has(lower)) return true
  if (PRIVATE_DOMAIN_SUFFIXES.some(s => lower.endsWith(s))) return true

  const ipv4 = parseIPv4Hostname(lower)
  if (ipv4) return isPrivateIPv4(ipv4)
  const ipv6 = parseIPv6Hostname(lower)
  if (ipv6) return isPrivateIPv6(ipv6)

  return false
}

export function isPrivateUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true
    return isPrivateHost(u.hostname)
  } catch {
    return true
  }
}

const SENSITIVE_QUERY_KEY_RE = /^(?:access_?token|api_?key|auth_?token|token|secret|password|passwd|key|auth|session_?id|sig|signature)$/i

/**
 * 清除发往第三方服务（如 Jina Reader）的敏感凭据：
 * 1. 剥除 HTTP 基础认证 (user:pass@)；
 * 2. 剥除含有 token / key / secret / password 等私密查询参数，防止将受保护链接的鉴权凭证泄露进外部日志。
 */
export function sanitizeUrlForExternalService(urlStr: string): string {
  try {
    const u = new URL(urlStr)
    u.username = ''
    u.password = ''
    const keysToDelete: string[] = []
    for (const key of u.searchParams.keys()) {
      if (SENSITIVE_QUERY_KEY_RE.test(key)) {
        keysToDelete.push(key)
      }
    }
    for (const k of keysToDelete) {
      u.searchParams.delete(k)
    }
    return u.toString()
  } catch {
    return urlStr
  }
}
