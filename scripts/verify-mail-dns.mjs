/**
 * 检查域名的邮件送达相关 DNS 记录（MX / SPF / DKIM / DMARC）
 *
 * 为什么要走 DoH：本机 UDP DNS 被沙箱拦（ECONNREFUSED），但 HTTPS 出站正常，
 * 所以用腾讯 doh.pub 的 JSON 接口查。比 `nslookup` 可靠。
 *
 * 用法:
 *   node scripts/verify-mail-dns.mjs                 # 默认查 ulink.ren
 *   node scripts/verify-mail-dns.mjs example.com
 */
const domain = process.argv[2] || 'ulink.ren'

async function query(name, type) {
  const url = `https://doh.pub/dns-query?name=${encodeURIComponent(name)}&type=${type}`
  const res = await fetch(url, { headers: { accept: 'application/dns-json' } })
  if (!res.ok) throw new Error(`DoH ${res.status}`)
  return res.json()
}

function answers(json) {
  return (json.Answer || []).map((a) => String(a.data).replace(/^"|"$/g, ''))
}

const pad = (s, n = 10) => String(s).padEnd(n)

console.log(`域名: ${domain}\n`)

// ── MX ──
const mx = answers(await query(domain, 'MX'))
const exmailMx = mx.filter((m) => /mxbiz\d*\.qq\.com/i.test(m))
console.log(`${pad('MX')} ${mx.length ? mx.join(', ') : '(无)'}`)
console.log(`${pad('')} ${exmailMx.length ? '✔ 指向腾讯企业邮' : '✖ 未指向企业邮，收信会失败'}`)

// ── SPF（主域 TXT）──
const txt = answers(await query(domain, 'TXT'))
const spf = txt.find((t) => /^v=spf1/i.test(t))
console.log(`\n${pad('SPF')} ${spf || '(缺失)'}`)
if (!spf) {
  console.log(`${pad('')} ✖ 缺失，容易进垃圾箱。腾讯企业邮建议: v=spf1 include:spf.mail.qq.com ~all`)
} else if (!/spf\.mail\.qq\.com/i.test(spf)) {
  console.log(`${pad('')} ⚠ 未包含腾讯企业邮的 include`)
} else {
  console.log(`${pad('')} ✔ 已包含 spf.mail.qq.com`)
}

// ── DKIM（枚举选择器；可用 DKIM_SELECTORS="a,b" 或第 2 个参数追加）──
// 腾讯企业邮的选择器是随机生成的（如 gfhp2610），所以既内置常见值，也允许外部传入。
const extra = (process.env.DKIM_SELECTORS || process.argv[3] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const SELECTORS = [
  ...new Set(['gfhp2610', 'dkim', 's1', 's2', 's3', 'exmail', 'mail', 'default', 's1024', 's2048', ...extra]),
]
const found = []
for (const sel of SELECTORS) {
  try {
    const list = answers(await query(`${sel}._domainkey.${domain}`, 'TXT'))
    const dkim = list.find((t) => /v=DKIM1|p=/i.test(t))
    if (dkim) found.push({ sel, len: dkim.length })
  } catch {
    /* 查不到就跳过 */
  }
}
console.log(`\n${pad('DKIM')} ${found.length ? found.map((f) => `${f.sel}（${f.len} 字符）`).join(', ') : '(无记录)'}`)
if (!found.length) {
  console.log(`${pad('')} ✖ 已试 ${SELECTORS.join(' / ')} 全部无记录 → 企业邮后台的 DKIM 尚未开启或 TXT 未添加`)
  console.log(`${pad('')}   后果：QQ/163/Gmail 更容易判为垃圾邮件`)
} else {
  console.log(`${pad('')} ✔ 至少一个选择器有记录`)
}

// ── DMARC ──
const dmarcList = answers(await query(`_dmarc.${domain}`, 'TXT'))
const dmarc = dmarcList.find((t) => /v=DMARC1/i.test(t))
console.log(`\n${pad('DMARC')} ${dmarc || '(缺失)'}`)
if (!dmarc) {
  console.log(`${pad('')} ⚠ 建议加一条 TXT 到 _dmarc.${domain}：`)
  console.log(`${pad('')}   v=DMARC1; p=none; rua=mailto:dmarc@${domain}; adkim=s; aspf=s; pct=100`)
  console.log(`${pad('')}   先 p=none 只观察不动手，确认 spf/dkim 都 pass 后再收紧到 quarantine`)
}

// ── 汇总 ──
const ok = mx.length > 0 && Boolean(spf) && found.length > 0
console.log(`\n结论: MX ${mx.length ? '✔' : '✖'} / SPF ${spf ? '✔' : '✖'} / DKIM ${found.length ? '✔' : '✖'} / DMARC ${dmarc ? '✔' : '⚠'}`)
process.exit(ok ? 0 : 1)
