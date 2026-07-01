/**
 * run-migrations.js — 通过 Supabase Management API 执行 SQL 迁移
 * 用法：node run-migrations.js
 *
 * 需要 .env 文件中有 SUPABASE_ACCESS_TOKEN
 */
const fs = require('fs')
const path = require('path')

// 从 .env 读取 access token
const envRaw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
const tokenMatch = envRaw.match(/SUPABASE_ACCESS_TOKEN=(.+)/)
if (!tokenMatch) {
  console.error('❌ 未找到 SUPABASE_ACCESS_TOKEN，请检查 .env 文件')
  process.exit(1)
}

const SUPABASE_ACCESS_TOKEN = tokenMatch[1].trim()
const PROJECT_REF = 'yqouglfopbmujkqmjgpu'

const migrations = [
  'supabase/migrations/010_public_groups_rls.sql',
  'supabase/migrations/011_error_logs.sql',
]

async function runMigration(name, sql) {
  console.log(`\n▶ 执行迁移: ${name}`)
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      }
    )
    const text = await res.text()
    if (res.ok) {
      console.log(`  ✅ 成功`)
      if (text.length > 2) console.log(`  ${text.slice(0, 300)}`)
    } else {
      console.log(`  ❌ 失败 (${res.status}): ${text.slice(0, 300)}`)
    }
    return res.ok
  } catch (e) {
    console.log(`  ❌ 异常: ${e.message}`)
    return false
  }
}

async function main() {
  console.log(`项目: ${PROJECT_REF}\n`)

  let allOk = true
  for (const m of migrations) {
    const sql = fs.readFileSync(path.join(__dirname, m), 'utf8')
    const ok = await runMigration(path.basename(m), sql)
    if (!ok) allOk = false
  }

  console.log(`\n${allOk ? '✅ 全部迁移成功' : '⚠️ 部分迁移失败'}`)
}

main().catch(console.error)
