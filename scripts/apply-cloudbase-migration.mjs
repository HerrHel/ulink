/**
 * 应用一份 CloudBase PG 迁移 SQL 文件。
 *
 * 为什么需要它：`tcb db execute` 只有 `--sql`，没有 `--file`（CLI 3.8.7 实测），
 * 而仓库里迁移文件都是多行 SQL，直接塞进 shell 参数容易被引号/换行/大小写环境搞坏。
 * 本脚本用 execFileSync 传 argv（不经 shell），并复用部署脚本同一套 tcb 可执行路径。
 *
 * 用法：
 *   node scripts/apply-cloudbase-migration.mjs cloudbase/migrations/20261031000002_ai_quota_expiry.sql
 *   node scripts/apply-cloudbase-migration.mjs <file> --env ulink-d1g5srvjo54b1886a
 *
 * 约束：`tcb db execute` 单批 SQL ≤ 10KB（CLI 限制）。超限请先在文件里按语句分批，
 * 或用 `--allow-large` 明确接受被截断的风险（不建议）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('用法: node scripts/apply-cloudbase-migration.mjs <migration.sql> [--env <envId>]')
  process.exit(1)
}
const filePath = resolve(file)
if (!existsSync(filePath)) {
  console.error(`✗ 文件不存在: ${filePath}`)
  process.exit(1)
}

function readEnvLocal(key) {
  try {
    const raw = readFileSync(resolve('.env.local'), 'utf8')
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : undefined
  } catch {
    return undefined
  }
}

const envIdx = args.indexOf('--env')
const envId = envIdx >= 0 ? args[envIdx + 1] : (readEnvLocal('VITE_CLOUDBASE_ENV_ID') || process.env.VITE_CLOUDBASE_ENV_ID)
if (!envId) {
  console.error('✗ 缺少环境 ID：传 --env 或在 .env.local 配 VITE_CLOUDBASE_ENV_ID')
  process.exit(1)
}

const sql = readFileSync(filePath, 'utf8')
const bytes = Buffer.byteLength(sql, 'utf8')
if (bytes > 10 * 1024 && !args.includes('--allow-large')) {
  console.error(`✗ SQL 文件 ${bytes} 字节，超过 tcb db execute 单批 10KB 限制；请先在文件内分批执行。`)
  process.exit(1)
}

const directJs = resolve(homedir(), '.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb')
const executable = existsSync(directJs) ? process.execPath : 'node'
const argv = existsSync(directJs)
  ? [directJs, 'db', 'execute', '-e', envId, '--sql', sql]
  : ['scripts/../node_modules/@cloudbase/cli/bin/tcb', 'db', 'execute', '-e', envId, '--sql', sql]

console.log(`应用迁移 ${file} → ${envId}（${bytes} 字节）`)
try {
  const out = execFileSync(executable, argv, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  })
  console.log(out.trim() || '✅ 执行成功（无输出）')
} catch (e) {
  const out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
  console.error('✗ 迁移执行失败：')
  console.error(out.trim() || String(e))
  process.exit(1)
}
