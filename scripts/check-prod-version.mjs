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
 *   3 = 网络/解析/本地 git 命令失败（含安全头探测失败，避免假绿）
 *   4 = 版本一致，但线上安全防护不完整（入口页 CSP 缺失、或网关未下发 XFO/XCTO，
 *       含 / privacy.html / terms.html / extension-guide.html 各页）
 *   5 = 版本一致，但本地工作区有未提交修改（HEAD 不代表线上/本地实际代码）
 *
 * 注：不用 process.exit() —— Node 24 + Windows 下 fetch 的 undici 句柄会在退出时
 * 触发 libuv 断言（0xC0000409）；改为返回退出码交给 process.exitCode。
 */
import { execFileSync, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/**
 * 执行 git 命令（#59）。
 * 旧版吞掉任何异常返回空串：git 不可用 / 不在仓库 / 命令报错时，
 * `git status --porcelain` 会得到 '' → localDirty=false，绕过「工作区有未提交修改」判定，
 * 把「拿不到本地状态」误报成「干净」。现改为失败即抛，由 main 统一报错并非零退出。
 */
function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  } catch (e) {
    const detail = String((e && e.stderr) || (e && e.message) || e).trim().slice(0, 300)
    throw new Error(`git 命令执行失败：${cmd}${detail ? `\n  ${detail}` : ''}`)
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
 * 线上安全防护探测（2026-11-14 更新，对齐 11-12 定稿的网关拓扑）。
 *
 * 现在的真实形态（别再按旧的 edge-headers 反代假设来判）：
 * - `/`、`/app`、`/legal/*` 全部是 **静态托管直连**，不再经云函数反代；
 * - XCTO / XFO / HSTS / Referrer-Policy 由**网关「自定义域名 → Headers 设置」统一注入**，
 *   与具体页面无关（连 404 页都带）；
 * - CSP 只存在于**页面 `<meta>`**（构建期注入）。域名层刻意不加 CSP，否则会与各页策略取交集。
 *
 * ⚠️ `frame-ancestors` **不能**通过 `<meta>` 交付（CSP 规范明确忽略），所以「点击劫持防护」
 * 在 meta-only 形态下只能靠 `X-Frame-Options`。旧版自检找 CSP 头里的 frame-ancestors，
 * 在拓扑切换后必然恒红 —— 假警报会让真回归被忽略，故改为直接校验 XFO。
 *
 * - 分享页 `/s/*`：share-ssr 自带 XCTO / XFO + `X-Robots-Tag: noindex`。
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
    cspValue: csp,
    robotsTag: res.headers.get('x-robots-tag') || '',
    shareRender: res.headers.get('x-share-render') || '',
  }
}

// 分享页 /s/* 探针：用一个必然不存在的 slug，share-ssr 会回 404 + 完整安全头（404 不是失败）。
// 分享页的安全头**只由 share-ssr 自己下发**、页面无 <meta> CSP 兜底，是唯一一道 XSS 防线；
// 2026-11-23 曾因网关 Headers 动作选成「覆盖」把整条 CSP 换掉。故这里校验的是 share-ssr
// 严格 CSP 的特征指令，而不只是「有 CSP 头」——被网关换成别的 CSP 也要报红。
const SHARE_PROBE_PATH = '/s/__check_prod_probe__'
const SHARE_CSP_MARKERS = ["frame-ancestors 'none'", "object-src 'none'", "script-src-attr 'none'", "base-uri 'none'"]

/** 返回分享页缺失项（纯函数）；probe 为 null（探测失败）按 fail-closed 记缺失 */
function shareMissing(probe) {
  if (!probe) return ['探测失败(/s/*)']
  const missing = []
  // x-share-render 缺失说明请求没打到 share-ssr（路由被改成静态托管 404 等），其余头也就不可信
  if (probe.shareRender !== 'v2') missing.push('share-ssr 路由(/s/*)')
  const csp = probe.cspValue || ''
  const lost = SHARE_CSP_MARKERS.filter((m) => !csp.includes(m))
  if (!csp) missing.push('CSP(/s/*)')
  else if (lost.length) missing.push(`CSP 被替换(/s/*，缺 ${lost.join(' / ')})`)
  if (!probe.xfo) missing.push('X-Frame-Options(/s/*)')
  if (!probe.xcto) missing.push('X-Content-Type-Options(/s/*)')
  if (!/noindex/i.test(probe.robotsTag || '')) missing.push('X-Robots-Tag noindex(/s/*)')
  return missing
}

// 探测失败哨兵：网络/解析异常时用它代替 null，main 见到它返回 3；
// 旧版首页探测失败会抛错 → sec=null → printSecurity 返回 [] → main 返回 0（假绿）。
const SEC_PROBE_FAILED = { probeFailed: true }

// #51：安全自检原来只探 3 个入口（/ /app /legal/privacy-policy.html）。
// public/ 下的 privacy.html / terms.html / extension-guide.html 是线上真实可访问的页面
// （旧地址重定向页 + 扩展说明页）；CloudBase 静态托管不下发 `_headers`，这三页实测没有 CSP。
// 这里补进自检并**如实报缺失**：不放宽断言、不为让自检变绿而跳过或豁免这些页面。
// 真正补齐 CSP 需给这三个 public/*.html 加 `<meta http-equiv="Content-Security-Policy">`
// （本批次越界，见修复报告）；在补齐前，`npm run check:prod` 会如实返回 4。
const EXTRA_SECURITY_PAGES = [
  { key: 'privacy', label: '隐私 /privacy.html', path: '/privacy.html' },
  { key: 'terms', label: '条款 /terms.html', path: '/terms.html' },
  { key: 'extensionGuide', label: '扩展 /extension-guide.html', path: '/extension-guide.html' },
  // 2026-11-25：宣传页从 / 搬到 /about（/ 现在直接是应用）
  { key: 'about', label: '介绍 /about', path: '/about' },
]

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
  let probeError = ''
  const probeOne = async (path) => {
    try {
      return await probePage(`${base}${path}?t=${Date.now()}`)
    } catch (err) {
      // 网络抖动/超时/404 是「无法判定」，不是「防护缺失」。旧实现保留 null 并计入
      // missing → 返回 4，与首页同类失败返回 3 的语义矛盾，误导排查方向。
      probeError = err instanceof Error ? err.message : String(err)
      return null
    }
  }
  app = await probeOne('/app')
  legal = await probeOne('/legal/privacy-policy.html')
  const extraPages = []
  for (const p of EXTRA_SECURITY_PAGES) {
    extraPages.push({ ...p, probe: await probeOne(p.path) })
  }
  if (probeError) return { ...SEC_PROBE_FAILED, error: `入口页探测失败：${probeError}` }
  // 分享页单独探测：失败不归为「无法判定」(3)，而是按缺失计入 (4)——它是唯一防线，宁可误报
  let share = null
  try {
    share = await probePage(`${base}${SHARE_PROBE_PATH}?t=${Date.now()}`)
  } catch {
    share = null
  }
  return { root, app, legal, extraPages, share }
}

function printSecurity(sec) {
  if (!sec || sec.probeFailed || !sec.root) {
    // 探测失败（哨兵 / sec 为空）返回哨兵而非 []，避免 main 把失败当成「无缺失」假绿
    console.log(`\n安全防护：⚠ 探测失败${sec && sec.error ? `（${sec.error}）` : '（网络错误）'}`)
    return SEC_PROBE_FAILED
  }
  const { root, app, legal, extraPages = [], share = null } = sec
  const fmt = (v) => (v ? '✓' : '✗')
  console.log('\n安全防护：')
  console.log(`  首页 /        CSP  ${root.cspMeta ? '<meta>' : fmt(root.cspHeader)}   Referrer ${fmt(root.referrer || root.referrerMeta)}`)
  const cspOf = (p) => (!p ? '-' : p.cspHeader ? 'header' : p.cspMeta ? '<meta>' : '✗')
  console.log(`  应用 /app     CSP  ${cspOf(app)}  XFO ${fmt(app && app.xfo)}  XCTO ${fmt(app && app.xcto)}  HSTS ${fmt(app && app.hsts)}`)
  console.log(`  法律 /legal   CSP  ${cspOf(legal)}  XFO ${fmt(legal && legal.xfo)}  XCTO ${fmt(legal && legal.xcto)}`)
  const missing = []
  // CSP：每个入口各自必须有（header 或 meta 皆可，静态直连形态下 meta 是唯一通道）
  if (!(root.cspMeta || root.cspHeader)) missing.push('CSP(/)')
  if (!(app && (app.cspHeader || app.cspMeta))) missing.push('CSP(/app)')
  if (!(legal && (legal.cspHeader || legal.cspMeta))) missing.push('CSP(/legal)')
  // 点击劫持：meta 交付不了 frame-ancestors，只能靠 XFO 响应头（网关域名层注入）
  if (!(app && app.xfo)) missing.push('X-Frame-Options(/app)')
  if (!(legal && legal.xfo)) missing.push('X-Frame-Options(/legal)')
  if (!(app && app.xcto)) missing.push('X-Content-Type-Options(/app)')
  if (!(legal && legal.xcto)) missing.push('X-Content-Type-Options(/legal)')
  // #51：新增页面的 CSP 断言，与其它入口一样严格（缺即计入 missing → 返回 4）。
  // 探测失败（probe=null）同样按「缺失」计入，保持 fail-closed，不制造假绿。
  for (const p of extraPages) {
    const hasCsp = !!(p.probe && (p.probe.cspHeader || p.probe.cspMeta))
    console.log(`  ${p.label}  CSP  ${fmt(hasCsp)}`)
    if (!hasCsp) missing.push(`CSP(${p.key})`)
  }
  const shareLost = shareMissing(share)
  console.log(`  分享 /s/*     ${shareLost.length ? '✗ ' + shareLost.join('、') : 'CSP(严格) ✓  XFO ✓  XCTO ✓  noindex ✓'}`)
  missing.push(...shareLost)
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
  // #59：git 命令失败必须显式报错并非零退出，不能让 localDirty 判定被静默绕过。
  // 返回 3（与网络/解析失败同码，语义是「无法可靠判定」），避免假绿。
  let localCommit
  let localBranch
  let localDirty
  try {
    localCommit = sh('git rev-parse HEAD')
    localBranch = sh('git rev-parse --abbrev-ref HEAD') || 'unknown'
    localDirty = sh('git status --porcelain') !== ''
  } catch (err) {
    console.error(`✗ 本地 git 信息不可用，无法判定版本一致性：${err instanceof Error ? err.message : String(err)}`)
    return 3
  }
  const localShort = localCommit ? localCommit.slice(0, 7) : 'unknown'

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
    // 仅用于展示「落后几个提交」；sh() 现在会抛，取不到时保留 '?' 不影响主判定（仍返回 1）
    let behind = '?'
    try {
      behind = sh(`git rev-list --count ${remoteCommit}..HEAD`) || '?'
    } catch { /* 展示值，失败不升级为整体失败 */ }
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
