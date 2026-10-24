/**
 * CloudBase 令牌校验单测（cb-auth）
 *
 * 目标：supabase/functions/_shared/cb-auth.ts（零第三方依赖，可直测）
 *
 * 用本地生成的 RSA 密钥对扮演 CloudBase 网关的签名私钥，覆盖真实会遇到的
 * 全部失败形态：签名篡改、过期、算法混淆（alg=none / HS256）、kid 轮换、
 * 非 JWT 令牌（走 userinfo 兜底）。不依赖网络。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto'
import {
  extractBearer,
  parseJwt,
  verifyJwtWithJwks,
  verifyCbToken,
  resolveViaUserinfo,
  jwksUrl,
  userinfoUrl,
  clearJwksCache,
  type CbJwk,
} from '../../supabase/functions/_shared/cb-auth'

const KID = 'test-kid-1'
let privateKey: KeyObject
let jwks: CbJwk[]

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** 用本地私钥签发一枚 RS256 JWT（模拟 CloudBase 网关） */
function mint(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' },
  key: KeyObject = privateKey,
): string {
  const input = `${b64url(header)}.${b64url(payload)}`
  const sig = cryptoSign('RSA-SHA256', Buffer.from(input), key).toString('base64url')
  return `${input}.${sig}`
}

const future = () => Math.floor(Date.now() / 1000) + 3600

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
  privateKey = pair.privateKey as KeyObject
  const jwk = pair.publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string }
  jwks = [{ kid: KID, kty: 'RSA', n: jwk.n, e: jwk.e }]
})

describe('extractBearer', () => {
  it('标准 Bearer 头取令牌', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('scheme 大小写不敏感、容忍多余空格', () => {
    expect(extractBearer('bearer  tok  ')).toBe('tok')
    expect(extractBearer('BEARER tok')).toBe('tok')
  })

  it('非 Bearer / 空 / 裸 token 一律拒绝', () => {
    expect(extractBearer('Basic dXNlcjpwYXNz')).toBeNull()
    expect(extractBearer('')).toBeNull()
    expect(extractBearer(null)).toBeNull()
    expect(extractBearer(undefined)).toBeNull()
    expect(extractBearer('abc.def.ghi')).toBeNull()
  })
})

describe('parseJwt', () => {
  it('解析出 header / payload / 签名原文', () => {
    const token = mint({ sub: 'u1', exp: future() })
    const parsed = parseJwt(token)
    expect(parsed).not.toBeNull()
    expect(parsed!.header.alg).toBe('RS256')
    expect(parsed!.payload.sub).toBe('u1')
    expect(parsed!.signingInput).toBe(token.split('.').slice(0, 2).join('.'))
  })

  it('段数不对 / base64 非法 / 载荷非对象 → null（不抛错）', () => {
    expect(parseJwt('a.b')).toBeNull()
    expect(parseJwt('a.b.c.d')).toBeNull()
    expect(parseJwt('!!!.!!!.!!!')).toBeNull()
    expect(parseJwt(`${b64url([1, 2])}.${b64url({ sub: 'u' })}.sig`)).toBeNull()
    expect(parseJwt(`${b64url({ alg: 'RS256' })}.${b64url('str')}.sig`)).toBeNull()
  })
})

describe('verifyJwtWithJwks — 正常路径', () => {
  it('签名正确且未过期 → ok，uid 取 sub', () => {
    const token = mint({ sub: 'user-123', exp: future() })
    const r = verifyJwtWithJwks(token, jwks)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.uid).toBe('user-123')
      expect(r.mode).toBe('offline')
      expect(r.claims.sub).toBe('user-123')
    }
  })

  it('无 kid 且公钥集只有一把时可采用唯一公钥', () => {
    const token = mint({ sub: 'user-1', exp: future() }, { alg: 'RS256' })
    const r = verifyJwtWithJwks(token, jwks)
    expect(r.ok).toBe(true)
  })

  it('无 kid 但公钥集有多把 → 拒绝（不猜）', () => {
    const token = mint({ sub: 'user-1', exp: future() }, { alg: 'RS256' })
    const r = verifyJwtWithJwks(token, [jwks[0], { ...jwks[0], kid: 'other' }])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_kid')
  })

  it('无 exp 的令牌不因过期被拒（由调用方决定是否强制）', () => {
    const r = verifyJwtWithJwks(mint({ sub: 'u' }), jwks)
    expect(r.ok).toBe(true)
  })
})

describe('verifyJwtWithJwks — 攻击面', () => {
  it('篡改 payload 后签名失配', () => {
    const token = mint({ sub: 'user-123', exp: future() })
    const [h, , s] = token.split('.')
    const forged = `${h}.${b64url({ sub: 'attacker', exp: future() })}.${s}`
    const r = verifyJwtWithJwks(forged, jwks)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_signature')
  })

  it('alg=none 被算法白名单挡住', () => {
    const input = `${b64url({ alg: 'none', kid: KID })}.${b64url({ sub: 'u', exp: future() })}`
    const r = verifyJwtWithJwks(`${input}.`, jwks)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_alg')
  })

  it('HS256 混淆攻击（把公钥当 HMAC 密钥）被挡', () => {
    const token = mint({ sub: 'u', exp: future() }, { alg: 'HS256', kid: KID })
    const r = verifyJwtWithJwks(token, jwks)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_alg')
  })

  it('kid 不存在 → unknown_kid', () => {
    const token = mint({ sub: 'u', exp: future() }, { alg: 'RS256', kid: 'ghost' })
    const r = verifyJwtWithJwks(token, jwks)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unknown_kid')
  })

  it('私钥不匹配（换了签发方）→ bad_signature', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const token = mint({ sub: 'u', exp: future() }, undefined, other.privateKey as KeyObject)
    const r = verifyJwtWithJwks(token, jwks)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad_signature')
  })

  it('缺 sub → no_sub（不能把空 uid 当已登录）', () => {
    const r = verifyJwtWithJwks(mint({ exp: future() }), jwks)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_sub')
  })

  it('sub 为空白串同样视为无效', () => {
    const r = verifyJwtWithJwks(mint({ sub: '   ', exp: future() }), jwks)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_sub')
  })
})

describe('verifyJwtWithJwks — 时间边界', () => {
  const now = 1_700_000_000_000

  it('exp 已过（超出容差）→ expired', () => {
    const token = mint({ sub: 'u', exp: Math.floor(now / 1000) - 120 })
    const r = verifyJwtWithJwks(token, jwks, { now, clockToleranceSec: 60 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('expired')
  })

  it('刚过期但在容差内 → 通过（容忍时钟偏差）', () => {
    const token = mint({ sub: 'u', exp: Math.floor(now / 1000) - 30 })
    const r = verifyJwtWithJwks(token, jwks, { now, clockToleranceSec: 60 })
    expect(r.ok).toBe(true)
  })

  it('nbf 在未来（超出容差）→ rejected', () => {
    const token = mint({ sub: 'u', exp: Math.floor(now / 1000) + 3600, nbf: Math.floor(now / 1000) + 600 })
    const r = verifyJwtWithJwks(token, jwks, { now, clockToleranceSec: 60 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('rejected')
  })
})

describe('verifyCbToken — 双模式编排', () => {
  it('无 Authorization → missing', async () => {
    const r = await verifyCbToken(null, { envId: 'env-test' })
    expect(r).toEqual({ ok: false, reason: 'missing' })
  })

  it('有效 JWT 走离线验签，不触碰 userinfo', async () => {
    let userinfoCalled = false
    const r = await verifyCbToken(`Bearer ${mint({ sub: 'u-off', exp: future() })}`, {
      envId: 'env-test',
      jwksLoader: async () => jwks,
      userinfoFetcher: async () => {
        userinfoCalled = true
        return null
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.uid).toBe('u-off')
      expect(r.mode).toBe('offline')
    }
    expect(userinfoCalled).toBe(false)
  })

  it('kid 轮换：首次未命中 → 强刷公钥后成功', async () => {
    const rotated = { ...jwks[0], kid: 'rotated-kid' }
    let calls = 0
    const r = await verifyCbToken(
      `Bearer ${mint({ sub: 'u-rot', exp: future() }, { alg: 'RS256', kid: 'rotated-kid' })}`,
      {
        envId: 'env-test',
        jwksLoader: async () => {
          calls++
          // 第一次返回旧公钥集，强刷后返回新版
          return calls === 1 ? jwks : [rotated]
        },
      },
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.uid).toBe('u-rot')
    expect(calls).toBe(2)
  })

  it('非 JWT（opaque token）回落 userinfo 成功', async () => {
    const r = await verifyCbToken('Bearer opaque-token-abc', {
      envId: 'env-test',
      jwksLoader: async () => jwks,
      userinfoFetcher: async (t) =>
        t === 'opaque-token-abc' ? { uid: 'u-opaque', claims: { sub: 'u-opaque' } } : null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.uid).toBe('u-opaque')
      expect(r.mode).toBe('userinfo')
    }
  })

  it('签名无效 + userinfo 也拒绝 → 整体失败（fail-closed）', async () => {
    const r = await verifyCbToken(`Bearer ${mint({ sub: 'u', exp: future() }).slice(0, -4)}AAAA`, {
      envId: 'env-test',
      jwksLoader: async () => jwks,
      userinfoFetcher: async () => null,
    })
    expect(r.ok).toBe(false)
  })

  it('拉公钥失败但 userinfo 可用 → 仍能认证', async () => {
    const r = await verifyCbToken(`Bearer ${mint({ sub: 'u-net', exp: future() })}`, {
      envId: 'env-test',
      jwksLoader: async () => {
        throw new Error('network down')
      },
      userinfoFetcher: async () => ({ uid: 'u-net', claims: { sub: 'u-net' } }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.mode).toBe('userinfo')
  })

  it('关闭兜底后 opaque token 直接失败', async () => {
    const r = await verifyCbToken('Bearer opaque', {
      envId: 'env-test',
      jwksLoader: async () => jwks,
      allowUserinfoFallback: false,
    })
    expect(r.ok).toBe(false)
  })
})

describe('resolveViaUserinfo — 响应形状兼容', () => {
  const cases: Array<[string, unknown, string]> = [
    ['OIDC 标准 { sub }', { sub: 'u-sub' }, 'u-sub'],
    ['包一层 { user: { sub } }', { user: { sub: 'u-nested' } }, 'u-nested'],
    ['{ id } 回退', { id: 'u-id' }, 'u-id'],
    ['{ user_id } 回退', { user_id: 'u-uid' }, 'u-uid'],
  ]

  for (const [name, body, expected] of cases) {
    it(`${name} → ${expected}`, async () => {
      const original = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof fetch
      try {
        const r = await resolveViaUserinfo('tok', 'env-test')
        expect(r?.uid).toBe(expected)
      } finally {
        globalThis.fetch = original
      }
    })
  }

  it('401 返回 null（不抛错）', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch
    try {
      expect(await resolveViaUserinfo('tok', 'env-test')).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  it('响应无任何 uid 字段 → null', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ email: 'a@b.c' }), { status: 200 })) as typeof fetch
    try {
      expect(await resolveViaUserinfo('tok', 'env-test')).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('端点拼装与缓存', () => {
  it('jwks / userinfo 走官方 OIDC 路径', () => {
    expect(jwksUrl('ulink-abc')).toBe('https://ulink-abc.api.tcloudbasegateway.com/auth/v1/certs')
    expect(userinfoUrl('ulink-abc')).toBe(
      'https://ulink-abc.api.tcloudbasegateway.com/auth/v1/user/me',
    )
  })

  it('clearJwksCache 可按 env 前缀清理', () => {
    expect(() => clearJwksCache()).not.toThrow()
    expect(() => clearJwksCache('env-test')).not.toThrow()
  })
})
