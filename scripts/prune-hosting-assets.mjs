#!/usr/bin/env node
/**
 * 清理静态托管 assets/ 下历次部署留下的旧分包文件
 *
 * 部署只上传、不删除远端多余文件（没用 --prune：正在打开旧页面的用户还会按需加载旧分包），
 * assets/ 因此随每次部署持续增长。本脚本只删同时满足以下两条的文件：
 *   1. 不在线上 sw.js 的预缓存清单里（sw.js 列出当前版本用到的全部 assets）；
 *   2. 最后修改时间早于 N 天（默认 30 天）：每次部署会重新上传当前版本的全部文件，
 *      超过 N 天没被重传，说明这段时间内没有任何一次部署用到它。
 *
 * 用法（由 .github/workflows/prune-hosting-assets.yml 调用）：
 *   CLOUDBASE_APIKEY=… ENV_ID=… node scripts/prune-hosting-assets.mjs            # 只统计，不删除
 *   CLOUDBASE_APIKEY=… ENV_ID=… CONFIRM=DELETE node scripts/prune-hosting-assets.mjs --delete
 * 可选环境变量：KEEP_DAYS（默认 30）、SITE_ORIGIN（默认 https://ulink.ren）
 *
 * 安全边界：线上 sw.js 取不到或解析出的引用数异常时直接中止；只处理 `assets/` 前缀下的对象，
 * 每批删除前逐个断言前缀且不在保留名单内。
 */
import CloudBase from '@cloudbase/manager-node'
import COS from 'cos-nodejs-sdk-v5'

const ASSETS_PREFIX = 'assets/'
const MIN_LIVE_ASSETS = 20
const apiKey = process.env.CLOUDBASE_APIKEY
const envId = process.env.ENV_ID
const apiRegion = process.env.TCB_REGION || 'ap-shanghai'
const keepDays = Number(process.env.KEEP_DAYS || 30)
const siteOrigin = (process.env.SITE_ORIGIN || 'https://ulink.ren').replace(/\/+$/, '')
const wantDelete = process.argv.includes('--delete')

if (!apiKey || !envId) {
  console.error('缺少 CLOUDBASE_APIKEY 或 ENV_ID')
  process.exit(2)
}
if (!Number.isFinite(keepDays) || keepDays < 7) {
  console.error('KEEP_DAYS 必须是不小于 7 的数字')
  process.exit(2)
}
if (wantDelete && process.env.CONFIRM !== 'DELETE') {
  console.error('删除模式需要 CONFIRM=DELETE')
  process.exit(2)
}

/** 取线上 sw.js，解析出当前版本引用的全部 assets 文件名（作为保留名单） */
async function fetchLiveAssets() {
  const res = await fetch(`${siteOrigin}/sw.js?t=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`获取线上 sw.js 失败：HTTP ${res.status}`)
  const text = await res.text()
  const names = new Set(text.match(/assets\/[A-Za-z0-9._-]+/g) || [])
  if (names.size < MIN_LIVE_ASSETS) {
    throw new Error(`线上 sw.js 只解析出 ${names.size} 个 assets 引用（下限 ${MIN_LIVE_ASSETS}），疑似异常，中止`)
  }
  return names
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
  const liveAssets = await fetchLiveAssets()
  const cred = await exchangeCredential()
  const manager = new CloudBase({ ...cred, envId })
  const { bucket, region, basePath } = await manager.hosting.getHostingBucket()
  const base = (basePath || '').replace(/^\/+|\/+$/g, '')
  const prefix = base ? `${base}/${ASSETS_PREFIX}` : ASSETS_PREFIX
  const cutoff = Date.now() - keepDays * 86400_000
  console.log(
    `桶 ${bucket}（${region}），前缀 ${prefix}，线上引用 ${liveAssets.size} 个，` +
      `保留 ${keepDays} 天内修改过的文件，模式：${wantDelete ? '删除' : '只统计'}`,
  )

  const cos = new COS({ SecretId: cred.secretId, SecretKey: cred.secretKey, SecurityToken: cred.token })
  const call = (method, params) =>
    new Promise((resolve, reject) =>
      cos[method]({ Bucket: bucket, Region: region, ...params }, (err, data) => (err ? reject(err) : resolve(data))),
    )

  // 先完整列举再删除：文件量只有几千，且避免边列边删时分页游标受影响
  const all = []
  let marker = ''
  for (;;) {
    const page = await withRetry('列举', () => call('getBucket', { Prefix: prefix, Marker: marker, MaxKeys: 1000 }))
    const items = page.Contents || []
    all.push(...items)
    const truncated = page.IsTruncated === true || page.IsTruncated === 'true'
    if (!truncated || !items.length) break
    marker = page.NextMarker || items[items.length - 1].Key
  }

  /** 物理 Key → 线上路径（assets/xxx），用于和 sw.js 名单比对 */
  const logical = (key) => (base ? key.slice(base.length + 1) : key)
  const stats = { live: 0, recent: 0, stale: 0, staleBytes: 0, totalBytes: 0 }
  const toDelete = []
  const liveFound = new Set()
  for (const it of all) {
    const size = Number(it.Size) || 0
    stats.totalBytes += size
    const path = logical(it.Key)
    if (liveAssets.has(path)) {
      stats.live++
      liveFound.add(path)
    } else if (new Date(it.LastModified).getTime() >= cutoff) {
      stats.recent++
    } else {
      stats.stale++
      stats.staleBytes += size
      toDelete.push(it.Key)
    }
  }
  // 线上引用的文件在桶里一个都找不到，说明前缀/basePath 判断有误，宁可不删
  if (liveFound.size < Math.min(liveAssets.size, MIN_LIVE_ASSETS)) {
    throw new Error(`桶内只匹配到 ${liveFound.size} 个线上引用的文件，前缀可能有误，中止`)
  }

  console.log(`assets 总数：${all.length}（${fmtBytes(stats.totalBytes)}）`)
  console.log(`  线上正在用：${stats.live}`)
  console.log(`  ${keepDays} 天内修改过（保留）：${stats.recent}`)
  console.log(`  可删除：${stats.stale}（${fmtBytes(stats.staleBytes)}）`)

  let deleted = 0
  const failed = []
  if (wantDelete) {
    for (let i = 0; i < toDelete.length; i += 1000) {
      const keys = toDelete.slice(i, i + 1000)
      // 硬性断言：只删 assets/ 前缀下、且不在线上引用名单里的对象
      const bad = keys.find((k) => !k.startsWith(prefix) || liveAssets.has(logical(k)))
      if (bad) throw new Error(`拒绝删除：${bad}`)
      const res = await withRetry('删除', () =>
        call('deleteMultipleObject', { Objects: keys.map((Key) => ({ Key })), Quiet: true }),
      )
      const errs = res.Error || []
      failed.push(...errs)
      deleted += keys.length - errs.length
    }
    console.log(`已删除：${deleted}，失败：${failed.length}`)
    for (const e of failed.slice(0, 20)) console.log(`  ${e.Key}: ${e.Code} ${e.Message}`)
  }

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(
      summary,
      [
        `## 静态托管旧 assets 清理（${wantDelete ? '删除' : '只统计'}，保留 ${keepDays} 天）`,
        '',
        `| 项目 | 值 |`,
        `|---|---|`,
        `| assets 总数 | ${all.length}（${fmtBytes(stats.totalBytes)}） |`,
        `| 线上正在用 | ${stats.live} |`,
        `| ${keepDays} 天内修改过 | ${stats.recent} |`,
        `| 可删除 | ${stats.stale}（${fmtBytes(stats.staleBytes)}） |`,
        ...(wantDelete ? [`| 已删除 | ${deleted} |`, `| 失败 | ${failed.length} |`] : []),
        '',
      ].join('\n'),
    )
  }
  if (failed.length) process.exit(1)
}

main().catch((e) => {
  console.error(e?.stack || e)
  process.exit(1)
})
