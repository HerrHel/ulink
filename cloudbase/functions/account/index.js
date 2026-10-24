/**
 * account — 账号注销（数据清除）HTTP 云函数
 *
 * 背景：《个人信息保护法》第四十七条（删除权）。本产品原先**没有**任何注销入口，
 * 而法律文档已承诺「核验身份后 30 日内删除服务器数据」——若无实现即构成虚假承诺。
 *
 * 本函数提供**自助清除**能力：
 *   1) cb-auth 离线验签 → uid（证明「你是你」，不依赖客户端自述）
 *   2) list_user_image_paths → 删除该用户在对象存储中的全部上传图片
 *   3) purge_user_data → 删除 PG 内该用户的全部数据（幂等）
 *
 * 账号记录本身（CloudBase auth 账号）由运营方人工核验后删除：云函数只有
 * publishable 级 APIKEY，没有管理密钥，无法调用账号删除接口。因此返回结果里
 * 明确区分「数据已删」与「账号待人工删除」，前端据此提示用户。
 *
 * 接口：POST / { "action": "purge" }
 *   200 { ok, dataDeleted, imagesDeleted, accountPendingDeletion }
 *   401 未登录 / 令牌无效
 *   503 上游故障（fail-closed，不谎报成功）
 */

const http = require('http')
const { verifyCbToken } = require('./cb-auth.js')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
const IMAGES_BUCKET = 'group-images'
const BODY_LIMIT = 4096

function isOriginAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)
}

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
  if (origin && isOriginAllowed(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

function sendJson(res, status, obj, extra) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extra,
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > BODY_LIMIT) {
        reject(new Error('too_large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid_json'))
      }
    })
    req.on('error', reject)
  })
}

let _app = null
function getApp() {
  if (_app) return _app
  const cloudbase = require('@cloudbase/node-sdk')
  _app = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })
  return _app
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || ''
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    res.writeHead(isOriginAllowed(origin) ? 200 : 403, cors)
    res.end()
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method_not_allowed' }, { ...cors, Allow: 'POST' })
    return
  }
  if (!ENV_ID || !API_KEY) {
    sendJson(res, 503, { error: 'not_configured' }, cors)
    return
  }
  if (!isOriginAllowed(origin)) {
    sendJson(res, 403, { error: 'origin_not_allowed' }, cors)
    return
  }

  try {
    let body
    try {
      body = await readJsonBody(req)
    } catch (e) {
      sendJson(res, 400, { error: e.message === 'too_large' ? 'body_too_large' : 'invalid_json' }, cors)
      return
    }
    if (body.action !== 'purge') {
      sendJson(res, 400, { error: 'unknown_action' }, cors)
      return
    }

    // ① 鉴权：离线验签拿 uid（fail-closed）
    const auth = await verifyCbToken(req.headers.authorization, { envId: ENV_ID })
    if (!auth.ok) {
      sendJson(res, 401, { error: 'unauthorized' }, cors)
      return
    }
    const uid = auth.uid

    const app = getApp()
    const db = app.rdb()

    // ② 先取图片路径（purge 会删掉 groups，路径就找不回来了）
    let imagePaths = []
    try {
      const r = await db.rpc('list_user_image_paths', { p_uid: uid })
      if (!r.error && Array.isArray(r.data)) imagePaths = r.data.filter((p) => typeof p === 'string' && p)
    } catch (e) {
      console.error('[account] list_user_image_paths failed:', e)
      // 不阻断：PG 数据必须删，图片可后补
    }

    // ③ 删对象存储图片
    let imagesDeleted = 0
    if (imagePaths.length > 0) {
      try {
        const fileList = imagePaths.map((p) => `cloud://${ENV_ID}.${IMAGES_BUCKET}/${p}`)
        const del = await app.deleteFile({ fileList })
        const list = (del && (del.fileList || (del.data && del.data.fileList))) || []
        imagesDeleted = list.filter((f) => f && (f.code === 0 || f.code === '0' || f.status === 'ok')).length
      } catch (e) {
        console.error('[account] deleteFile failed:', e)
        // 失败不谎报：图片删除结果为 0，由运维补删
      }
    }

    // ④ 删 PG 数据
    const purge = await db.rpc('purge_user_data', { p_uid: uid })
    if (purge.error) {
      console.error('[account] purge_user_data failed:', purge.error)
      sendJson(res, 503, { error: 'temporarily_unavailable' }, cors)
      return
    }

    sendJson(
      res,
      200,
      {
        ok: true,
        dataDeleted: purge.data && purge.data.ok === true,
        imagesDeleted,
        imagesPending: Math.max(0, imagePaths.length - imagesDeleted),
        // 账号本身由运营方人工核验后删除（云函数无管理密钥）
        accountPendingDeletion: true,
      },
      cors,
    )
  } catch (e) {
    console.error('[account] unhandled:', e)
    sendJson(res, 500, { error: 'internal_error' }, cors)
  }
})

const PORT = Number(process.env.PORT) || 9000
server.listen(PORT, () => {
  console.log('[account] listening on :' + PORT)
})
