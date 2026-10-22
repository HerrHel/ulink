/**
 * 探测 @cloudbase/js-sdk 的 auth 表面（不发请求，无副作用）
 *
 * 目的：确认 CloudBase 身份认证 v3 到底提供了哪些登录方法，
 * 特别是「邮箱验证码 / 邮箱密码 / 微信 OAuth」三类是否原生可用。
 *
 * 用法: node scripts/verify-cloudbase-auth.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvLocal() {
  const raw = readFileSync(resolve('.env.local'), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const env = loadEnvLocal()
const { default: cloudbase } = await import('@cloudbase/js-sdk')
const app = cloudbase.init({ env: env.VITE_CLOUDBASE_ENV_ID, accessKey: env.VITE_PUBLISHABLE_KEY })

const auth = app.auth
console.log('app.auth 存在:', Boolean(auth), '｜类型:', typeof auth)

function methodNames(obj) {
  const names = new Set()
  let cur = obj
  while (cur && cur !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(cur)) {
      if (n === 'constructor') continue
      if (typeof obj[n] === 'function') names.add(n)
    }
    cur = Object.getPrototypeOf(cur)
  }
  return [...names].sort()
}

const methods = methodNames(auth)
console.log(`\n可调用方法 ${methods.length} 个：`)
console.log(methods.join(', '))

const expected = [
  'signInWithOtp',      // 邮箱/短信验证码：发码
  'verifyOtp',          // 独立校验（需 messageId，通常用返回的 data.verifyOtp 闭包）
  'signInWithPassword', // 邮箱/用户名 + 密码
  'signUp',             // 注册（发码 + 设密码）
  'resetPasswordForEmail',
  'signInWithOAuth',    // 第三方（微信等）
  'signOut',
  'getSession',
  'getUser',
  'onAuthStateChange',
]

console.log('\n本项目需要的登录能力：')
for (const m of expected) {
  const ok = typeof auth[m] === 'function'
  console.log(`  ${ok ? '✔' : '✖'} ${m}`)
}

// 会话形状（未登录态）
try {
  const s = await auth.getSession()
  console.log('\ngetSession() 未登录时:', JSON.stringify(s))
} catch (e) {
  console.log('\ngetSession() 抛出:', e?.message ?? e)
}
