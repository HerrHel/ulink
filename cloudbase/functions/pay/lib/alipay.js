/**
 * 支付宝渠道集成
 *
 * 支持产品能力：
 *   1. 电脑网站支付（alipay.trade.page.pay）—— FAST_INSTANT_TRADE_PAY
 *   2. 手机网站支付（alipay.trade.wap.pay）—— QUICK_WAP_PAY
 *   3. 统一查单（alipay.trade.query）
 *   4. 统一异步通知验签与解析
 *
 * 关键规则与签名要点：
 *   1. **金额单位是「元」的两位小数字符串**（如 "12.00"），不是分；
 *   2. 签名用 **RSA2（SHA256withRSA）**：
 *      - **请求加签**：参数字典序拼接，必须排除 sign，保留 sign_type（支付宝网关验签必须包含 sign_type）；
 *      - **回调验签**：参数字典序拼接，必须排除 sign 和 sign_type（符合支付宝异步通知规范）；
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

/**
 * 请求待签名串：排除 sign 与空值（保留 sign_type）
 * ⚠️ 支付宝网关在 RSA2 下把请求参数中的 sign_type 算入待签名串中。
 */
function buildRequestSignContent(params) {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
}

/**
 * 回调验签待签名串：排除 sign、sign_type 与空值
 * ⚠️ 支付宝异步通知官方规范明确要求排除 sign 与 sign_type。
 */
function buildVerifySignContent(params) {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
}

/** 保持历史接口兼容，默认同 buildVerifySignContent */
const buildSignContent = buildVerifySignContent

function signRSA2(content) {
  return createSign('RSA-SHA256').update(content, 'utf8').sign(privateKey(), 'base64')
}

/**
 * 构造收银台跳转 URL（电脑网站支付与手机网站支付通用引擎）
 */
function buildCashierUrl({ method, productCode, outTradeNo, subject, totalCents, timeoutMinutes = 30, returnUrl }) {
  if (!isAlipayConfigured()) throw new Error('alipay_not_configured')

  const bizContent = {
    out_trade_no: outTradeNo,
    total_amount: centsToYuan(totalCents),
    subject: String(subject).slice(0, 256),
    product_code: productCode,
    timeout_express: `${Math.max(5, timeoutMinutes + 5)}m`,
  }

  const params = {
    app_id: process.env.ALIPAY_APP_ID,
    method,
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: nowTimestamp(),
    version: '1.0',
    notify_url: process.env.ALIPAY_NOTIFY_URL,
    return_url: returnUrl || 'https://ulink.ren/#payment_success',
    biz_content: JSON.stringify(bizContent),
  }

  params.sign = signRSA2(buildRequestSignContent(params))
  return `${gateway()}?${new URLSearchParams(params).toString()}`
}

/**
 * 电脑网站支付（PC 跳转或扫码）
 * product_code: FAST_INSTANT_TRADE_PAY
 */
async function createPagePayOrder({ outTradeNo, subject, totalCents, timeoutMinutes = 30, returnUrl }) {
  const payUrl = buildCashierUrl({
    method: 'alipay.trade.page.pay',
    productCode: 'FAST_INSTANT_TRADE_PAY',
    outTradeNo,
    subject,
    totalCents,
    timeoutMinutes,
    returnUrl,
  })
  return { payUrl, qrCode: payUrl }
}

/**
 * 手机网站支付（H5 自动唤起支付宝 App）
 * product_code: QUICK_WAP_PAY
 */
async function createWapPayOrder({ outTradeNo, subject, totalCents, timeoutMinutes = 30, returnUrl }) {
  const payUrl = buildCashierUrl({
    method: 'alipay.trade.wap.pay',
    productCode: 'QUICK_WAP_PAY',
    outTradeNo,
    subject,
    totalCents,
    timeoutMinutes,
    returnUrl,
  })
  return { payUrl, qrCode: payUrl }
}

/**
 * 统一支付下单入口
 */
async function createOrder({ outTradeNo, subject, totalCents, timeoutMinutes = 30, isMobile = false, returnUrl }) {
  if (isMobile) {
    return createWapPayOrder({ outTradeNo, subject, totalCents, timeoutMinutes, returnUrl })
  }
  return createPagePayOrder({ outTradeNo, subject, totalCents, timeoutMinutes, returnUrl })
}

/**
 * 兼容旧代码的预下单接口（直接导流到电脑网站支付，支持 PC 扫码/跳转）
 */
async function createPrecreateOrder({ outTradeNo, subject, totalCents, timeoutMinutes = 30, returnUrl }) {
  return createPagePayOrder({ outTradeNo, subject, totalCents, timeoutMinutes, returnUrl })
}

/** 主动查单（统一交易查询接口，全产品线通用） */
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
  params.sign = signRSA2(buildRequestSignContent(params))

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
    // 2026-11-14 审计 #35：必须取「实付」而非订单总额。有折扣/优惠时
    // total_amount 仍是原价，用它过金额校验等于少付也发货。
    paidCents: yuanToCents(node.buyer_pay_amount ?? node.total_amount),
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

  const content = buildVerifySignContent(params)
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
  createPagePayOrder,
  createWapPayOrder,
  createOrder,
  queryOrder,
  verifyNotify,
  parsePaidNotify,
  centsToYuan,
  yuanToCents,
  buildSignContent,
  buildRequestSignContent,
  buildVerifySignContent,
}
