/**
 * 部署一个 CloudBase HTTP 云函数，并注入运行时环境变量
 *
 * 存在意义：
 * 1) `tcb fn deploy` 的 `--path /xxx` 在 Git Bash 下会被 MSYS 路径转换吃掉，
 *    必须 MSYS_NO_PATHCONV=1；本脚本用 execFileSync 传 argv，天然规避。
 * 2) 环境变量（服务端 API Key 等）只能写在 cloudbaserc.json 里再 `tcb config update fn`，
 *    而 cloudbaserc.json 含密**绝不能进仓库**——脚本用完即删。
 * 3) 5 个函数逐个手敲这些命令容易漏；脚本统一入口。
 *
 * 用法：
 *   node scripts/deploy-cloudbase-fn.mjs report-error
 *   node scripts/deploy-cloudbase-fn.mjs report-error --path /api/report-error
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

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

const ROOT = resolve('.')
const FN_DIR = resolve('cloudbase/functions', fnName)
if (!existsSync(FN_DIR)) throw new Error(`函数目录不存在: ${FN_DIR}`)

function readEnvLocal(key) {
  try {
    const raw = readFileSync(resolve('.env.local'), 'utf8')
    const m = raw.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'))
    return m ? m[1].trim() : undefined
  } catch {
    return undefined
  }
}

const envId = readEnvLocal('VITE_CLOUDBASE_ENV_ID') || process.env.VITE_CLOUDBASE_ENV_ID
const apiKey = readEnvLocal('CLOUDBASE_APIKEY') || process.env.CLOUDBASE_APIKEY
if (!envId) throw new Error('缺少 VITE_CLOUDBASE_ENV_ID')

/** 在 tcb 工作目录跑命令；cwd 决定它在哪找 scf_bootstrap / cloudbaserc.json */
function tcb(cwd, argv) {
  return execFileSync('bash', [TCB_BIN, ...argv, '-e', envId], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    // `tcb config update fn` 在配置里有环境变量时会交互式询问「覆盖 / 合并」，
    // 管道里没有 TTY 会直接挂死。喂一个回车选中默认项（Override）。
    input: '\n',
  })
}

// ── 0) 先生成由 TS 真源派生的 JS（ssrf-guard 等），保证与真源同步 ──
try {
  execFileSync('bash', ['-c', `"${process.execPath}" "${resolve('scripts/build-fn-assets.mjs')}"`], {
    encoding: 'utf8',
  })
  console.log('已生成派生资产（build-fn-assets.mjs）')
} catch (e) {
  console.log('⚠ 派生资产生成失败（继续尝试部署）:', String(e.stdout || e.message).slice(0, 200))
}

// ── 1) 部署（cwd = 函数目录，scf_bootstrap 才能被识别）──
if (!envOnly) {
  console.log(`部署 ${fnName} → ${httpPath}`)
  try {
    // --force：函数已存在时覆盖更新（否则 tcb 直接拒绝）
    console.log(
      tcb(FN_DIR, ['fn', 'deploy', fnName, '--force', '--httpFn', '--path', httpPath, '--runtime', 'Nodejs20.19', '--yes']),
    )
  } catch (e) {
    const out = String((e && e.stdout) || '') + String((e && e.stderr) || '')
    // 二次部署时路由已存在会报「Path '/xxx' is used」——代码包此时已上传完成，
    // 路由本身还指着本函数（类型修正在后面步骤），视为可继续的非致命错误。
    if (/is used/.test(out)) {
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
const FN_EXTRA_ENV = {
  'report-error': () => ({
    IP_HASH_SALT: readEnvLocal('IP_HASH_SALT') || 'ulink-report-error',
  }),
  'check-link': () => ({
    IP_HASH_SALT: readEnvLocal('CHECK_LINK_IP_HASH_SALT') || 'ulink-check-link',
  }),
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
    }
    if (smtpPass) out.SMTP_PASS = smtpPass
    const turnstile = readEnvLocal('TURNSTILE_SECRET')
    if (turnstile) out.TURNSTILE_SECRET = turnstile
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
  'mimo-chat': () => {
    const out = {
      IP_HASH_SALT: readEnvLocal('MIMO_CHAT_IP_HASH_SALT') || 'ulink-mimo-chat',
    }
    // MIMO_API_KEY 缺失时函数自身 503（不部署假 key）
    const key = readEnvLocal('MIMO_API_KEY')
    if (key) out.MIMO_API_KEY = key
    const origins = readEnvLocal('ALLOWED_ORIGINS')
    if (origins) out.ALLOWED_ORIGINS = origins
    const model = readEnvLocal('MIMO_MODEL')
    if (model) out.MIMO_MODEL = model
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
    return out
  },
  'share-ssr': () => ({
    APP_ORIGIN: readEnvLocal('APP_ORIGIN') || 'https://ulink.ren',
  }),
}
if (apiKey) {
  const rcPath = resolve(FN_DIR, 'cloudbaserc.json')
  const rc = {
    envId,
    functions: [
      {
        name: fnName,
        timeout: 20,
        runtime: 'Nodejs20.19',
        installDependency: true,
        envVariables: {
          CLOUDBASE_ENV_ID: envId,
          CLOUDBASE_APIKEY: apiKey,
          ...((FN_EXTRA_ENV[fnName] || ({}))()),
        },
      },
    ],
  }
  writeFileSync(rcPath, JSON.stringify(rc, null, 2), 'utf8')
  try {
    console.log(tcb(FN_DIR, ['config', 'update', 'fn', fnName]))
  } finally {
    // 含密文件绝不落地过夜
    rmSync(rcPath, { force: true })
    console.log('已删除临时 cloudbaserc.json（含密，不落仓库）')
  }
} else {
  console.log('⚠ 未找到 CLOUDBASE_APIKEY，跳过环境变量注入')
}

// ── 3) 修正路由上游类型：deploy 的 --path 默认建成 SCF（Event）类型，
//      而 --httpFn 建的是 Web 函数，两者不匹配会让网关回
//      `FUNCTIONS_PARAM_INVALID: FunctionType parameter is invalid`。
//      必须显式改成 WEB_SCF。──
if (!envOnly) {
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

console.log(`\n访问地址: https://${envId}.service.tcloudbase.com${httpPath}`)
console.log(`（客户端请把 VITE_CLOUDBASE_FN_BASE 设为 https://${envId}.service.tcloudbase.com）`)
