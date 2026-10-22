/**
 * 核对 @cloudbase/js-sdk 在本项目的真实运行时形状（不依赖浏览器）
 *
 * 目的：把「文档说的」变成「实测过的」——确认
 *   1) app.rdb() 存在，且 from() 返回 postgrest 风格构造器
 *   2) publishable key 映射到 PG 的 anon 角色（含 GRANT 基线：anon 无表权限 → 42501）
 *   3) 公开读 RPC（get_public_group）可匿名调用
 *
 * 用法: node scripts/verify-cloudbase-sdk.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvLocal() {
  const raw = readFileSync(resolve('.env.local'), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const env = loadEnvLocal()
const envId = env.VITE_CLOUDBASE_ENV_ID
const publishableKey = env.VITE_PUBLISHABLE_KEY
if (!envId || !publishableKey) throw new Error('.env.local 缺少 VITE_CLOUDBASE_ENV_ID / VITE_PUBLISHABLE_KEY')

const { default: cloudbase } = await import('@cloudbase/js-sdk')

const app = cloudbase.init({ env: envId, accessKey: publishableKey })

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`)
}

check('app.rdb 是函数', typeof app.rdb === 'function')

const db = typeof app.rdb === 'function' ? app.rdb() : null
check('rdb() 返回对象', Boolean(db) && typeof db === 'object')
if (db) {
  check('rdb.from 是函数', typeof db.from === 'function')
  const q = db.from('bookmarks')
  check('from() 返回构造器', Boolean(q) && typeof q === 'object')

  const terminals = ['select', 'insert', 'upsert', 'update', 'delete']
  const missingTerminals = terminals.filter((m) => typeof q?.[m] !== 'function')
  check('终端方法齐备（from 层）', missingTerminals.length === 0, missingTerminals.length ? `缺: ${missingTerminals.join(', ')}` : terminals.join('/'))

  // 过滤器挂在「终端方法返回的构造器」上，而不是 from() 直出对象——本项目端口依赖后者成立
  const filters = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'not', 'is', 'in', 'ilike', 'or', 'match', 'order', 'limit', 'range', 'single']
  const probes = {
    'select()': q.select('*'),
    'update()': q.update({}),
    'delete()': q.delete(),
    'upsert()': q.upsert({}),
  }
  for (const [label, b] of Object.entries(probes)) {
    const missing = filters.filter((m) => typeof b?.[m] !== 'function')
    check(`${label} 返回的构造器带全过滤器`, missing.length === 0, missing.length ? `缺: ${missing.join(', ')}` : 'ok')
  }

  check('rdb.rpc 是函数', typeof db.rpc === 'function')
}

// ── 真实请求：anon 读书签表应当被 GRANT 层拒绝（031 权限基线）──
if (db) {
  try {
    const res = await db.from('bookmarks').select('*').limit(1)
    const code = res?.error?.code
    const msg = res?.error?.message || ''
    const denied = code === '42501' || /permission denied/i.test(msg)
    check('anon 直读 bookmarks 被拒（符合 031 基线）', denied, `code=${code ?? 'none'} ${msg.slice(0, 90)}`)
  } catch (e) {
    check('anon 直读 bookmarks 被拒（符合 031 基线）', false, `抛出: ${e?.message ?? e}`)
  }

  // ── 公开读 RPC：匿名可调，不存在的 gid 应返回空 payload 而非报错 ──
  try {
    const res = await db.rpc('get_public_group', { p_gid: 'does-not-exist-000' })
    const ok = !res?.error && (res?.data === null || typeof res?.data === 'object')
    check('get_public_group 匿名可调', ok, res?.error ? `error: ${res.error.message?.slice(0, 90)}` : `data=${JSON.stringify(res?.data)?.slice(0, 60)}`)
  } catch (e) {
    check('get_public_group 匿名可调', false, `抛出: ${e?.message ?? e}`)
  }
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} 项通过`)
process.exit(failed.length ? 1 : 0)
