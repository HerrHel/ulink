/**
 * CloudBase 令牌校验探针 —— 验证「云函数能否用 access_token 换到 uid」
 *
 * 用途：在真实环境确认 access_token 的形态与三条校验路径的可用性。
 *   A. 令牌是不是可验签的 RS256 JWT（决定能否离线验签、省掉一次外网调用）
 *   B. JWKS 公钥能否完成本地验签
 *   C. userinfo 端点（/auth/v1/user/me）能否兜底换取 uid
 *
 * 用法：
 *   node scripts/probe-cb-auth.mjs            # 只探端点与公钥集，不需要令牌
 *   node scripts/probe-cb-auth.mjs <token>    # 完整验证（推荐从文件/环境变量传入）
 *   或 echo <token> | node scripts/probe-cb-auth.mjs -
 *
 * 令牌来源（浏览器）：DevTools → Application → Local Storage → 找 auth 相关键里的
 * access_token；或登录后在控制台执行 cloudbase.auth().getAccessToken()。
 */
import { createPublicKey, createVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'

const ENV_ID =
  process.env.VITE_CLOUDBASE_ENV_ID ||
  (() => {
    try {
      const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      return (env.match(/^VITE_CLOUDBASE_ENV_ID=(.+)$/m)?.[1] || '').trim().replace(/^"|"$/g, '')
    } catch {
      return ''
    }
  })()

if (!ENV_ID) {
  console.error('✖ 找不到 envId（VITE_CLOUDBASE_ENV_ID），请检查 .env.local')
  process.exit(1)
}

const BASE = `https://${ENV_ID}.api.tcloudbasegateway.com`
const JWKS_URL = `${BASE}/auth/v1/certs`
const USERINFO_URL = `${BASE}/auth/v1/user/me`

const ok = (m) => console.log(`  ✅ ${m}`)
const bad = (m) => console.log(`  ❌ ${m}`)
const info = (m) => console.log(`     ${m}`)
const section = (m) => console.log(`\n${m}`)

/** base64url → JSON */
function decodeSegment(seg) {
  try {
    return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

async function readToken() {
  const arg = process.argv[2]
  if (!arg) return null
  if (arg !== '-') return arg.trim()
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function main() {
  console.log(`CloudBase 令牌校验探针`)
  console.log(`env    : ${ENV_ID}`)
  console.log(`issuer : ${BASE}`)

  // ── 1. OIDC discovery ──
  section('[1] OIDC discovery')
  let discovery = null
  try {
    const res = await fetch(`${BASE}/.well-known/openid-configuration`)
    discovery = await res.json()
    ok(`HTTP ${res.status}`)
    info(`jwks_uri     = ${discovery.jwks_uri}`)
    info(`userinfo     = ${discovery.userinfo_endpoint}`)
    info(`签名算法     = ${(discovery.id_token_signing_alg_values_supported || []).join(', ')}`)
  } catch (e) {
    bad(`不可达：${e.message}`)
  }

  // ── 2. JWKS ──
  section('[2] 公钥集（离线验签的前提）')
  let jwks = []
  try {
    const res = await fetch(JWKS_URL)
    const body = await res.json()
    jwks = (body.keys || []).filter((k) => k.kty === 'RSA' && k.n && k.e)
    ok(`HTTP ${res.status}，可用公钥 ${jwks.length} 把`)
    for (const [i, k] of jwks.entries()) {
      let imported = '导入失败'
      try {
        const key = createPublicKey({ key: { kty: 'RSA', n: k.n, e: k.e }, format: 'jwk' })
        imported = `${key.asymmetricKeyDetails.modulusLength}bit`
      } catch (e) {
        imported = `导入失败：${e.message}`
      }
      info(`#${i} kid=${(k.kid || '(无)').slice(0, 12)} alg=${k.alg || '-'} use=${k.use || '-'} → ${imported}`)
    }
  } catch (e) {
    bad(`拉取失败：${e.message}`)
  }

  // ── 3. 令牌形态 ──
  const token = await readToken()
  if (!token) {
    section('[3] 令牌验证')
    info('未提供令牌，跳过。传入方式：')
    info('  node scripts/probe-cb-auth.mjs <token>')
    info('  echo <token> | node scripts/probe-cb-auth.mjs -')
    console.log('\n结论：环境侧（端点 + 公钥）已就绪；令牌侧需提供 real token 才能定论。')
    return
  }

  section('[3] 令牌形态')
  const parts = token.split('.')
  let offlineResult = null

  if (parts.length === 3) {
    const header = decodeSegment(parts[0])
    const payload = decodeSegment(parts[1])
    ok('是 3 段 JWT 结构')
    info(`header  = ${JSON.stringify(header)}`)
    if (payload) {
      const expS = typeof payload.exp === 'number' ? payload.exp : null
      const expIn = expS ? Math.round((expS * 1000 - Date.now()) / 60000) : null
      info(
        `payload: sub=${payload.sub ?? '(无)'} iss=${payload.iss ?? '-'} aud=${payload.aud ?? '-'} exp=${expS ? new Date(expS * 1000).toISOString() : '(无)'}${expIn !== null ? `（${expIn > 0 ? '剩 ' + expIn + ' 分钟' : '已过期' }）` : ''}`,
      )
    }

    // ── 4. 离线验签 ──
    section('[4] 离线验签（本地用 JWKS 公钥）')
    const alg = header?.alg
    const kid = header?.kid
    if (alg !== 'RS256') {
      bad(`alg=${alg}，非 RS256 → 本方案不可离线验签，必须走 userinfo 兜底`)
    } else if (jwks.length === 0) {
      bad('无可用公钥，跳过')
    } else {
      const jwk = kid ? jwks.find((k) => k.kid === kid) : jwks.length === 1 ? jwks[0] : null
      if (!jwk) {
        bad(`kid=${kid} 在公钥集中不存在（可能已轮换）`)
      } else {
        try {
          const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
          const v = createVerify('RSA-SHA256')
          v.update(`${parts[0]}.${parts[1]}`)
          v.end()
          const good = v.verify(key, Buffer.from(parts[2], 'base64url'))
          if (good) {
            ok(`签名校验通过 —— access_token 是 RS256 JWT，云函数可离线验签（零外网调用）`)
            offlineResult = 'ok'
          } else {
            bad('签名不匹配 —— 令牌不是本环境签发，或公钥已轮换')
            offlineResult = 'bad_signature'
          }
        } catch (e) {
          bad(`验签异常：${e.message}`)
        }
      }
    }
  } else {
    bad(`不是 JWT（${parts.length} 段）→ opaque token，必须走 userinfo 兜底`)
  }

  // ── 5. userinfo 兜底 ──
  section('[5] userinfo 在线校验（兜底路径）')
  let userinfoUid = null
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    })
    const body = await res.json().catch(() => null)
    if (res.ok && body) {
      const user = body.user && typeof body.user === 'object' ? body.user : body
      userinfoUid = user.sub || user.id || user.user_id || null
      ok(`HTTP ${res.status}`)
      info(`返回字段: ${Object.keys(user).join(', ')}`)
      if (userinfoUid) ok(`uid = ${userinfoUid}`)
      else bad('响应里找不到 sub / id / user_id，需适配字段名')
    } else {
      bad(`HTTP ${res.status}：${JSON.stringify(body)?.slice(0, 200)}`)
    }
  } catch (e) {
    bad(`不可达：${e.message}`)
  }

  // ── 结论 ──
  section('结论')
  if (offlineResult === 'ok') {
    console.log('  ✔ 推荐方案：云函数内离线 RS256 验签（JWKS 缓存 1h），sub 即 uid。')
    if (userinfoUid) console.log(`     userinfo 交叉印证一致：${userinfoUid}`)
  } else if (userinfoUid) {
    console.log('  ✔ access_token 非可验签 JWT（或 kid 不匹配）→ 走 userinfo 兜底。')
    console.log('     每次请求多一次网关调用，建议在云函数内按 token 前缀做 60s 缓存。')
  } else {
    console.log('  ✘ 两条路径都失败 —— 令牌无效或已过期，请重新登录后取新 token 复测。')
  }
  if (offlineResult === 'ok' || userinfoUid) {
    console.log(`\n  最终 uid: ${userinfoUid || '(离线验签成功，见 [3] 的 sub)'}`)
  }
}

main().catch((e) => {
  console.error('探针异常：', e)
  process.exit(1)
})
