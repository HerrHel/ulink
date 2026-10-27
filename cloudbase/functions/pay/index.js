/**
 * ulink 支付云函数（CloudBase HTTP 服务，CJS）
 *
 * 路由（网关侧配 `/pay` 前缀 + 路径透传，本函数同时兼容带/不带前缀）：
 *   POST /                  { action: 'create' | 'status' }   需 Authorization
 *   POST /notify/wechat     微信支付回调（RSA 验签 + AES-GCM 解密）
 *   POST /notify/alipay     支付宝回调（RSA2 验签，form-urlencoded）
 *
 * 三条不可妥协的规矩：
 *   1. **金额只认服务端订单**：下单金额取 `plans.price_cents`，回调金额只用于校验，
 *      不符即拒（`settle_paid_order` 内部再校一次，双层）。
 *   2. **发货幂等**：渠道会重发回调（微信最多 8 次）。幂等由 `status='pending'`
 *      条件更新兜住，重复回调会返回 `already_settled` 而非重复延长权益。
 *   3. **回调必须验签且 fail-closed**：验签失败 / 缺密钥 / 时间戳偏差 → 直接拒绝，
 *      绝不"先发货再补验签"。
 */

const http = require('node:http')
const crypto = require('node:crypto')

const { verifyCbToken } = require('./cb-auth.js')
const wxpay = require('./lib/wxpay.js')
const alipay = require('./lib/alipay.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'ulink-pay'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/** 下单限流：每用户 10 次/10 分钟（防止刷单把渠道侧打爆） */
const CREATE_LIMIT = Number(process.env.PAY_CREATE_LIMIT || 10)
const CREATE_WINDOW_SEC = Number(process.env.PAY_CREATE_WINDOW_SEC || 600)
/** 订单有效期（分钟） */
const ORDER_TTL_MIN = Number(process.env.PAY_ORDER_TTL_MIN || 30)
/** 渠道回调是否允许任意来源（回调没有 Origin，这里只做日志，不做拦截） */

let _db = null
function getDb() {
  if (!_db) {
    const app = require('@cloudbase/node-sdk').init({
      env: ENV_ID,
      // 云函数内用环境 API Key 换取服务端权限；缺失时 SDK 会走默认凭证
      ...(API_KEY ? { accessKey: API_KEY } : {}),
    })
    _db = app.rdb()
  }
  return _db
}

function isOriginAllowed(origin) {
  if (!origin) return true // 同源/服务端调用
  if (ALLOWED_ORIGINS.length === 0) return false
  return ALLOWED_ORIGINS.includes(origin)
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && isOriginAllowed(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

function sendJson(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extra,
  })
  res.end(body)
}

function sendText(res, status, text, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra,
  })
  res.end(text)
}

/** 收集原始 body（微信回调验签必须用**原文**，不能先 parse 再 stringify） */
function readRawBody(req, limit = 128 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('too_large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim()
  return req.socket?.remoteAddress || '0.0.0.0'
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex')
}

/** 归一化路径：兼容网关带前缀（/pay/notify/x）与不带前缀（/notify/x） */
function pathname(req) {
  const raw = (req.url || '/').split('?')[0]
  return raw.replace(/^\/pay(?=\/|$)/, '') || '/'
}

/** 需要鉴权的两个 action */
async function handleAuthed(req, res, action, body, cors) {
  const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })
  if (!auth.ok) {
    sendJson(res, 401, { error: 'unauthorized' }, cors)
    return
  }
  const uid = auth.uid
  const db = getDb()

  // 可购套餐列表：价格与周期**只从服务端 plans 表读**，前端不硬编码。
  // 只返回付费且启用的套餐（免费档不走支付）。
  if (action === 'plans') {
    const q = await db.from('plans').where({ active: true }).order('price_cents', 'asc').get()
    if (q.error) {
      console.error('[pay] plans query failed:', q.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    const rows = (q.data || [])
      .filter((r) => typeof r.price_cents === 'number' && r.price_cents > 0)
      .map((r) => ({
        planId: r.id,
        name: r.name,
        priceCents: r.price_cents,
        currency: r.currency || 'CNY',
        periodDays: r.period_days || 0,
      }))
    sendJson(res, 200, { ok: true, plans: rows }, cors)
    return
  }

  if (action === 'create') {
    // 限流 fail-closed
    const rl = await db.rpc('consume_rate_limit', {
      p_key: `pay-create:${uid}:${sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)}`,
      p_limit: CREATE_LIMIT,
      p_window_secs: CREATE_WINDOW_SEC,
    })
    if (rl.error) {
      console.error('[pay] rate limit failed (fail-closed):', rl.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    // 已知坑：拒绝时 data 可能是 {} 而非 false —— 必须显式判 true
    if (rl.data !== true) {
      sendJson(res, 429, { error: 'rate_limited' }, { ...cors, 'Retry-After': String(CREATE_WINDOW_SEC) })
      return
    }

    const planId = typeof body.planId === 'string' ? body.planId.trim() : ''
    const channel = typeof body.channel === 'string' ? body.channel.trim() : ''
    if (!planId || !['wechat', 'alipay'].includes(channel)) {
      sendJson(res, 400, { error: 'invalid_params' }, cors)
      return
    }

    // 渠道未配置 → 明确告知「未开通」，不要建出永远付不了的订单
    if (channel === 'wechat' && !wxpay.isWxpayConfigured()) {
      sendJson(res, 503, { error: 'channel_not_configured', channel }, cors)
      return
    }
    if (channel === 'alipay' && !alipay.isAlipayConfigured()) {
      sendJson(res, 503, { error: 'channel_not_configured', channel }, cors)
      return
    }

    // 建单：金额唯一来源是服务端 plans 表
    const cr = await db.rpc('create_payment_order', {
      p_uid: uid,
      p_plan_id: planId,
      p_channel: channel,
      p_ttl_minutes: ORDER_TTL_MIN,
    })
    if (cr.error) {
      console.error('[pay] create_payment_order failed:', cr.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    const order = cr.data || {}
    if (order.ok !== true) {
      sendJson(res, 400, { error: order.reason || 'create_failed' }, cors)
      return
    }

    // 调渠道下单
    let payResult
    try {
      if (channel === 'wechat') {
        payResult = await wxpay.createNativeOrder({
          outTradeNo: order.order_id,
          description: order.plan_name || 'ulink 订阅',
          totalCents: order.amount_cents,
          expireMinutes: ORDER_TTL_MIN,
        })
      } else {
        payResult = await alipay.createPrecreateOrder({
          outTradeNo: order.order_id,
          subject: order.plan_name || 'ulink 订阅',
          totalCents: order.amount_cents,
          timeoutMinutes: ORDER_TTL_MIN,
        })
      }
    } catch (e) {
      console.error('[pay] channel create failed:', channel, e.message)
      // 渠道侧失败：把订单置失败，避免留下永远 pending 的脏单
      await db.rpc('fail_payment_order', { p_order_id: order.order_id, p_reason: 'channel_create_failed' })
      sendJson(res, 502, { error: 'channel_error' }, cors)
      return
    }

    const qrCode = payResult.codeUrl || payResult.qrCode
    await db.rpc('attach_pay_payload', {
      p_order_id: order.order_id,
      p_payload: { qrCode, channel },
      p_channel_order_id: null,
    })

    sendJson(
      res,
      200,
      {
        ok: true,
        orderId: order.order_id,
        planId: order.plan_id,
        planName: order.plan_name,
        amountCents: order.amount_cents,
        currency: order.currency,
        channel,
        qrCode,
        expiresAt: order.expires_at,
      },
      cors,
    )
    return
  }

  if (action === 'status') {
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : ''
    if (!orderId) {
      sendJson(res, 400, { error: 'invalid_params' }, cors)
      return
    }
    const q = await db.from('orders').where({ id: orderId }).limit(1).get()
    if (q.error) {
      console.error('[pay] order query failed:', q.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    const row = (q.data || [])[0]
    // 不区分「不存在」与「不属于你」，避免成为订单号探测接口
    if (!row || String(row.user_id) !== String(uid)) {
      sendJson(res, 404, { error: 'order_not_found' }, cors)
      return
    }

    const expired = row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false

    // 主动查渠道（前端可选 sync=1，用于回调延迟时的兜底）
    const wantSync = body.sync === true
    if (wantSync && row.status === 'pending' && !expired) {
      try {
        const remote =
          row.channel === 'wechat'
            ? await wxpay.queryOrder(orderId)
            : await alipay.queryOrder(orderId)
        if (remote.tradeState === 'SUCCESS' && remote.paidCents != null) {
          await db.rpc('settle_paid_order', {
            p_order_id: orderId,
            p_channel: row.channel,
            p_channel_order_id: remote.channelOrderId,
            p_paid_cents: remote.paidCents,
            p_raw: remote.raw || {},
          })
          const again = await db.from('orders').where({ id: orderId }).limit(1).get()
          const fresh = (again.data || [])[0]
          if (fresh) {
            sendJson(res, 200, { ok: true, order: shapeOrder(fresh) }, cors)
            return
          }
        } else if (remote.tradeState === 'CLOSED' || remote.tradeState === 'REVOKED') {
          await db.rpc('fail_payment_order', { p_order_id: orderId, p_reason: remote.tradeState })
        }
      } catch (e) {
        // 查单失败不影响本地状态返回（前端继续轮询）
        console.warn('[pay] queryOrder failed:', e.message)
      }
    }

    sendJson(res, 200, { ok: true, order: shapeOrder(row) }, cors)
    return
  }

  sendJson(res, 400, { error: 'unknown_action' }, cors)
}

function shapeOrder(row) {
  return {
    orderId: row.id,
    planId: row.plan_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    channel: row.channel,
    status: row.status,
    qrCode: row.pay_payload?.qrCode || null,
    paidAt: row.paid_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || null,
  }
}

/** 微信回调：务必返回 200 + {"code":"SUCCESS"}，否则微信会按 8 次梯度重推 */
async function handleWxpayNotify(req, res) {
  if (!wxpay.isWxpayConfigured()) {
    sendJson(res, 503, { code: 'FAIL', message: 'not_configured' })
    return
  }
  const rawBody = await readRawBody(req)
  const parsed = wxpay.parsePaidNotify(req.headers, rawBody)
  if (!parsed.ok) {
    // 验签失败/事件不符：返回非 2xx，渠道会重推（便于排查），但绝不发货
    console.warn('[pay] wxpay notify rejected:', parsed.reason)
    const status = parsed.reason === 'ignored_event' ? 200 : 400
    sendJson(res, status, { code: parsed.reason === 'ignored_event' ? 'SUCCESS' : 'FAIL', message: parsed.reason })
    return
  }

  const db = getDb()
  const r = await db.rpc('settle_paid_order', {
    p_order_id: parsed.outTradeNo,
    p_channel: 'wechat',
    p_channel_order_id: parsed.channelOrderId,
    p_paid_cents: parsed.paidCents,
    p_raw: parsed.raw,
  })
  if (r.error) {
    console.error('[pay] settle failed (wechat):', r.error)
    sendJson(res, 500, { code: 'FAIL', message: 'settle_error' })
    return
  }
  const data = r.data || {}
  // 幂等命中（already_settled / not_pending）也回 SUCCESS：让渠道停止重推
  const ok = data.ok === true || data.reason === 'already_settled' || data.reason === 'not_pending'
  if (!ok) console.error('[pay] settle rejected (wechat):', JSON.stringify(data))
  sendJson(res, ok ? 200 : 400, { code: ok ? 'SUCCESS' : 'FAIL', message: ok ? '成功' : data.reason })
}

/** 支付宝回调：返回纯文本 `success`（小写），否则支付宝会重推 */
async function handleAlipayNotify(req, res) {
  if (!alipay.isAlipayConfigured()) {
    sendText(res, 503, 'failure')
    return
  }
  const rawBody = await readRawBody(req)
  const params = Object.fromEntries(new URLSearchParams(rawBody))
  const parsed = alipay.parsePaidNotify(params)
  if (!parsed.ok) {
    console.warn('[pay] alipay notify rejected:', parsed.reason)
    sendText(res, parsed.reason === 'not_success' ? 200 : 400, parsed.reason === 'not_success' ? 'success' : 'failure')
    return
  }

  const db = getDb()
  const r = await db.rpc('settle_paid_order', {
    p_order_id: parsed.outTradeNo,
    p_channel: 'alipay',
    p_channel_order_id: parsed.channelOrderId,
    p_paid_cents: parsed.paidCents,
    p_raw: parsed.raw,
  })
  if (r.error) {
    console.error('[pay] settle failed (alipay):', r.error)
    sendText(res, 500, 'failure')
    return
  }
  const data = r.data || {}
  const ok = data.ok === true || data.reason === 'already_settled' || data.reason === 'not_pending'
  if (!ok) console.error('[pay] settle rejected (alipay):', JSON.stringify(data))
  sendText(res, ok ? 200 : 400, ok ? 'success' : 'failure')
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || ''
  const cors = corsHeaders(origin)
  const p = pathname(req)

  // 回调端点：不走 CORS / Origin 校验（渠道服务端直连，没有 Origin）
  if (p === '/notify/wechat' || p === '/notify/alipay') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' })
      return
    }
    try {
      if (p === '/notify/wechat') await handleWxpayNotify(req, res)
      else await handleAlipayNotify(req, res)
    } catch (e) {
      console.error('[pay] notify unhandled:', e)
      if (!res.headersSent) sendJson(res, 500, { code: 'FAIL', message: 'internal_error' })
    }
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(isOriginAllowed(origin) ? 200 : 403, cors)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' }, { ...cors, Allow: 'POST' })
    return
  }
  if (!ENV_ID) {
    sendJson(res, 503, { error: 'not_configured' }, cors)
    return
  }
  if (!isOriginAllowed(origin)) {
    sendJson(res, 403, { error: 'origin_not_allowed' }, cors)
    return
  }

  try {
    const rawBody = await readRawBody(req)
    let body = {}
    if (rawBody) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        sendJson(res, 400, { error: 'invalid_json' }, cors)
        return
      }
    }
    const action = typeof body.action === 'string' ? body.action : ''
    if (action !== 'create' && action !== 'status' && action !== 'plans') {
      sendJson(res, 400, { error: 'unknown_action' }, cors)
      return
    }
    await handleAuthed(req, res, action, body, cors)
  } catch (e) {
    if (e.message === 'too_large') {
      sendJson(res, 413, { error: 'body_too_large' }, cors)
      return
    }
    console.error('[pay] unhandled:', e)
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error' }, cors)
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[pay] listening on :' + PORT)
  console.log('[pay] channels — wechat:', wxpay.isWxpayConfigured(), '| alipay:', alipay.isAlipayConfigured())
})
