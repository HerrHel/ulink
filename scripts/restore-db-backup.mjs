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
 * 事务性（#15）：生成的文件是唯一一对 BEGIN/COMMIT 包住的**整批单事务**。--apply 仅在
 * 整份能一次调用提交时自动执行；大备份（受 ExecutePGSql ~10KB/批限制）不会拆成多个
 * 独立事务（那会让首批 DELETE 先提交、后续失败即清库），而是预检后拒绝自动执行、引导
 * 人工单一事务执行该文件，保证任一失败整体回滚、不留 DELETE 已提交状态。
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

// 快照校验（#16）：既要遍历快照里实有的表，也要反向核对 ORDER 全集。
// 旧版只 for (const t of Object.keys(tables))，缺表会被下面 .filter(present.has) 静默跳过：
// 那张表既没 DELETE 也没 INSERT，恢复后停留在「当前时点」，其余表却已回滚到备份时点，
// 造成跨时点不一致，脚本仍打印「恢复执行完成」。因此缺表一律计入 skipped 并拒绝生成/执行。
// 注：ORDER 是业务表全集；若某张表是后加的、旧备份早于它，则该备份同样被拒绝——
// 宁可拒绝，也不能把「部分表当前、部分表历史」的混合库当成成功恢复。
// 未知表/非数组/row_counts 行数不符一并计入 skipped，打印实际表数而非硬编码 ORDER.length。
const known = new Set(ORDER)
const present = new Set(Object.keys(tables))
const rowCounts = snapshot.row_counts
const skipped = []
for (const t of Object.keys(tables)) {
  if (!known.has(t)) { skipped.push(`未知表 ${t}`); continue }
  if (!Array.isArray(tables[t])) { skipped.push(`非数组 ${t}`); continue }
}
// #16 核心：ORDER 每张表都必须在快照里出现，缺一即拒绝
for (const t of ORDER) {
  if (!present.has(t)) skipped.push(`缺表 ${t}（ORDER 全集要求，快照缺失会导致跨时点不一致）`)
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

// DELETE 逆序（子表先删，避免违反外键）、INSERT 正序（父表先插）。
// 上面的 #16 校验已保证 ORDER 全集都在快照里，故 .filter(present.has) 此时是恒真的防御式写法，
// 不会再静默跳过任何缺表；保留它是为了在校验被误改后仍不逐出多余表。
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

  // ── #15 灾难恢复的事务性保证 ──
  // ExecutePGSql / `tcb db execute` 单批约 10KB，无法把大备份塞进一次调用。
  // 旧版对 >9KB 备份按表切批、每批独立 BEGIN/COMMIT：首批 DELETE 一旦提交，后续
  // INSERT 批失败脚本即 exit(1)，库被清空且没有自动回滚 —— 灾难恢复反而清库。
  //
  // 修复口径：上方 lines 已把**所有** statements 包进 fullSql 的**唯一一对** BEGIN/COMMIT，
  // 这份文件本身就是「整批单事务」。--apply 因此只在「整份 SQL 能作为一次调用提交」时
  // 才自动执行；大备份**绝不再拆成多个独立事务**（tcb 每次 db execute 是独立连接/会话，
  // BEGIN 无法跨调用延续），而是在执行前做一次完整预检后拒绝自动执行，明确引导人工把
  // 这一份单一事务 SQL 文件整体执行。如此任一语句失败都不会留下「DELETE 已提交」状态：
  // PG 单事务内遇错会把后续 COMMIT 变成 ROLLBACK，整批回滚。
  // 默认「仅生成 SQL」模式完全不受影响，生成的文件内容与改动前一致。
  const MAX_SINGLE_TX_BYTES = 9 * 1024 // 留余量，低于 ExecutePGSql ~10KB 限制
  const sqlBytes = Buffer.byteLength(fullSql, 'utf8')

  /** 执行前完整预检：确认产物是且仅是「一个完整事务」，绝不在中途夹带 ROLLBACK/额外 COMMIT */
  function preflightSingleTx(sql) {
    const meaningful = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'))
    const begins = meaningful.filter((l) => /^BEGIN\s*;/i.test(l)).length
    const commits = meaningful.filter((l) => /^COMMIT\s*;/i.test(l)).length
    const rollbacks = meaningful.filter((l) => /^ROLLBACK\s*;/i.test(l)).length
    const wraps = begins === 1 && commits === 1 && rollbacks === 0
      && meaningful[0] === 'BEGIN;' && meaningful[meaningful.length - 1] === 'COMMIT;'
    if (!wraps) {
      console.error(`✖ 预检失败：生成的 SQL 不是单一完整事务（BEGIN=${begins} COMMIT=${commits} ROLLBACK=${rollbacks}，首=${meaningful[0]} 尾=${meaningful[meaningful.length - 1]}）`)
      process.exit(1)
    }
    return statements.length
  }

  const stmtCount = preflightSingleTx(fullSql) // 无论走哪条路径，执行前都先完整预检

  if (sqlBytes > MAX_SINGLE_TX_BYTES) {
    console.error(`✖ 备份 ${sqlBytes} 字节，超过单次调用上限 ${MAX_SINGLE_TX_BYTES} 字节`)
    console.error('  --apply 不会自动分批执行大备份：那会退化成多个独立事务、重新引入清库风险。')
    console.error('  唯一一份单事务 SQL 已生成，请用支持多语句单事务的客户端整体执行（勿拆分）：')
    console.error(`    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "${outPath}"`)
    console.error('  （或在数据库控制台一次粘贴整份文件，确保 BEGIN…COMMIT 在同一事务提交；')
    console.error('   任一语句报错即整体 ROLLBACK，不会留下 DELETE 已提交的状态。）')
    console.error(`  预检通过：${stmtCount} 条语句，仅含一对 BEGIN/COMMIT。`)
    process.exit(1)
  }

  // 小备份：整份 fullSql 即 BEGIN; … COMMIT;，一次调用原子提交。
  // runSqlChecked 在 execFileSync 抛错或返回错误标记时 exit(1)；单事务下失败不会提交任何 DELETE。
  console.log('→ 整份 SQL 在单个事务内一次执行（BEGIN … COMMIT），任一语句失败则整体回滚')
  runSqlChecked(fullSql, '完整恢复（单事务）')
  console.log('✔ 恢复执行完成（单一事务已提交并经错误标记校验）')
} else {
  console.log('  仅生成 SQL 文件；如确认要执行，追加 --apply --yes（会先打印警告）')
}
