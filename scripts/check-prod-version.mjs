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
 *   3 = 网络或解析失败（含安全头探测失败，避免假绿）
 *   4 = 版本一致，但线上安全防护不完整（/app 的 CSP frame-ancestors、XCTO 缺失，或首页/法律页 CSP 缺失）
 *   5 = 版本一致，但本地工作区有未提交修改（HEAD 不代表线上/本地实际代码）
 *
 * 注：不用 process.exit() —— Node 24 + Windows 下 fetch 的 undici 句柄会在退出时
 * 触发 libuv 断言（0xC0000409）；改为返回退出码交给 process.exitCode。
 */
import { execFileSync, execSync } from 'node:child_process'
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
    // 参数数组而非字符串拼接：外部 version.json 的 commit 不能进 shell
    execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** version.json 来自远端，commit 必须先按 git sha 形态白名单校验 */
function isGitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value)
}

function fmt(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso || '-') : d.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 线上安全防护探测（2026-10-31 更新）。
 *
 * CloudBase 静态托管不支持自定义响应头，`public/_headers` 只对 Cloudflare Pages 生效：
 * - 首页 `/`：构建期 `<meta>` CSP + Referrer（静态托管兜底）；
 * - `/app` 与 `/legal/*`：经 `edge-headers` 云函数反代，带真实响应头（CSP frame-ancestors / XCTO / XFO / HSTS）；
 * - 分享页 `/s/*`：share-ssr 自带 XCTO / XFO。
 * 这里同时认「响应头」与「meta」，并检查入口页的关键头。
 */
async function probePage(url) {
  // 带 Cache-Control: no-cache 请求头，避免 CDN/浏览器缓存把过期的安全头探测结果当成最新
  const res = await fetch(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
  const html = await res.text()
  const csp = res.headers.get('content-security-policy') || ''
  return {
    status: res.status,
    cspHeader: !!csp,
    cspMeta: /http-equiv=["']?content-security-policy/i.test(html),
    frameAncestors: /frame-ancestors/i.test(csp),
    xcto: res.headers.get('x-content-type-options'),
    xfo: res.headers.get('x-frame-options'),
    referrer: res.headers.get('referrer-policy'),
    referrerMeta: /<meta[^>]+name=["']?referrer["']?/i.test(html),
    hsts: res.headers.get('strict-transport-security'),
  }
}

// 探测失败哨兵：网络/解析异常时用它代替 null，main 见到它返回 3；
// 旧版首页探测失败会抛错 → sec=null → printSecurity 返回 [] → main 返回 0（假绿）。
const SEC_PROBE_FAILED = { probeFailed: true }

async function checkSecurity(base) {
  let root
  try {
    root = await probePage(`${base}/?t=${Date.now()}`)
  } catch (err) {
    // 首页探测失败必须返回哨兵，不能让异常冒泡成 sec=null 被当成「安全头齐全」
    return { ...SEC_PROBE_FAILED, error: err instanceof Error ? err.message : String(err) }
  }
  let app = null
  let legal = null
  try { app = await probePage(`${base}/app?t=${Date.now()}`) } catch { /* 保留 null，报告缺失 */ }
  try { legal = await probePage(`${base}/legal/privacy-policy.html?t=${Date.now()}`) } catch { /* 同上 */ }
  return { root, app, legal }
}

function printSecurity(sec) {
  if (!sec || sec.probeFailed || !sec.root) {
    // 探测失败（哨兵 / sec 为空）返回哨兵而非 []，避免 main 把失败当成「无缺失」假绿
    console.log(`\n安全防护：⚠ 探测失败${sec && sec.error ? `（${sec.error}）` : '（网络错误）'}`)
    return SEC_PROBE_FAILED
  }
  const { root, app, legal } = sec
  const fmt = (v) => (v ? '✓' : '✗')
  console.log('\n安全防护：')
  console.log(`  首页 /        CSP  ${root.cspMeta ? '<meta>' : fmt(root.cspHeader)}   Referrer ${fmt(root.referrer || root.referrerMeta)}`)
  console.log(`  应用 /app     CSP  ${fmt(app && app.cspHeader)} frame-ancestors ${fmt(app && app.frameAncestors)}  XCTO ${fmt(app && app.xcto)}  HSTS ${fmt(app && app.hsts)}`)
  console.log(`  法律 /legal   CSP  ${fmt(legal && legal.cspHeader)} frame-ancestors ${fmt(legal && legal.frameAncestors)}  XCTO ${fmt(legal && legal.xcto)}`)
  const missing = []
  if (!(app && app.cspHeader) && !root.cspMeta) missing.push('CSP')
  if (!(app && app.frameAncestors)) missing.push('frame-ancestors')
  if (!(app && app.xcto)) missing.push('X-Content-Type-Options')
  if (!(legal && legal.xcto)) missing.push('X-Content-Type-Options(legal)')
  return missing
}

async function main() {
  const baseArg = process.argv[2]
  const baseEnv = process.env.ULINK_BASE_URL
  const base = (baseArg || baseEnv || 'https://ulink.ren').replace(/\/+$/, '')
  // base 来自 argv/ULINK_BASE_URL 时打印明显警告，避免把非生产地址误当成线上正式版本自检
  if (baseArg || baseEnv) {
    console.warn(`\n⚠⚠ 警告：本次使用自定义 base=${base}（来自 ${baseArg ? 'argv' : 'ULINK_BASE_URL'}），并非默认生产地址 https://ulink.ren`)
    console.warn('   结果不能代表线上正式环境的版本/安全头状态，请确认目标地址无误。')
  }
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

  const rawCommit = typeof remote.commit === 'string' ? remote.commit : ''
  // 未通过白名单的值只用于展示，绝不用于 git 命令
  const remoteCommit = isGitSha(rawCommit) ? rawCommit : ''
  const remoteShort = isGitSha(rawCommit) ? rawCommit.slice(0, 7) : 'unknown'

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
    let sec
    try {
      sec = await checkSecurity(base)
    } catch (err) {
      sec = { ...SEC_PROBE_FAILED, error: err instanceof Error ? err.message : String(err) }
    }
    const missing = printSecurity(sec)
    // 探测失败哨兵：返回 3，杜绝「sec=null → missing=[] → return 0」的假绿
    if (missing === SEC_PROBE_FAILED) {
      console.log('\n✗ 安全防护探测失败，无法确认线上防护状态')
      return 3
    }
    if (missing.length > 0) {
      console.log(`\n✗ 安全防护不完整：缺失 ${missing.join('、')}`)
      console.log('  CSP/Referrer-Policy 的仓库内兜底是构建期 <meta>（见 vite.config.ts securityMetaPlugin），')
      console.log('  推新构建后才会生效；X-Content-Type-Options 与 frame-ancestors 需平台侧支持（docs/TECH_DEBT.md §零 #1）。')
      return 4
    }
    // 工作区有未提交修改：HEAD 已不能代表本地实际代码，返回专用码 5 而非假绿 0
    if (localDirty) {
      console.log('\n⚠ 工作区有未提交修改，线上 HEAD 不代表本地实际代码（专用码 5）')
      return 5
    }
    return 0
  }

  if (isGitSha(remoteCommit) && isAncestor(remoteCommit, localCommit)) {
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
