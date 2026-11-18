/**
 * 支付渠道库单测（cloudbase/functions/pay/lib/*）
 *
 * 为什么必须测：这里任何一处算错都是**真金白银**的问题 ——
 * 金额单位搞错（分↔元）会导致 12 元收成 1200 元或 0.12 元；
 * 验签漏一条分支会导致伪造回调白嫖订阅。
 *
 * 覆盖重点：
 *   1. 微信/支付宝的金额单位差异（微信=分整数，支付宝=元两位小数字符串）
 *   2. 微信回调 resource 的 AES-256-GCM 解密（真实构造密文，不 mock）
 *   3. 验签的 fail-closed 行为（缺头 / 时间戳偏差 / 无密钥 / 签名不符）
 *   4. 支付宝待签名串的排序与排除规则
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import { createCipheriv, randomBytes, generateKeyPairSync, createSign } from 'node:crypto'
import { join } from 'node:path'

const requireCjs = createRequire(import.meta.url)
const PAY_LIB = join(process.cwd(), 'cloudbase/functions/pay/lib')

const alipay = requireCjs(join(PAY_LIB, 'alipay.js')) as {
  centsToYuan: (c: number) => string
  yuanToCents: (y: string) => number | null
  buildSignContent: (p: Record<string, unknown>) => string
  verifyNotify: (p: Record<string, string>) => { ok: boolean; reason?: string }
  parsePaidNotify: (p: Record<string, string>) => { ok: boolean; reason?: string }
  buildVerifySignContent: (p: Record<string, unknown>) => string
  isAlipayConfigured: () => boolean
}
const wxpay = requireCjs(join(PAY_LIB, 'wxpay.js')) as {
  isWxpayConfigured: () => boolean
  verifyNotify: (h: Record<string, string>, body: string) => { ok: boolean; reason?: string }
  decryptResource: (r: { ciphertext: string; nonce: string; associated_data?: string }) => unknown
  parsePaidNotify: (h: Record<string, string>, body: string) => { ok: boolean; reason?: string }
}

describe('支付宝：金额单位（元 ↔ 分）', () => {
  it('分转元保留两位小数', () => {
    expect(alipay.centsToYuan(1)).toBe('0.01')
    expect(alipay.centsToYuan(99)).toBe('0.99')
    expect(alipay.centsToYuan(100)).toBe('1.00')
    expect(alipay.centsToYuan(1200)).toBe('12.00')
    expect(alipay.centsToYuan(12345)).toBe('123.45')
    expect(alipay.centsToYuan(0)).toBe('0.00')
  })

  it('元转分可逆，且容忍一位小数', () => {
    for (const c of [1, 99, 100, 1200, 12345, 999999]) {
      expect(alipay.yuanToCents(alipay.centsToYuan(c))).toBe(c)
    }
    expect(alipay.yuanToCents('12.0')).toBe(1200)
    expect(alipay.yuanToCents('12')).toBe(1200)
  })

  it('非法金额返回 null（不能静默当 0，否则会白送订阅）', () => {
    expect(alipay.yuanToCents('abc')).toBeNull()
    expect(alipay.yuanToCents('12.345')).toBeNull()
    expect(alipay.yuanToCents('')).toBeNull()
    expect(alipay.yuanToCents('-1')).toBeNull()
  })

  it('负数/非整数分会被拒绝', () => {
    expect(() => alipay.centsToYuan(-1)).toThrow()
    expect(() => alipay.centsToYuan(1.5)).toThrow()
  })
})

describe('支付宝：待签名串规则', () => {
  it('按 key 字典序拼接，排除 sign/sign_type 与空值', () => {
    const s = alipay.buildSignContent({ b: 2, a: 1, sign: 'X', sign_type: 'RSA2', empty: '' })
    expect(s).toBe('a=1&b=2')
  })

  it('排除 undefined / null', () => {
    expect(alipay.buildSignContent({ a: 1, b: undefined, c: null, d: 'x' })).toBe('a=1&d=x')
  })
})

describe('支付宝：验签 fail-closed', () => {
  it('没有 sign 直接拒绝', () => {
    expect(alipay.verifyNotify({ app_id: '1' }).ok).toBe(false)
  })

  it('有 sign 但没有配置公钥也拒绝（不能放行）', () => {
    const r = alipay.verifyNotify({ sign: 'abc', app_id: '1' })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_public_key')
  })
})

describe('微信：配置检测与验签 fail-closed', () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('未配置环境变量时视为未开通', () => {
    delete process.env.WXPAY_APPID
    delete process.env.WXPAY_MCHID
    delete process.env.WXPAY_SERIAL_NO
    delete process.env.WXPAY_PRIVATE_KEY
    delete process.env.WXPAY_APIV3_KEY
    delete process.env.WXPAY_PLATFORM_CERT
    expect(wxpay.isWxpayConfigured()).toBe(false)
  })

  it('缺签名头 → 拒绝', () => {
    const r = wxpay.verifyNotify({}, '{}')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing_signature_headers')
  })

  it('时间戳偏差超过 5 分钟 → 拒绝（防重放）', () => {
    const old = String(Math.floor(Date.now() / 1000) - 600)
    const r = wxpay.verifyNotify(
      { 'wechatpay-timestamp': old, 'wechatpay-nonce': 'n', 'wechatpay-signature': 's' },
      '{}',
    )
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('timestamp_skew')
  })

  it('未来时间戳同样拒绝（双向校验）', () => {
    const future = String(Math.floor(Date.now() / 1000) + 600)
    const r = wxpay.verifyNotify(
      { 'wechatpay-timestamp': future, 'wechatpay-nonce': 'n', 'wechatpay-signature': 's' },
      '{}',
    )
    expect(r.reason).toBe('timestamp_skew')
  })

  it('parsePaidNotify 验签失败时不返回 ok', () => {
    expect(wxpay.parsePaidNotify({}, '{"event_type":"TRANSACTION.SUCCESS"}').ok).toBe(false)
  })
})

describe('微信：回调 resource 解密（AES-256-GCM 真实加密）', () => {
  const KEY = 'a'.repeat(32) // 32 字节
  const ORIGINAL = { ...process.env }
  beforeEach(() => {
    process.env.WXPAY_APIV3_KEY = KEY
  })
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  /** 按微信规范构造密文：nonce(12) + ciphertext + tag(16) */
  function encrypt(plain: object, nonce: string, aad: string) {
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY, 'utf8'), Buffer.from(nonce, 'utf8'))
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const enc = Buffer.concat([cipher.update(JSON.stringify(plain), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([enc, tag]).toString('base64')
  }

  it('能正确解出明文', () => {
    const nonce = randomBytes(6).toString('hex') // 12 字符
    const aad = 'transaction'
    const payload = { out_trade_no: 'ord_1', trade_state: 'SUCCESS', amount: { total: 1200 } }
    const ciphertext = encrypt(payload, nonce, aad)
    const out = wxpay.decryptResource({ ciphertext, nonce, associated_data: aad }) as typeof payload
    expect(out.out_trade_no).toBe('ord_1')
    expect(out.amount.total).toBe(1200)
  })

  it('密文被篡改 → 认证失败抛错（不会返回脏数据）', () => {
    const nonce = randomBytes(6).toString('hex')
    const aad = 'transaction'
    const ciphertext = encrypt({ a: 1 }, nonce, aad)
    const buf = Buffer.from(ciphertext, 'base64')
    buf[0] = buf[0] ^ 0xff // 破坏一个字节
    expect(() =>
      wxpay.decryptResource({ ciphertext: buf.toString('base64'), nonce, associated_data: aad }),
    ).toThrow()
  })

  it('AAD 不匹配 → 认证失败', () => {
    const nonce = randomBytes(6).toString('hex')
    const ciphertext = encrypt({ a: 1 }, nonce, 'right-aad')
    expect(() =>
      wxpay.decryptResource({ ciphertext, nonce, associated_data: 'wrong-aad' }),
    ).toThrow()
  })

  it('APIV3 Key 长度不对时明确报错', () => {
    process.env.WXPAY_APIV3_KEY = 'short'
    expect(() =>
      wxpay.decryptResource({ ciphertext: 'x', nonce: 'y' }),
    ).toThrow(/apiv3_key_invalid/)
  })
})


// ── 真实密钥对下的验签（变异测试发现：此前只测「没配密钥时拒绝」，把验签改成恒放行也全绿）──
// 回调验签是「伪造到账通知 → 白拿会员」的唯一防线：签名对才放行，任何篡改 / 换钥 / 缺钥都必须拒绝。
function rsaPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}
const signB64 = (msg: string, privateKey: string) => createSign('RSA-SHA256').update(msg, 'utf8').sign(privateKey, 'base64')

describe('微信：真实密钥对验签（公钥模式 / 平台证书模式）', () => {
  const ORIGINAL = { ...process.env }
  const platform = rsaPair()
  const attacker = rsaPair()
  const body = '{"id":"evt_1","event_type":"TRANSACTION.SUCCESS","resource":{}}'
  const headersFor = (signature: string, serial = 'PUB_KEY_ID_0000000001') => {
    const ts = String(Math.floor(Date.now() / 1000))
    return { 'wechatpay-timestamp': ts, 'wechatpay-nonce': 'nonce-abc', 'wechatpay-serial': serial, 'wechatpay-signature': signature }
  }
  const signedHeaders = (privateKey: string, rawBody = body, serial?: string) => {
    const h = headersFor('', serial)
    h['wechatpay-signature'] = signB64(`${h['wechatpay-timestamp']}
${h['wechatpay-nonce']}
${rawBody}
`, privateKey)
    return h
  }
  beforeEach(() => {
    process.env = { ...ORIGINAL }
    delete process.env.WXPAY_PLATFORM_CERT
    process.env.WXPAY_PUBLIC_KEY = platform.publicKey
  })
  afterEach(() => { process.env = { ...ORIGINAL } })

  it('平台私钥签名 → 放行', () => {
    expect(wxpay.verifyNotify(signedHeaders(platform.privateKey), body)).toEqual({ ok: true })
  })

  it('报文被篡改（签名不变）→ 拒绝', () => {
    const h = signedHeaders(platform.privateKey)
    const tampered = body.replace('evt_1', 'evt_forged')
    expect(wxpay.verifyNotify(h, tampered)).toMatchObject({ ok: false, reason: 'signature_mismatch' })
  })

  it('攻击者自己的密钥签名 → 拒绝', () => {
    expect(wxpay.verifyNotify(signedHeaders(attacker.privateKey), body)).toMatchObject({ ok: false, reason: 'signature_mismatch' })
  })

  it('签名不是合法 base64 / 乱码 → 拒绝（不放行、不抛出）', () => {
    expect(wxpay.verifyNotify(headersFor('not-a-real-signature'), body).ok).toBe(false)
  })

  it('平台证书模式：WXPAY_PLATFORM_CERT 对应私钥签名放行、他钥拒绝', () => {
    delete process.env.WXPAY_PUBLIC_KEY
    process.env.WXPAY_PLATFORM_CERT = platform.publicKey
    expect(wxpay.verifyNotify(signedHeaders(platform.privateKey, body, 'SERIAL_PLATFORM_1'), body)).toEqual({ ok: true })
    expect(wxpay.verifyNotify(signedHeaders(attacker.privateKey, body, 'SERIAL_PLATFORM_1'), body).ok).toBe(false)
  })

  it('公钥模式 serial（PUB_KEY_ID_）但未配置公钥 → 拒绝（no_verification_key）', () => {
    delete process.env.WXPAY_PUBLIC_KEY
    expect(wxpay.verifyNotify(signedHeaders(platform.privateKey), body)).toMatchObject({ ok: false, reason: 'no_verification_key' })
  })

  it('parsePaidNotify：伪造签名的「支付成功」回调不得返回 ok', () => {
    expect(wxpay.parsePaidNotify(signedHeaders(attacker.privateKey), body).ok).toBe(false)
  })
})

describe('支付宝：真实密钥对验签（RSA2）', () => {
  const ORIGINAL = { ...process.env }
  const alipayKeys = rsaPair()
  const attacker = rsaPair()
  const baseParams = (): Record<string, string> => ({
    app_id: '2021000000000001',
    out_trade_no: 'ord_20261118_0001',
    trade_no: '2026111822001400000000000001',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '15.00',
    buyer_pay_amount: '15.00',
    charset: 'utf-8',
    sign_type: 'RSA2',
  })
  const signParams = (params: Record<string, string>, privateKey: string) => ({
    ...params,
    sign: signB64(alipay.buildVerifySignContent(params), privateKey),
  })
  beforeEach(() => {
    process.env = { ...ORIGINAL }
    process.env.ALIPAY_PUBLIC_KEY = alipayKeys.publicKey
    process.env.ALIPAY_APP_ID = '2021000000000001'
  })
  afterEach(() => { process.env = { ...ORIGINAL } })

  it('支付宝私钥签名 → 放行', () => {
    expect(alipay.verifyNotify(signParams(baseParams(), alipayKeys.privateKey))).toEqual({ ok: true })
  })

  it('金额被篡改（签名不变）→ 拒绝', () => {
    const signed = signParams(baseParams(), alipayKeys.privateKey)
    expect(alipay.verifyNotify({ ...signed, total_amount: '0.01', buyer_pay_amount: '0.01' })).toMatchObject({ ok: false, reason: 'signature_mismatch' })
  })

  it('订单号被替换（签名不变）→ 拒绝', () => {
    const signed = signParams(baseParams(), alipayKeys.privateKey)
    expect(alipay.verifyNotify({ ...signed, out_trade_no: 'ord_someone_else' }).ok).toBe(false)
  })

  it('攻击者自己的密钥签名 → 拒绝', () => {
    expect(alipay.verifyNotify(signParams(baseParams(), attacker.privateKey))).toMatchObject({ ok: false, reason: 'signature_mismatch' })
  })

  it('parsePaidNotify：伪造签名的 TRADE_SUCCESS 不得返回 ok；真签名才 ok', () => {
    expect(alipay.parsePaidNotify(signParams(baseParams(), attacker.privateKey)).ok).toBe(false)
    expect(alipay.parsePaidNotify(signParams(baseParams(), alipayKeys.privateKey)).ok).toBe(true)
  })
})

