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
/** 用户上传媒体临时对象保留小时数：默认 24h；处理完前端/worker 会主动删，这里兜底 */
const DEEP_MEDIA_KEEP_HOURS = parseInt(process.env.DEEP_MEDIA_KEEP_HOURS || '24', 10)
const DEEP_MEDIA_BUCKET = 'deep-media'
/**
 * 数据库备份保留天数：默认 30 天。
 * 背景：CloudBase 个人版的 PG 跑在共享集群，控制台「备份」页明确提示
 * 「当前共享集群暂不提供相关能力」（2026-11-03 核实），而安全评估报告承诺
 * 「提供云端数据备份用于取证」——故自建每日全量导出，存 deep-media 的
 * db-backup/ 前缀下，按天滚动清理。
 * 设 0 可关闭备份（不推荐：等于放弃报告里的承诺）。
 */
const DB_BACKUP_KEEP_DAYS = parseInt(process.env.DB_BACKUP_KEEP_DAYS || '30', 10)

/**
 * 数据库全量备份：一个 RPC 完成「全库导出 → 入库 → 轮转」。
 *
 * 为什么不写到云存储：CloudBase 的 PG 环境下 node-sdk 不支持 uploadFile
 * （STORAGE_NOT_SUPPORTED），且平台共享集群本身不提供备份能力。
 * 落到 db_backup 表可覆盖最常见的事故——误删/代码 bug 批量删数据，
 * 随时 SELECT payload 即可取回；保留 DB_BACKUP_KEEP_DAYS 天。
 */
async function backupDatabase(db) {
  const r = await db.rpc('fn_create_db_backup', { p_keep_days: DB_BACKUP_KEEP_DAYS })
  if (r.error) {
    throw new Error('fn_create_db_backup: ' + String(r.error.message || r.error))
  }
  return r.data
}

async function runCleanup() {
  if (!ENV_ID || !API_KEY) {
    // 未配置属部署错误：抛异常让触发器记为失败，并打 [ALERT] 便于 CLS 告警规则匹配
    throw new Error('[ALERT] [maintenance] not_configured: CLOUDBASE_ENV_ID / CLOUDBASE_APIKEY 未配置')
  }
  const app = cloudbase.init({ env: ENV_ID, accessKey: API_KEY })
  const db = app.rdb()
  const errors = []
  const result = { ok: true, deepMediaDeleted: 0, dbBackup: null }

  // 备份移到最前：函数 timeout 60s，备份放末尾容易被超时杀掉；且备份失败不能拖累后续清理。
  if (DB_BACKUP_KEEP_DAYS > 0) {
    try {
      result.dbBackup = await backupDatabase(db)
    } catch (e) {
      const msg = `db backup failed: ${(e && e.message) || e}`
      console.error('[maintenance]', msg)
      errors.push(msg)
      result.dbBackup = { ok: false, error: String((e && e.message) || e) }
    }
  }

  // 每段任务独立 try/catch：旧版首步 cleanup_expired_data 无 try/catch，抛错会让 deep-media 清理与备份全部不执行
  try {
    const r = await db.rpc('cleanup_expired_data', {
      p_error_log_days: ERROR_LOG_KEEP_DAYS,
      p_trash_days: TRASH_KEEP_DAYS,
    })
    if (r.error) {
      const msg = `cleanup_expired_data failed: ${String(r.error.message || r.error)}`
      console.error('[maintenance]', msg)
      errors.push(msg)
    } else {
      Object.assign(result, r.data || {})
    }
  } catch (e) {
    const msg = `cleanup_expired_data threw: ${(e && e.message) || e}`
    console.error('[maintenance]', msg)
    errors.push(msg)
  }

  // 兜底清理 deep-media 中用户中途关闭页面/失败残留的临时媒体（循环批次删除，防积压）
  try {
    for (let round = 0; round < 10; round++) {
      const listed = await db.rpc('list_expired_deep_media', { p_keep_hours: DEEP_MEDIA_KEEP_HOURS })
      if (listed.error) {
        const msg = `list_expired_deep_media failed: ${String(listed.error.message || listed.error)}`
        console.error('[maintenance]', msg)
        errors.push(msg)
        break
      }
      if (!Array.isArray(listed.data) || listed.data.length === 0) {
        break
      }
      const fileList = listed.data
        .filter((p) => typeof p === 'string' && p)
        .map((p) => `cloud://${ENV_ID}.${DEEP_MEDIA_BUCKET}/${p}`)
      if (fileList.length === 0) break

      const del = await app.deleteFile({ fileList })
      const results = (del && (del.fileList || (del.data && del.data.fileList))) || []
      result.deepMediaDeleted += results.filter((f) => f && (f.code === 0 || f.code === '0' || f.status === 'ok')).length

      // 若当前批次小于 200，说明已全部扫清
      if (listed.data.length < 200) break
    }
  } catch (e) {
    const msg = `deep-media cleanup failed: ${(e && e.message) || e}`
    console.error('[maintenance]', msg)
    errors.push(msg)
  }

  // 任一任务失败：写一条带 [ALERT] 前缀的明确告警日志，并抛异常让定时触发器把本次执行记录为失败
  // （旧版备份失败只 console.error 后 main_handler 仍正常 return，触发器视为成功）
  if (errors.length) {
    const alertMsg = `[ALERT] [maintenance] ${errors.length} 项维护任务失败：${errors.join(' | ')}`
    console.error(alertMsg)
    result.ok = false
    result.errors = errors
    throw new Error(alertMsg)
  }
  return result
}

// 定时触发器入口（导出名保持 main_handler 不变）
exports.main_handler = async (event, context) => {
  try {
    const result = await runCleanup()
    console.log('[maintenance] done:', JSON.stringify(result))
    return result
  } catch (e) {
    // 失败时记录 [ALERT] 并重新抛出，让定时触发器把本次执行判定为失败
    console.error(`[ALERT] [maintenance] 执行失败：${(e && e.message) || e}`)
    throw e
  }
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
    // runCleanup 失败会抛异常，HTTP 直调需捕获并返回 500（否则未处理的 rejection 会拖垮进程）
    try {
      const result = await runCleanup()
      res.writeHead(result && result.ok ? 200 : 500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
      res.end(JSON.stringify(result))
    } catch (e) {
      console.error(`[ALERT] [maintenance] HTTP 直调执行失败：${(e && e.message) || e}`)
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }))
    }
  })
  const PORT = Number(process.env.PORT) || 9000
  server.listen(PORT, () => console.log('[maintenance] listening on :' + PORT))
}
