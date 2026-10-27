#!/usr/bin/env node
/**
 * scripts/ssl-renew.mjs — ulink.ren 证书状态查询与续期（腾讯云 SSL v3 / 2019-12-05）
 *
 * 背景：站点用的是腾讯云免费 DV 证书（TrustAsia C1 DV Free，PackageType=83），
 * **有效期已从 12 个月缩短到 90 天**。证书一过期全站会弹「不安全」，微信支付也会失效。
 *
 * 用法：
 *   node scripts/ssl-renew.mjs            查状态（默认，纯只读）
 *   node scripts/ssl-renew.mjs --apply    剩余 <= 30 天时真的申请续期
 *
 * ⚠️ 关键：`ApplyCertificate` 传 `OldCertificateId` 会建立**续费关系**（腾讯云侧可托管）。
 *    但 CloudBase 域名绑定是否会自动切到新证书**尚未实测**（当前证书还剩 80+ 天，
 *    无法提前触发）。因此续期后必须去
 *    「CloudBase 控制台 → HTTP 网关 → 域名及路由 → ulink.ren → 编辑」确认证书已指向新证书；
 *    若未自动切换，手动选择新证书即可。
 *
 * 免费证书额度：每个主域每年有限张数（超额报 FailedOperation.MainDomainCertificateCountLimit）。
 * 所以脚本默认只读，真正申请需显式 --apply。
 */

import { createHmac, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOST = 'ssl.tencentcloudapi.com'
const SERVICE = 'ssl'
const VERSION = '2019-12-05' // ← 注意：不是 2018-05-01，用错版本会全部 InvalidAction
const DOMAIN = 'ulink.ren'
const RENEW_THRESHOLD_DAYS = 30

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const hmac = (k, s) => createHmac('sha256', k).update(s, 'utf8').digest()

function loadCredential() {
  const file = join(homedir(), '.tccli', 'default.credential')
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const secretId = raw.secretId || raw.SecretId
  const secretKey = raw.secretKey || raw.SecretKey
  if (!secretId || !secretKey) throw new Error(`${file} 缺少 secretId/secretKey`)
  return { secretId, secretKey }
}

async function call(action, payload, cred) {
  const ts = Math.floor(Date.now() / 1000)
  const date = new Date(ts * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload)
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\nhost:${HOST}\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(body)}`
  const scope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${ts}\n${scope}\n${sha256(canonicalRequest)}`
  const secretDate = hmac(`TC3${cred.secretKey}`, date)
  const secretService = hmac(secretDate, SERVICE)
  const secretSigning = hmac(secretService, 'tc3_request')
  const signature = createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex')

  const res = await fetch(`https://${HOST}/`, {
    method: 'POST',
    headers: {
      Authorization:
        `TC3-HMAC-SHA256 Credential=${cred.secretId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      Host: HOST,
      'X-TC-Action': action,
      'X-TC-Version': VERSION,
      'X-TC-Timestamp': String(ts),
    },
    body,
  })
  const json = await res.json()
  if (json.Response?.Error) {
    const e = json.Response.Error
    throw new Error(`${e.Code}: ${e.Message}`)
  }
  return json.Response || {}
}

/** 证书状态码 → 人话 */
const STATUS_TEXT = {
  0: '审核中',
  1: '已签发',
  2: '审核失败',
  3: '已过期',
  4: '已添加DNS记录',
  5: '企业证书待提交',
  6: '待提交',
  7: '已取消',
  8: '已提交待确认',
  9: '已替换',
  10: '已吊销',
  11: '已删除',
  12: '已上传',
  13: '待验证',
  14: '待验证',
  15: '待验证',
  16: '待验证',
  17: '待验证',
  18: '待验证',
  19: '已签发（待部署）',
  20: '不适用',
  21: '已托管',
}

function daysLeft(endTime) {
  if (!endTime) return null
  const end = new Date(endTime.replace(/-/g, '/')) // 兼容 "2027-01-25 22:59:59"
  return Math.floor((end.getTime() - Date.now()) / 86400000)
}

const apply = process.argv.includes('--apply')
const cred = loadCredential()

const listResp = await call('DescribeCertificates', { Limit: 100 }, cred)
const certs = (listResp.Certificates || [])
  .filter((c) => String(c.Domain || '').includes(DOMAIN))
  .sort((a, b) => String(b.CertEndTime).localeCompare(String(a.CertEndTime)))

if (certs.length === 0) {
  console.error(`未找到 ${DOMAIN} 的证书`)
  process.exit(2)
}

console.log(`\n${DOMAIN} 的证书（共 ${certs.length} 张）:`)
for (const c of certs) {
  const d = daysLeft(c.CertEndTime)
  const flag = d !== null && d <= RENEW_THRESHOLD_DAYS ? '  ← 需续期' : ''
  console.log(
    `  ${c.CertificateId} | ${STATUS_TEXT[c.Status] ?? `状态${c.Status}`} | ` +
      `到期 ${c.CertEndTime} | 剩 ${d} 天${flag}`,
  )
}

// 取当前有效（已签发且未过期）里最晚到期的那张作为“当前证书”
const current = certs.find((c) => c.Status === 1 || c.Status === 21)
if (!current) {
  console.error('\n没有已签发的证书，无法判断续期状态')
  process.exit(2)
}

const left = daysLeft(current.CertEndTime)
console.log(`\n当前生效证书: ${current.CertificateId}，剩余 ${left} 天`)

if (left === null || left > RENEW_THRESHOLD_DAYS) {
  console.log(`未到续期窗口（阈值 ${RENEW_THRESHOLD_DAYS} 天），无需操作。`)
  process.exit(0)
}

console.log(`已进入续期窗口（<= ${RENEW_THRESHOLD_DAYS} 天）。`)
if (!apply) {
  console.log('这是只读检查；要真的申请续期，加 --apply 重跑。')
  console.log('（每张免费证书都会占用该主域当年的额度，别反复试）')
  process.exit(0)
}

console.log('正在申请续期（DNS_AUTO 自动验证，签发后自动删除验证记录）…')
const renewResp = await call(
  'ApplyCertificate',
  {
    DvAuthMethod: 'DNS_AUTO', // 域名解析托管在 DNSPod 且同账号，可自动加验证记录
    DomainName: DOMAIN,
    PackageType: '83', // TrustAsia C1 DV Free
    OldCertificateId: current.CertificateId, // 建立续费关系
    DeleteDnsAutoRecord: true,
    Alias: `${DOMAIN}-auto-renew`,
  },
  cred,
)
console.log(`\n✓ 已提交续期申请，新证书 ID：${renewResp.CertificateId}`)
console.log('  签发通常需要几分钟到 2 小时（DNS 自动验证）。')
console.log('')
console.log('  ⚠️ 下一步（可能需手动，务必确认）：')
console.log('     CloudBase 控制台 → HTTP 网关 → 域名及路由 → ulink.ren → 编辑')
console.log('     确认「证书关联」已指向新证书；未自动切换则手动选择新证书。')
console.log('')
console.log('     验证方式：')
console.log('       node scripts/ssl-renew.mjs          # 新证书应变为「已签发」')
console.log(`       openssl s_client -connect ${DOMAIN}:443 -servername ${DOMAIN} </dev/null 2>/dev/null | grep subject=`)
