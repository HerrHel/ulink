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
 *   node scripts/restore-db-backup.mjs --apply --dry-run      # 恢复演练：真跑全部语句后强制回滚
 *   node scripts/restore-db-backup.mjs --self-test            # 只验证分片执行链路（临时表）
 *
 * 安全设计：默认**只生成文件**，产物在 outputs/restore-<day>.sql，人工审阅后再执行；
 * --apply 必须同时显式传 --yes 并先打印不可逆警告，否则拒绝执行。
 * 恢复语义：对每张表先 DELETE 再 INSERT（不是 DROP，保留表结构与 RLS 策略）；
 * DELETE 段集中在所有 INSERT 之前，DELETE 逆序、INSERT 正序以避开外键。
 * 事务性（#15）：生成的文件是唯一一对 BEGIN/COMMIT 包住的**整批单事务**。
 *
 * --apply 在 2026-11-14 之后可以安全执行任意大小的备份，机制是「分片暂存 + 单语句执行」：
 *   1. 建一张临时表 _restore_<tag>(id, stmt)，把每条语句按 ≤8KB 的批 INSERT 进去
 *      （绕过 ExecutePGSql ~10KB/批的限制，但只写暂存表，不碰业务数据）；
 *   2. 用**一条** DO 块（body 固定几百字节）循环 `EXECUTE r.stmt` 逐条执行全部语句，
 *      全部都在这一条语句隐含的**同一个事务**里完成；
 *   3. 任一条失败 → DO 块抛异常 → 整条语句回滚 → DELETE 也不会提交；
 *   4. 成功后才 DROP 暂存表。
 * 这样既不受单批 10KB 限制，又保住了「全有或全无」，不再需要人工 psql。
 *
 * 自检：`--self-test` 会针对临时表跑一遍「全成功」与「中途失败必回滚」两个用例，
 * 只碰 _restore_selftest 表，可随时执行，用于验证分片执行链路本身没坏。
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
// --dry-run：配合 --apply 做一次「真执行 + 强制回滚」的恢复演练，不改动任何数据
const dryRun = args.includes('--dry-run')
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

/** 执行并校验，失败时**抛出**（供需要收尾清理的调用点使用） */
function runSqlStrict(sql, label) {
  let out
  try {
    out = runSql(sql)
  } catch (e) {
    const detail = String((e && (e.stdout || e.stderr)) || (e && e.message) || e).slice(-1000)
    throw new Error(`${label} 执行异常，恢复中止：${detail}`)
  }
  const text = String(out || '')
  if (SQL_ERROR_RE.test(text)) {
    throw new Error(`${label} 返回错误标记，恢复中止：${text.slice(-800)}`)
  }
  return out
}

/** 执行一批 SQL 并逐批校验：execFileSync 抛错或返回含错误标记都退出 1 */
function runSqlChecked(sql, label) {
  try {
    return runSqlStrict(sql, label)
  } catch (e) {
    console.error(`✖ ${e.message}`)
    process.exit(1)
  }
}

/** 取单值（Rows 元素是 JSON 数组字符串） */
function scalar(sql) {
  const rows = extractRows(runSql(sql))
  return rows.length ? rows[0][0] : null
}

// ── #15 分片暂存 + 单语句单事务执行 ──────────────────────────────────────────
// ExecutePGSql 单批约 10KB，但「分批执行」会退化成多个独立事务（首批 DELETE 提交后
// 后续失败即清库）。折中办法：把语句**切成 ≤6KB 的文本片**写入暂存表（只写暂存表，
// 不碰业务数据），再用**一条** DO 块在这条语句隐含的同一个事务里，把同一 grp 的片
// 拼回完整语句后逐条 EXECUTE。任一条失败 → 抛异常 → 整条语句回滚 → DELETE 也不会提交。
//
// 为什么必须支持「单条语句跨片」：实测真实备份里存在 11KB 的单条 INSERT
// （某条书签的笔记很长），按语句粒度分片会直接卡住 —— 这是 dry-run 演练当场抓到的。
const CHUNK_BYTES = 8 * 1024 // 单次 staging INSERT 的载荷预算，远低于 ~10KB 上限
const PART_BYTES = 6 * 1024 // 单片文本上限，给美元引用标记与列开销留余量

function makeTag() {
  return 'r' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}

/** 按 UTF-8 字节把文本切成若干片（只在字符边界切，不会切断多字节字符） */
function splitByBytes(text, maxBytes) {
  const parts = []
  let cur = ''
  let curBytes = 0
  for (const ch of text) {
    const b = Buffer.byteLength(ch, 'utf8')
    if (curBytes + b > maxBytes && cur) {
      parts.push(cur)
      cur = ''
      curBytes = 0
    }
    cur += ch
    curBytes += b
  }
  if (cur) parts.push(cur)
  return parts
}

/** 清理上次中途被杀可能留下的暂存表（只匹配本脚本的命名空间） */
function sweepStaleStages() {
  runSqlStrict(`DO $do$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '\\_restore\\_%' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I', r.tablename);
  END LOOP;
END $do$;`, '清理遗留暂存表')
}

/**
 * 把 stmtList 全部语句放在**同一个事务**里执行。
 * @param {string[]} stmtList 已去掉 BEGIN/COMMIT 的裸语句
 * @param {string} label 日志标签
 * @param {{ expectFail?: boolean, onError?: (msg: string) => void }} [opts] expectFail=true 时失败不退出，返回 false（供自检/演练用）
 */
function execStagedInOneTx(stmtList, label, opts = {}) {
  const expectFail = opts.expectFail === true
  if (!stmtList.length) {
    if (expectFail) return false
    console.error(`✖ ${label}：没有可执行语句`)
    process.exit(1)
  }
  const tag = makeTag()
  const stage = `_restore_${tag}`
  const lit = (s) => `$${tag}$${s}$${tag}$`
  // 语句内容若恰好包含本轮的美元引用标记，会被提前终止 → 极罕见，直接换一轮
  if (stmtList.some((s) => s.includes(`$${tag}$`))) {
    if (expectFail) return false
    console.error('✖ 语句内容与分片标记冲突（极罕见），请重跑')
    process.exit(1)
  }
  // 语句 → 文本片：grp 标识属于第几条语句（1 起），seq 是片内顺序
  const parts = []
  stmtList.forEach((s, i) => {
    splitByBytes(s, PART_BYTES).forEach((p, j) => parts.push({ grp: i + 1, seq: j + 1, part: p }))
  })
  // 打包：每批一次 INSERT，载荷不超过 CHUNK_BYTES
  const overhead = Buffer.byteLength(lit(''), 'utf8') + 8
  const batches = []
  let cur = []
  let curBytes = 0
  for (const p of parts) {
    const b = Buffer.byteLength(p.part, 'utf8') + overhead
    if (cur.length && curBytes + b > CHUNK_BYTES) {
      batches.push(cur)
      cur = []
      curBytes = 0
    }
    cur.push(p)
    curBytes += b
  }
  if (cur.length) batches.push(cur)
  let created = false
  try {
    runSqlStrict(
      `CREATE TABLE public.${stage} (grp int NOT NULL, seq int NOT NULL, part text NOT NULL, PRIMARY KEY (grp, seq));`,
      '建暂存表',
    )
    created = true
    batches.forEach((batch, i) => {
      const values = batch.map((p) => `(${p.grp}, ${p.seq}, ${lit(p.part)})`).join(',\n')
      runSqlStrict(
        `INSERT INTO public.${stage} (grp, seq, part) VALUES ${values};`,
        `暂存第 ${i + 1}/${batches.length} 批（${batch.length} 片）`,
      )
    })
    console.log(`→ ${stmtList.length} 条语句切成 ${parts.length} 片、分 ${batches.length} 批暂存，开始单事务执行…`)
    // 关键：整个循环是一条 DO 语句 = 一个事务。同 grp 的片先拼回完整语句，再 EXECUTE。
    // 内层 BEGIN/EXCEPTION 只为在报错时带上「第几条语句 + SQL 前缀」，便于定位；
    // 捕获后立即重新抛出，事务照样整体回滚（不会吞掉错误继续跑）。
    const doBlock = `DO $do$
DECLARE s text; g int; r record; n int := 0;
BEGIN
  FOR g IN SELECT DISTINCT grp FROM public.${stage} ORDER BY grp LOOP
    s := '';
    FOR r IN SELECT part FROM public.${stage} WHERE grp = g ORDER BY seq LOOP
      s := s || r.part;
    END LOOP;
    BEGIN
      EXECUTE s;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'restore stmt #% : %', g, SQLERRM;
    END;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'restore: staged statement set is empty'; END IF;
END
$do$;`
    runSqlStrict(doBlock, '单事务逐条执行')
    console.log(`✔ 单事务已提交（${stmtList.length} 条语句）`)
  } catch (e) {
    if (created) {
      try { runSqlStrict(`DROP TABLE IF EXISTS public.${stage};`, '清理暂存表') } catch { /* 下面会有提示 */ }
    }
    if (expectFail) {
      if (typeof opts.onError === 'function') opts.onError(e.message)
      console.log(`✔ 预期内失败（已回滚）：${e.message.slice(0, 200)}`)
      return false
    }
    console.error(`✖ ${label} 失败，整批已回滚：${e.message}`)
    process.exit(1)
  }
  try {
    runSqlStrict(`DROP TABLE IF EXISTS public.${stage};`, '清理暂存表')
  } catch {
    console.error(`⚠ 暂存表 public.${stage} 未能删除，请手工 DROP（不影响数据正确性）`)
  }
  return true
}

/** 自检：验证分片执行链路本身（只碰 _restore_selftest 表） */
function runSelfTest() {
  const T = 'public._restore_selftest'
  const cleanup = () => runSqlChecked(`DROP TABLE IF EXISTS ${T};`, '自检清理')
  sweepStaleStages()
  cleanup()

  console.log('▶ 自检 1/3：全部成功 → 数据应提交')
  const ok = execStagedInOneTx([
    `CREATE TABLE ${T} (a int PRIMARY KEY);`,
    `INSERT INTO ${T} (a) VALUES (1);`,
    `INSERT INTO ${T} (a) VALUES (2);`,
    `INSERT INTO ${T} (a) VALUES (3);`,
  ], '自检-成功用例')
  if (!ok) {
    console.error('✖ 自检 1 失败：应成功却失败')
    process.exit(1)
  }
  const got = String(scalar(`SELECT count(*) FROM ${T};`))
  if (got !== '3') {
    console.error(`✖ 自检 1 失败：期望 3 行，实际 ${got}`)
    process.exit(1)
  }
  console.log('✔ 自检 1 通过（3 行已提交）')
  cleanup()

  console.log('▶ 自检 2/3：中途失败 → 整批必须回滚（连 CREATE 也要撤销）')
  const failed = execStagedInOneTx([
    `CREATE TABLE ${T} (a int PRIMARY KEY);`,
    `INSERT INTO ${T} (a) VALUES (1);`,
    `INSERT INTO ${T} (a) VALUES (2);`,
    `INSERT INTO ${T} (a) VALUES (1);`, // 主键冲突：必须让整批回滚
  ], '自检-失败用例', { expectFail: true })
  if (failed) {
    console.error('✖ 自检 2 失败：主键冲突的批次竟然成功了')
    process.exit(1)
  }
  const stillThere = String(scalar(`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = '_restore_selftest';`))
  if (stillThere !== '0') {
    console.error(`✖ 自检 2 失败：失败后表仍留在库里（回滚不彻底）`)
    cleanup()
    process.exit(1)
  }
  const leftovers = String(scalar(`SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '\\_restore\\_%';`))
  console.log(`✔ 自检 2 通过（失败批次已整体回滚，残留暂存表 ${leftovers} 张）`)
  cleanup()

  // 自检 3：跨多批 + 单条语句跨片。真实备份里存在 11KB 的单条 INSERT（长笔记），
  // 必须证明「大 payload」与「单条语句超单片上限」两种情况都能正确还原。
  console.log('▶ 自检 3/3：大payload 跨多批 + 单条语句跨片 → 应全部提交且行数一致')
  const N = 800
  const pad = 'x'.repeat(200)
  const bulk = [`CREATE TABLE ${T} (a int PRIMARY KEY, pad text);`]
  for (let i = 1; i <= N; i++) bulk.push(`INSERT INTO ${T} (a, pad) VALUES (${i}, '${pad}');`)
  // 单条 20KB（远超 PART_BYTES）→ 必须被切成多片再拼回
  bulk.push(`INSERT INTO ${T} (a, pad) VALUES (${N + 1}, '${'y'.repeat(20000)}');`)
  const bytes = bulk.reduce((n, s) => n + Buffer.byteLength(s, 'utf8'), 0)
  console.log(`  构造 ${bulk.length} 条语句 / ${(bytes / 1024).toFixed(0)}KB（约 ${Math.ceil(bytes / CHUNK_BYTES)} 批）`)
  execStagedInOneTx(bulk, '自检-多批用例')
  const bulkGot = String(scalar(`SELECT count(*) FROM ${T};`))
  if (bulkGot !== String(N + 1)) {
    console.error(`✖ 自检 3 失败：期望 ${N + 1} 行，实际 ${bulkGot}`)
    process.exit(1)
  }
  // 单条 20KB 语句若被切坏，长度会变 → 用 length 精确校验拼回结果与原串一致
  const bigLen = String(scalar(`SELECT length(pad) FROM ${T} WHERE a = ${N + 1};`))
  if (bigLen !== '20000') {
    console.error(`✖ 自检 3 失败：跨片语句拼回后长度 ${bigLen}，期望 20000（分片拼接有损）`)
    process.exit(1)
  }
  console.log(`✔ 自检 3 通过（${(bytes / 1024).toFixed(0)}KB / ${Math.ceil(bytes / CHUNK_BYTES)} 批一次事务提交）`)
  cleanup()
  console.log('✔ 自检全部通过：分片暂存 + 单事务执行 + 失败回滚 + 跨批大payload 均正常')
}

// 自检模式：只验证分片执行链路，不读取也不改动任何业务数据
if (args.includes('--self-test')) {
  runSelfTest()
  process.exit(0)
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

// jsonb 列必须显式 `::jsonb` 且按 JSON 文本编码 —— 直接把字符串字面量赋给 jsonb 会报
// `invalid input syntax for type json`（22P02）。实测踩到：bookmarks.password 是 jsonb，
// 空值在快照里是 ''，旧 esc 生成 `''` → 整批恢复在半路失败（dry-run 演练抓到的）。
// 列类型从库里现查，避免硬编码漂移（当前 14 个 jsonb 列，散在 8 张表）。
const JSONB_COLS = new Map()
{
  const rows = extractRows(runSql(
    `SELECT table_name, string_agg(column_name, ',') AS cols FROM information_schema.columns ` +
    `WHERE table_schema = 'public' AND data_type IN ('jsonb', 'json') GROUP BY table_name`,
  ))
  for (const r of rows) JSONB_COLS.set(String(r[0]), new Set(String(r[1]).split(',')))
  if (!JSONB_COLS.size) {
    console.error('✖ 无法读取列类型（information_schema 查询为空），拒绝生成 SQL：jsonb 列会被错误编码')
    process.exit(1)
  }
}

const sqlQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

/** 按目标列类型编码值；jsonb 走 JSON 文本 + 显式转换 */
const esc = (table, col, v) => {
  if (v === null || v === undefined) return 'NULL'
  const jsonCols = JSONB_COLS.get(table)
  if (jsonCols && jsonCols.has(col)) return `${sqlQuote(JSON.stringify(v))}::jsonb`
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'object') return `${sqlQuote(JSON.stringify(v))}::jsonb`
  return sqlQuote(v)
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
      sql: `INSERT INTO public.${t} (${colList})${overriding} VALUES (${cols.map((c) => esc(t, c, rec[c])).join(', ')});`,
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

  // ── #15 灾难恢复的事务性保证 ──
  // ExecutePGSql 单批约 10KB，但「按表分批 + 每批独立事务」会让首批 DELETE 先提交，
  // 后续 INSERT 失败即清库。现在改为：语句先写入暂存表（只写暂存表，不碰业务数据），
  // 再用**一条** DO 块在同一事务里逐条 EXECUTE —— 既绕过 10KB 限制，又保持全有或全无。
  // 生成的文件（fullSql）仍是人工审阅 / psql 回放用的单一事务版本，语义不变。
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

  // ── 演练模式：真跑全部语句，末尾强制抛错 → 整批回滚，数据零变化 ──
  // 灾难恢复路径不演练等于没有：这条分支用真实备份的每一条语句压一遍链路，
  // 但以 RAISE EXCEPTION 收尾，任何语法/约束/顺序错误都会在真正 --apply 之前暴露。
  if (dryRun) {
    const before = {}
    for (const t of insertOrder) before[t] = String(scalar(`SELECT count(*) FROM public.${t};`))
    console.log(`▶ 恢复演练：${stmtCount} 条语句全部真实执行，末尾强制回滚（不改动任何数据）`)
    sweepStaleStages()
    let lastErr = ''
    const ended = execStagedInOneTx(
      [...statements.map((s) => s.sql), `DO $dr$ BEGIN RAISE EXCEPTION 'dry-run drill finished, roll back'; END $dr$;`],
      '恢复演练',
      { expectFail: true, onError: (m) => { lastErr = String(m || '') } },
    )
    if (ended) {
      console.error('✖ 演练失败：末尾的强制抛错没有生效（事务未按预期回滚），请立即人工检查数据')
      process.exit(1)
    }
    // 必须确认失败原因就是「末尾那一抛」，否则说明恢复链路本身有缺陷
    // （曾经真实发生过：jsonb 字面量不合法导致第 N 条语句失败，被误判成演练通过）
    if (!/dry-run drill finished, roll back/.test(lastErr)) {
      console.error('✖ 演练失败：恢复 SQL 自身执行出错，不是演练收尾的强制回滚。')
      console.error(`  实际错误：${lastErr.slice(0, 1200)}`)
      const m = lastErr.match(/stmt #(\d+)/)
      if (m) {
        const idx = Number(m[1]) - 1
        const bad = idx >= 0 && idx < statements.length ? statements[idx].sql : '(演练收尾语句)'
        console.error(`  失败语句 #${m[1]}（${Buffer.byteLength(bad, 'utf8')} 字节）：`)
        console.error('  ' + bad.slice(0, 1500).replace(/\n/g, '\n  '))
      }
      console.error('  这条路径就是灾难恢复时会走的路 —— 必须修好才能依赖备份。')
      process.exit(1)
    }
    const changed = []
    for (const t of insertOrder) {
      const after = String(scalar(`SELECT count(*) FROM public.${t};`))
      if (after !== before[t]) changed.push(`${t}: 演练前 ${before[t]} 演练后 ${after}`)
    }
    if (changed.length) {
      console.error('✖ 演练失败：强制回滚后行数发生变化（回滚不彻底）：')
      for (const c of changed) console.error('  - ' + c)
      process.exit(1)
    }
    console.log('✔ 演练通过：全部语句可执行，强制失败时整体回滚、数据零变化')
    process.exit(0)
  }

  if (!yes) {
    console.error('✖ --apply 必须同时显式传入 --yes 才可执行（默认只生成 SQL 文件；想验证而不改数据用 --dry-run）')
    process.exit(1)
  }

  // 恢复前先给「当前库」拍一张快照：万一选错日期或备份本身损坏，还有退路。
  // fn_create_db_backup 是 maintenance 每日调用的同一个函数（幂等，按 day 覆盖）。
  try {
    const raw2 = scalar('SELECT public.fn_create_db_backup(30);')
    const info = raw2 ? JSON.parse(String(raw2)) : null
    console.log(`✔ 恢复前已为当前数据创建快照${info && info.day ? `（${info.day}）` : ''}，必要时可再跑一次回退`)
  } catch (e) {
    console.error(`✖ 恢复前快照创建失败，拒绝执行恢复（没有退路）：${e.message}`)
    process.exit(1)
  }

  console.log(`→ ${stmtCount} 条语句（${sqlBytes} 字节）将分片暂存，随后在单事务内逐条执行`)
  sweepStaleStages()
  execStagedInOneTx(statements.map((s) => s.sql), '完整恢复（单事务）')

  // 恢复后逐表核对行数：与快照实际行数比对，不一致即视为恢复不完整
  const mismatched = []
  for (const t of insertOrder) {
    const expected = Array.isArray(tables[t]) ? tables[t].length : 0
    const actual = Number(scalar(`SELECT count(*) FROM public.${t};`))
    if (actual !== expected) mismatched.push(`${t}: 期望 ${expected} 实际 ${actual}`)
  }
  if (mismatched.length) {
    console.error('✖ 恢复后行数核对不一致（数据已提交，请人工检查）：')
    for (const m of mismatched) console.error('  - ' + m)
    process.exit(1)
  }
  console.log(`✔ 恢复完成并核对通过：${insertOrder.length} 张表行数与快照一致`)
} else {
  console.log('  仅生成 SQL 文件；如确认要执行，追加 --apply --yes（会先打印警告）')
}
