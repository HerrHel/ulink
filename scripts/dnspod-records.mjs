#!/usr/bin/env node
/**
 * scripts/dnspod-records.mjs — DNSPod 记录查询与修改（腾讯云 API v3 / TC3-HMAC-SHA256）
 *
 * 凭证来源：`~/.tccli/default.credential`（腾讯云 API 密钥，**不硬编码、不落盘到仓库**）。
 * 用法：
 *   node scripts/dnspod-records.mjs list ulink.ren
 *   node scripts/dnspod-records.mjs set   ulink.ren @ A 124.223.146.214
 *   node scripts/dnspod-records.mjs del   ulink.ren <recordId>
 *
 * 背景（2026-10-27）：备案完成后需要把域名从 Cloudflare Pages 切回 CloudBase（国内）。
 * 切换时踩到的两个坑：
 *   1. 根域（@）同时存在 MX/TXT（企业邮箱 SPF/DMARC）与 CNAME 会**冲突**，
 *      根域只能用 **A 记录**指向 CloudBase 上海节点 IP。
 *   2. 原先指向 `ulink.pages.dev` 的两条 CNAME 处于 **DISABLE** 状态（备案期手动停解析），
 *      公网完全解析不出任何记录（表现为连接直接失败，而不是 404）。
 *
 * ⚠️ 切解析前务必确认 CloudBase 控制台已把域名绑定到**静态托管**与**HTTP 网关**，
 *    否则会返回 502（CloudBase 收到请求但无法路由到服务）。
 */

import { createHmac, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOST = 'dnspod.tencentcloudapi.com'
const SERVICE = 'dnspod'
const VERSION = '2021-03-23'

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const hmac = (k, s) => createHmac('sha256', k).update(s, 'utf8').digest()

function loadCredential() {
  const file = join(homedir(), '.tccli', 'default.credential')
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new Error(`读不到腾讯云凭证：${file}\n请先执行 tccli configure 或在该文件写入 secretId/secretKey`)
  }
  const secretId = raw.secretId || raw.SecretId
  const secretKey = raw.secretKey || raw.SecretKey
  if (!secretId || !secretKey) throw new Error(`${file} 里缺少 secretId / secretKey`)
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
  const authorization =
    `TC3-HMAC-SHA256 Credential=${cred.secretId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(`https://${HOST}/`, {
    method: 'POST',
    headers: {
      Authorization: authorization,
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

const [, , cmd, ...rest] = process.argv
const cred = loadCredential()

if (cmd === 'list') {
  const domain = rest[0]
  if (!domain) throw new Error('用法: dnspod-records.mjs list <domain>')
  const resp = await call('DescribeRecordList', { Domain: domain, Limit: 100 }, cred)
  const list = (resp.RecordList || []).sort(
    (a, b) => a.Type.localeCompare(b.Type) || (a.Name || '').localeCompare(b.Name || ''),
  )
  for (const r of list) {
    const flag = r.Status === 'ENABLE' ? '' : '   <-- 已停用'
    console.log(
      `  ${(r.Name || '@').padEnd(22)} ${r.Type.padEnd(6)} ${String(r.Value).slice(0, 44).padEnd(46)} ${r.Status}${flag}`,
    )
  }
} else if (cmd === 'set') {
  const [domain, subDomain, type, value, ttl = '600'] = rest
  if (!domain || !subDomain || !type || !value) {
    throw new Error('用法: dnspod-records.mjs set <domain> <subDomain|@> <A|CNAME|TXT|MX> <value> [ttl]')
  }
  const resp = await call(
    'CreateRecord',
    {
      Domain: domain,
      SubDomain: subDomain === '@' ? '' : subDomain,
      RecordType: type,
      RecordLine: '默认',
      Value: value,
      TTL: Number(ttl),
      Status: 'ENABLE',
    },
    cred,
  )
  console.log(`已创建 ${subDomain} ${type} ${value}（recordId=${resp.RecordId}）`)
} else if (cmd === 'del') {
  const [domain, recordId] = rest
  if (!domain || !recordId) throw new Error('用法: dnspod-records.mjs del <domain> <recordId>')
  await call('DeleteRecord', { Domain: domain, RecordId: Number(recordId) }, cred)
  console.log(`已删除 recordId=${recordId}`)
} else {
  console.log(
    [
      '用法:',
      '  node scripts/dnspod-records.mjs list <domain>',
      '  node scripts/dnspod-records.mjs set   <domain> <subDomain|@> <type> <value> [ttl]',
      '  node scripts/dnspod-records.mjs del   <domain> <recordId>',
    ].join('\n'),
  )
  process.exit(1)
}
