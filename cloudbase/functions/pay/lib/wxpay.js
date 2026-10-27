/**
 * 微信支付 API v3 —— Native（扫码）支付
 *
 * 只实现本项目需要的三件事：
 *   1. `createNativeOrder()` 下单，拿到 `code_url`（前端渲染成二维码）
 *   2. `verifyNotify()`    验证回调签名（RSA-SHA256 + 平台证书）+ 解密 resource
 *   3. `queryOrder()`      主动查单（回调丢失时的兜底）
 *
 * 依赖的环境变量（未配置则视为「支付未开通」，上层返回 503）：
 *   WXPAY_APPID           公众号/小程序 AppID（Native 支付必填）
 *   WXPAY_MCHID           商户号
 *   WXPAY_SERIAL_NO       商户 API 证书序列号
 *   WXPAY_PRIVATE_KEY     商户 API 私钥（PEM，apiclient_key.pem 内容）
 *   WXPAY_APIV3_KEY       APIv3 密钥（32 字节，用于回调解密）
 *   WXPAY_PLATFORM_CERT   微信支付平台证书（PEM，用于验签）※见下方说明
 *   WXPAY_NOTIFY_URL      回调地址，如 https://ulink.ren/pay/notify/wechat
 *
 * ⚠️ 关于平台证书：微信 2024 年起推行「微信支付公钥」模式（无需下载平台证书），
 *    但存量商户仍用平台证书。这里两种都支持：
 *      - 配了 WXPAY_PLATFORM_CERT → 用证书验签
 *      - 只配了 WXPAY_PUBLIC_KEY + WXPAY_PUBLIC_KEY_ID → 用公钥验签
 *    生产务必通过「下载平台证书」接口定期轮换，本模块不自动轮换（避免引入定时任务依赖）。
 */

const { createSign, createVerify, createDecipheriv, randomUUID } = require('node:crypto')

const API_BASE = 'https://api.mch.weixin.qq.com'

/** 配置是否齐全（缺失即视为未开通支付） */
function isWxpayConfigured() {
  return Boolean(
    process.env.WXPAY_APPID &&
      process.env.WXPAY_MCHID &&
      process.env.WXPAY_SERIAL_NO &&
      process.env.WXPAY_PRIVATE_KEY &&
      process.env.WXPAY_APIV3_KEY &&
      (process.env.WXPAY_PLATFORM_CERT || process.env.WXPAY_PUBLIC_KEY),
  )
}

/** 商户私钥：支持带 \n 转义的单行写法（云函数环境变量通常不能存多行） */
function privateKey() {
  const raw = process.env.WXPAY_PRIVATE_KEY || ''
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

function platformCert() {
  const raw = process.env.WXPAY_PLATFORM_CERT || ''
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

function publicKey() {
  const raw = process.env.WXPAY_PUBLIC_KEY || ''
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw
}

/** APIv3 请求签名（Authorization 头） */
function buildAuthorization(method, urlPath, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = randomUUID().replace(/-/g, '')
  // 签名串：HTTP方法\nURL\n时间戳\n随机串\n报文主体\n
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`
  const signature = createSign('RSA-SHA256').update(message).sign(privateKey(), 'base64')
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${process.env.WXPAY_MCHID}",` +
    `nonce_str="${nonce}",signature="${signature}",` +
    `timestamp="${timestamp}",serial_no="${process.env.WXPAY_SERIAL_NO}"`
  )
}

async function apiRequest(method, urlPath, payload) {
  const body = payload ? JSON.stringify(payload) : ''
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: buildAuthorization(method, urlPath, body),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'ulink-pay/1.0',
    },
    body: body || undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON（极少见），保留原文便于排查 */
  }
  if (!res.ok) {
    const msg = json?.message || text.slice(0, 200) || `HTTP ${res.status}`
    const err = new Error(`wxpay_api_error: ${msg}`)
    err.status = res.status
    err.code = json?.code
    throw err
  }
  return json
}

/**
 * Native 下单：返回 code_url，前端把它渲染成二维码。
 * @param {{ outTradeNo: string, description: string, totalCents: number, expireMinutes?: number }} p
 */
async function createNativeOrder({ outTradeNo, description, totalCents, expireMinutes = 30 }) {
  if (!isWxpayConfigured()) throw new Error('wxpay_not_configured')
  const payload = {
    appid: process.env.WXPAY_APPID,
    mchid: process.env.WXPAY_MCHID,
    description: description.slice(0, 127), // 微信限制 127 字符
    out_trade_no: outTradeNo,
    notify_url: process.env.WXPAY_NOTIFY_URL,
    amount: { total: totalCents, currency: 'CNY' },
    time_expire: new Date(Date.now() + expireMinutes * 60000).toISOString(),
  }
  const json = await apiRequest('POST', '/v3/pay/transactions/native', payload)
  if (!json?.code_url) throw new Error('wxpay_no_code_url')
  return { codeUrl: json.code_url }
}

/** 主动查单（回调丢失或不及时时的兜底） */
async function queryOrder(outTradeNo) {
  if (!isWxpayConfigured()) throw new Error('wxpay_not_configured')
  const path =
    `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}` +
    `?mchid=${encodeURIComponent(process.env.WXPAY_MCHID)}`
  const json = await apiRequest('GET', path, null)
  return {
    // SUCCESS / REFUND / NOTPAY / CLOSED / REVOKED / USERPAYING / PAYERROR
    tradeState: json?.trade_state,
    transactionId: json?.transaction_id || null,
    totalCents: json?.amount?.total ?? null,
    successTime: json?.success_time || null,
    raw: json,
  }
}

/** 关闭订单（用户放弃支付时，避免渠道侧长时间挂单） */
async function closeOrder(outTradeNo) {
  if (!isWxpayConfigured()) throw new Error('wxpay_not_configured')
  await apiRequest('POST', `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}/close`, {
    mchid: process.env.WXPAY_MCHID,
  })
}

/**
 * 验证回调签名。
 * 签名串：`${timestamp}\n${nonce}\n${body}\n`
 * 缺少任一签名头 → 直接拒绝（fail-closed）。
 */
function verifyNotify(headers, rawBody) {
  const timestamp = headers['wechatpay-timestamp']
  const nonce = headers['wechatpay-nonce']
  const signature = headers['wechatpay-signature']
  const serial = headers['wechatpay-serial']

  if (!timestamp || !nonce || !signature) return { ok: false, reason: 'missing_signature_headers' }

  // 防重放：时间戳与当前时间相差超过 5 分钟即拒绝
  const skew = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(skew) || skew > 300) return { ok: false, reason: 'timestamp_skew' }

  const message = `${timestamp}\n${nonce}\n${rawBody}\n`

  // 公钥模式优先（serial 以 PUB_KEY_ID_ 开头）；否则用平台证书
  const configuredKey = serial && String(serial).startsWith('PUB_KEY_ID_') ? publicKey() : platformCert()
  if (!configuredKey) return { ok: false, reason: 'no_verification_key' }

  try {
    const ok = createVerify('RSA-SHA256').update(message).verify(configuredKey, signature, 'base64')
    return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' }
  } catch (e) {
    return { ok: false, reason: `verify_error: ${e.message}` }
  }
}

/**
 * 解密回调 resource（AES-256-GCM）。
 * 密文格式：nonce(12) + ciphertext + tag(16)，`associated_data` 作为 AAD。
 */
function decryptResource(resource) {
  const key = process.env.WXPAY_APIV3_KEY
  if (!key || Buffer.byteLength(key) !== 32) throw new Error('wxpay_apiv3_key_invalid')
  const { ciphertext, nonce, associated_data: aad } = resource || {}
  if (!ciphertext || !nonce) throw new Error('wxpay_resource_malformed')

  const buf = Buffer.from(ciphertext, 'base64')
  const data = buf.subarray(0, buf.length - 16)
  const tag = buf.subarray(buf.length - 16)

  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), Buffer.from(nonce, 'utf8'))
  decipher.setAuthTag(tag)
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'))
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  return JSON.parse(plain)
}

/**
 * 解析支付成功回调 → 统一结构。
 * 只处理 `TRANSACTION.SUCCESS`；其它事件（退款等）交由调用方忽略或单独处理。
 */
function parsePaidNotify(headers, rawBody) {
  const verify = verifyNotify(headers, rawBody)
  if (!verify.ok) return { ok: false, reason: verify.reason }

  let body
  try {
    body = JSON.parse(rawBody)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
  if (body.event_type !== 'TRANSACTION.SUCCESS') {
    return { ok: false, reason: 'ignored_event', eventType: body.event_type }
  }

  let resource
  try {
    resource = decryptResource(body.resource)
  } catch (e) {
    return { ok: false, reason: 'decrypt_failed', detail: e.message }
  }

  if (resource.trade_state !== 'SUCCESS') {
    return { ok: false, reason: 'not_success', tradeState: resource.trade_state }
  }

  return {
    ok: true,
    outTradeNo: resource.out_trade_no,
    channelOrderId: resource.transaction_id,
    paidCents: resource.amount?.total ?? null,
    payerOpenid: resource.payer?.openid || null,
    successTime: resource.success_time || null,
    raw: resource,
  }
}

module.exports = {
  isWxpayConfigured,
  createNativeOrder,
  queryOrder,
  closeOrder,
  verifyNotify,
  decryptResource,
  parsePaidNotify,
};
