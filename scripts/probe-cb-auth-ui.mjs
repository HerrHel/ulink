/**
 * 交互式探针：打开真实浏览器 → 你登录一次 → 自动抓取 access_token 并验证
 *
 * 为什么需要交互：生产环境已禁用匿名登录，而合法令牌只能由真实登录产生。
 * 本脚本不要求你手动复制凭证，登录完成后自动从 localStorage 取证。
 *
 * 用法：
 *   node scripts/probe-cb-auth-ui.mjs                # 默认打开 https://ulink.ren
 *   node scripts/probe-cb-auth-ui.mjs http://localhost:5173
 *
 * 安全：token 不会写入磁盘，日志里只打印长度与前 12 字符；验证完即丢弃。
 */
import { chromium } from 'playwright'
import { createRequire } from 'node:module'

// cb-auth.js 是 esbuild 产出的 CJS，用 require 加载最稳（ESM 命名导出对 CJS 不可靠）
const require = createRequire(import.meta.url)

const URL = process.argv[2] || 'https://ulink.ren'
const TIMEOUT_SEC = 300

const ENV_ID = 'ulink-d1g5srvjo54b1886a'
const BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`

const log = (m) => console.log(m)

/** 从任意字符串里挑出形如 JWT 的片段 */
function pickJwt(value) {
  if (typeof value !== 'string') return null
  const direct = /^eyJ[W-zA-Z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/
  if (direct.test(value)) return value
  // JSON 里嵌套的情形：递归找字符串值
  if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
    try {
      const walk = (o) => {
        if (typeof o === 'string') return direct.test(o) ? o : null
        if (o && typeof o === 'object') {
          for (const v of Object.values(o)) {
            const hit = walk(v)
            if (hit) return hit
          }
        }
        return null
      }
      return walk(JSON.parse(value))
    } catch {
      return null
    }
  }
  // 兜底：值里包含 eyJ... 的 JWT 子串
  const m = value.match(/eyJ[W-zA-Z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{10,}/)
  return m ? m[0] : null
}

function decode(seg) {
  try {
    return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/** 页面内注入提示条，让用户知道该做什么 */
async function banner(page, text) {
  await page
    .evaluate((t) => {
      let el = document.getElementById('__probe_banner')
      if (!el) {
        el = document.createElement('div')
        el.id = '__probe_banner'
        el.style.cssText =
          'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:14px 20px;' +
          'background:#185FA5;color:#fff;font:500 15px/1.5 system-ui,sans-serif;text-align:center;' +
          'box-shadow:0 2px 12px rgba(0,0,0,.35)'
        document.body.appendChild(el)
      }
      el.textContent = t
    }, text)
    .catch(() => {})
}

const browser = await chromium.launch({ headless: false })
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } })
const page = await ctx.newPage()

let token = null
try {
  log(`打开 ${URL} …`)
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await banner(page, '正在等待登录：请点「登录」，用邮箱验证码或密码登录一次。登录成功后本窗口会自动关闭。')

  log('等待登录中（最多 ' + TIMEOUT_SEC + ' 秒）…')
  const deadline = Date.now() + TIMEOUT_SEC * 1000
  while (Date.now() < deadline) {
    const found = await page
      .evaluate(() => {
        const pick = (store) => {
          const out = []
          for (let i = 0; i < store.length; i++) {
            const k = store.key(i)
            try {
              out.push({ k, v: store.getItem(k) })
            } catch {
              /* 忽略不可读项 */
            }
          }
          return out
        }
        return [...pick(localStorage), ...pick(sessionStorage)]
      })
      .catch(() => [])

    for (const { k, v } of found) {
      const jwt = pickJwt(v)
      if (jwt) {
        const payload = decode(jwt.split('.')[1])
        // 必须是带 sub 的令牌，且未过期，才认定为目标令牌
        if (payload?.sub && (!payload.exp || payload.exp * 1000 > Date.now())) {
          token = jwt
          log(`✓ 已从 localStorage 取到令牌（键名 ${k}）`)
          break
        }
      }
    }
    if (token) break
    await page.waitForTimeout(1500)
  }

  if (!token) {
    log('✖ 超时未检测到登录态。请确认已登录成功后再重跑。')
    process.exitCode = 2
  } else {
    const [h, p] = token.split('.')
    const header = decode(h)
    const payload = decode(p)
    log('\n[令牌形态]')
    log('  长度        : ' + token.length)
    log('  指纹        : ' + token.slice(0, 12) + '…（不落盘）')
    log('  header      : ' + JSON.stringify(header))
    log('  sub         : ' + payload?.sub)
    log('  iss         : ' + (payload?.iss ?? '(无)'))
    log('  exp         : ' + (payload?.exp ? new Date(payload.exp * 1000).toISOString() : '(无)'))
    log('  段数        : ' + token.split('.').length)

    // ── 离线验签 ──
    log('\n[离线验签 · 用公钥本地校验]')
    let offlineOk = false
    try {
      const { verifyJwtWithJwks, fetchJwks } = require('../cloudbase/functions/mimo-chat/cb-auth.js')
      const keys = await fetchJwks(ENV_ID)
      log('  公钥集      : ' + keys.length + ' 把')
      const r = verifyJwtWithJwks(token, keys)
      log('  结果        : ' + JSON.stringify(r))
      offlineOk = r.ok
    } catch (e) {
      log('  异常        : ' + e.message)
    }

    // ── userinfo 兜底 ──
    log('\n[userinfo 在线校验 · 兜底路径]')
    let uiUid = null
    try {
      const res = await fetch(`${BASE}/auth/v1/user/me`, {
        headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      })
      const body = await res.json().catch(() => null)
      if (res.ok && body) {
        const u = body.user && typeof body.user === 'object' ? body.user : body
        uiUid = u.sub || u.id || u.user_id || null
        log('  HTTP        : ' + res.status)
        log('  字段        : ' + Object.keys(u).join(', '))
        log('  uid         : ' + (uiUid ?? '(未找到 sub/id)'))
      } else {
        log('  HTTP ' + res.status + ' : ' + JSON.stringify(body)?.slice(0, 180))
      }
    } catch (e) {
      log('  异常        : ' + e.message)
    }

    // ── 结论 ──
    log('\n========== 结论 ==========')
    if (offlineOk) {
      log('✔ access_token 是可离线验签的 RS256 JWT。')
      log('  → 云函数用 cb-auth 验签即可拿到 uid，零外网开销，不存在每次请求打网关的问题。')
      log('  uid = ' + (payload?.sub ?? uiUid))
    } else if (uiUid) {
      log('✔ access_token 不能离线验签（opaque 或 kid 不匹配），但 userinfo 可用。')
      log('  → 云函数需回落 userinfo，建议按 token 前缀做 60s 缓存压低开销。')
      log('  uid = ' + uiUid)
    } else {
      log('✖ 两条路径都不通，令牌可能已失效，请重新登录后复测。')
      process.exitCode = 1
    }
    log('==========================')
  }
} finally {
  await browser.close().catch(() => {})
}
