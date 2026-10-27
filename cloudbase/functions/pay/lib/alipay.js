/**
 * 支付宝当面付（alipay.trade.precreate）—— 扫码支付
 *
 * 与微信的三处关键差异（写代码时最容易踩）：
 *   1. **金额单位是「元」的两位小数字符串**（如 "12.00"），不是分；
 *   2. 签名用 **RSA2（SHA256withRSA）**，待签名串是「排除 sign/sign_type 后
 *      按 key 字典序拼接的 key=value&...」，且**不强制 urlencode**（网关请求时
 *      参数各自 urlencode，回调验签时先 decode 再拼）；
 *   3. 回调是 form-urlencoded，不是 JSON。
 *
 * 环境变量（未配置视为未开通）：
 *   ALIPAY_APP_ID         应用 APPID
 *   ALIPAY_PRIVATE_KEY    应用私钥（PEM，PKCS8）
 *   ALIPAY_PUBLIC_KEY     支付宝公钥（PEM，用于验签回调）
 *   ALIPAY_NOTIFY_URL     回调地址 https://ulink.ren/pay/notify/alipay
 *   ALIPAY_GATEWAY        可选，默认 https://openapi.alipay.com/gateway.do
 *                         沙箱用 https://openapi-sandbox.dl.alipaydev.com/gateway.do
 */

const { createSign, createVerify } = require('node:crypto')

function pem(raw) {
  const v = raw || ''
  return v.includes('\\n') ? v.replace(/\\n/g, '\n') : v
}

function privateKey() {
  return pem(process.env.ALIPAY_PRIVATE_KEY)
}

function alipayPublicKey() {
  return pem(process.env.ALIPAY_PUBLIC_KEY)
}

function gateway() {
  return process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do'
}

function isAlipayConfigured() {
  return Boolean(
    process.env.ALIPAY_APP_ID && process.env.ALIPAY_PRIVATE_KEY && process.env.ALIPAY_PUBLIC_KEY,
  )
}

/** 支付宝要求的时间格式：yyyy-MM-dd HH:mm:ss（东八区） */
function nowTimestamp() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  )
}

/** 分 → 元（两位小数字符串）。整数运算避免浮点误差。 */
function centsToYuan(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('invalid_amount')
  const yuan = Math.floor(cents / 100)
  const fen = cents % 100
  return `${yuan}.${String(fen).padStart(2, '0')}`
}

/** 元（两位小数字符串）→ 分。用于回调金额核对。 */
function yuanToCents(yuan) {
  const s = String(yuan || '').trim()
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) return null
  const intPart = Number(m[1])
  const fracPart = Number((m[2] || '').padEnd(2, '0'))
  return intPart * 100 + fracPart
}

/** 按 key 字典序拼接（排除空值与 sign/sign_type），得到待签名/待验签串 */
function buildSignContent(params) {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
}

function signRSA2(content) {
  return createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey(), 'base64')
}

/**
 * 当面付下单：返回 qr_code（前端渲染二维码）。
 * @param {{ outTradeNo: string, subject: string, totalCents: number, timeoutMinutes?: number }} p
 */
async function createPrecreateOrder({ outTradeNo, subject, totalCents, timeoutMinutes = 30 }) {
  if (!isAlipayConfigured()) throw new Error('alipay_not_configured')

  const bizContent = {
    out_trade_no: outTradeNo,
    total_amount: centsToYuan(totalCents),
    subject: String(subject).slice(0, 256),
    // 超时关单：支付宝语法 m（分）；与本地 orders.expires_at 对齐，略长一点留缓冲
    timeout_express: `${Math.max(5, timeoutMinutes + 5)}m`,
}

  const params = {
    app_id: process.env.ALIPAY_APP_ID,
    method: 'alipay.trade.precreate',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: nowTimestamp(),
    version: '1.0',
    notify_url: process.env.ALIPAY_NOTIFY_URL,
    biz_content: JSON.stringify(bizContent),
  }
  params.sign = signRSA2(buildSignContent(params))

  const body = new URLSearchParams(params).toString()
  const res = await fetch(gateway(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`alipay_bad_response: ${text.slice(0, 200)}`)
  }

  const node = json.alipay_trade_precreate_response
  if (!node) throw new Error('alipay_missing_response_node')
  if (node.code !== '10000' || !node.qr_code) {
    throw new Error(`alipay_error: ${node.sub_code || node.code} ${node.sub_msg || node.msg || ''}`.trim())
  }
  return { qrCode: node.qr_code }
}

/** 主动查单（回调丢失时的兜底） */
async function queryOrder(outTradeNo) {
  if (!isAlipayConfigured()) throw new Error('alipay_not_configured')
  const params = {
    app_id: process.env.ALIPAY_APP_ID,
    method: 'alipay.trade.query',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: nowTimestamp(),
    version: '1.0',
    biz_content: JSON.stringify({ out_trade_no: outTradeNo }),
  }
  params.sign = signRSA2(buildSignContent(params))

  const res = await fetch(gateway(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  })
  const json = await res.json()
  const node = json.alipay_trade_query_response || {}
  if (node.code !== '10000') {
    return { tradeState: 'UNKNOWN', channelOrderId: null, paidCents: null, raw: node }
  }
  return {
    // WAIT_BUYER_PAY / TRADE_SUCCESS / TRADE_FINISHED / TRADE_CLOSED
    tradeState: node.trade_status === 'TRADE_SUCCESS' || node.trade_status === 'TRADE_FINISHED'
      ? 'SUCCESS'
      : node.trade_status,
    channelOrderId: node.trade_no || null,
    paidCents: yuanToCents(node.total_amount),
    successTime: node.send_pay_date || null,
    raw: node,
  }
}

/**
 * 验证回调签名。
 * @param {Record<string,string>} params 已 urldecode 的表单参数
 */
function verifyNotify(params) {
  const sign = params.sign
  if (!sign) return { ok: false, reason: 'missing_sign' }
  const key = alipayPublicKey()
  if (!key) return { ok: false, reason: 'no_public_key' }

  const content = buildSignContent(params)
  try {
    const ok = createVerify('RSA-SHA256').update(content, 'utf8').verify(key, sign, 'base64')
    return ok ? { ok: true } : { ok: false, reason: 'signature_mismatch' }
  } catch (e) {
    return { ok: false, reason: `verify_error: ${e.message}` }
  }
}

/**
 * 解析支付成功回调。
 * ⚠️ 必须同时校验 `app_id` 与 `seller_id`（若配置了），否则可能被别家的合法通知刷到。
 */
function parsePaidNotify(params) {
  const verify = verifyNotify(params)
  if (!verify.ok) return { ok: false, reason: verify.reason }

  if (process.env.ALIPAY_APP_ID && params.app_id !== process.env.ALIPAY_APP_ID) {
    return { ok: false, reason: 'app_id_mismatch' }
  }
  if (params.trade_status !== 'TRADE_SUCCESS' && params.trade_status !== 'TRADE_FINISHED') {
    return { ok: false, reason: 'not_success', tradeStatus: params.trade_status }
  }

  return {
    ok: true,
    outTradeNo: params.out_trade_no,
    channelOrderId: params.trade_no || null,
    paidCents: yuanToCents(params.total_amount),
    buyerId: params.buyer_id || null,
    successTime: params.gmt_payment || null,
    raw: params,
  }
}

module.exports = {
  isAlipayConfigured,
  createPrecreateOrder,
  queryOrder,
  verifyNotify,
  parsePaidNotify,
  centsToYuan,
  yuanToCents,
  buildSignContent,
}
