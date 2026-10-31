/**
 * mimo-chat — 小米 MiMo 大模型的服务端安全转发（CloudBase HTTP 云函数，密钥永不出后端）
 *
 * 从 supabase/functions/mimo-chat/index.ts 迁移而来。业务逻辑**原样搬**：
 * SSE 流式透传、请求体校验/token 预算/model 白名单（mimo-guard.ts 真源派生）、
 * CORS fail-closed、上游超时 + 客户端断连取消（断连后不空耗配额）、
 * 上游错误体不透传（S11，可能含 key 片段）。
 *
 * 迁移差异（与 jina-proxy/check-link 同口径）：
 * 1) 鉴权：Supabase getUser → IP 哈希限流（consume_rate_limit fail-closed），
 *    频次收紧到 30/min/IP（原 30/min/user）。转发计费通道宁可暂时不可用也不无限放行。
 * 2) SSE 透传：Deno Response(body) → Node Readable.fromWeb(upstream.body).pipe(res)。
 * 3) 断连：req.signal → res 'close' 事件。
 */

const http = require('http')
const crypto = require('crypto')
const { Readable, Transform } = require('stream')
const { validateChatBody, isOriginAllowed, buildCorsHeaders } = require('./mimo-guard.js')
const { verifyCbToken } = require('./cb-auth.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const MIMO_API_KEY = process.env.MIMO_API_KEY || ''
const MIMO_BASE_URL = (process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '')
const MIMO_MODEL = process.env.MIMO_MODEL || 'mimo-v2.6-flash'
const ALLOWED_MODELS = (process.env.MIMO_ALLOWED_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
const RATE_LIMIT_PER_MIN = parseInt(process.env.MIMO_CHAT_RATE_LIMIT_PER_MIN || '30', 10)
/** 上游首响应超时（ms）；流式输出可超过此值，仅约束等待首字节 */
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.MIMO_CHAT_TIMEOUT_MS || '60000', 10)
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'ulink-mimo-chat'
/**
 * 计费模式：
 *   shadow  —— 只记录用量、不做任何额度判断（默认，绝不影响用户体验）
 *   enforce —— 预留：按 resolve_entitlement 的额度拦截（待影子计量拿到真实分布后再开启）
 */
const BILLING_MODE = (process.env.BILLING_MODE || 'shadow').toLowerCase()

/** 按 Asia/Shanghai 分桶（UTC+8 偏移后取 YYYY-MM），跨时区用户口径一致 */
function shanghaiPeriod(now) {
  return new Date((now || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 7)
}

/** 按 Asia/Shanghai 取日键（YYYY-MM-DD），用于 ai.requests.daily 每日配额 */
function shanghaiDate(now) {
  return new Date((now || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

/** 影子计量：只写账本，任何失败都不影响主流程 */
async function recordUsage(db, uid, metric, amount, ref) {
  try {
    // period 必传：北京时间当月 'YYYY-MM'。不传会被记成 'unknown'，按月额度查不到（已踩）
    const period = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7)
    await db.rpc('record_usage', {
      p_uid: uid,
      p_metric: metric,
      p_amount: amount,
      p_ref: ref,
      p_period: period,
      p_period: shanghaiPeriod(),
    })
  } catch (e) {
    console.error('[mimo-chat] record_usage failed:', e)
  }
}

function sendJson(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  })
  res.end(payload)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => {
      raw += c
      if (raw.length > 2_000_000) {
        reject(new Error('body_too_large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new Error('invalid_json'))
      }
    })
    req.on('error', reject)
  })
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'] || ''
  const first = String(xff).split(',')[0]?.trim()
  return first || req.headers['x-real-ip'] || req.headers['cf-connecting-ip'] || 'unknown'
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex')
}

let _db = null
function getDb() {
  if (_db) return _db
  const cloudbase = require('@cloudbase/node-sdk')
  const app = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })
  _db = app.rdb()
  return _db
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers['origin'] || null
  const cors = buildCorsHeaders(origin, ALLOWED_ORIGINS)

  if (req.method === 'OPTIONS') {
    res.writeHead(isOriginAllowed(origin, ALLOWED_ORIGINS) ? 200 : 403, cors)
    res.end()
    return
  }
  if (!ENV_ID || !API_KEY) {
    sendJson(res, 500, { error: 'not_configured' }, cors)
    return
  }

  // 上游取消链路：客户端断连即 abort 上游，不再空耗配额
  const upstreamAbort = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) upstreamAbort.abort()
  })

  try {
    if (!MIMO_API_KEY) {
      sendJson(res, 503, { error: 'AI 服务未配置（服务端缺少 MIMO_API_KEY）' }, cors)
      return
    }

    // 用户身份：能验签就按 uid 计量；验不到（未登录 / 老客户端）回退 IP 限流，不阻断使用
    const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID }).catch(() => null)
    const uid = auth && auth.ok ? auth.uid : null

    // 限流 fail-closed：转发计费通道宁可暂时不可用，也不无限放行
    const ipHash = sha256Hex(clientIp(req) + '|' + IP_HASH_SALT)
    const db = getDb()
    const rl = await db.rpc('consume_rate_limit', {
      // 已登录按用户限流（跨设备统一口径，也是未来计费的主体键）
      p_key: uid ? 'mimo-chat:uid:' + uid : 'mimo-chat:ip:' + ipHash,
      p_limit: RATE_LIMIT_PER_MIN,
      p_window_secs: 60,
    })
    if (rl.error) {
      console.error('[mimo-chat] rate limit rpc failed (fail-closed):', rl.error)
      sendJson(res, 503, { error: 'AI 服务暂时不可用，请稍后再试' }, cors)
      return
    }
    if (rl.data !== true) {
      sendJson(res, 429, { error: 'Rate limit exceeded' }, { ...cors, 'Retry-After': '60' })
      return
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      sendJson(res, 400, { error: 'Invalid JSON body' }, cors)
      return
    }
    const guard = validateChatBody(body, {
      defaultModel: MIMO_MODEL,
      allowedModels: ALLOWED_MODELS,
    })
    if (!guard.ok) {
      sendJson(res, guard.status, { error: guard.error }, cors)
      return
    }

    // ── 额度拦截（enforce）：本月 ai.tokens 超额拒绝 ──
    // quota 查询失败 fail-open：配额系统故障时不误伤用户（宁可少拦，日志留痕）
    if (BILLING_MODE === 'enforce' && uid) {
      try {
        const q = await db.rpc('ai_quota_check', { p_uid: uid })
        if (q.error) {
          console.error('[mimo-chat] ai_quota_check failed (fail-open):', q.error)
        } else if (q.data?.exceeded === true) {
          console.warn('[mimo-chat] quota exceeded for', uid, JSON.stringify(q.data))
          sendJson(res, 429, {
            error: 'quota_exceeded',
            message: '本月 AI 额度已用完。升级 PRO 解锁 20 万 tokens/月（年付折合 ¥9/月）。',
          }, cors)
          return
        }
      } catch (e) {
        console.error('[mimo-chat] quota check throw (fail-open):', e)
      }
    }

    // ── 每日请求数拦截（enforce）：plans.features['ai.requests.daily'] ──
    // 与 token 月度额度互补：防止单日高频刷（token 总量尚未耗尽时也能拦住）。
    // 未配置该键的档位视为不限制；RPC 失败 fail-open，避免配额系统故障误伤。
    if (BILLING_MODE === 'enforce' && uid) {
      try {
        const ent = await db.rpc('resolve_entitlement', { p_uid: uid })
        const rawLimit = ent.error ? undefined : ent.data?.features?.['ai.requests.daily']
        if (rawLimit !== undefined && rawLimit !== null) {
          const limit = Number(rawLimit)
          if (!Number.isFinite(limit) || limit <= 0) {
            sendJson(res, 429, {
              error: 'quota_exceeded',
              quota: 'ai.requests.daily',
              message: '当前档位未开放 AI 请求，请升级后再试。',
            }, cors)
            return
          }
          const daily = await db.rpc('consume_rate_limit', {
            p_key: `ai:req:${uid}:${shanghaiDate()}`,
            p_limit: limit,
            p_window_secs: 86400,
          })
          if (daily.error) {
            console.error('[mimo-chat] ai.requests quota rpc failed (fail-open):', daily.error)
          } else if (daily.data !== true) {
            console.warn('[mimo-chat] daily request quota exceeded for', uid, 'limit=', limit)
            sendJson(res, 429, {
              error: 'quota_exceeded',
              quota: 'ai.requests.daily',
              limit,
              message: '今日 AI 请求次数已用完（免费版 20 次/日、PRO 100 次/日），请明天再试或升级。',
            }, cors)
            return
          }
        }
      } catch (e) {
        console.error('[mimo-chat] ai.requests quota throw (fail-open):', e)
      }
    }

    const upstream = await fetch(MIMO_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + MIMO_API_KEY,
      },
      body: JSON.stringify(guard.value),
      signal: AbortSignal.any([upstreamAbort.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      // S11：不透传上游原始错误体（可能含 key 片段），只回状态码
      console.error('[mimo-chat] upstream failed:', upstream.status, errText.slice(0, 200))
      sendJson(res, 502, { error: 'AI 服务请求失败 (' + upstream.status + ')' }, cors)
      return
    }

    // SSE 流式透传（含 text/event-stream 头），前端解析逻辑零改动
    res.writeHead(200, {
      ...cors,
      'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
    })

    // 影子计量：统计输出字节数（token 的近似值），**只记录不拦截**
    if (uid) {
      let outBytes = 0
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          outBytes += chunk.length
          cb(null, chunk)
        },
      })
      const inChars = JSON.stringify(guard.value.messages || []).length
      const ref = 'chat-' + Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex')
      res.on('finish', () => {
        void recordUsage(db, uid, 'ai.requests', 1, ref)
        void recordUsage(db, uid, 'ai.chars', inChars + outBytes, ref)
      })
      Readable.fromWeb(upstream.body).pipe(counter).pipe(res)
      return
    }

    Readable.fromWeb(upstream.body).pipe(res)
  } catch (error) {
    console.error('[mimo-chat] internal error:', error)
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal server error' }, cors)
    } else {
      res.destroy()
    }
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[mimo-chat] listening on :' + PORT)
})
