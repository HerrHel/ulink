/**
 * send-feedback — 应用内反馈表单 → 企业邮箱（CloudBase HTTP 云函数）
 *
 * 从 supabase/functions/send-feedback/index.ts 迁移而来。业务逻辑**原样搬**：
 * honeypot 静默吞、Turnstile 可选人机、IP 哈希 DB 计数限流（1h/5）、落库优先
 * （SMTP 失败不影响内容归档）、零依赖 SMTP 六步会话（见 smtp.js）。
 *
 * 迁移差异（刻意为之）：
 * 1) 运行时：Deno.connectTls → Node tls.connect（smtp.js）；crypto.subtle → crypto.createHash。
 * 2) 落库：Supabase service_role → CloudBase rdb（CLOUDBASE_APIKEY，绕过 RLS）。
 *    a) rdb insert 不返回插入行（data: {}），而本流程要拿 id 回写 mail 状态
 *       → id 显式生成（crypto.randomUUID()）。
 *    b) rdb .insert() 不是原生 Promise（无 .catch），返回 {error,...} 必须主动检查。
 * 3) 限流与 report-error 同款 DB 计数形状（select head+count + eq + gte），查询失败
 *    500 fail-closed（与原版 rate_check_failed 一致）。
 *
 * feedback_messages 表无 user_id 列，不涉及「落 NULL」约束问题。
 * 凭据：HTTP 云函数必须显式凭证（CLOUDBASE_APIKEY，绝不进代码/响应）。
 */

const http = require('http')
const crypto = require('crypto')
const { SmtpSession, buildMime, withTimeout } = require('./smtp.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.exmail.qq.com'
const SMTP_PORT = Number(process.env.SMTP_PORT || 465)
const SMTP_USER = process.env.SMTP_USER || ''
const SMTP_PASS = process.env.SMTP_PASS || ''
const FEEDBACK_TO = process.env.FEEDBACK_TO || 'support@ulink.ren'
/** 发件人：多数 SMTP 要求与登录账号一致，故默认取 SMTP_USER */
const FEEDBACK_FROM = process.env.FEEDBACK_FROM || SMTP_USER
/**
 * 人机验证开关（CloudBase auth captcha，按需挑战）：
 * '1'/'true' → 未带有效 captcha_token 的提交回 400 {error:'captcha_required'}，
 * 前端拉起图形验证码后带 token 重交；token 一次性消费（防重放）。
 * 未配置 → 跳过（仅 honeypot + 限流）。
 */
const REQUIRE_CAPTCHA = /^(1|true)$/i.test(process.env.REQUIRE_CAPTCHA || '')
/** IP 哈希盐：独立于 report-error / check-link，防跨接口关联 */
const IP_HASH_SALT = process.env.IP_HASH_SALT || 'ulink-feedback'
const APP_ORIGIN = (process.env.APP_ORIGIN || 'https://ulink.ren').replace(/\/+$/, '')

const MAX_MESSAGE = 4000
const MAX_CONTACT = 200
const MIN_MESSAGE = 5
const RATE_LIMIT = 5
const RATE_WINDOW_MS = 60 * 60 * 1000
const SMTP_TIMEOUT_MS = 20_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 100_000) {
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

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200
}

function buildBody(f) {
  return [
    '与链 · ulink 用户反馈',
    '',
    '时间：' + f.at,
    '联系方式：' + (f.contact || '（未填写）'),
    '语言：' + (f.locale || '未知'),
    '版本：' + (f.appVersion || '未知'),
    'IP 哈希：' + f.ipHash,
    '浏览器：' + (f.ua || '未知'),
    '记录 ID：' + f.id,
    '站点：' + APP_ORIGIN,
    '',
    '------ 反馈内容 ------',
    f.message,
    '',
  ].join('\r\n')
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
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' })
    return
  }
  if (!ENV_ID || !API_KEY) {
    console.error('[send-feedback] missing env CLOUDBASE_ENV_ID / CLOUDBASE_APIKEY')
    sendJson(res, 500, { error: 'not_configured' })
    return
  }

  let payload
  try {
    payload = await readJsonBody(req)
  } catch (e) {
    sendJson(res, 400, { error: e.message || 'invalid_json' })
    return
  }

  const message = String(payload.message ?? '').trim()
  const contact = String(payload.contact ?? '').trim()
  const locale = String(payload.locale ?? '').slice(0, 20)
  const appVersion = String(payload.appVersion ?? '').slice(0, 40)
  // honeypot：正常用户看不到这个字段，填了即为机器人
  const honeypot = String(payload.website ?? '').trim()

  if (honeypot) {
    sendJson(res, 200, { ok: true, skipped: true })
    return
  }
  if (message.length < MIN_MESSAGE) {
    sendJson(res, 400, { error: 'message_too_short' })
    return
  }
  if (message.length > MAX_MESSAGE) {
    sendJson(res, 400, { error: 'message_too_long' })
    return
  }
  if (contact.length > MAX_CONTACT) {
    sendJson(res, 400, { error: 'contact_too_long' })
    return
  }

  const ip = clientIp(req)
  const ipHash = sha256Hex(ip + '|' + IP_HASH_SALT)

  const db = getDb()

  // 人机验证（CloudBase auth captcha，按需挑战）：无 token → captcha_required
  // （前端拉起图形验证码、verifyCaptchaData 拿 captcha_token 后重交）；
  // 有 token → **一次性消费**（consume_rate_limit 单次窗口防重放），重复/失败
  // 一律回 captcha_required 要求重新验证（fail-closed）。
  const captchaToken = String(payload.captcha_token ?? '').trim()
  if (REQUIRE_CAPTCHA) {
    if (!captchaToken) {
      sendJson(res, 400, { error: 'captcha_required' })
      return
    }
    const claim = await db.rpc('consume_rate_limit', {
      p_key: 'fb-captcha:' + sha256Hex(captchaToken),
      p_limit: 1,
      p_window_secs: 1800,
    })
    if (claim.error || claim.data !== true) {
      sendJson(res, 400, { error: 'captcha_required' })
      return
    }
  }

  // 限流：同 IP 1 小时内提交数（DB 计数跨实例一致；查询失败 fail-closed）
  try {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
    const r = await db
      .from('feedback_messages')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', since)
    if (r.error) {
      console.error('[send-feedback] rate check failed:', r.error)
      sendJson(res, 500, { error: 'rate_check_failed' })
      return
    }
    if ((r.count ?? 0) >= RATE_LIMIT) {
      sendJson(res, 429, { error: 'rate_limited' })
      return
    }
  } catch (e) {
    console.error('[send-feedback] rate check threw:', e)
    sendJson(res, 500, { error: 'rate_check_failed' })
    return
  }

  // id 显式生成：rdb insert 不返回插入行，而后面要按 id 回写 mail 状态
  const rowId = crypto.randomUUID()
  const ins = await db.from('feedback_messages').insert({
    id: rowId,
    message,
    contact: contact || null,
    ip_hash: ipHash,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 400) || null,
    locale: locale || null,
    app_version: appVersion || null,
    mail_sent: false,
    mail_error: null,
  })
  if (ins.error) {
    console.error('[send-feedback] insert failed:', ins.error)
    sendJson(res, 500, { error: 'store_failed' })
    return
  }

  // 发信：失败不影响已落库的反馈内容
  let mailSent = false
  let mailError = null
  if (SMTP_USER && SMTP_PASS && FEEDBACK_TO) {
    const session = new SmtpSession({ host: SMTP_HOST, port: SMTP_PORT, user: SMTP_USER, pass: SMTP_PASS })
    try {
      const at = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      const body = buildBody({
        id: rowId,
        at,
        contact,
        locale,
        appVersion,
        ipHash,
        ua: req.headers['user-agent'] || '',
        message,
      })
      const mime = buildMime(
        '与链 ulink · 用户反馈' + (contact ? '（' + contact + '）' : ''),
        body,
        FEEDBACK_FROM,
        FEEDBACK_TO,
        looksLikeEmail(contact) ? contact : '',
        'ulink.ren',
      )
      await withTimeout(
        (async () => {
          await session.connect()
          await session.sendMail(FEEDBACK_FROM, FEEDBACK_TO, mime)
          await session.quit()
        })(),
        SMTP_TIMEOUT_MS,
        'SMTP',
      )
      mailSent = true
    } catch (e) {
      mailError = String((e && e.message) || e).slice(0, 500)
    } finally {
      session.close()
    }
  } else {
    mailError = 'smtp_not_configured'
  }

  const upd = await db
    .from('feedback_messages')
    .update({ mail_sent: mailSent, mail_error: mailError })
    .eq('id', rowId)
  if (upd.error) console.error('[send-feedback] update mail status failed:', upd.error)

  sendJson(res, 200, { ok: true, mailSent })
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[send-feedback] listening on :' + PORT)
})
