/**
 * 部署一个 CloudBase HTTP 云函数，并注入运行时环境变量
 *
 * 存在意义：
 * 1) `tcb fn deploy` 的 `--path /xxx` 在 Git Bash 下会被 MSYS 路径转换吃掉，
 *    必须 MSYS_NO_PATHCONV=1；本脚本用 execFileSync 传 argv，天然规避。
 * 2) 环境变量（服务端 API Key 等）只能写在 cloudbaserc.json 里再 `tcb config update fn`，
 *    而 cloudbaserc.json 含密**绝不能进仓库**——脚本用完即删。
 * 3) 14 个云函数逐个手敲这些命令容易漏；脚本统一入口。
 *
 * 用法：
 *   node scripts/deploy-cloudbase-fn.mjs report-error
 *   node scripts/deploy-cloudbase-fn.mjs report-error --path /api/report-error
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

const TCB_BIN =
  process.env.TCB_BIN || resolve(homedir(), '.workbuddy/binaries/node/cli-connector-packages/tcb')

const args = process.argv.slice(2)
const fnName = args.find((a) => !a.startsWith('--'))
if (!fnName) {
  console.error('用法: node scripts/deploy-cloudbase-fn.mjs <function-name> [--path /xxx] [--env-only]')
  process.exit(1)
}
const pathArgIdx = args.indexOf('--path')
const httpPath = pathArgIdx >= 0 ? args[pathArgIdx + 1] : `/${fnName}`
/** --env-only：只重新注入环境变量（密钥轮换用），跳过代码包上传与路由步骤 */
const envOnly = args.includes('--env-only')
const isEventFn = fnName === 'maintenance'

const ROOT = resolve('.')
const FN_DIR = resolve('cloudbase/functions', fnName)
if (!existsSync(FN_DIR)) throw new Error(`函数目录不存在: ${FN_DIR}`)

/** 正则元字符转义（env 键名通常是 [A-Z_]+，仍做防御） */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 读取 .env.local 中的键（#48 多行 PEM 兼容）。
 *
 * 旧版单行正则 `^KEY\s*=\s*(.*)$`（无 s 标志）会把真换行的 PEM 截成第一行：
 *   KEY="-----BEGIN PRIVATE KEY-----
 *   MIIE...
 *   -----END PRIVATE KEY-----"
 * 只拿到 `"-----BEGIN PRIVATE KEY-----`，注入线上后支付验签静默失败，脚本却仍 exit 0。
 *
 * 支持三种写法，且**完整保留字面量 \n**（云函数的 pem() 会把它还原成真换行，既有兼容不变）：
 *   KEY=value                                   单行无引号
 *   KEY="a\nb"                                  双引号 + 字面量 \n（一行写完）
 *   KEY="-----BEGIN ...<真换行>...-----END ..."  引号内跨行真换行
 * 值内转义序列（含 \n、\"）原样保留、不在此 unescape，避免破坏既有字面量 \n 兼容。
 */
function readEnvLocal(key) {
  let raw
  try {
    raw = readFileSync(resolve('.env.local'), 'utf8').replace(/\r\n/g, '\n')
  } catch {
    return undefined
  }
  const start = raw.search(new RegExp(`^${escapeRe(key)}[ \\t]*=`, 'm'))
  if (start < 0) return undefined
  const rest = raw.slice(start)
  let i = rest.indexOf('=') + 1
  while (i < rest.length && (rest[i] === ' ' || rest[i] === '\t')) i++
  if (i >= rest.length) return ''
  const quote = rest[i] === '"' || rest[i] === "'" ? rest[i] : null
  if (!quote) {
    // 无引号：到行尾为止（真换行即结束）
    const nl = rest.indexOf('\n', i)
    return (nl < 0 ? rest.slice(i) : rest.slice(i, nl)).trim()
  }
  i++ // 跳过开引号
  let buf = ''
  let closed = false
  while (i < rest.length) {
    const ch = rest[i]
    if (ch === '\\' && i + 1 < rest.length) {
      // 原样保留转义序列：字面量 \n 必须交给云函数 pem() 还原，不能在这里吞掉反斜杠
      buf += ch + rest[i + 1]
      i += 2
      continue
    }
    if (ch === quote) { closed = true; break }
    buf += ch
    i++
  }
  // 未闭合引号视为坏配置：返回 undefined，由缺变量 / PEM 校验显式暴露，绝不注入半截值
  return closed ? buf : undefined
}

/**
 * #48：注入前校验多行 PEM 首尾完整。
 * 仅针对「看起来是 PEM」的值（含 -----BEGIN）：必须含同标签的 -----END 且以 END 收尾。
 * 真换行被截成第一行、或引号未闭合导致的残缺 PEM 会在这里被拦下并非零退出，绝不把半截
 * 密钥注入线上（否则支付验签静默失败而脚本 exit 0）。普通字符串值（APIV3_KEY / APPID 等）
 * 无 BEGIN 标记，不受影响，避免误伤。
 */
function assertPemComplete(env) {
  for (const [k, v] of Object.entries(env)) {
    if (typeof v !== 'string' || !v.includes('-----BEGIN')) continue
    const begin = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(v)
    const ends = [...v.matchAll(/-----END ([A-Z0-9 ]+)-----/g)].map((m) => m[1])
    const label = begin ? begin[1] : '(未知)'
    const complete = !!begin && ends.includes(label) && /-----END [A-Z0-9 ]+-----\s*$/.test(v.trim())
    if (!complete) {
      console.error(`✖ 环境变量 ${k} 疑似多行 PEM，但首尾不完整（缺 -----END ${label}----- 或已被截断）`)
      console.error('  .env.local 请用引号包裹多行 PEM（KEY="-----BEGIN...\\n...-----END..."），或写成字面量 \\n；')
      console.error('  拒绝注入残缺密钥，避免线上支付验签静默失败。')
      process.exit(1)
    }
  }
}

const envId = readEnvLocal('VITE_CLOUDBASE_ENV_ID') || process.env.VITE_CLOUDBASE_ENV_ID
const apiKey = readEnvLocal('CLOUDBASE_APIKEY') || process.env.CLOUDBASE_APIKEY
if (!envId) throw new Error('缺少 VITE_CLOUDBASE_ENV_ID')
// --env-only 是密钥轮换唯一入口：缺 CLOUDBASE_APIKEY 时旧版会整块跳过注入、继续跑并 exit 0（假绿），
// 这里直接报错退出 1
if (envOnly && !apiKey) {
  console.error('✖ --env-only 需要 CLOUDBASE_APIKEY（密钥轮换唯一入口），未找到，拒绝继续')
  process.exit(1)
}
// #18：普通部署（非 --env-only）缺 CLOUDBASE_APIKEY 时，第 2 步的 env 注入整块会被跳过，
// 但代码包仍会 --force 上传、末尾照常打印「访问地址」并 exit 0 ——「更新成功但密钥没换」假绿。
// 必须在上传代码包之前拒绝，避免留下「代码已更新、env 未注入」的半吊子线上状态。
// --env-only 的口径保持上方原有分支不变（它本就要求 key）。
if (!envOnly && !apiKey) {
  console.error('✖ 未找到 CLOUDBASE_APIKEY：环境变量注入将被跳过，拒绝继续部署（避免「更新成功但密钥没换」假绿）')
  console.error('  请在 .env.local 配置 CLOUDBASE_APIKEY（或 export 到环境）后重试；仅轮换密钥可用 --env-only。')
  process.exit(1)
}

/**
 * maintenance 依赖定时触发器跑「每日备份 + 数据清理」。触发器不在代码里，
 * 一旦丢失（重建函数、手动删触发器）备份会**静默停摆**——2026-11-09 实际发生过：
 * db_backup 只有建表当天（11-03）一份，之后 6 天无新备份，而函数本身完全正常
 * （手动调 fn_create_db_backup 立即成功）。部署时幂等确保触发器存在。
 */
function ensureDailyBackupTrigger() {
  const TRIGGER = 'daily-maintenance'
  const CRON = '0 0 3 * * * *' // 7 位，北京时间 03:00
  try {
    const raw = String(tcb(ROOT, ['fn', 'detail', 'maintenance', '--json']) || '')
    const parsed = JSON.parse(raw)
    const info = parsed.data || parsed
    const list = Array.isArray(info.Triggers) ? info.Triggers : []
    if (list.some((t) => t && t.TriggerName === TRIGGER)) {
      console.log(`✔ 每日备份触发器 ${TRIGGER} 已存在`)
      return
    }
    console.log(`⚠ 未找到每日备份触发器 ${TRIGGER}，正在创建…`)
  } catch (e) {
    console.log('⚠ 查询触发器失败，尝试直接创建：', String((e && e.message) || e).slice(0, 120))
  }
  try {
    tcb(ROOT, ['fn', 'trigger', 'create', 'maintenance', '--trigger-name', TRIGGER, '--cron', CRON])
    console.log(`✔ 已创建每日备份触发器 ${TRIGGER}（${CRON}）`)
  } catch (e) {
    const out = String((e && (e.stdout || e.message)) || e)
    // 已存在不算失败（并发部署 / CLI 判定差异）
    if (/exist|已存在|duplicate/i.test(out)) {
      console.log(`✔ 每日备份触发器 ${TRIGGER} 已存在`)
      return
    }
    throw e
  }
}

/** 在 tcb 工作目录跑命令；cwd 决定它在哪找 scf_bootstrap / cloudbaserc.json */
function tcb(cwd, argv) {
  const directJs = resolve(homedir(), '.workbuddy/binaries/node/cli-connector-packages/node_modules/@cloudbase/cli/bin/tcb')
  const executable = existsSync(directJs) ? process.execPath : 'bash'
  const args = existsSync(directJs) ? [directJs, ...argv, '-e', envId] : [TCB_BIN, ...argv, '-e', envId]
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    // `tcb config update fn` 在配置里有环境变量时会交互式询问「覆盖 / 合并」。
    // 默认项 Override 会用本地 env 完全替换线上，一旦 .env.local 缺少某个线上
    // 密钥（如 WXPAY_PLATFORM_CERT）就会被静默删掉；这里用下箭头选中第二项
    // Merge（本地覆盖同名、线上独有项保留）。其它交互（routes edit 的 Y/n）仍喂回车。
    input: argv[0] === 'config' && argv[1] === 'update' ? '\x1b[B\n' : '\n',
  })
}

// ── 0) 先生成由 TS 真源派生的 JS（ssrf-guard 等），保证与真源同步 ──
// #18：生成失败必须立即退出 1。旧版只打 warn 后继续 --force 部署，会把旧的 / 残缺的派生
// JS 推上线（本地部署路径完全绕过 CI 的派生守卫），末尾却仍打印「访问地址」并 exit 0。
try {
  execFileSync(process.execPath, [resolve('scripts/build-fn-assets.mjs')], {
    encoding: 'utf8',
  })
  console.log('已生成派生资产（build-fn-assets.mjs）')
} catch (e) {
  const detail = String((e && (e.stdout || e.stderr)) || (e && e.message) || e).slice(-500)
  console.error('✖ 派生资产生成失败（build-fn-assets.mjs），拒绝继续部署：', detail)
  process.exit(1)
}

// ── 1) 部署（cwd = 函数目录，scf_bootstrap 才能被识别）──
if (!envOnly) {
  console.log(`部署 ${fnName} → ${httpPath}`)
  try {
    // --force：函数已存在时覆盖更新（否则 tcb 直接拒绝）
    console.log(
      tcb(FN_DIR, isEventFn
        ? ['fn', 'deploy', fnName, '--force', '--runtime', 'Nodejs20.19', '--yes', '--deployMode', 'zip']
        : ['fn', 'deploy', fnName, '--force', '--httpFn', '--path', httpPath, '--runtime', 'Nodejs20.19', '--yes', '--deployMode', 'zip']),
    )
  } catch (e) {
    const out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
    // 精确匹配已知「Path '/xxx' is used」文案；旧版 /is used/ 太宽，会吞掉其它真实错误
    const escapedPath = httpPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pathUsedRe = new RegExp(`Path\\s+['"]?${escapedPath}['"]?\\s+is used`, 'i')
    if (pathUsedRe.test(out)) {
      console.log(`⚠ 路由 ${httpPath} 已存在（代码包已更新，继续注入配置）`)
    } else {
      throw e
    }
  }
} else {
  console.log(`仅注入环境变量：${fnName}（--env-only）`)
}

// ── 2) 注入环境变量：临时生成含密 cloudbaserc.json，推送后立即删除 ──
/**
 * 各函数的额外环境变量（CLOUDBASE_ENV_ID / CLOUDBASE_APIKEY 之外）。
 * ⚠️ IP_HASH_SALT 必须**每函数独立**（防跨接口关联），不能共用一个默认值——
 * 早期版本统一回落 'ulink-report-error'，导致 check-link 拿到 report-error 的盐。
 * value 为 undefined 时跳过该项（可选变量未配置）。
 */
/**
 * ⚠️ IP_HASH_SALT 曾统一回落成仓库内公开的 'ulink-<fn>' 常量。
 * CloudBase 网关不回填可信客户端 IP、X-Forwarded-For 可伪造，盐一旦可预测，
 * 按 IP 的限流键就能被任意构造。未显式在 .env.local 配置时，改为部署期生成
 * 每函数独立的随机盐（不下发公开值）。如需跨部署稳定，请把盐写进 .env.local。
 */
function sanitizeEnvSalts(env) {
  const out = { ...env }
  const salt = out.IP_HASH_SALT
  if (typeof salt !== 'string' || salt.startsWith('ulink-')) {
    out.IP_HASH_SALT = randomBytes(24).toString('hex')
  }
  return out
}

const FN_EXTRA_ENV = {
  'report-error': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('IP_HASH_SALT') || 'ulink-report-error',
    }
    // CORS 白名单：未注入时函数内回落到内置主站列表
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    return out
  },
  'check-link': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('CHECK_LINK_IP_HASH_SALT') || 'ulink-check-link',
    }
    // ⚠️ 必须注入：isOriginAllowed 的判据是 `allowed.length > 0 && includes(origin)`，
    // 缺失该变量会解析成空数组 → 所有带 Origin 的请求一律 403（死链检测曾长期不可用）
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    return out
  },
  'send-feedback': () => {
    // SMTP 密码优先 .env.local 的 CLOUDBASE_SMTP_PASS（16 位企业邮客户端专用密码）；
    // Supabase 旧存档那份 64 位会 535。未配置时函数降级「只落库不发信」。
    const smtpUser = readEnvLocal('CLOUDBASE_SMTP_USER') || 'noreply@ulink.ren'
    const smtpPass = readEnvLocal('CLOUDBASE_SMTP_PASS') || readEnvLocal('SMTP_PASS')
    const out = {
      SMTP_HOST: 'smtp.exmail.qq.com',
      SMTP_PORT: '465',
      SMTP_USER: smtpUser,
      FEEDBACK_TO: readEnvLocal('FEEDBACK_TO') || 'support@ulink.ren',
      APP_ORIGIN: 'https://ulink.ren',
      IP_HASH_SALT: readEnvLocal('FEEDBACK_IP_HASH_SALT') || 'ulink-feedback',
      // 人机验证（CloudBase auth captcha）默认开启：前端按需挑战 + token 一次性消费
      REQUIRE_CAPTCHA: readEnvLocal('REQUIRE_CAPTCHA') || 'true',
      // PoW 无感验证（主闸）默认开启：有效 PoW 直接放行，失败回落图形验证码
      REQUIRE_POW: readEnvLocal('REQUIRE_POW') || 'true',
      POW_SECRET: readEnvLocal('POW_SECRET') || randomBytes(32).toString('hex'),
    }
    if (smtpPass) out.SMTP_PASS = smtpPass
    // CORS 白名单：未注入时函数内回落到内置主站列表
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    return out
  },
  'jina-proxy': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('JINA_PROXY_IP_HASH_SALT') || 'ulink-jina-proxy',
    }
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    const rl = readEnvLocal('JINA_PROXY_RATE_LIMIT_PER_MIN')
    if (rl) out.JINA_PROXY_RATE_LIMIT_PER_MIN = rl
    const to = readEnvLocal('JINA_PROXY_TIMEOUT_MS')
    if (to) out.JINA_PROXY_TIMEOUT_MS = to
    return out
  },
  // 2026-11-09：AI 候选 / 元数据提取从 CF Pages 迁入（复用同一份 handler），
  // 需要与 mimo-chat 同一把 MIMO_API_KEY；缺失时函数自身 503，不部署假 key。
  'ai-api': () => {
    const out = {}
    const key = readEnvLocal('MIMO_API_KEY')
    if (key) out.MIMO_API_KEY = key
    return out
  },
  'mimo-chat': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('MIMO_CHAT_IP_HASH_SALT') || 'ulink-mimo-chat',
      // 额度拦截开关：shadow=只计量；enforce=超额 429（.env.local 控制，部署时注入）
      BILLING_MODE: readEnvLocal('BILLING_MODE') || 'shadow',
    }
    // MIMO_API_KEY 缺失时函数自身 503（不部署假 key）
    const key = readEnvLocal('MIMO_API_KEY')
    if (key) out.MIMO_API_KEY = key
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    const model = readEnvLocal('MIMO_MODEL')
    if (model) out.MIMO_MODEL = model
    // 上游流式超时：AbortSignal 覆盖整个 body，超时会把正在输出的回答掐断。
    // 不注入时函数内默认 115s，与下面 FN_PROFILE 的 120s 上限留 5s 余量补发中断帧
    const chatTimeout = readEnvLocal('MIMO_CHAT_TIMEOUT_MS')
    if (chatTimeout) out.MIMO_CHAT_TIMEOUT_MS = chatTimeout
    return out
  },
  'extract-video': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('EXTRACT_VIDEO_IP_HASH_SALT') || 'ulink-extract-video',
    }
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    const yt = readEnvLocal('YOUTUBE_API_KEY')
    if (yt) out.YOUTUBE_API_KEY = yt
    // 视频微服务（scripts/video-worker）：未配置则函数保持旧链路（平台适配器 + r.jina.ai）
    const worker = readEnvLocal('VIDEO_WORKER_URL')
    if (worker) out.VIDEO_WORKER_URL = worker
    const workerToken = readEnvLocal('VIDEO_WORKER_TOKEN')
    if (workerToken) out.VIDEO_WORKER_TOKEN = workerToken
    const workerTimeout = readEnvLocal('EXTRACT_VIDEO_WORKER_TIMEOUT_MS')
    if (workerTimeout) out.EXTRACT_VIDEO_WORKER_TIMEOUT_MS = workerTimeout
    // 视频日配额：默认免费 1/日、匿名 1/日/IP；本地可覆盖或临时关闭（EXTRACT_VIDEO_QUOTA_ENFORCE=false）
    const anonQuota = readEnvLocal('EXTRACT_VIDEO_ANON_DAILY_LIMIT')
    if (anonQuota) out.EXTRACT_VIDEO_ANON_DAILY_LIMIT = anonQuota
    const freeQuota = readEnvLocal('EXTRACT_VIDEO_FREE_DAILY')
    if (freeQuota) out.EXTRACT_VIDEO_FREE_DAILY = freeQuota
    const quotaMode = readEnvLocal('EXTRACT_VIDEO_QUOTA_ENFORCE')
    if (quotaMode) out.EXTRACT_VIDEO_QUOTA_ENFORCE = quotaMode
    // 深度解析（ASR 口播转写 + 画面 OCR）：独立日额度，默认 PRO 2 次/日、free 0（需登录）
    const deepQuota = readEnvLocal('EXTRACT_VIDEO_DEEP_DAILY')
    if (deepQuota) out.EXTRACT_VIDEO_DEEP_DAILY = deepQuota
    const deepSubmitTimeout = readEnvLocal('EXTRACT_VIDEO_DEEP_SUBMIT_TIMEOUT_MS')
    if (deepSubmitTimeout) out.EXTRACT_VIDEO_DEEP_SUBMIT_TIMEOUT_MS = deepSubmitTimeout
    const deepStatusTimeout = readEnvLocal('EXTRACT_VIDEO_DEEP_STATUS_TIMEOUT_MS')
    if (deepStatusTimeout) out.EXTRACT_VIDEO_DEEP_STATUS_TIMEOUT_MS = deepStatusTimeout
    // 与 IP 无关的全局兜底限流/匿名额度：X-Forwarded-For 可伪造时防止外呼成本被刷爆
    const rateGlobal = readEnvLocal('EXTRACT_VIDEO_RATE_LIMIT_GLOBAL_PER_MIN')
    if (rateGlobal) out.EXTRACT_VIDEO_RATE_LIMIT_GLOBAL_PER_MIN = rateGlobal
    const anonGlobal = readEnvLocal('EXTRACT_VIDEO_ANON_GLOBAL_DAILY')
    if (anonGlobal) out.EXTRACT_VIDEO_ANON_GLOBAL_DAILY = anonGlobal
    return out
  },
  'share-ssr': () => {
    const out = {
      APP_ORIGIN: readEnvLocal('APP_ORIGIN') || 'https://ulink.ren',
    }
    // 访问密码票据签名密钥：缺失时「带密码的分享」会 503（fail-closed，不降级放行）
    const lockSecret = readEnvLocal('SHARE_LOCK_SECRET')
    if (lockSecret) out.SHARE_LOCK_SECRET = lockSecret
    // 密码尝试限流用的 IP 盐（每函数独立）
    out.IP_HASH_SALT = readEnvLocal('SHARE_SSR_IP_HASH_SALT') || 'ulink-share-ssr'
    return out
  },
  'share-admin': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('SHARE_ADMIN_IP_HASH_SALT') || 'ulink-share-admin',
    }
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    return out
  },
  'account': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('ACCOUNT_IP_HASH_SALT') || 'ulink-account',
    }
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    return out
  },
  'redeem': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('REDEEM_IP_HASH_SALT') || 'ulink-redeem',
    }
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    return out
  },
  // 支付：渠道密钥（缺失则函数自身 503 channel_not_configured，不部署假 key）
  'pay': () => {
    const out = {
      // 限流 IP 盐：每函数独立（pay/index.js 的回落默认值同为 'ulink-pay'）
      IP_HASH_SALT: readEnvLocal('PAY_IP_HASH_SALT') || 'ulink-pay',
    }
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    // ⚠️ 多行 PEM 在 .env.local 里两种写法都支持：引号内**字面量 \n**（云函数 pem()
    // 会还原成真换行，既有兼容不变）或引号内**真换行**（readEnvLocal 已支持跨行读取）。
    // 无论哪种，assertPemComplete 都会在注入前校验首尾 -----BEGIN/-----END 完整，残缺即报错退出。
    const CHANNEL_ENV = {
      // 微信支付（Native 扫码）
      WXPAY_APPID: 'WXPAY_APPID',
      WXPAY_MCHID: 'WXPAY_MCHID',
      WXPAY_SERIAL_NO: 'WXPAY_SERIAL_NO',
      WXPAY_PRIVATE_KEY: 'WXPAY_PRIVATE_KEY',
      WXPAY_APIV3_KEY: 'WXPAY_APIV3_KEY',
      WXPAY_PLATFORM_CERT: 'WXPAY_PLATFORM_CERT',
      WXPAY_PUBLIC_KEY: 'WXPAY_PUBLIC_KEY',
      WXPAY_NOTIFY_URL: 'WXPAY_NOTIFY_URL',
      // 支付宝（当面付）
      ALIPAY_APP_ID: 'ALIPAY_APP_ID',
      ALIPAY_PRIVATE_KEY: 'ALIPAY_PRIVATE_KEY',
      ALIPAY_PUBLIC_KEY: 'ALIPAY_PUBLIC_KEY',
      ALIPAY_NOTIFY_URL: 'ALIPAY_NOTIFY_URL',
      ALIPAY_GATEWAY: 'ALIPAY_GATEWAY',
    }
    for (const [k, envKey] of Object.entries(CHANNEL_ENV)) {
      const v = readEnvLocal(envKey)
      if (v) out[k] = v
    }
    return out
  },
}
/**
 * 各函数的超时与内存配置
 *
 * timeout：过短会**直接杀掉**正在进行的请求。原先全局硬编码 20s，
 *   而 AI 流式回答经常超过 20s → 用户看到回答被截断（且代码里的
 *   MIMO_CHAT_TIMEOUT_MS 默认 60s 与之矛盾）。
 *
 * memorySize：直接决定资源点消耗。计费公式
 *   资源点 = 0.11108 点/GBs，其中 1 GBs = 1GB 内存运行 1 秒
 *   → 内存减半，资源点也减半。mimo-chat 只是流式转发（不缓冲整个响应），
 *     128MB 足够。
 */
const FN_PROFILE = {
  // timeout 120：音频多模态要「下载 → base64 → 上游解析」，8.5MB mp3 实测上游耗时 44s，
  // 90s 会把长音频的流式中途掐断。timeout 只是上限，不改变按实际时长计费。
  'mimo-chat': { timeout: 120, memorySize: 128 },
  'check-link': { timeout: 40, memorySize: 128 },
  'extract-video': { timeout: 60, memorySize: 256 },
  'jina-proxy': { timeout: 40, memorySize: 128 },
  'share-ssr': { timeout: 20, memorySize: 128 },
  'share-admin': { timeout: 20, memorySize: 128 },
  'account': { timeout: 30, memorySize: 128 },
  'redeem': { timeout: 20, memorySize: 128 },
  'pay': { timeout: 30, memorySize: 128 },
  'report-error': { timeout: 15, memorySize: 128 },
  'send-feedback': { timeout: 20, memorySize: 128 },
  'edge-headers': { timeout: 15, memorySize: 128 },
  'maintenance': { timeout: 60, memorySize: 128 },
  // extract-metadata 要「抓网页 + Jina 兜底 + MIMO 提炼」串行，最坏 30s 级
  'ai-api': { timeout: 60, memorySize: 256 },
}
const DEFAULT_PROFILE = { timeout: 20, memorySize: 128 }

if (apiKey) {
  const rcPath = resolve(FN_DIR, 'cloudbaserc.json')
  const profile = { ...DEFAULT_PROFILE, ...(FN_PROFILE[fnName] || {}) }
  const envVariables = {
    CLOUDBASE_ENV_ID: envId,
    CLOUDBASE_APIKEY: apiKey,
    // 没有额外变量的函数（如 edge-headers）走空对象工厂；此处曾误把 {} 当函数调用
    ...sanitizeEnvSalts(
      typeof FN_EXTRA_ENV[fnName] === 'function' ? FN_EXTRA_ENV[fnName]() : {},
    ),
  }
  // #48：写含密文件 / 注入之前先校验多行 PEM 首尾完整，残缺即报错退出，
  // 不把半截密钥推到线上（否则支付验签静默失败而脚本仍可能打印成功）。
  assertPemComplete(envVariables)
  const rc = {
    envId,
    functions: [
      {
        name: fnName,
        timeout: profile.timeout,
        memorySize: profile.memorySize,
        runtime: 'Nodejs20.19',
        installDependency: true,
        envVariables,
      },
    ],
  }
  writeFileSync(rcPath, JSON.stringify(rc, null, 2), 'utf8')
  try {
    const updateOut = String(tcb(FN_DIR, ['config', 'update', 'fn', fnName]) || '')
    console.log(updateOut)
    // 无论 env-only 与否，都要在 config update 输出里确认成功；未命中成功标记或出现失败标记即非零退出
    // （env-only 尤其关键：它是密钥轮换唯一入口，旧版完全不检查输出就 exit 0）
    const ok = /(?:success|成功|√|已更新|更新完成|updated)/i.test(updateOut)
    const bad = /(?:failed|失败|✖|error:)/i.test(updateOut)
    if (!ok || bad) {
      console.error(`✖ config update 输出未确认成功（envOnly=${envOnly}），拒绝继续：\n${updateOut.slice(-800)}`)
      process.exit(1)
    }
  } finally {
    // 含密文件绝不落地过夜
    rmSync(rcPath, { force: true })
    console.log('已删除临时 cloudbaserc.json（含密，不落仓库）')
  }
} else {
  // 理论上不可达：文件头部已对 --env-only / 普通部署两种场景分别做了 !apiKey 前置拒绝。
  // 保留为防御性兜底，杜绝后续重构重新引入「跳过 env 注入仍 exit 0」的假绿。
  console.error('✖ 未找到 CLOUDBASE_APIKEY，环境变量注入被跳过（不应到达此处）')
  process.exit(1)
}

// ── 3) 修正路由上游类型：deploy 的 --path 默认建成 SCF（Event）类型，
//      而 --httpFn 建的是 Web 函数，两者不匹配会让网关回
//      `FUNCTIONS_PARAM_INVALID: FunctionType parameter is invalid`。
//      必须显式改成 WEB_SCF。──
if (!envOnly && !isEventFn) {
  try {
    console.log(
      tcb(FN_DIR, [
        'routes',
        'edit',
        '-d',
        JSON.stringify({
          domain: '*',
          routes: [{ path: httpPath, upstreamResourceType: 'WEB_SCF' }],
        }),
      ]),
    )
  } catch (e) {
    console.log('⚠ 路由类型修正失败（若已是 WEB_SCF 可忽略）:', String(e.stdout || e.message).slice(0, 200))
  }
}

// ── 4) maintenance：确保每日备份触发器存在（丢失会让备份静默停摆）──
if (!envOnly && fnName === 'maintenance') {
  ensureDailyBackupTrigger()
}

console.log(`\n访问地址: https://${envId}.service.tcloudbase.com${httpPath}`)
console.log(`（客户端请把 VITE_CLOUDBASE_FN_BASE 设为 https://${envId}.service.tcloudbase.com）`)
