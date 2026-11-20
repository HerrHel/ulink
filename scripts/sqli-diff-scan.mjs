/**
 * sqli-diff-scan — 注入类「差分复测」小工具
 *
 * 用途：漏扫工具无法提供原始请求包时，用同一类判定逻辑（布尔差分 / 时间延时 / 报错特征）
 * 对本站可注入面做一遍定向复测，输出可归档的表格证据。
 *
 * 判定口径（与主流漏扫一致）：
 *   1. 布尔差分：同一入口，良性值与 payload 的状态码或响应体长度不同 → 可疑
 *   2. 时间延时：payload 含 SLEEP/WAITFOR 时，耗时显著高于基线（阈值 --delay，默认 3000ms）→ 可疑
 *   3. 报错特征：响应体出现 SQL 报错关键字（syntax error / SQLSTATE / ORA- / unclosed quotation）→ 可疑
 *
 * 用法：
 *   node scripts/sqli-diff-scan.mjs                    # 默认扫 https://ulink.ren
 *   node scripts/sqli-diff-scan.mjs --base https://xxx --delay 3000
 * 退出码：0 = 未发现可疑项；1 = 存在可疑项
 */

const BASE = (() => {
  const i = process.argv.indexOf('--base')
  return (i > -1 && process.argv[i + 1]) || 'https://ulink.ren'
})()
const DELAY_MS = (() => {
  const i = process.argv.indexOf('--delay')
  return i > -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : 3000
})()

const PAYLOADS = [
  { label: '良性基线', value: 'abc' },
  { label: '单引号', value: "abc'" },
  { label: '双单引号', value: "abc''" },
  { label: '双引号', value: 'abc"' },
  { label: '分号', value: 'abc;' },
  { label: '右括号', value: 'abc)' },
  { label: 'AND 1=1', value: 'abc AND 1=1--' },
  { label: 'AND 1=2', value: 'abc AND 1=2--' },
  { label: "OR '1'='1", value: "abc' OR '1'='1" },
  { label: 'SLEEP(3)', value: "abc' AND SLEEP(3)--" },
]

/** 入口：本站所有接受外部输入的位置 */
const TARGETS = [
  { label: '/s/<id>', path: (v) => `/s/${encodeURIComponent(v)}` },
  { label: '/s/c/<id>', path: (v) => `/s/c/${encodeURIComponent(v)}` },
  { label: '/check-link?url=', path: (v) => `/check-link?url=${encodeURIComponent(v)}` },
  { label: '/?q=', path: (v) => `/?q=${encodeURIComponent(v)}` },
  { label: '/legal/?q=', path: (v) => `/legal/?q=${encodeURIComponent(v)}` },
]

const SQL_ERROR_RE =
  /SQLSTATE|syntax error at or near|unclosed quotation|ORA-\d{5}|MySQLSyntaxErrorException|SequelizeDatabaseError|pg_query\(\)|sqlite3\.OperationalError/i

async function probe(url) {
  const started = performance.now()
  let res, body = ''
  try {
    res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'ulink-sqli-diff-scan/1.0 (+compliance)' },
      signal: AbortSignal.timeout(20000),
    })
    body = await res.text()
  } catch (e) {
    return { status: 0, bytes: 0, hash: '-', ms: Math.round(performance.now() - started), error: e.message }
  }
  const ms = Math.round(performance.now() - started)
  const hash = (await import('node:crypto')).createHash('sha256').update(body).digest('hex').slice(0, 12)
  return { status: res.status, bytes: Buffer.byteLength(body), hash, ms, sqlError: SQL_ERROR_RE.test(body) }
}

const rows = []
for (const target of TARGETS) {
  let baseline = null
  for (const p of PAYLOADS) {
    const url = BASE + target.path(p.value)
    const r = await probe(url)
    if (p.label === '良性基线') baseline = r
    rows.push({ target: target.label, payload: p.label, value: p.value, url, ...r })
  }
  for (const row of rows.filter((x) => x.target === target.label && x.payload !== '良性基线')) {
    const diffs = []
    if (row.status !== baseline.status) diffs.push(`状态码 ${baseline.status}→${row.status}`)
    if (row.bytes !== baseline.bytes) diffs.push(`长度 ${baseline.bytes}→${row.bytes}`)
    if (row.ms - baseline.ms > DELAY_MS) diffs.push(`延时 +${row.ms - baseline.ms}ms`)
    if (row.sqlError) diffs.push('响应含 SQL 报错特征')
    row.diff = diffs.join('；')
  }
}

const suspicious = rows.filter((r) => r.diff)
const pad = (s, n) => String(s).padEnd(n)
console.log(`\n目标：${BASE}    延时阈值：${DELAY_MS}ms    请求数：${rows.length}\n`)
console.log(pad('入口', 18) + pad('payload', 12) + pad('状态码', 8) + pad('字节', 8) + pad('耗时ms', 8) + '差分')
console.log('-'.repeat(78))
for (const r of rows) {
  console.log(
    pad(r.target, 18) + pad(r.payload, 12) + pad(r.status, 8) + pad(r.bytes, 8) + pad(r.ms, 8) + (r.diff || '-'),
  )
}
console.log('-'.repeat(78))
console.log(
  suspicious.length === 0
    ? `结论：${rows.length} 个请求，各入口的良性基线与全部 payload 响应一致，未发现布尔差分 / 时间延时 / 报错特征。`
    : `可疑项 ${suspicious.length} 条，见上表「差分」列。`,
)
process.exit(suspicious.length === 0 ? 0 : 1)
