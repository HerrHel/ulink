/**
 * 用企业邮 SMTP 发一封真实测试信，用于验证投递链路与 SPF/DKIM/DMARC
 *
 * 为什么需要它：站点的「发送验证码」目前还走 Supabase（VITE_BACKEND 未切），
 * 所以不能用来验证 CloudBase → 企业邮 这条新链路。这个脚本直接走 SMTP，
 * 能独立证明「企业邮能以 ulink.ren 的身份把信发出去，并且带上 DKIM 签名」。
 *
 * 用法:
 *   node scripts/send-test-mail.mjs you@example.com
 *   node scripts/send-test-mail.mjs            # 不传则发给自己（SMTP 账号）
 *
 * 收到后怎么判：
 *   1) 发件人应显示「与链 ulink」<noreply@ulink.ren>
 *   2) 看原始信头（QQ 邮箱：更多 → 显示邮件原文；Gmail：显示原始邮件）
 *      - 要有 DKIM-Signature: v=1; ... d=ulink.ren; s=gfhp2610
 *      - 收件方加的 Authentication-Results 里应有 spf=pass / dkim=pass / dmarc=pass
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import tls from 'node:tls'

function readEnvLocal(key) {
  try {
    const raw = readFileSync(resolve('.env.local'), 'utf8')
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : undefined
  } catch {
    return undefined
  }
}

const host = readEnvLocal('CLOUDBASE_SMTP_HOST') || 'smtp.exmail.qq.com'
const port = Number(readEnvLocal('CLOUDBASE_SMTP_PORT') || 465)
const user = readEnvLocal('CLOUDBASE_SMTP_USER') || 'noreply@ulink.ren'
const pass = readEnvLocal('CLOUDBASE_SMTP_PASS')
const from = readEnvLocal('CLOUDBASE_SMTP_SENDER') || user
const fromName = '与链 ulink'

const to = process.argv[2] || user
const subject = 'ulink 邮件链路测试'
const stamp = new Date().toISOString()

if (!pass) {
  console.error('✖ .env.local 缺少 CLOUDBASE_SMTP_PASS')
  process.exit(1)
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')

const message = [
  `From: =?UTF-8?B?${b64(fromName)}?= <${from}>`,
  `To: <${to}>`,
  `Subject: =?UTF-8?B?${b64(subject)}?=`,
  `Date: ${new Date().toUTCString()}`,
  `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@ulink.ren>`,
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  'Content-Transfer-Encoding: 8bit',
  '',
  '这是一封由 ulink 迁移脚本发出的测试邮件。',
  '',
  `发件人：${fromName} <${from}>`,
  `收件人：${to}`,
  `时间：${stamp}`,
  '',
  '用途：确认 ulink.ren 的外发邮件能通过 SPF / DKIM / DMARC。',
  '',
  '— 与链 ulink',
].join('\r\n')

console.log(`SMTP ${host}:${port}  ${from} → ${to}`)

const socket = tls.connect({ host, port, servername: host, timeout: 30000 })
let step = 0
let buffer = ''

function send(line, redact = false) {
  console.log('C:', redact ? '<redacted>' : line.length > 70 ? line.slice(0, 70) + '…' : line)
  socket.write(line + '\r\n')
}

function advance(code, sep) {
  if (step === 0 && code === 220) {
    step = 1
    send('EHLO ulink.ren')
    return
  }
  // EHLO 多行响应：以 "250 " （空格）结束，等最后一行再继续
  if (step === 1 && code === 250 && sep === ' ') {
    step = 2
    send('AUTH LOGIN')
    return
  }
  if (step === 2 && code === 334) {
    step = 3
    send(b64(user), true)
    return
  }
  if (step === 3 && code === 334) {
    step = 4
    send(b64(pass), true)
    return
  }
  if (step === 4 && code === 235) {
    step = 5
    send(`MAIL FROM:<${from}>`)
    return
  }
  if (step === 4 && String(code).startsWith('5')) {
    console.log('\n✖ SMTP 认证失败', code)
    socket.end()
    process.exit(1)
  }
  if (step === 5 && code === 250) {
    step = 6
    send(`RCPT TO:<${to}>`)
    return
  }
  if (step === 6 && code === 250) {
    step = 7
    send('DATA')
    return
  }
  if (step === 7 && code === 354) {
    step = 8
    socket.write(message + '\r\n.\r\n')
    return
  }
  if (step === 8 && code === 250) {
    step = 9
    console.log('\n✔ 已投递成功 —— 去收件箱（含垃圾箱）看信头')
    send('QUIT')
    return
  }
  if (step === 8 && String(code).startsWith('5')) {
    console.log('\n✖ 服务器拒收', code)
    socket.end()
    process.exit(1)
  }
}

socket.setEncoding('utf8')
socket.on('data', (chunk) => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\r\n')) >= 0) {
    const line = buffer.slice(0, idx)
    buffer = buffer.slice(idx + 2)
    if (!/^\d{3}/.test(line)) continue
    const code = Number(line.slice(0, 3))
    const sep = line[3] || ' '
    console.log('S:', line)
    advance(code, sep)
  }
})

socket.on('timeout', () => {
  console.log('✖ 超时')
  socket.destroy()
  process.exit(1)
})
socket.on('error', (e) => {
  console.log('✖ 连接错误:', e.code || e.message)
  process.exit(1)
})
socket.on('close', () => process.exit(0))
