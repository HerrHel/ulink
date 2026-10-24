/**
 * 分享访问密码单测（share-lock）
 *
 * 目标：supabase/functions/_shared/share-lock.ts
 *
 * 覆盖点（每一项都对应一个真实攻击面）：
 * - 摘要不可逆、salt 随机、错误密码不通过、台账格式异常一律 fail-closed
 * - scrypt 参数被恶意放大时拒绝（CPU 打满型 DoS）
 * - 票据：换 gid 不能用、过期不能用、改 exp 不能用、密钥空不能签
 * - cookie：HttpOnly / Secure / SameSite 必须齐全
 */
import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  validatePasswordInput,
  makeTicket,
  checkTicket,
  ticketCookieName,
  parseCookies,
  buildTicketCookie,
  clearTicketCookie,
  TICKET_TTL_SEC,
} from '../../supabase/functions/_shared/share-lock'

const SECRET = 'test-secret-please-change'

describe('validatePasswordInput', () => {
  it('长度在 [4,128] 内通过', () => {
    expect(validatePasswordInput('abcd').ok).toBe(true)
    expect(validatePasswordInput('a'.repeat(128)).ok).toBe(true)
  })
  it('过短 / 过长 / 非字符串被拒', () => {
    expect(validatePasswordInput('abc')).toEqual({ ok: false, reason: 'too_short' })
    expect(validatePasswordInput('a'.repeat(129))).toEqual({ ok: false, reason: 'too_long' })
    expect(validatePasswordInput(1234)).toEqual({ ok: false, reason: 'not_string' })
    expect(validatePasswordInput(null)).toEqual({ ok: false, reason: 'not_string' })
  })
})

describe('hashPassword / verifyPassword', () => {
  it('正确密码通过，错误密码不通过', () => {
    const stored = hashPassword('correct horse')
    expect(verifyPassword('correct horse', stored)).toBe(true)
    expect(verifyPassword('wrong horse', stored)).toBe(false)
    expect(verifyPassword('', stored)).toBe(false)
  })

  it('摘要格式固定且不可逆（不含明文）', () => {
    const stored = hashPassword('secret123')
    const parts = stored.split('$')
    expect(parts).toHaveLength(6)
    expect(parts[0]).toBe('scrypt')
    expect(stored).not.toContain('secret123')
  })

  it('同一密码两次摘要不同（salt 随机）', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })

  it('NFKC 归一化：全角与半角视为同一密码', () => {
    const stored = hashPassword('ａｂｃｄ')
    expect(verifyPassword('abcd', stored)).toBe(true)
  })

  it('空 / 畸形摘要一律 false（fail-closed）', () => {
    expect(verifyPassword('x', null)).toBe(false)
    expect(verifyPassword('x', '')).toBe(false)
    expect(verifyPassword('x', 'plaintext')).toBe(false)
    expect(verifyPassword('x', 'scrypt$16384$8$1$only')).toBe(false)
    expect(verifyPassword('x', 'bcrypt$16384$8$1$AAAA$BBBB')).toBe(false)
  })

  it('拒绝被放大的 scrypt 参数（防 CPU 打满 DoS）', () => {
    const huge = `scrypt$${1 << 21}$8$1$AAAA${'A'.repeat(20)}$BBBB${'B'.repeat(40)}`
    expect(verifyPassword('x', huge)).toBe(false)
  })
})

describe('票据签名 / 校验', () => {
  it('正确 gid + 未过期 → 通过', () => {
    const t = makeTicket('g-abc', SECRET)
    expect(checkTicket(t, 'g-abc', SECRET)).toBe(true)
  })

  it('换一个 gid 不能用（票据绑定分享）', () => {
    const t = makeTicket('g-abc', SECRET)
    expect(checkTicket(t, 'g-other', SECRET)).toBe(false)
  })

  it('换一个密钥不能用', () => {
    const t = makeTicket('g-abc', SECRET)
    expect(checkTicket(t, 'g-abc', 'another-secret')).toBe(false)
  })

  it('过期票据被拒（超出 30s 容差）', () => {
    const now = 1_700_000_000_000
    const t = makeTicket('g-abc', SECRET, now, 60)
    // 过期 60s：已超出 30s 时钟容差
    expect(checkTicket(t, 'g-abc', SECRET, now + 120_000)).toBe(false)
  })

  it('过期判定留 30s 时钟容差', () => {
    const now = 1_700_000_000_000
    const t = makeTicket('g-abc', SECRET, now, 60)
    expect(checkTicket(t, 'g-abc', SECRET, now + 60_000 + 20_000)).toBe(true)
  })

  it('篡改过期时间（延长）签名失配', () => {
    const now = 1_700_000_000_000
    const t = makeTicket('g-abc', SECRET, now, 60)
    const [v, exp, sig] = t.split('.')
    const forged = `${v}.${Number(exp) + 999999}.${sig}`
    expect(checkTicket(forged, 'g-abc', SECRET, now + 61_000)).toBe(false)
  })

  it('空票据 / 畸形票据 / 空密钥 → false', () => {
    expect(checkTicket(null, 'g', SECRET)).toBe(false)
    expect(checkTicket('', 'g', SECRET)).toBe(false)
    expect(checkTicket('v1.123', 'g', SECRET)).toBe(false)
    expect(checkTicket('v2.1.abc', 'g', SECRET)).toBe(false)
    expect(checkTicket(makeTicket('g', SECRET), 'g', '')).toBe(false)
  })

  it('无密钥时签发直接抛错（绝不静默降级）', () => {
    expect(() => makeTicket('g', '')).toThrow()
  })

  it('默认有效期为 24 小时', () => {
    expect(TICKET_TTL_SEC).toBe(24 * 60 * 60)
  })
})

describe('cookie 工具', () => {
  it('cookie 名由 gid 派生、稳定且互不冲突', () => {
    expect(ticketCookieName('g-abc')).toBe(ticketCookieName('g-abc'))
    expect(ticketCookieName('g-abc')).not.toBe(ticketCookieName('g-xyz'))
    expect(ticketCookieName('g-abc')).toMatch(/^ulp_[0-9a-f]{12}$/)
  })

  it('parseCookies 解析多值并忽略空段', () => {
    expect(parseCookies('a=1; b=2;; c=hello%20world')).toEqual({
      a: '1',
      b: '2',
      c: 'hello world',
    })
    expect(parseCookies(undefined)).toEqual({})
  })

  it('Set-Cookie 具备 HttpOnly / Secure / SameSite', () => {
    const c = buildTicketCookie('g-abc', 'v1.123.sig')
    expect(c).toContain('HttpOnly')
    expect(c).toContain('Secure')
    expect(c).toContain('SameSite=Lax')
    expect(c).toContain('Path=/')
    expect(c).toContain('Max-Age=' + TICKET_TTL_SEC)
  })

  it('清除用 Max-Age=0', () => {
    expect(clearTicketCookie('g-abc')).toContain('Max-Age=0')
  })
})
