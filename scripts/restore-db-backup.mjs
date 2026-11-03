#!/usr/bin/env node
/**
 * restore-db-backup —— 从 db_backup 表生成数据库恢复 SQL（默认只生成，不执行）
 *
 * 背景：CloudBase 个人版 PG 跑在共享集群，平台备份不可用（控制台提示
 * 「当前共享集群暂不提供相关能力」）。maintenance 每日调用 fn_create_db_backup
 * 把全部业务表快照写入 db_backup 表（保留 30 天）。本脚本负责把快照还原成 SQL：
 *
 *   node scripts/restore-db-backup.mjs                  # 用最新备份，生成 SQL
 *   node scripts/restore-db-backup.mjs --day 2026-11-03  # 指定日期
 *   node scripts/restore-db-backup.mjs --apply          # 生成并直接执行（危险）
 *
 * 安全设计：默认**只生成文件**，产物在 outputs/restore-<day>.sql，人工审阅后再执行。
 * 恢复语义：对每张表先 DELETE 再 INSERT（不是 DROP，保留表结构与 RLS 策略）。
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const TCB = process.env.TCB_BIN || resolve(homedir(), '.workbuddy/binaries/node/cli-connector-packages/tcb')
const ENV_ID = process.env.VITE_CLOUDBASE_ENV_ID || 'ulink-d1g5srvjo54b1886a'

const args = process.argv.slice(2)
const dayIdx = args.indexOf('--day')
const day = dayIdx >= 0 ? args[dayIdx + 1] : null
const apply = args.includes('--apply')

function runSql(sql) {
  const directJs = resolve(homedir(), '.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb')
  const executable = existsSync(directJs) ? process.execPath : 'bash'
  const argv = existsSync(directJs) ? [directJs, ...sqlArgs(), '-e', ENV_ID] : [TCB, ...sqlArgs(), '-e', ENV_ID]
  const out = execFileSync(executable, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
  return out
  function sqlArgs() {
    return ['db', 'execute', '--json', '--sql', sql]
  }
}

/** 从 tcb 输出里抠出 Rows 数组（CLI 输出混有进度行，且 Rows 元素是 JSON 字符串） */
function extractRows(out) {
  const i = out.indexOf('{')
  const parsed = JSON.parse(out.slice(i))
  const rows = parsed?.data?.Rows || []
  return rows.map((r) => (typeof r === 'string' ? JSON.parse(r) : r))
}

const where = day ? `WHERE day = '${day.replace(/'/g, '')}'` : ''
console.log(`读取备份${day ? `（${day}）` : '（最新）'}…`)
// 单列 jsonb 返回，避免依赖列顺序
const rows = extractRows(runSql(`SELECT jsonb_build_object('day', day, 'bytes', bytes, 'payload', payload) AS b FROM public.db_backup ${where} ORDER BY day DESC LIMIT 1`))
if (!rows.length) {
  console.error('✖ 没找到对应备份；可用 list_db_backups() 查看已有日期')
  process.exit(1)
}
const raw = rows[0]
const rec = Array.isArray(raw) ? JSON.parse(raw[0]) : typeof raw === 'string' ? JSON.parse(raw) : raw
const snapshot = rec.payload || {}
const backupDay = rec.day
const tables = snapshot.tables || {}

// 生成 SQL：每表先清空再插入（顺序按外键依赖从被依赖到依赖方）
const ORDER = [
  'plans', 'categories', 'sibling_groups', 'bookmarks', 'custom_attributes',
  'public_category_shares', 'user_security', 'entitlements', 'usage_ledger',
  'orders', 'feedback_messages', 'error_logs', 'link_check_history',
  'data_history', 'deleted_item_graveyard', 'legacy_identity_map', 'audit_log',
]

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

const lines = [
  `-- 由 restore-db-backup 生成于 ${new Date().toISOString()}`,
  `-- 备份日期：${backupDay}（${snapshot.exported_at}），大小 ${rec.bytes ?? '?'} 字节`,
  '-- 语义：先 DELETE 再 INSERT，保留表结构、索引与 RLS 策略',
  'BEGIN;',
]

let totalRows = 0
for (const t of ORDER) {
  const data = tables[t]
  if (!Array.isArray(data)) continue
  lines.push(`-- ${t}: ${data.length} 行`)
  lines.push(`DELETE FROM public.${t};`)
  if (!data.length) continue
  const cols = Object.keys(data[0])
  const colList = cols.map((c) => `"${c}"`).join(', ')
  for (const rec of data) {
    lines.push(`INSERT INTO public.${t} (${colList}) VALUES (${cols.map((c) => esc(rec[c])).join(', ')});`)
    totalRows += 1
  }
}
lines.push('COMMIT;')

mkdirSync('outputs', { recursive: true })
const outPath = resolve('outputs', `restore-${backupDay}.sql`)
writeFileSync(outPath, lines.join('\n') + '\n', 'utf8')
console.log(`✔ 已生成 ${outPath}`)
console.log(`  备份日期 ${backupDay}，共 ${totalRows} 行 / ${ORDER.length} 张表`)

if (apply) {
  console.log('⚠ --apply：正在执行恢复（先确认已导出当前数据）…')
  console.log(runSql(lines.slice(3, -1).join('\n')).slice(-500))
}
