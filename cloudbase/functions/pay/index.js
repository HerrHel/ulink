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
    // ⚠️ 不要用 rdb.from(...).where(...)：node-sdk 的 rdb 是 PostgREST 客户端，
    // 数据库角色对 plans/orders 无 SELECT 权限（42501），且没有 where/match 方法。
    // 套餐读取走 SECURITY DEFINER 的 RPC（与 redeem 模式一致）。
    const r = await db.rpc('list_purchase_plans')
    if (r.error) {
      console.error('[pay] list_purchase_plans failed:', r.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    // 全部 active 档位（含免费）：定价对比表需要免费列；下单时服务端会再校验付费档
    const rows = (Array.isArray(r.data) ? r.data : []).filter(
      (p) => typeof p.priceCents === 'number',
    )
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
    const fetchOrder = async () => {
      const r = await db.rpc('get_payment_order', { p_order_id: orderId, p_uid: uid })
      if (r.error) {
        console.error('[pay] get_payment_order failed:', r.error)
        return { error: r.error }
      }
      return r.data || {}
    }

    const first = await fetchOrder()
    if (first.error) {
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }
    // RPC 内部归一化：不存在与「不属于你」都返回 order_not_found，避免订单号探测
    if (first.ok !== true) {
      sendJson(res, 404, { error: 'order_not_found' }, cors)
      return
    }
    const row = first.order

    const expired = row.expiresAt ? new Date(row.expiresAt).getTime() < Date.now() : false

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
          const again = await fetchOrder()
          if (again.ok === true) {
            sendJson(res, 200, { ok: true, order: again.order }, cors)
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

    sendJson(res, 200, { ok: true, order: row }, cors)
    return
  }

  if (action === 'transactions' || action === 'orders') {
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 100)
    const offset = Math.max(Number(body.offset) || 0, 0)

    const ordersRes = await db
      .from('orders')
      .select('id, user_id, plan_id, amount_cents, currency, channel, channel_order_id, status, paid_at, created_at, expires_at, idempotency_key', { count: 'exact' })
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (ordersRes.error) {
      console.error('[pay] list orders failed:', ordersRes.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }

    let plansMap = {}
    try {
      const pr = await db.rpc('list_purchase_plans')
      if (Array.isArray(pr.data)) {
        for (const p of pr.data) {
          if (p.planId) plansMap[p.planId] = p.name
        }
      }
    } catch { /* ignore */ }

    const rawList = ordersRes.data || []
    const total = typeof ordersRes.count === 'number' ? ordersRes.count : rawList.length

    const list = rawList.map((o) => {
      let type = 'purchase'
      let typeLabel = '充值'
      let channelLabel = '微信支付'
      if (o.channel === 'wechat') channelLabel = '微信支付'
      else if (o.channel === 'alipay') channelLabel = '支付宝'
      else if (o.channel === 'redeem') {
        type = 'redeem'
        typeLabel = '兑换码'
        channelLabel = '兑换码'
      } else if (o.channel === 'manual') {
        type = 'gift'
        typeLabel = '赠送金额'
        channelLabel = '-'
      }

      if (o.amount_cents === 0 && o.channel !== 'redeem') {
        type = 'gift'
        typeLabel = '赠送金额'
        channelLabel = '-'
      }

      let statusLabel = '充值成功'
      if (o.status === 'paid') {
        statusLabel = type === 'gift' ? '额度到账' : (o.channel === 'redeem' ? '额度到账' : '充值成功')
      } else if (o.status === 'pending') {
        statusLabel = '待支付'
      } else if (o.status === 'failed') {
        statusLabel = '已取消'
      } else if (o.status === 'refunded') {
        statusLabel = '已退款'
      }

      const planName = plansMap[o.plan_id] || (o.plan_id === 'plus_yearly' ? 'PRO 年付' : o.plan_id === 'plus_monthly' ? 'PRO 月付' : o.plan_id === 'pro_quarterly' ? 'PRO 季付' : o.plan_id)
      let notes = '-'
      if (o.channel === 'redeem') {
        notes = o.idempotency_key ? `兑换码: ${o.idempotency_key}` : (planName || '兑换码核销')
      } else if (o.expires_at) {
        notes = '有效期至 ' + new Date(o.expires_at).toISOString().slice(0, 10)
      } else if (planName) {
        notes = planName
      }

      return {
        orderId: o.id,
        channelOrderId: o.channel_order_id,
        createdAt: o.created_at,
        paidAt: o.paid_at,
        amountYen: (o.amount_cents / 100).toFixed(2),
        amountCents: o.amount_cents,
        currency: o.currency || 'CNY',
        type,
        typeLabel,
        channel: o.channel,
        channelLabel,
        status: o.status,
        statusLabel,
        planId: o.plan_id,
        planName,
        notes,
      }
    })

    sendJson(res, 200, { ok: true, list, total }, cors)
    return
  }

  sendJson(res, 400, { error: 'unknown_action' }, cors)
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
    // 路由白名单必须与 handleAuthed 内实现保持一致（曾漏 transactions/orders，
    // 导致「设置 → 交易明细」永远 400 unknown_action，见 TECH_DEBT §零）。
    const ALLOWED_ACTIONS = new Set(['create', 'status', 'plans', 'transactions', 'orders'])
    if (!ALLOWED_ACTIONS.has(action)) {
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
