/**
 * maintenance — 定时维护任务（CloudBase 定时触发器 · 事件型云函数）
 *
 * 职责：清理超过保留期的错误日志（默认 365 天，对应隐私政策 §5.3 的「最长 12 个月」承诺），
 *      并可选清理回收站中的软删除数据（默认关闭，与隐私政策「不设自动过期」的表述一致）。
 *
 * 事件型函数（非 HTTP）：由 CloudBase 定时触发器调用。
 * 部署（在 cloudbase/functions/maintenance 目录内执行）：
 *   bash <tcb> fn deploy maintenance --runtime Nodejs20.19 --yes
 * 配置定时触发器：
 *   bash <tcb> fn trigger create maintenance --cron "0 3 * * *" --name daily-cleanup
 *   （UTC 每日 03:00；北京时间 11:00）
 *
 * 也支持被 HTTP 直调（便于手工验证）：
 *   curl -X POST https://<fnbase>/maintenance
 * 此时走 exports.main，由 scf_bootstrap 启动的 HTTP 服务转发。
 */

const cloudbase = require('@cloudbase/node-sdk')

const ENV_ID = process.env.CLOUDBASE_ENV_ID || ''
const API_KEY = process.env.CLOUDBASE_APIKEY || ''
/** 错误日志保留天数：365 = 12 个月 */
const ERROR_LOG_KEEP_DAYS = parseInt(process.env.ERROR_LOG_KEEP_DAYS || '365', 10)
/** 回收站自动清理天数：0 = 关闭 */
const TRASH_KEEP_DAYS = parseInt(process.env.TRASH_KEEP_DAYS || '0', 10)

async function runCleanup() {
  if (!ENV_ID || !API_KEY) {
    console.error('[maintenance] CLOUDBASE_ENV_ID / CLOUDBASE_APIKEY 未配置')
    return { ok: false, error: 'not_configured' }
  }
  const app = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })
  const db = app.rdb()
  const r = await db.rpc('cleanup_expired_data', {
    p_error_log_days: ERROR_LOG_KEEP_DAYS,
    p_trash_days: TRASH_KEEP_DAYS,
  })
  if (r.error) {
    console.error('[maintenance] cleanup_expired_data failed:', r.error)
    return { ok: false, error: String(r.error.message || r.error) }
  }
  return r.data
}

// 定时触发器入口
exports.main_handler = async (event, context) => {
  const result = await runCleanup()
  console.log('[maintenance] done:', JSON.stringify(result))
  return result
}

// 兼容 CloudBase 若干版本的 exports.main 约定
exports.main = exports.main_handler

// HTTP 直调入口（仅当以 scf_bootstrap 启动时生效）
if (require.main === module) {
  const http = require('http')
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'method_not_allowed' }))
      return
    }
    const result = await runCleanup()
    res.writeHead(result && result.ok ? 200 : 500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(result))
  })
  const PORT = Number(process.env.PORT) || 9000
  server.listen(PORT, () => console.log('[maintenance] listening on :' + PORT))
}
