/**
 * 直接用 SMTP AUTH 验证企业邮账号能否登录（不依赖 CloudBase）
 *
 * 用途：当 CloudBase 报 `535 authentication failed` 时，隔离问题到底在
 * 凭据本身、还是平台侧（IP/安全策略）。
 *
 * 密码来源：默认从 Supabase 管理 API 读（不落盘、不打印）；
 * 也可用 CLOUDBASE_SMTP_USER / CLOUDBASE_SMTP_PASS 环境变量覆盖。
 *
 * 用法: node scripts/verify-smtp-auth.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tls from 'node:tls'

function readDotEnv(key) {
  try {
    const raw = readFileSync(resolve('.env'), 'utf8')
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : undefined
  } catch {
    return undefined
  }
}

/** .env.local 优先级最高（新密码放这里，覆盖 Supabase 里的旧密码） */
function readEnvLocal(key) {
  try {
    const raw = readFileSync(resolve('.env.local'), 'utf8')
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : undefined
  } catch {
    return undefined
  }
}

async function fromSupabase() {
  const token = process.env.SUPABASE_ACCESS_TOKEN || readDotEnv('SUPABASE_ACCESS_TOKEN')
  const url = process.env.VITE_SUPABASE_URL || readDotEnv('VITE_SUPABASE_URL')
  if (!token || !url) return null
  const ref = url.replace(/^https?:\/\//, '').split('.')[0]
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const c = await res.json()
  return { host: c.smtp_host, port: Number(c.smtp_port) || 465, user: c.smtp_user, pass: c.smtp_pass }
}

const sb = await fromSupabase()
const host = process.env.CLOUDBASE_SMTP_HOST || readEnvLocal('CLOUDBASE_SMTP_HOST') || sb?.host || 'smtp.exmail.qq.com'
const port = Number(
  process.env.CLOUDBASE_SMTP_PORT || readEnvLocal('CLOUDBASE_SMTP_PORT') || sb?.port || 465,
)
const user = process.env.CLOUDBASE_SMTP_USER || readEnvLocal('CLOUDBASE_SMTP_USER') || sb?.user
const pass = process.env.CLOUDBASE_SMTP_PASS || readEnvLocal('CLOUDBASE_SMTP_PASS') || sb?.pass

if (!user || !pass) {
  console.error('✖ 没有可用的 SMTP 账号/密码')
  process.exit(1)
}

console.log(`目标 ${host}:${port}  账号 ${user}  密码 <${pass.length} 字符>`)

const socket = tls.connect({ host, port, servername: host, timeout: 20000 })
socket.setEncoding('utf8')

let buffer = ''
let step = 0
let lastCode = ''
const transcript = []

function say(line) {
  transcript.push('C: ' + line.replace(/^(AUTH LOGIN|[A-Za-z0-9+/=]{4,})$/, (m) => (m.length > 20 ? '<redacted>' : m)))
  socket.write(line + '\r\n')
}

socket.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\r\n')) >= 0) {
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 2)
    if (/^\d{3}/.test(line)) {
      lastCode = line.slice(0, 3)
      transcript.push('S: ' + line)
      handle(lastCode, line)
    }
  }
})

function handle(code, line) {
  if (step === 0 && code === '220') {
    step = 1
    say('EHLO localhost')
    return
  }
  if (step === 1 && code === '250' && /AUTH/i.test(line)) {
    // 多行 EHLO 响应，等最后一行再发；此处以松散方式处理
    step = 2
    say('AUTH LOGIN')
    return
  }
  if (step === 2 && code === '334') {
    step = 3
    say(Buffer.from(user, 'utf8').toString('base64'))
    return
  }
  if (step === 3 && code === '334') {
    step = 4
    say(Buffer.from(pass, 'utf8').toString('base64'))
    return
  }
  if (step === 4) {
    if (code === '235') {
      console.log('\n✔ SMTP 认证成功 —— 凭据本身有效，问题在平台侧（IP/安全策略）')
    } else if (code === '535') {
      console.log('\n✖ SMTP 认证失败 535 —— 密码无效 / 需要客户端专用密码 / 该账号 SMTP 未开启')
    } else {
      console.log(`\n? 未预期的返回码 ${code}: ${line}`)
    }
    console.log('\n--- 会话记录 ---')
    for (const t of transcript) console.log(t)
    socket.end()
    process.exit(0)
  }
}

socket.on('timeout', () => {
  console.log('✖ 连接超时')
  socket.destroy()
  process.exit(1)
})
socket.on('error', (e) => {
  console.log('✖ 连接错误:', e.code || e.message)
  process.exit(1)
})
