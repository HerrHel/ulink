import { describe, it, expect } from 'vitest'
/**
 * S7 SSRF 防护单测：覆盖计划要求的三类攻击载荷。
 * 测试目标为无 Deno 依殊的纯逻辑 ssrf-guard.ts。
 * 不依赖真实 fetch/网络；重定向逐跳逻辑的拦截能力通过 validateUrlShape 间接验证
 * （每跳都会重新调用它对 Location 做校验，故 validateUrlShape 能拦的载荷在
 * 任意跳数下都被拦）。
 */
import {
  isPrivateHost,
  parseIPv4Hostname,
  parseIPv6Hostname,
  isPrivateIPv4,
  isPrivateIPv6,
  validateUrlShape,
  isTargetDnsSafeSyncResults,
  isOriginAllowed,
  buildCorsHeaders,
} from '../../supabase/functions/check-link/ssrf-guard.js'

describe('S7 SSRF guard — IPv4 解析', () => {
  it('点分十进制正常解析', () => {
    expect(parseIPv4Hostname('127.0.0.1')).toEqual([127, 0, 0, 1])
    expect(parseIPv4Hostname('192.168.1.1')).toEqual([192, 168, 1, 1])
    expect(parseIPv4Hostname('8.8.8.8')).toEqual([8, 8, 8, 8])
  })

  it('十进制整数 IP 解析（2130706433 ≡ 127.0.0.1）', () => {
    // 关键载荷：纯数字主机名按 32-bit 整数解析
    expect(parseIPv4Hostname('2130706433')).toEqual([127, 0, 0, 1])
    expect(parseIPv4Hostname('3232235521')).toEqual([192, 168, 0, 1])
  })

  it('16/8 进制整数主机名也解析', () => {
    expect(parseIPv4Hostname('0x7f000001')).toEqual([127, 0, 0, 1])
    expect(parseIPv4Hostname('017700000001')).toEqual([127, 0, 0, 1])
  })

  it('非法 octet 返回 null', () => {
    expect(parseIPv4Hostname('999.1.1.1')).toBeNull()
    expect(parseIPv4Hostname('not-an-ip')).toBeNull()
    expect(parseIPv4Hostname('127.0.0.1.5')).toBeNull()
  })
})

describe('S7 SSRF guard — IPv6 解析', () => {
  it('展开压缩形态 ::', () => {
    expect(parseIPv6Hostname('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIPv6Hostname('fe80::1')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1])
    expect(parseIPv6Hostname('fc00::1')).toEqual([0xfc00, 0, 0, 0, 0, 0, 0, 1])
  })

  it('IPv4-mapped 形态解析', () => {
    // ::ffff:127.0.0.1 → [0,0,0,0,0,0xffff,0x7f00,0x0001]
    const r = parseIPv6Hostname('::ffff:127.0.0.1')
    expect(r).not.toBeNull()
    expect(r).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001])
  })

  it('非 IPv6 返回 null', () => {
    expect(parseIPv6Hostname('example.com')).toBeNull()
    expect(parseIPv6Hostname('127.0.0.1')).toBeNull()
  })
})

describe('S7 SSRF guard — 私有段判定', () => {
  it('IPv4 各私有/保留段全部命中', () => {
    expect(isPrivateIPv4([127, 0, 0, 1])).toBe(true)         // loopback
    expect(isPrivateIPv4([10, 0, 0, 1])).toBe(true)          // RFC1918
    expect(isPrivateIPv4([172, 16, 0, 1])).toBe(true)        // RFC1918
    expect(isPrivateIPv4([172, 31, 255, 255])).toBe(true)    // RFC1918 边界
    expect(isPrivateIPv4([192, 168, 0, 1])).toBe(true)       // RFC1918
    expect(isPrivateIPv4([169, 254, 169, 254])).toBe(true)  // link-local 云元数据
    expect(isPrivateIPv4([0, 0, 0, 0])).toBe(true)          // 本网络
    expect(isPrivateIPv4([100, 64, 0, 1])).toBe(true)        // CGNAT
    expect(isPrivateIPv4([224, 0, 0, 1])).toBe(true)        // 组播
  })

  it('IPv4 公网段不命中', () => {
    expect(isPrivateIPv4([8, 8, 8, 8])).toBe(false)
    expect(isPrivateIPv4([1, 1, 1, 1])).toBe(false)
    expect(isPrivateIPv4([172, 32, 0, 1])).toBe(false)      // 172.32 不在 /12
  })

  it('IPv6 各私有/保留段命中', () => {
    expect(isPrivateIPv6([0, 0, 0, 0, 0, 0, 0, 1])).toBe(true)  // ::1 环回
    expect(isPrivateIPv6([0xfe80, 0, 0, 0, 0, 0, 0, 1])).toBe(true)  // fe80:: link-local
    expect(isPrivateIPv6([0xfc00, 0, 0, 0, 0, 0, 0, 1])).toBe(true)  // fc00:: ULA
    expect(isPrivateIPv6([0xfd00, 0, 0, 0, 0, 0, 0, 1])).toBe(true)  // fd00:: ULA
    expect(isPrivateIPv6([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1])).toBe(true) // 2001:db8 文档
    // ::ffff:127.0.0.1（IPv4-mapped 环回）
    expect(isPrivateIPv6([0, 0, 0, 0, 0, 0xffff, 0x7f00, 0x0001])).toBe(true)
  })

  it('IPv6 公网段不命中', () => {
    expect(isPrivateIPv6([0x2606, 0x4700, 0x4700, 0x1111, 0x2222, 0x3333, 0x4444, 0x5555])).toBe(false)
    expect(isPrivateIPv6([0x2001, 0x4860, 0x4860, 0, 0, 0, 0, 0x8888])).toBe(false)
  })
})

describe('S7 SSRF guard — isPrivateHost 全量入口', () => {
  // 计划要求的三类攻击载荷，逐条断言被拦
  const blocked = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',      // 云元数据端点
    'metadata.google.internal',
    'metadata',
    '2130706433',          // 十进制整数 ≡ 127.0.0.1
    '3232235521',          // 十进制整数 ≡ 192.168.0.1
    'fc00::1',             // IPv6 ULA
    'fe80::1',             // IPv6 link-local
    '::ffff:127.0.0.1',    // IPv4-mapped 环回
  ]
  for (const host of blocked) {
    it(`拦住 ${host}`, () => {
      expect(isPrivateHost(host)).toBe(true)
    })
  }

  const allowed = [
    'example.com',
    'github.com',
    '8.8.8.8',
    '1.1.1.1',
    'weibo.com',
  ]
  for (const host of allowed) {
    it(`放行 ${host}`, () => {
      expect(isPrivateHost(host)).toBe(false)
    })
  }
})

describe('S7 SSRF guard — validateUrlShape URL 形状校验', () => {
  it('合法 http/https URL 通过', () => {
    expect(() => validateUrlShape('https://github.com')).not.toThrow()
    expect(() => validateUrlShape('http://example.com:80')).not.toThrow()
    expect(() => validateUrlShape('https://api.xinac.net/icon/x.ico')).not.toThrow()
  })

  it('非 http(s) 协议被拒', () => {
    expect(() => validateUrlShape('file:///etc/passwd')).toThrow()
    expect(() => validateUrlShape('ftp://example.com')).toThrow()
    expect(() => validateUrlShape('gopher://localhost')).toThrow()
  })

  it('带认证信息的 URL 被拒', () => {
    expect(() => validateUrlShape('http://user:pass@example.com')).toThrow()
    expect(() => validateUrlShape('https://admin@internal.svc')).toThrow()
  })

  it('非标准端口被拒', () => {
    expect(() => validateUrlShape('http://example.com:8080')).toThrow()
    expect(() => validateUrlShape('http://example.com:22')).toThrow()
  })

  it('内网主机被拒（各类载荷）', () => {
    // 计划三类载荷经 URL 校验入口验证
    expect(() => validateUrlShape('http://2130706433/')).toThrow()         // 十进制 IP
    expect(() => validateUrlShape('http://[::ffff:127.0.0.1]/')).toThrow() // IPv6 mapped
    expect(() => validateUrlShape('http://169.254.169.254/')).toThrow()    // 元数据
    expect(() => validateUrlShape('http://[fc00::1]/')).toThrow()          // IPv6 ULA
    expect(() => validateUrlShape('http://localhost/')).toThrow()
    expect(() => validateUrlShape('http://192.168.1.1/')).toThrow()
  })
})

describe('S7 SSRF guard — DNS 重绑定检测', () => {
  it('A 记录命中内网即拒', () => {
    // 域名字面合法，但 A 记录落在 169.254.169.254 → DNS 重绑定 → 拒
    expect(isTargetDnsSafeSyncResults('evil.rebind.attacker.com', ['169.254.169.254'])).toBe(false)
    expect(isTargetDnsSafeSyncResults('evil.com', ['127.0.0.1'])).toBe(false)
  })

  it('A 记录均为公网则放行', () => {
    expect(isTargetDnsSafeSyncResults('example.com', ['93.184.216.34'])).toBe(true)
    expect(isTargetDnsSafeSyncResults('dual.cdn.net', ['1.1.1.1', '8.8.8.8'])).toBe(true)
  })

  it('任一记录命中即拒（混合 A 记录攻击）', () => {
    expect(isTargetDnsSafeSyncResults('mix.attacker.com', ['1.1.1.1', '10.0.0.1'])).toBe(false)
  })

  it('IPv6 AAAA 命中内网即拒', () => {
    expect(isTargetDnsSafeSyncResults('v6.attacker.com', ['::1'])).toBe(false)
    expect(isTargetDnsSafeSyncResults('v6.attacker.com', ['fc00::1'])).toBe(false)
  })

  it('H6: 空解析结果 fail-closed 拒', () => {
    expect(isTargetDnsSafeSyncResults('nxdomain.example', [])).toBe(false)
  })
})

describe('S9 CORS fail-closed — isOriginAllowed', () => {
  it('白名单为空时一律拒（fail-closed，不再回退 origin/*）', () => {
    expect(isOriginAllowed('https://app.linkvault.com', [])).toBe(false)
    expect(isOriginAllowed(null, [])).toBe(false)
    // 关键防回归：原 fail-open 在白名单为空且 origin 非空时会反射 origin
    expect(isOriginAllowed('https://evil.com', [])).toBe(false)
  })

  it('origin 为 null/空一律拒', () => {
    expect(isOriginAllowed(null, ['https://app.linkvault.com'])).toBe(false)
    expect(isOriginAllowed('', ['https://app.linkvault.com'])).toBe(false)
  })

  it('origin 精确命中白名单才放行', () => {
    const allowed = ['https://app.linkvault.com', 'https://linkvault.pages.dev']
    expect(isOriginAllowed('https://app.linkvault.com', allowed)).toBe(true)
    expect(isOriginAllowed('https://linkvault.pages.dev', allowed)).toBe(true)
  })

  it('未命中白名单的 origin 被拒（不做子域通配）', () => {
    const allowed = ['https://app.linkvault.com']
    expect(isOriginAllowed('https://evil.com', allowed)).toBe(false)
    expect(isOriginAllowed('http://app.linkvault.com', allowed)).toBe(false)  // 协议不同
    expect(isOriginAllowed('https://attacker.app.linkvault.com', allowed)).toBe(false)  // 子域不同
    expect(isOriginAllowed('https://app.linkvault.com.evil.com', allowed)).toBe(false)  // origin 伪造
  })
})

describe('S9 CORS fail-closed — buildCorsHeaders', () => {
  it('命中白名单带 ACAO + Allow-Headers + Vary', () => {
    const h = buildCorsHeaders('https://app.linkvault.com', ['https://app.linkvault.com'])
    expect(h['Access-Control-Allow-Origin']).toBe('https://app.linkvault.com')
    expect(h['Access-Control-Allow-Headers']).toContain('authorization')
    expect(h['Vary']).toBe('Origin')
  })

  it('未命中（或白名单空）不带 ACAO，仅留 Vary（浏览器据此阻断跨域）', () => {
    const h1 = buildCorsHeaders('https://evil.com', ['https://app.linkvault.com'])
    expect(h1['Access-Control-Allow-Origin']).toBeUndefined()
    expect(h1['Vary']).toBe('Origin')

    const h2 = buildCorsHeaders('https://evil.com', [])  // 白名单空：原 fail-open 会放通
    expect(h2['Access-Control-Allow-Origin']).toBeUndefined()

    const h3 = buildCorsHeaders(null, ['https://app.linkvault.com'])
    expect(h3['Access-Control-Allow-Origin']).toBeUndefined()
  })
})
