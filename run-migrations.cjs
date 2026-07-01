#!/usr/bin/env node
/**
 * run-migrations.cjs — 通过 Supabase Management API 自动执行 SQL 迁移
 *
 * 用法：node run-migrations.cjs
 * 自动扫描 supabase/migrations/*.sql 按文件名排序执行
 * 所有 SQL 已使用 IF NOT EXISTS / DROP POLICY IF EXISTS，可安全重复执行
 *
 * 需要 .env 文件中有 SUPABASE_ACCESS_TOKEN
 */
const fs = require('fs')
const path = require('path')

// ── 配置 ──
const MIGRATIONS_DIR = path.join(__dirname, 'supabase', 'migrations')
const PROJECT_REF = 'yqouglfopbmujkqmjgpu'

// ── 读取 access token ──
const envRaw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
const tokenMatch = envRaw.match(/SUPABASE_ACCESS_TOKEN=(.+)/)
if (!tokenMatch) {
  console.error('❌ 未找到 SUPABASE_ACCESS_TOKEN，请检查 .env 文件')
  process.exit(1)
}
const SUPABASE_ACCESS_TOKEN = tokenMatch[1].trim()

// ── 自动发现所有 .sql 文件，按文件名排序 ──
const sqlFiles = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort()  // 按文件名字典序（001 < 002 < ... < 011）
  .map(f => path.join(MIGRATIONS_DIR, f))

if (!sqlFiles.length) {
  console.log('📭 没有找到迁移文件')
  process.exit(0)
}

async function runMigration(name, sql) {
  console.log(`  ▶ ${name}...`)
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
      console.log(`    ✅`)
      return true
    }
    // 幂等性检查：如果是"已存在"类错误，不算失败
    if (text.includes('already exists') || text.includes('duplicate')) {
      console.log(`    ⚠️ 已存在，跳过`)
      return true
    }
    console.log(`    ❌ (${res.status}): ${text.slice(0, 200)}`)
    return false
  } catch (e) {
    console.log(`    ❌ ${e.message}`)
    return false
  }
}

async function main() {
  console.log(`🔗 项目: ${PROJECT_REF}`)
  console.log(`📁 ${sqlFiles.length} 个迁移文件\n`)

  let ok = 0, fail = 0
  for (const file of sqlFiles) {
    const name = path.basename(file)
    const sql = fs.readFileSync(file, 'utf8')
    if (await runMigration(name, sql)) ok++
    else fail++
  }

  console.log(`\n${fail === 0 ? '✅' : '⚠️'} ${ok} 成功，${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
