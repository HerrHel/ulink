#!/usr/bin/env node
/**
 * 线上版本自检：对比线上部署的 /version.json 与本地 git HEAD，判断「线上是否最新版」。
 *
 * 背景：__BUILD_TIME__ 只反映构建时刻，跨环境永远不同（CI 与本地各自构建），
 * 无法据此判断版本一致性；/version.json 里的 git commit 才是可比的唯一标识。
 *
 * 用法：
 *   npm run check:prod                     # 默认 https://ulink.ren
 *   node scripts/check-prod-version.mjs <baseUrl>
 *
 * 退出码：
 *   0 = 线上 commit === 本地 HEAD（且工作区干净、安全头/元数据完整）
 *   1 = 不一致（线上落后 / 本地落后 / 分叉）
 *   2 = 线上没有 /version.json（部署早于该机制，属旧版本）
 *   3 = 网络或解析失败
 *   4 = 版本一致，但线上安全防护不完整（CSP / Referrer-Policy 缺失；XCTO 属平台限制仅提示）
 *
 * 注：不用 process.exit() —— Node 24 + Windows 下 fetch 的 undici 句柄会在退出时
 * 触发 libuv 断言（0xC0000409）；改为返回退出码交给 process.exitCode。
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

function isAncestor(a, b) {
  if (!a || !b) return false
  try {
    execSync(`git merge-base --is-ancestor ${a} ${b}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function fmt(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso || '-') : d.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 线上安全防护探测（2026-10-31 新增）。
 *
 * CloudBase 静态托管不支持自定义响应头，`public/_headers` 只对 Cloudflare Pages 生效；
 * 生产改为 `<meta http-equiv="Content-Security-Policy">` + `<meta name="referrer">` 降级，
 * XCTO 无 meta 等价物。这里同时认「响应头」与「meta」，任一存在即视为已覆盖。
 */
async function checkSecurity(base) {
  const res = await fetch(`${base}/?t=${Date.now()}`, { cache: 'no-store' })
  const html = res.ok ? await res.text() : ''
  return {
    status: res.status,
    cspHeader: !!res.headers.get('content-security-policy'),
    cspMeta: /http-equiv=["']?content-security-policy/i.test(html),
    referrerHeader: !!res.headers.get('referrer-policy'),
    referrerMeta: /<meta[^>]+name=["']?referrer["']?/i.test(html),
    xcto: !!res.headers.get('x-content-type-options'),
  }
}

function printSecurity(sec) {
  if (!sec) {
    console.log('\n安全防护：⚠ 探测失败（网络错误）')
    return []
  }
  const csp = sec.cspHeader ? 'HTTP 头' : sec.cspMeta ? '<meta>（托管无响应头，降级）' : '✗ 缺失'
  const ref = sec.referrerHeader ? 'HTTP 头' : sec.referrerMeta ? '<meta>（降级）' : '✗ 缺失'
  const xcto = sec.xcto ? 'HTTP 头' : '✗ 缺失（CloudBase 托管无响应头，平台限制）'
  console.log('\n安全防护：')
  console.log(`  CSP                    ${csp}`)
  console.log(`  Referrer-Policy        ${ref}`)
  console.log(`  X-Content-Type-Options ${xcto}`)
  // 只有仓库能兜底的 CSP / Referrer 计入失败；XCTO 无 meta 等价物，仅提示
  const missing = []
  if (!sec.cspHeader && !sec.cspMeta) missing.push('CSP')
  if (!sec.referrerHeader && !sec.referrerMeta) missing.push('Referrer-Policy')
  return missing
}

async function main() {
  const base = (process.argv[2] || process.env.ULINK_BASE_URL || 'https://ulink.ren').replace(/\/+$/, '')
  const localCommit = sh('git rev-parse HEAD')
  const localShort = localCommit ? localCommit.slice(0, 7) : 'unknown'
  const localBranch = sh('git rev-parse --abbrev-ref HEAD') || 'unknown'
  const localDirty = sh('git status --porcelain') !== ''

  const url = `${base}/version.json?t=${Date.now()}`
  let remote
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
    if (res.status === 404) {
      console.error(`✗ ${base}/version.json 不存在（HTTP 404）`)
      console.error('  线上仍是未包含构建信息端点的旧版本；推送新构建后重试。')
      return 2
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    remote = await res.json()
  } catch (err) {
    console.error(`✗ 无法读取 ${url}: ${err instanceof Error ? err.message : String(err)}`)
    return 3
  }

  const remoteCommit = typeof remote.commit === 'string' ? remote.commit : ''
  const remoteShort = remoteCommit && remoteCommit !== 'unknown' ? remoteCommit.slice(0, 7) : (remote.commitShort || 'unknown')

  console.log('本地:')
  console.log(`  分支      ${localBranch}`)
  console.log(`  提交      ${localShort}${localDirty ? '（工作区有未提交修改）' : ''}`)
  console.log(`  版本      v${pkg.version}`)
  console.log('线上:')
  console.log(`  地址      ${base}`)
  console.log(`  提交      ${remoteShort}${remote.branch ? `（${remote.branch}）` : ''}`)
  console.log(`  版本      v${remote.version || '-'}`)
  console.log(`  提交时间  ${fmt(remote.commitTime)}`)
  console.log(`  构建时间  ${fmt(remote.buildTime)}`)

  if (!remoteCommit || remoteCommit === 'unknown') {
    console.log('\n⚠ 线上 version.json 未包含 commit（构建时 git 不可用），只能凭构建时间大致判断。')
    return 1
  }

  if (remoteCommit === localCommit) {
    console.log(`\n✅ 线上即本地 HEAD（${localShort}）${localDirty ? '；注意本地存在未提交修改，线上不包含这些改动' : ''}`)
    let sec = null
    try {
      sec = await checkSecurity(base)
    } catch (err) {
      console.log(`\n安全防护：⚠ 探测失败（${err instanceof Error ? err.message : String(err)}）`)
    }
    const missing = printSecurity(sec)
    if (missing.length > 0) {
      console.log(`\n✗ 安全防护不完整：缺失 ${missing.join('、')}`)
      console.log('  CSP/Referrer-Policy 的仓库内兜底是构建期 <meta>（见 vite.config.ts securityMetaPlugin），')
      console.log('  推新构建后才会生效；X-Content-Type-Options 与 frame-ancestors 需平台侧支持（docs/TECH_DEBT.md §零 #1）。')
      return 4
    }
    return 0
  }

  if (isAncestor(remoteCommit, localCommit)) {
    const behind = sh(`git rev-list --count ${remoteCommit}..HEAD`) || '?'
    console.log(`\n✗ 线上落后本地 ${behind} 个提交（线上 ${remoteShort} → 本地 ${localShort}）`)
    console.log('  若刚推送过，确认 CI deploy job 是否成功（gh run list --limit 3）。')
    return 1
  }

  if (isAncestor(localCommit, remoteCommit)) {
    console.log(`\n✗ 线上比本地新（本地 ${localShort} → 线上 ${remoteShort}），先 git pull。`)
    return 1
  }

  console.log(`\n✗ 无法判定：本地仓库可能没有线上提交 ${remoteShort}，先 git fetch origin。`)
  return 1
}

process.exitCode = await main()
