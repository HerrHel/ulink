#!/usr/bin/env node
/**
 * restore-db-backup —— 从 db_backup 表生成数据库恢复 SQL（默认只生成，不执行）
 *
 * 背景：CloudBase 个人版 PG 跑在共享集群，平台备份不可用（控制台提示
 * 「当前共享集群暂不提供相关能力」）。maintenance 每日调用 fn_create_db_backup
 * 把全部业务表快照写入 db_backup 表（保留 30 天）。本脚本负责把快照还原成 SQL：
 *
 *   node scripts/restore-db-backup.mjs                       # 用最新备份，生成 SQL
 *   node scripts/restore-db-backup.mjs --day 2026-11-03       # 指定日期
 *   node scripts/restore-db-backup.mjs --apply --yes          # 生成并直接执行（危险，须显式 --yes）
 *
 * 安全设计：默认**只生成文件**，产物在 outputs/restore-<day>.sql，人工审阅后再执行；
 * --apply 必须同时显式传 --yes 并先打印不可逆警告，否则拒绝执行。
 * 恢复语义：对每张表先 DELETE 再 INSERT（不是 DROP，保留表结构与 RLS 策略）；
 * DELETE 段集中在所有 INSERT 之前，DELETE 逆序、INSERT 正序以避开外键。
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
// --apply 是破坏性操作，必须显式 --yes 才真正执行；默认只生成 SQL 文件
const yes = args.includes('--yes')

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

// tcb db execute 失败可能仍以 0 退出、把错误塞进 --json 输出；这些标记一律判失败
const SQL_ERROR_RE = /\b(?:ERROR|FATAL|PANIC)\s*:|"(?:error|errMsg|errmsg|Error)"\s*:\s*(?:"[^"]+"|\{|\[|true|\d+)|"(?:code|message)"\s*:\s*"[^"]*(?:fail|error|denied|invalid|violat|timeout|syntax|rollback|exception|refused)[^"]*"|\b(?:permission denied|syntax error|violates (?:foreign key|unique|check|not-null)|does not exist|deadlock detected|current transaction is aborted|ROLLBACK|FAILED|connection (?:refused|reset))\b/i

/** 检查一批 SQL 的返回内容：带错误标记即失败并退出 1（旧版不检查，打印成功 exit 0） */
function assertSqlOk(out, label) {
  const text = String(out || '')
  if (SQL_ERROR_RE.test(text)) {
    console.error(`✖ ${label} 返回错误标记，恢复中止：\n${text.slice(-1000)}`)
    process.exit(1)
  }
}

/** 执行一批 SQL 并逐批校验：execFileSync 抛错或返回含错误标记都退出 1 */
function runSqlChecked(sql, label) {
  let out
  try {
    out = runSql(sql)
  } catch (e) {
    const detail = String((e && (e.stdout || e.stderr)) || (e && e.message) || e).slice(-1000)
    console.error(`✖ ${label} 执行异常，恢复中止：${detail}`)
    process.exit(1)
  }
  assertSqlOk(out, label)
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

// 外键依赖顺序：被依赖（父表）在前、依赖方（子表）在后，供 INSERT 正序使用
const ORDER = [
  'plans', 'categories', 'sibling_groups', 'bookmarks', 'custom_attributes',
  'public_category_shares', 'user_security', 'entitlements', 'usage_ledger',
  'orders', 'feedback_messages', 'error_logs', 'link_check_history',
  'data_history', 'deleted_item_graveyard', 'legacy_identity_map', 'audit_log',
]
// GENERATED ALWAYS AS IDENTITY：显式写 id 的 INSERT 必须带 OVERRIDING SYSTEM VALUE
const IDENTITY_ALWAYS = new Set(['audit_log'])
// BIGSERIAL / identity 表：补显式 id 后必须把序列推进到 max(id)，否则后续自增撞主键
const SEQUENCE_ID_TABLES = ['data_history', 'usage_ledger', 'error_logs', 'audit_log']

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

// 快照校验：遍历 Object.keys(snapshot.tables)（不再遍历 ORDER 后静默 continue）；
// 未知表/非数组/row_counts 行数不符全部计入 skipped 并报错退出，且打印实际表数而非硬编码 ORDER.length
const known = new Set(ORDER)
const present = new Set(Object.keys(tables))
const rowCounts = snapshot.row_counts
const skipped = []
for (const t of Object.keys(tables)) {
  if (!known.has(t)) { skipped.push(`未知表 ${t}`); continue }
  if (!Array.isArray(tables[t])) { skipped.push(`非数组 ${t}`); continue }
}
// 校验 snapshot.row_counts（若存在）与实际行数一致
if (rowCounts && typeof rowCounts === 'object') {
  for (const t of Object.keys(rowCounts)) {
    const declared = Number(rowCounts[t])
    const actual = Array.isArray(tables[t]) ? tables[t].length : null
    if (actual === null || declared !== actual) {
      skipped.push(`行数不符 ${t}: 声明 ${declared} 实际 ${actual ?? '(缺失)'}`)
    }
  }
}
if (skipped.length) {
  console.error('✖ 快照校验失败，未生成/执行任何 SQL：')
  for (const s of skipped) console.error('  - ' + s)
  process.exit(1)
}

// DELETE 逆序（子表先删，避免违反外键）、INSERT 正序（父表先插）；只处理快照里实有的表
const deleteOrder = ORDER.slice().reverse().filter((t) => present.has(t))
const insertOrder = ORDER.filter((t) => present.has(t))

// 语句按「DELETE 段 → INSERT 段 → setval 段」排列，保证 DELETE 段全部位于 INSERT 段之前
const statements = [] // { sql, table }
let totalRows = 0
for (const t of deleteOrder) {
  statements.push({ sql: `DELETE FROM public.${t};`, table: 'DELETE' })
}
for (const t of insertOrder) {
  const data = tables[t]
  if (!data.length) continue
  const cols = Object.keys(data[0])
  const colList = cols.map((c) => `"${c}"`).join(', ')
  const overriding = IDENTITY_ALWAYS.has(t) ? ' OVERRIDING SYSTEM VALUE' : ''
  for (const rec of data) {
    statements.push({
      sql: `INSERT INTO public.${t} (${colList})${overriding} VALUES (${cols.map((c) => esc(rec[c])).join(', ')});`,
      table: `INSERT ${t}`,
    })
    totalRows += 1
  }
}
// 末尾对所有 BIGSERIAL/identity 表重置序列到 max(id)
for (const t of SEQUENCE_ID_TABLES) {
  statements.push({
    sql: `SELECT setval(pg_get_serial_sequence('public.${t}','id'), COALESCE((SELECT max(id) FROM public.${t}),1));`,
    table: 'setval',
  })
}

// 生成的 SQL 文件：完整单事务，含 BEGIN/COMMIT（供人工审阅/一次性执行）
const lines = [
  `-- 由 restore-db-backup 生成于 ${new Date().toISOString()}`,
  `-- 备份日期：${backupDay}（${snapshot.exported_at}），大小 ${rec.bytes ?? '?'} 字节`,
  '-- 语义：先 DELETE 再 INSERT，保留表结构、索引与 RLS 策略',
  '-- DELETE 段（逆序、子表先删）全部位于 INSERT 段（正序、父表先插）之前',
  'BEGIN;',
  ...statements.map((s) => s.sql),
  'COMMIT;',
]
const fullSql = lines.join('\n')

mkdirSync('outputs', { recursive: true })
const outPath = resolve('outputs', `restore-${backupDay}.sql`)
writeFileSync(outPath, fullSql + '\n', 'utf8')
console.log(`✔ 已生成 ${outPath}`)
console.log(`  备份日期 ${backupDay}，共 ${totalRows} 行 / ${insertOrder.length} 张表（实际表数，非硬编码）`)

if (apply) {
  // 破坏性操作：先打印不可逆警告，并强制要求显式 --yes；否则只生成文件、拒绝执行
  console.log('⚠⚠ --apply：即将清空并重建全部业务表数据，此操作不可逆！')
  console.log(`⚠⚠ 请先确认已导出当前数据、并已审阅 ${outPath}`)
  if (!yes) {
    console.error('✖ --apply 必须同时显式传入 --yes 才可执行（默认只生成 SQL 文件）')
    process.exit(1)
  }

  // tcb db execute 单批约 10KB；大备份按表切批（每批 ~9KB），每批自带 BEGIN/COMMIT
  // 各批独立事务，避免旧版那样 BEGIN 无 COMMIT 被连接关闭静默回滚；小备份直接执行完整 SQL
  const MAX_BATCH_BYTES = 9 * 1024
  const WRAP_BYTES = Buffer.byteLength('BEGIN;\n\nCOMMIT;', 'utf8')
  const batches = []
  if (Buffer.byteLength(fullSql, 'utf8') <= MAX_BATCH_BYTES) {
    batches.push({ label: `完整 SQL（单事务，${totalRows} 行）`, sql: fullSql })
  } else {
    let cur = []
    let curBytes = 0
    let curTable = ''
    const flush = () => {
      if (!cur.length) return
      batches.push({ label: curTable, sql: 'BEGIN;\n' + cur.join('\n') + '\nCOMMIT;' })
      cur = []
      curBytes = 0
    }
    for (const s of statements) {
      const b = Buffer.byteLength(s.sql, 'utf8') + 1
      // 换表或累计超过 ~9KB 就切批（按表分批）
      if (cur.length && (s.table !== curTable || curBytes + b + WRAP_BYTES > MAX_BATCH_BYTES)) flush()
      curTable = s.table
      cur.push(s.sql)
      curBytes += b
    }
    flush()
  }

  console.log(`→ 共 ${batches.length} 批，逐批执行并校验返回…`)
  for (let i = 0; i < batches.length; i++) {
    console.log(`  [${i + 1}/${batches.length}] ${batches[i].label}`)
    runSqlChecked(batches[i].sql, `第 ${i + 1} 批 ${batches[i].label}`)
  }
  console.log('✔ 恢复执行完成（各批均含 BEGIN/COMMIT 且已校验无错误标记）')
} else {
  console.log('  仅生成 SQL 文件；如确认要执行，追加 --apply --yes（会先打印警告）')
}
