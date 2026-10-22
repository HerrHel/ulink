/**
 * 把 Supabase 业务数据搬到 CloudBase PostgreSQL
 *
 * 导出：走 Supabase 管理 API 的 SQL 端点（POST /v1/projects/{ref}/database/query），
 *       一条 `json_agg` 就能把整表取成 JSON，不需要 Docker、不需要直连数据库密码。
 * 导入：按 CloudBase 的列清单生成 INSERT ... ON CONFLICT DO UPDATE，分批用
 *       `tcb db execute --sql` 提交。
 *
 * 用法：
 *   node scripts/migrate-supabase-data.mjs export            # 只导出到 cloudbase/data-export/
 *   node scripts/migrate-supabase-data.mjs import            # 只导入
 *   node scripts/migrate-supabase-data.mjs all               # 导出 + 导入 + 写身份映射
 *   node scripts/migrate-supabase-data.mjs all --tables=bookmarks,categories
 *
 * 刻意跳过的表（迁移后再慢慢补，不影响可用性）：
 *   data_history / error_logs / link_check_history / feedback_messages
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const ENV_DIR = resolve('cloudbase/data-export')
const CLOUDBASE_ENV = 'ulink-d1g5srvjo54b1886a'
// Windows 上 `tcb` 是 bash 包装脚本，Node 的 spawnSync 不能直接执行它，
// 必须显式交给 bash 跑（同时避免 shell:true 把 SQL 里的引号搅乱）
const TCB_BIN =
  process.env.TCB_BIN ||
  resolve(homedir(), '.workbuddy/binaries/node/cli-connector-packages/tcb')

const DEFAULT_TABLES = [
  'categories',
  'custom_attributes',
  'bookmarks',
  'sibling_groups',
  'user_security',
  'deleted_item_graveyard',
  'public_category_shares',
]

// 复合主键表 → ON CONFLICT 列组
const CONFLICT = {
  categories: 'user_id,id',
  custom_attributes: 'user_id,id',
  bookmarks: 'user_id,id',
  sibling_groups: 'user_id,id',
  user_security: 'user_id',
  deleted_item_graveyard: 'user_id,table_name,item_id',
  public_category_shares: 'id',
}

const args = process.argv.slice(2)
const phase = args[0] || 'all'
const tablesArg = args.find((a) => a.startsWith('--tables='))
const tables = tablesArg ? tablesArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_TABLES

function readDotEnv(key) {
  const raw = readFileSync(resolve('.env'), 'utf8')
  const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))
  return m ? m[1].trim() : undefined
}

const SUPABASE_TOKEN = readDotEnv('SUPABASE_ACCESS_TOKEN')
const SUPABASE_URL = readDotEnv('VITE_SUPABASE_URL')
if (!SUPABASE_TOKEN || !SUPABASE_URL) throw new Error('.env 缺少 SUPABASE_ACCESS_TOKEN / VITE_SUPABASE_URL')
const SUPABASE_REF = SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]

/** 在 Supabase 上跑 SQL，返回 JSON 行数组 */
async function supabaseQuery(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Supabase SQL ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

/** 在 CloudBase 上跑 SQL（单语句）；走 --json 拿结构化结果，避免解析 ASCII 表格 */
function cloudbaseExecute(sql) {
  let out
  try {
    out = execFileSync('bash', [TCB_BIN, 'db', 'execute', '-e', CLOUDBASE_ENV, '--json', '--sql', sql], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (e) {
    // execFileSync 的 message 只有 "Command failed"，真正的 SQL 错误在 stdout/stderr 里
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim()
    const m = detail.match(/"message":"([^"]{0,300})/)
    throw new Error(`CloudBase SQL 失败: ${m ? m[1] : detail.slice(0, 300) || e.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(out)
  } catch {
    // 个别版本会先打一行提示再输出 JSON，从第一个 { 开始截
    const i = out.indexOf('{')
    if (i < 0) throw new Error(`CloudBase 输出无法解析：${out.slice(0, 300)}`)
    parsed = JSON.parse(out.slice(i))
  }
  if (parsed.error) {
    throw new Error(`CloudBase SQL 失败: ${parsed.error.message || JSON.stringify(parsed.error).slice(0, 300)}`)
  }
  return parsed.data || {}
}

/** CloudBase 目标表的列与类型（按 ordinal 排序） */
function targetColumns(table) {
  const d = cloudbaseExecute(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position`,
  )
  const rows = (d.Rows || []).map((r) => JSON.parse(r))
  if (!rows.length) throw new Error(`拿不到 ${table} 的列清单`)
  return rows.map(([name, data_type]) => ({ name, data_type }))
}

function sqlLiteral(v, dataType) {
  if (v === null || v === undefined) return 'NULL'
  // jsonb/json 列必须写合法 JSON：空字符串要写成 ""（裸 '' 会报 22P02）
  if (dataType === 'jsonb' || dataType === 'json') {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

async function doExport() {
  if (!existsSync(ENV_DIR)) mkdirSync(ENV_DIR, { recursive: true })
  for (const t of tables) {
    const rows = await supabaseQuery(`select coalesce(json_agg(t), '[]'::json) as rows from public.${t} t`)
    const data = rows[0]?.rows ?? []
    writeFileSync(resolve(ENV_DIR, `${t}.json`), JSON.stringify(data, null, 0), 'utf8')
    console.log(`  ${t.padEnd(24)} ${data.length} 行`)
  }
  const users = await supabaseQuery(
    `select id::text as uuid, email from auth.users where email is not null order by created_at`,
  )
  writeFileSync(resolve(ENV_DIR, '_users.json'), JSON.stringify(users, null, 0), 'utf8')
  console.log(`  ${'_users'.padEnd(24)} ${users.length} 行`)
}

async function doImport() {
  for (const t of tables) {
    const path = resolve(ENV_DIR, `${t}.json`)
    if (!existsSync(path)) {
      console.log(`  ${t.padEnd(24)} 跳过（无导出文件）`)
      continue
    }
    const rows = JSON.parse(readFileSync(path, 'utf8'))
    if (!rows.length) {
      console.log(`  ${t.padEnd(24)} 无数据`)
      continue
    }
    const cols = targetColumns(t)
    // 只写导出里真实存在的列，避免 Supabase 有而 CloudBase 没有的列
    const use = cols.filter((c) => Object.prototype.hasOwnProperty.call(rows[0], c.name))
    const useNames = use.map((c) => c.name)
    const conflictCols = CONFLICT[t].split(',')
    const updateCols = useNames.filter((c) => !conflictCols.includes(c))
    // order 之类的保留字必须加引号
    const q = (c) => `"${c}"`

    // ⚠️ 实测：CloudBase 的 ExecutePGSql 对 SQL 长度有限制（约 10KB 出头就会
    // 被截断成 "unterminated quoted string" / "syntax error at end of input"）。
    // 两个应对：
    //   a) 正常行按**字符长度**攒批（不是按行数）
    //   b) 单个字段就超长的行（实例里有 base64 内联 icon，一个字段 10KB+）——
    //      先把该字段写成空串插进去，再用 `SET col = col || '片段'` 分块追加，
    //      这样任何单条 SQL 都在限制内，且内容一字不丢。
    const MAX_SQL = Number(process.env.IMPORT_MAX_SQL) || 6000
    const BIG_FIELD = 2500
    const CHUNK = 1200
    const head = `INSERT INTO public.${t} (${useNames.map(q).join(',')}) VALUES `
    const tail =
      ` ON CONFLICT (${conflictCols.map(q).join(',')}) DO UPDATE SET ` +
      updateCols.map((c) => `${q(c)}=EXCLUDED.${q(c)}`).join(',')
    const pkWhere = (r) => conflictCols.map((c) => `${q(c)} = ${sqlLiteral(r[c], 'text')}`).join(' AND ')

    let done = 0
    let buf = []
    let bufLen = 0
    const flush = () => {
      if (!buf.length) return
      const sql = head + buf.join(',') + tail
      try {
        cloudbaseExecute(sql)
      } catch (e) {
        throw new Error(`${t} 第 ${done} 行起的一批失败（SQL ${sql.length} 字符，${buf.length} 行）：${e.message}`)
      }
      done += buf.length
      buf = []
      bufLen = 0
    }

    /** 单行写入：超长字段分块追加 */
    const writeOneBig = (r, bigFields) => {
      const values = use.map((c) => (bigFields.has(c.name) ? "''" : sqlLiteral(r[c.name], c.data_type)))
      cloudbaseExecute(head + `(${values.join(',')})` + tail)
      for (const name of bigFields) {
        const text = r[name]
        for (let i = 0; i < text.length; i += CHUNK) {
          let end = i + CHUNK
          // 不要切在代理对中间
          if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1
          const piece = text.slice(i, end)
          cloudbaseExecute(
            `UPDATE public.${t} SET ${q(name)} = ${q(name)} || '${piece.replace(/'/g, "''")}' WHERE ${pkWhere(r)}`,
          )
        }
      }
      done += 1
    }

    for (const r of rows) {
      const lits = use.map((c) => sqlLiteral(r[c.name], c.data_type))
      const bigFields = new Set(
        use.filter((c) => typeof r[c.name] === 'string' && lits[use.indexOf(c)].length > BIG_FIELD).map((c) => c.name),
      )
      if (bigFields.size) {
        flush()
        writeOneBig(r, bigFields)
        continue
      }
      const lit = `(${lits.join(',')})`
      if (buf.length && bufLen + lit.length + 1 + head.length + tail.length > MAX_SQL) flush()
      buf.push(lit)
      bufLen += lit.length + 1
    }
    flush()
    console.log(`  ${t.padEnd(24)} ${done} 行已写入`)
  }
}

async function doIdentityMap() {
  const path = resolve(ENV_DIR, '_users.json')
  if (!existsSync(path)) throw new Error('缺少 _users.json，先跑 export')
  const users = JSON.parse(readFileSync(path, 'utf8'))
  for (const u of users) {
    if (!u.uuid || !u.email) continue
    const sql =
      `INSERT INTO public.legacy_identity_map (legacy_uuid, email) VALUES ` +
      `('${u.uuid.replace(/'/g, "''")}', '${u.email.replace(/'/g, "''")}') ` +
      `ON CONFLICT (legacy_uuid) DO UPDATE SET email = EXCLUDED.email`
    cloudbaseExecute(sql)
  }
  console.log(`  身份映射写入 ${users.length} 条`)
}

if (phase === 'export' || phase === 'all') {
  console.log(`导出 ${tables.length} 张表 → ${ENV_DIR}`)
  await doExport()
}
if (phase === 'import' || phase === 'all') {
  console.log('导入到 CloudBase：')
  await doImport()
}
if (phase === 'all') {
  console.log('写身份映射：')
  await doIdentityMap()
}
