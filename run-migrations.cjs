#!/usr/bin/env node
/**
 * run-migrations.cjs — 通过 Supabase Management API 自动执行 SQL 迁移
 *
 * 用法：node run-migrations.cjs
 *
 * - 自动扫描 supabase/migrations/*.sql 按文件名排序
 * - 通过 .migration-state.json 跟踪已应用的迁移，避免重复执行
 * - 新加迁移只需放 .sql 文件，脚本自动发现并执行
 *
 * 需要 .env 文件中有 SUPABASE_ACCESS_TOKEN
 */
const fs = require('fs')
const path = require('path')

// ── 配置 ──
const MIGRATIONS_DIR = path.join(__dirname, 'supabase', 'migrations')
const STATE_FILE = path.join(__dirname, '.migration-state.json')
const PROJECT_REF = 'yqouglfopbmujkqmjgpu'

// ── 读取 access token ──
const envRaw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
const tokenMatch = envRaw.match(/SUPABASE_ACCESS_TOKEN=(.+)/)
if (!tokenMatch) {
  console.error('❌ 未找到 SUPABASE_ACCESS_TOKEN，请检查 .env 文件')
  process.exit(1)
}
const SUPABASE_ACCESS_TOKEN = tokenMatch[1].trim()

// ── 读取已应用状态 ──
let applied = new Set()
if (fs.existsSync(STATE_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (Array.isArray(data.applied)) applied = new Set(data.applied)
  } catch { /* 忽略损坏文件 */ }
}

// ── 自动发现所有 .sql 文件 ──
const allFiles = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort()
  .map(f => path.join(MIGRATIONS_DIR, f))

const pending = allFiles.filter(f => !applied.has(path.basename(f)))

if (!allFiles.length) {
  console.log('📭 没有找到迁移文件')
  process.exit(0)
}

if (!pending.length) {
  console.log(`✅ 全部 ${allFiles.length} 个迁移已应用，无需更新`)
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
    // 幂等容错：各种"已存在"类错误算通过
    const idempotentErrors = ['already exists', 'duplicate', 'already a member']
    if (idempotentErrors.some(e => text.includes(e))) {
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
  console.log(`📁 ${allFiles.length} 个迁移文件，${pending.length} 个待应用\n`)

  let ok = 0, fail = 0
  for (const file of pending) {
    const name = path.basename(file)
    if (await runMigration(name, fs.readFileSync(file, 'utf8'))) {
      applied.add(name)
      ok++
    } else {
      fail++
      break // 失败一个就停，避免部分应用
    }
  }

  // 保存状态
  fs.writeFileSync(STATE_FILE, JSON.stringify({ applied: [...applied].sort() }, null, 2))

  console.log(`\n${fail === 0 ? '✅' : '⚠️'} ${ok} 成功，${fail} 失败`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
