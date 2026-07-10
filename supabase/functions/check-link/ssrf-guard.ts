/**
 * ssrf-guard.ts — SSRF 校验纯逻辑（无 Deno / 无网络依赖，可被 vitest 单测）。
 *
 * 被 supabase/functions/check-link/index.ts 引用。本文件不得 import 任何 Deno
 * 或 fetch API，保证在 Node/vitest + jsdom 环境下可测。
 *
 * S7 三层防御中的「第一层（host 字面全量校验）」在此实现；DNS 层（best-effort
 * resolveDns）与重定向逐跳逻辑留在 index.ts，因前者依赖 Deno API、后者依赖 fetch。
 * 但 DNS 校验的核心——「A/AAAA 记录是否私有」——复用本文件的 _isPrivateHost，
 * 通过 isTargetDnsSafe(hostname, resolver) 注入 resolver 实现可测。
 */

/** 字面私有主机名 */
export const PRIVATE_LITERAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata',
])

/** IPv4 段判断：octet 数组 → 是否私有/保留/环回/链路本地 */
export function isPrivateIPv4(octets: number[]): boolean {
  if (octets.length !== 4 || octets.some(o => o < 0 || o > 255)) return false
  const [a, b] = octets
  if (a === 127) return true                  // 127.0.0.0/8  loopback
  if (a === 10) return true                   // 10.0.0.0/8    RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 168) return true      // 192.168.0.0/16 RFC1918
  if (a === 169 && b === 254) return true      // 169.254.0.0/16 link-local（云元数据）
  if (a === 0) return true                     // 0.0.0.0/8     本网络
  if (a === 100 && b >= 64 && b <= 127) return true  // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true        // 192.0.0.0/24  IETF 协议保留
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 基准测试
  if (a >= 224) return true                    // 224.0.0.0/4+  组播/保留（D/E 类）
  return false
}

/** IPv6 私有/保留段判断：接收 8 组 hextets（16-bit each）。
 *  掩码在 hextet 上做（16-bit），不是 byte。 */
export function isPrivateIPv6(hextets: number[]): boolean {
  if (hextets.length !== 8) return false
  const a = hextets[0]
  const b = hextets[1]
  // ::1 环回：前 7 段全 0、末段 1
  if (hextets.slice(0, 7).every(h => h === 0) && hextets[7] === 1) return true
  // :: 未指定地址
  if (hextets.every(h => h === 0)) return true
  // fc00::/7  ULA（私有）：高 7 位为 1111110 → 首段 & 0xfe00 === 0xfc00
  if ((a & 0xfe00) === 0xfc00) return true
  // fe80::/10 link-local：高 10 位为 1111111010 → 首段 & 0xffc0 === 0xfe80
  if ((a & 0xffc0) === 0xfe80) return true
  // 2001:db8::/32 文档
  if (a === 0x2001 && b === 0x0db8) return true
  // IPv4-mapped IPv6：::ffff:a.b.c.d → [0,0,0,0,0,0xffff, a<<8|b, c<<8|d]
  if (hextets.slice(0, 5).every(h => h === 0) && hextets[5] === 0xffff) {
    const ipv4 = [(hextets[6] >> 8) & 0xff, hextets[6] & 0xff, (hextets[7] >> 8) & 0xff, hextets[7] & 0xff]
    return isPrivateIPv4(ipv4)
  }
  // IPv4-compatible IPv6：::a.b.c.d（已废弃，仍收）
  if (hextets.slice(0, 5).every(h => h === 0) && hextets[5] === 0) {
    const ipv4 = [(hextets[6] >> 8) & 0xff, hextets[6] & 0xff, (hextets[7] >> 8) & 0xff, hextets[7] & 0xff]
    return isPrivateIPv4(ipv4)
  }
  return false
}

/** 把 hostname 解析成 IPv4 octets。支持点分十进制 / 十进制整数 / 16/8 进制整数主机名。
 *  返回 null 表示不是这两种形态（交由调用方走域名分支）。 */
export function parseIPv4Hostname(hostname: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (m) {
    const octets = m.slice(1).map(Number)
    if (octets.some(o => Number.isNaN(o) || o > 255)) return null
    return octets
  }
  const mm = /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.exec(hostname)
  if (mm) {
    const isHex = /^0x/i.test(hostname)
    const isOct = /^0[0-7]+$/i.test(hostname)
    const base = isHex ? 16 : isOct ? 8 : 10
    const n = parseInt(hostname, base)
    if (Number.isNaN(n) || n < 0 || n > 0xffffffff) return null
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  }
  return null
}

/** 解析 IPv6 hostname 为 8 hextets。hostname 可能是 Node 风格带方括号
 *  （URL.hostname 返回 "[fc00::1]"）或 Deno 风格剥方括号（"fc00::1"），本函数
 *  统一先剥方括号。支持末段为点分 IPv4 的混合形态（::ffff:127.0.0.1）。
 *  返回 null 表示非合法 IPv6。 */
export function parseIPv6Hostname(hostname: string): number[] | null {
  let h = hostname.toLowerCase()
  // 剥方括号（Node 的 URL.hostname 对 IPv6 保留方括号，Deno 通常剥除，统一处理）
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (!h.includes(':')) return null
  const parts = h.split('::')
  if (parts.length > 2) return null
  // 处理末段为点分 IPv4 的混合形态（如 ::ffff:127.0.0.1）→ 展开为两个 hextet
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

/** 全量 host 私有校验：点分十进制 / 十进制整数 / IPv6 / 字面主机名。
 *  hostname 可能是 Node 风格带方括号（URL.hostname IPv6）或 Deno 风格剥方括号，
 *  统一先剥方括号再判定。 */
export function isPrivateHost(hostname: string): boolean {
  let lower = hostname.toLowerCase()
  if (lower.startsWith('[') && lower.endsWith(']')) lower = lower.slice(1, -1)
  if (PRIVATE_LITERAL_HOSTS.has(lower)) return true
  const ipv4 = parseIPv4Hostname(lower)
  if (ipv4) return isPrivateIPv4(ipv4)
  const ipv6 = parseIPv6Hostname(lower)
  if (ipv6) return isPrivateIPv6(ipv6)
  return false
}

/** DNS resolver 接口：注入以解耦 Deno API，使本逻辑可测。
 *  返回 hostname 解析到的 A/AAAA 记录数组。 */
export interface DnsResolver {
  resolve(hostname: string, type: 'A' | 'AAAA'): Promise<string[]>
}

/** DNS 重绑定校验：解析 hostname 的 A/AAAA，任一记录落入私有段即返 false。
 *  resolver 解析抛错时返回 true（best-effort，不阻断主路径），与 Deno resolveDns
 *  降级行为一致。hostname 为 IP 字面量或非域名时直接 true（不查 DNS）。 */
export function isTargetDnsSafeSyncResults(hostname: string, records: string[]): boolean {
  for (const r of records) {
    if (isPrivateHost(r)) return false
  }
  return true
}

/** 仅允许的协议 / 端口 */
export const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
export const ALLOWED_PORTS = new Set(['', '80', '443'])

/** 校验 URL 字符串（不含 DNS 校验）。返回解析后的 URL；违规抛 Error。 */
export function validateUrlShape(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('URL 必须以 http:// 或 https:// 开头')
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new Error('URL 必须以 http:// 或 https:// 开头')
  if (parsed.username || parsed.password) throw new Error('URL 不得包含认证信息')
  if (!ALLOWED_PORTS.has(parsed.port)) throw new Error('仅允许 80/443 端口')
  if (isPrivateHost(parsed.hostname)) throw new Error('不允许访问内网地址')
  return parsed
}

/**
 * S9 CORS fail-closed 判定：origin 是否获准跨域。
 * 白名单为空 → 一律拒（缺省 fail-closed，不再 fail-open 回退 origin/'*'）。
 * 命中精确白名单才放行（不做子域通配，防 origin 伪造）。
 */
export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin || allowed.length === 0) return false
  return allowed.includes(origin)
}

/** 构造 CORS 响应头：命中白名单才带 Access-Control-Allow-Origin，否则空对象。
 *  始终带 Vary: Origin，避免 CDN 缓存跨 origin 串台。 */
export function buildCorsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = { 'Vary': 'Origin' }
  if (isOriginAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin!
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type'
  }
  return headers
}
