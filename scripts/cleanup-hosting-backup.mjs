#!/usr/bin/env node
/**
 * 一次性清理：删除静态托管里 `tcb hosting deploy --safe` 历次留下的 `.cloudbase-backup/` 备份
 *
 * 为什么要自己写：CLI 的 cleanupBackup 会把空 Marker 传给 deleteDirectoryCustom，但后者没有往下传，
 * 列举时仍用默认 Marker '/'。'.'（0x2E）排在 '/'（0x2F）前面，导致以 '.' 开头的备份永远列不出来、删不掉。
 * 这里直接调 COS：Marker 从空串开始分页。
 *
 * 用法（由 .github/workflows/cleanup-hosting-backup.yml 调用）：
 *   CLOUDBASE_APIKEY=… ENV_ID=… node scripts/cleanup-hosting-backup.mjs            # 只统计，不删除
 *   CLOUDBASE_APIKEY=… ENV_ID=… CONFIRM=DELETE node scripts/cleanup-hosting-backup.mjs --delete
 *
 * 安全边界：只处理 Key 以 `<basePath>/.cloudbase-backup/` 开头的对象，每批删除前逐个断言前缀。
 */
import CloudBase from '@cloudbase/manager-node'
import COS from 'cos-nodejs-sdk-v5'

const BACKUP_PREFIX = '.cloudbase-backup/'
const apiKey = process.env.CLOUDBASE_APIKEY
const envId = process.env.ENV_ID
const apiRegion = process.env.TCB_REGION || 'ap-shanghai'
const wantDelete = process.argv.includes('--delete')

if (!apiKey || !envId) {
  console.error('缺少 CLOUDBASE_APIKEY 或 ENV_ID')
  process.exit(2)
}
if (wantDelete && process.env.CONFIRM !== 'DELETE') {
  console.error('删除模式需要 CONFIRM=DELETE')
  process.exit(2)
}

/** 与 CLI 相同：用 CloudBase API Key 换临时密钥 */
async function exchangeCredential() {
  const res = await fetch(`https://${envId}.${apiRegion}.tcb-api.tencentcloudapi.com/capi/credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ env: envId }),
  })
  const body = await res.json()
  const d = body?.data
  if (body?.code !== 0 || !d?.TmpSecretId || !d?.TmpSecretKey || !d?.Token) {
    throw new Error(`API Key 换取临时密钥失败：${body?.message || body?.msg || res.status}`)
  }
  return { secretId: d.TmpSecretId, secretKey: d.TmpSecretKey, token: d.Token }
}

/** 带重试的 COS 调用（网络抖动时最多 5 次） */
async function withRetry(label, fn) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= 5) throw e
      console.warn(`${label} 失败（第 ${i} 次），重试：${e?.message || e?.code || e}`)
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

function fmtBytes(n) {
  return n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(2)} GB` : `${(n / (1 << 20)).toFixed(1)} MB`
}

async function main() {
  const cred = await exchangeCredential()
  const manager = new CloudBase({ ...cred, envId })
  const { bucket, region, basePath } = await manager.hosting.getHostingBucket()
  const base = (basePath || '').replace(/^\/+|\/+$/g, '')
  const prefix = base ? `${base}/${BACKUP_PREFIX}` : BACKUP_PREFIX
  console.log(`桶 ${bucket}（${region}），前缀 ${prefix}，模式：${wantDelete ? '删除' : '只统计'}`)

  const cos = new COS({ SecretId: cred.secretId, SecretKey: cred.secretKey, SecurityToken: cred.token })
  const call = (method, params) =>
    new Promise((resolve, reject) =>
      cos[method]({ Bucket: bucket, Region: region, ...params }, (err, data) => (err ? reject(err) : resolve(data))),
    )

  let marker = ''
  let total = 0
  let bytes = 0
  let deleted = 0
  const failed = []
  const snapshots = new Map() // 备份时间戳 → 文件数

  for (;;) {
    const page = await withRetry('列举', () => call('getBucket', { Prefix: prefix, Marker: marker, MaxKeys: 1000 }))
    const items = page.Contents || []
    for (const it of items) {
      total++
      bytes += Number(it.Size) || 0
      const ts = it.Key.slice(prefix.length).split('/')[0]
      snapshots.set(ts, (snapshots.get(ts) || 0) + 1)
    }

    if (wantDelete && items.length) {
      const keys = items.map((it) => it.Key)
      // 硬性断言：只删备份前缀下的对象
      const outside = keys.find((k) => !k.startsWith(prefix))
      if (outside) throw new Error(`拒绝删除前缀之外的对象：${outside}`)
      const res = await withRetry('删除', () =>
        call('deleteMultipleObject', { Objects: keys.map((Key) => ({ Key })), Quiet: true }),
      )
      const errs = res.Error || []
      failed.push(...errs)
      deleted += keys.length - errs.length
      process.stdout.write(`\r已删除 ${deleted} 个`)
    }

    const truncated = page.IsTruncated === true || page.IsTruncated === 'true'
    if (!truncated || !items.length) break
    marker = page.NextMarker || items[items.length - 1].Key
    if (!wantDelete && total % 50000 < 1000) console.log(`已统计 ${total} 个…`)
  }
  if (wantDelete) process.stdout.write('\n')

  const sorted = [...snapshots.keys()].sort()
  const toDate = (ts) => (/^\d{13}$/.test(ts) ? new Date(Number(ts)).toISOString() : ts)
  console.log(`备份份数：${snapshots.size}`)
  if (sorted.length) console.log(`最早：${toDate(sorted[0])}  最晚：${toDate(sorted[sorted.length - 1])}`)
  console.log(`文件数：${total}，总大小：${fmtBytes(bytes)}`)
  if (wantDelete) {
    console.log(`已删除：${deleted}，失败：${failed.length}`)
    for (const e of failed.slice(0, 20)) console.log(`  ${e.Key}: ${e.Code} ${e.Message}`)
    if (failed.length) process.exit(1)
  }

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(
      summary,
      [
        `## 静态托管备份清理（${wantDelete ? '删除' : '只统计'}）`,
        '',
        `| 项目 | 值 |`,
        `|---|---|`,
        `| 备份份数 | ${snapshots.size} |`,
        `| 文件数 | ${total} |`,
        `| 总大小 | ${fmtBytes(bytes)} |`,
        ...(sorted.length ? [`| 时间范围 | ${toDate(sorted[0])} ~ ${toDate(sorted[sorted.length - 1])} |`] : []),
        ...(wantDelete ? [`| 已删除 | ${deleted} |`, `| 失败 | ${failed.length} |`] : []),
        '',
      ].join('\n'),
    )
  }
}

main().catch((e) => {
  console.error(e?.stack || e)
  process.exit(1)
})
