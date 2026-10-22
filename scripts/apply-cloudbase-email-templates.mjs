/**
 * 配置 CloudBase 邮箱登录：开启 provider + 写入品牌邮件模板
 *
 * 凭证来源（按优先级）：
 *   1) 环境变量 / .env.local 的 CLOUDBASE_SECRET_ID + CLOUDBASE_SECRET_KEY（可再加 CLOUDBASE_TOKEN 走 STS）
 *   2) **本机 `tcb` CLI 已登录的会话**（~/.config/.cloudbase/auth.json 里的临时 STS 凭证）
 *      —— 这是默认路径：CLI 登录过一次就够，不需要额外申请任何密钥
 *
 * 用法：
 *   node scripts/apply-cloudbase-email-templates.mjs --status      # 只看当前 provider 状态
 *   node scripts/apply-cloudbase-email-templates.mjs --dry-run     # 打印将要提交的载荷
 *   node scripts/apply-cloudbase-email-templates.mjs               # 真正写入
 *
 * 底层 API：TCB `ModifyProvider`
 *   { EnvId, Id, On, EmailConfig: { On, SmtpConfig?, TemplateConfig } }
 *
 * ⚠️ 关键：EMAIL 专属配置挂在 **provider 顶层的 `EmailConfig`**，不是 `Config` 里。
 *    `Config` 是给 OAUTH/OIDC/SAML 用的通用字段；往 `Config` 塞 `TemplateConfig`
 *    会被 API 拒成 UnknownParameter（实测踩过）。官方文档
 *    api-reference/manager/node/login-config 的写法有误导，以
 *    @cloudbase/manager-node 的 types/env/index.d.ts 为准。
 *
 *   On='TRUE'（provider 层）  = 启用该登录方式
 *   EmailConfig.On='TRUE'    = 采用 CloudBase 平台代发（零配置，无需自备 SMTP）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const statusOnly = args.includes('--status')
const providerArgIdx = args.indexOf('--provider')
const providerId = providerArgIdx >= 0 ? args[providerArgIdx + 1] : 'email'

function readEnvLocal(key) {
  try {
    const raw = readFileSync(resolve('.env.local'), 'utf8')
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : undefined
  } catch {
    return undefined
  }
}

/** 从 tcb CLI 的登录态读临时 STS 凭证（不打印、不外传） */
function loadCliCredential() {
  try {
    const raw = readFileSync(resolve(homedir(), '.config/.cloudbase/auth.json'), 'utf8')
    const c = JSON.parse(raw).credential
    if (!c?.tmpSecretId || !c?.tmpSecretKey || !c?.tmpToken) return null
    if (c.tmpExpired && Date.now() > Number(c.tmpExpired)) return null
    return { secretId: c.tmpSecretId, secretKey: c.tmpSecretKey, token: c.tmpToken }
  } catch {
    return null
  }
}

const envId = process.env.VITE_CLOUDBASE_ENV_ID || readEnvLocal('VITE_CLOUDBASE_ENV_ID')
if (!envId) {
  console.error('✖ 缺少环境 ID（VITE_CLOUDBASE_ENV_ID）')
  process.exit(1)
}

let credential = null
const envSecretId = process.env.CLOUDBASE_SECRET_ID || readEnvLocal('CLOUDBASE_SECRET_ID')
const envSecretKey = process.env.CLOUDBASE_SECRET_KEY || readEnvLocal('CLOUDBASE_SECRET_KEY')
if (envSecretId && envSecretKey) {
  credential = {
    secretId: envSecretId,
    secretKey: envSecretKey,
    token: process.env.CLOUDBASE_TOKEN || readEnvLocal('CLOUDBASE_TOKEN'),
  }
  console.log('凭证来源: 环境变量 CLOUDBASE_SECRET_ID')
} else {
  credential = loadCliCredential()
  console.log(credential ? '凭证来源: tcb CLI 已登录会话（临时 STS）' : '✖ 没有可用凭证')
}

let CloudBase
try {
  ;({ default: CloudBase } = await import('@cloudbase/manager-node'))
} catch {
  console.error('✖ 未安装 @cloudbase/manager-node，请先执行：npm i -D @cloudbase/manager-node')
  process.exit(1)
}

const app = new CloudBase({ ...(credential || {}), envId })

// ── 只查状态 ──
if (statusOnly) {
  const res = await app.env.getProviders()
  const list = res?.Data || res?.data?.Data || []
  console.log(`环境 ${envId} 共 ${list.length} 个认证源：`)
  for (const p of list) {
    const ec = p.EmailConfig || {}
    const smtp = ec.SmtpConfig || {}
    console.log(`  - ${p.Id} (${p.ProviderType}) On=${p.On}`)
    if (p.ProviderType === 'EMAIL') {
      const reg = ec.TemplateConfig?.RegisterSignIn || {}
      console.log(
        `      代发=${ec.On}  发件地址=${smtp.SenderAddress || '(空)'}  主机=${smtp.ServerHost || '(空)'}:${smtp.ServerPort || 0}  加密=${smtp.SecurityMode || '(空)'}`,
      )
      console.log(
        `      模板 zh=${(reg.ZhCN || '').length} en=${(reg.EnUS || '').length}  主题="${reg.SubjectZhCN || '(空)'}"  发件人="${reg.SenderNameZhCN || '(空)'}"`,
      )
    }
  }
  process.exit(0)
}

const zh = readFileSync(resolve('cloudbase/email-templates/register-signin.zh-CN.html'), 'utf8')
const en = readFileSync(resolve('cloudbase/email-templates/register-signin.en-US.html'), 'utf8')

const reg = {
  ZhCN: zh,
  EnUS: en,
  // 实测 GetProviders 会回显这四个字段 —— 主题与发件人显示名是可配的。
  // 注意：社区 issue #1559 里工程师回复「不可配」是当时的结论，字段现在已存在。
  SubjectZhCN: '与链 ulink 验证码',
  SubjectEnUS: 'Your ulink verification code',
  SenderNameZhCN: '与链 ulink',
  SenderNameEnUS: 'ulink',
}

// ── 发信方式：平台代发（默认）/ 自有 SMTP / 直接沿用 Supabase 的 SMTP ──
// 优先级：--from-supabase > CLOUDBASE_SMTP_* 环境变量 > 平台代发
const fromSupabase = args.includes('--from-supabase')

function readDotEnv(key) {
  try {
    const raw = readFileSync(resolve('.env'), 'utf8')
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : undefined
  } catch {
    return undefined
  }
}

/** 从 Supabase 管理 API 拉真实邮件配置（凭据只在内存里流转，不落盘不打日志） */
async function fetchSupabaseMailConfig() {
  const token = process.env.SUPABASE_ACCESS_TOKEN || readDotEnv('SUPABASE_ACCESS_TOKEN')
  const url = process.env.VITE_SUPABASE_URL || readDotEnv('VITE_SUPABASE_URL')
  if (!token || !url) throw new Error('.env 缺少 SUPABASE_ACCESS_TOKEN 或 VITE_SUPABASE_URL')
  const ref = url.replace(/^https?:\/\//, '').split('.')[0]
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Supabase 管理 API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const c = await res.json()
  return {
    projectRef: ref,
    sender: c.smtp_admin_email,
    user: c.smtp_user,
    pass: c.smtp_pass,
    host: c.smtp_host,
    port: Number(c.smtp_port) || 465,
    secure: /465/.test(String(c.smtp_port)) ? 'SSL' : 'STARTSSL',
    senderName: c.smtp_sender_name,
    subject: c.mailer_subjects_magic_link,
    maxFrequency: c.smtp_max_frequency,
  }
}

let supabaseMail = null
if (fromSupabase) {
  supabaseMail = await fetchSupabaseMailConfig()
  console.log(
    `Supabase 邮件配置已读取（project ${supabaseMail.projectRef}）：` +
      `${supabaseMail.sender} via ${supabaseMail.host}:${supabaseMail.port} ` +
      `密码 ${supabaseMail.pass ? `<${supabaseMail.pass.length} 字符，未打印>` : '(空)'}`,
  )
}

const smtpSender =
  supabaseMail?.sender || process.env.CLOUDBASE_SMTP_SENDER || readEnvLocal('CLOUDBASE_SMTP_SENDER')
const smtpUser = supabaseMail?.user || process.env.CLOUDBASE_SMTP_USER || readEnvLocal('CLOUDBASE_SMTP_USER')
// 密码优先级刻意反转：环境变量 / .env.local 优先于 Supabase 里存的那份。
// 原因：Supabase 里存的可能是旧密码（实测 535），新密码应当能覆盖它。
const smtpPass =
  process.env.CLOUDBASE_SMTP_PASS || readEnvLocal('CLOUDBASE_SMTP_PASS') || supabaseMail?.pass
const smtpHost =
  supabaseMail?.host ||
  process.env.CLOUDBASE_SMTP_HOST ||
  readEnvLocal('CLOUDBASE_SMTP_HOST') ||
  'smtp.exmail.qq.com'
const smtpPort =
  supabaseMail?.port || Number(process.env.CLOUDBASE_SMTP_PORT || readEnvLocal('CLOUDBASE_SMTP_PORT') || 465)
const smtpSecure =
  supabaseMail?.secure || process.env.CLOUDBASE_SMTP_SECURE || readEnvLocal('CLOUDBASE_SMTP_SECURE') || 'SSL'

// 主题与发件人显示名：沿用 Supabase 的文案（只有中文主题，英文用等价翻译）
if (supabaseMail?.subject) {
  reg.SubjectZhCN = supabaseMail.subject
  reg.SubjectEnUS = 'Your ulink verification code'
}
if (supabaseMail?.senderName) {
  reg.SenderNameZhCN = supabaseMail.senderName
  reg.SenderNameEnUS = supabaseMail.senderName
}

const useSmtp = Boolean(smtpSender && smtpUser && smtpPass)

const smtpConfig = useSmtp
  ? {
      SenderAddress: smtpSender,
      ServerHost: smtpHost,
      ServerPort: smtpPort,
      AccountUsername: smtpUser,
      AccountPassword: smtpPass,
      SecurityMode: smtpSecure,
    }
  : undefined

const enablePayload = {
  Id: providerId,
  On: 'TRUE',
  EmailConfig: useSmtp
    ? // On='FALSE' → 不用平台代发，改走下面的 SmtpConfig
      { On: 'FALSE', SmtpConfig: smtpConfig }
    : // On='TRUE' → 平台代发，发件地址固定 cloudbase_noreply@tencent.com
      { On: 'TRUE' },
}
const templatePayload = { Id: providerId, EmailConfig: { TemplateConfig: { RegisterSignIn: reg } } }

console.log(`provider: ${providerId}  模板: zh ${zh.length} / en ${en.length} 字符`)
console.log(
  useSmtp
    ? `发信方式: 自有 SMTP → ${smtpSender} via ${smtpHost}:${smtpPort} (${smtpSecure})  密码来源: ${
        process.env.CLOUDBASE_SMTP_PASS || readEnvLocal('CLOUDBASE_SMTP_PASS') ? '.env(.local)' : 'Supabase 存档'
      }（${smtpPass.length} 字符）`
    : '发信方式: CloudBase 平台代发（cloudbase_noreply@tencent.com）',
)

if (dryRun) {
  console.log('\n--- dry-run：将分两次提交（正文与密码略）---')
  console.log(
    JSON.stringify(
      {
        ...enablePayload,
        EmailConfig: {
          ...enablePayload.EmailConfig,
          ...(smtpConfig ? { SmtpConfig: { ...smtpConfig, AccountPassword: '<hidden>' } } : {}),
        },
      },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify(
      {
        Id: providerId,
        EmailConfig: {
          TemplateConfig: { RegisterSignIn: { ...reg, ZhCN: `<${zh.length} chars>`, EnUS: `<${en.length} chars>` } },
        },
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (!credential) {
  console.error('\n✖ 无可用凭证。先跑 `tcb login`，或配置 CLOUDBASE_SECRET_ID / CLOUDBASE_SECRET_KEY。')
  process.exit(1)
}

// ⚠️ 必须分两次调用：把 `On: 'TRUE'`（provider 层）和大体积模板塞进同一个请求时，
// API 会返回成功但模板被静默丢弃（实测）。分开提交则每次都稳定落库。
await app.env.modifyProvider(enablePayload)
console.log(`① 已开启邮箱登录 + ${useSmtp ? '自有 SMTP' : '平台代发'}`)

await app.env.modifyProvider(templatePayload)
console.log('② 已提交邮件模板与主题')

const after = await app.env.getProviders()
const target = (after?.Data || after?.data?.Data || []).find((p) => p.Id === providerId)
const ec = target?.EmailConfig || {}
const rsi = ec.TemplateConfig?.RegisterSignIn
console.log(
  `复核: ${providerId} → provider.On=${target?.On ?? '?'}  代发=${ec.On ?? '?'}  发件地址=${ec.SmtpConfig?.SenderAddress ?? '?'}  主机=${ec.SmtpConfig?.ServerHost || '(空)'}`,
)
console.log(
  `      模板 ZhCN=${rsi?.ZhCN?.length ?? 0} / EnUS=${rsi?.EnUS?.length ?? 0}  主题="${rsi?.SubjectZhCN || '(空)'}"  发件人="${rsi?.SenderNameZhCN || '(空)'}"`,
)
const senderOk = useSmtp ? ec.SmtpConfig?.SenderAddress === smtpSender : Boolean(ec.SmtpConfig?.SenderAddress)
const ok = rsi?.ZhCN?.length > 1000 && rsi?.EnUS?.length > 1000 && target?.On === 'TRUE' && senderOk
if (!ok) {
  console.error('✖ 复核未通过：开关 / 模板 / 发件地址未按预期落库，请检查上面的输出。')
  process.exitCode = 1
}
