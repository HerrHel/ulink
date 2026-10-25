#!/usr/bin/env node
/**
 * 生成兑换码并写入 orders 表（channel='redeem'）
 *
 * 用途：在**支付商户号到位之前**，先把「下单 → 核销 → 发放权益」整条链路跑通。
 * 兑换码本身就是 orders.idempotency_key —— 不另建表，天然唯一且天然幂等。
 *
 * 用法：
 *   node scripts/gen-redeem-codes.mjs --count 20 --plan plus_monthly
 *   node scripts/gen-redeem-codes.mjs --count 5 --plan plus_yearly --dry-run
 *
 * 选项：
 *   --count N      生成数量（默认 10）
 *   --plan ID      套餐 id（默认 plus_monthly）
 *   --dry-run      只打印将要执行的 SQL，不落库
 *   --print-only   只打印码，不写库（已存在时补打）
 *
 * 码格式：8 位大写 Base32（去掉 I/O/0/1 等易混字符，便于手工输入）
 * 熵：32^8 ≈ 1.1e12；配合云函数 10 次/10 分钟的核销限流，暴力猜码不成立
 */
import { execFileSync } from 'node:child_process'
import { randomUUID, randomInt } from 'node:crypto'

const ENV_ID = process.env.VITE_CLOUDBASE_ENV_ID || 'ulink-d1g5srvjo54b1886a'
// 去掉 I O 0 1：手输时最常混淆的字符
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const BATCH = 50

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const has = (name) => process.argv.includes(`--${name}`)

const count = Math.max(1, Math.min(500, parseInt(arg('count', '10'), 10) || 10))
const planId = arg('plan', 'plus_monthly')
const dryRun = has('dry-run')
const printOnly = has('print-only')

function genCode() {
  let s = ''
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}

function esc(v) {
  return String(v).replace(/'/g, "''")
}

const codes = new Set()
while (codes.size < count) codes.add(genCode())
const list = [...codes]

console.log(`生成 ${list.length} 个兑换码（套餐 ${planId}）`)
if (printOnly || dryRun) {
  console.log(list.join('\n'))
}

if (printOnly) process.exit(0)

function runSql(sql) {
  // Windows Git Bash 下直接 execFileSync('tcb') 会失败（tcb 是 shell 包装脚本），
  // 必须经 bash -c 调用；SQL 里只有单引号，用双引号包裹安全。
  const cmd = `tcb db execute -e ${ENV_ID} --sql "${sql.replace(/"/g, '\\"')}"`
  try {
    return execFileSync('bash', ['-c', cmd], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    })
  } catch (e) {
    const detail = String(e.stderr || e.stdout || e.message || '')
    console.error('执行失败：\n' + detail.slice(-1200))
    process.exit(1)
  }
}

let inserted = 0
for (let i = 0; i < list.length; i += BATCH) {
  const chunk = list.slice(i, i + BATCH)
  const values = chunk
    .map(
      (c) =>
        `('${randomUUID()}','unassigned','${esc(planId)}',0,'CNY','redeem',NULL,'pending','${esc(c)}',now())`,
    )
    .join(',')
  const sql =
    `INSERT INTO public.orders ` +
    `(id,user_id,plan_id,amount_cents,currency,channel,channel_order_id,status,idempotency_key,created_at) ` +
    `VALUES ${values}`

  if (dryRun) {
    console.log(`\n--- 将执行（${chunk.length} 行）---\n${sql}`)
    continue
  }
  const out = runSql(sql)
  if (/error/i.test(out) && !/Affected rows: 0/.test(out)) {
    console.error('插入失败：', out.slice(-500))
    process.exit(1)
  }
  inserted += chunk.length
  console.log(`  已写入 ${chunk.length} 个（累计 ${inserted}）`)
}

if (!dryRun) {
  console.log(`\n完成，共 ${inserted} 个兑换码：\n`)
  console.log(list.join('\n'))
  console.log('\n（把上面的码交付给用户即可兑换；每个码只能用一次）')
}
