/**
 * 生成云函数目录里「由 TS 真源派生」的 JS 文件
 *
 * 目前只有一处：
 *   supabase/functions/check-link/ssrf-guard.ts
 *     → cloudbase/functions/check-link/ssrf-guard.js
 *
 * 为什么不是手抄一份：ssrf-guard 是 SSRF 防御的唯一真源，53 个单测覆盖的是 TS 那份；
 * 手抄 JS 迟早会和真源漂移（历史上内联镜像就出过这个问题，见 P2-6）。esbuild 只做
 * 类型剥离 + CJS 打包，不改逻辑。
 *
 * 用法: node scripts/build-fn-assets.mjs
 */
import { buildSync } from 'esbuild'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const JOBS = [
  {
    from: 'supabase/functions/check-link/ssrf-guard.ts',
    to: 'cloudbase/functions/check-link/ssrf-guard.js',
  },
  // jina-proxy 复用 ssrf-guard 的 CORS + video-adapters 的 URL/DNS 校验（真源同上）
  {
    from: 'supabase/functions/check-link/ssrf-guard.ts',
    to: 'cloudbase/functions/jina-proxy/ssrf-guard.js',
  },
  {
    from: 'supabase/functions/check-link/ssrf-guard.ts',
    to: 'cloudbase/functions/extract-video/ssrf-guard.js',
  },
  {
    from: 'supabase/functions/extract-video/video-adapters.ts',
    to: 'cloudbase/functions/extract-video/video-adapters.js',
  },
  {
    from: 'supabase/functions/extract-video/video-adapters.ts',
    to: 'cloudbase/functions/jina-proxy/video-adapters.js',
  },
  // extract-video 日配额需要识别调用者 uid（与 mimo-chat/share-admin 同一鉴权真源）
  {
    from: 'supabase/functions/_shared/cb-auth.ts',
    to: 'cloudbase/functions/extract-video/cb-auth.js',
  },
  {
    from: 'supabase/functions/mimo-chat/mimo-guard.ts',
    to: 'cloudbase/functions/mimo-chat/mimo-guard.js',
  },
  // CloudBase 令牌校验（云函数侧换 uid）——真源一份，派生到每个需要鉴权的函数
  {
    from: 'supabase/functions/_shared/cb-auth.ts',
    to: 'cloudbase/functions/mimo-chat/cb-auth.js',
  },
  // check-link：可选鉴权（带 token 才按用户执行 linkcheck.daily，匿名仍走 IP 限流）
  {
    from: 'supabase/functions/_shared/cb-auth.ts',
    to: 'cloudbase/functions/check-link/cb-auth.js',
  },
  // 分享 SSR 渲染核（3400+ 行零依赖纯函数，bundle 自包含）
  {
    from: 'functions/_lib/share-render.ts',
    to: 'cloudbase/functions/share-ssr/share-render.js',
  },
  // 分享访问密码：哈希 / 票据签名（云函数侧验密用）
  {
    from: 'supabase/functions/_shared/share-lock.ts',
    to: 'cloudbase/functions/share-ssr/share-lock.js',
  },
  // share-admin（设置密码）复用同一套鉴权与哈希实现
  {
    from: 'supabase/functions/_shared/cb-auth.ts',
    to: 'cloudbase/functions/share-admin/cb-auth.js',
  },
  {
    from: 'supabase/functions/_shared/share-lock.ts',
    to: 'cloudbase/functions/share-admin/share-lock.js',
  },
  // account（注销）复用同一套鉴权实现
  {
    from: 'supabase/functions/_shared/cb-auth.ts',
    to: 'cloudbase/functions/account/cb-auth.js',
  },
  // redeem（兑换码核销）同样需要验签
  {
    from: 'supabase/functions/_shared/cb-auth.ts',
    to: 'cloudbase/functions/redeem/cb-auth.js',
  },
  // pay（支付回调 / 查单）涉及资损，验签实现必须与真源同步
  {
    from: 'supabase/functions/_shared/cb-auth.ts',
    to: 'cloudbase/functions/pay/cb-auth.js',
  },
]

// 纯数据文件复制（无类型剥离）：视频平台域名清单的单一真源 = src/config/videoPlatforms.json
// worker（Python）运行时读同目录的 video-platforms.json；客户端与云函数直接 import/内联 JSON。
const COPY_JOBS = [
  {
    from: 'src/config/videoPlatforms.json',
    to: 'scripts/video-worker/video-platforms.json',
  },
  {
    from: 'src/config/videoPlatforms.json',
    to: 'cloudbase/functions/extract-video/video-platforms.json',
  },
]

const HEADER = '// 本文件由 scripts/build-fn-assets.mjs 从 %FROM% 生成，请勿手改\n'

// 用 esbuild 的 JS API（buildSync）而不是 `node node_modules/esbuild/bin/esbuild`：
// 该 bin 在 Windows 上是 JS shim、在 Linux 上是 ELF 原生二进制，
// 用 node 执行会在 CI 上直接 SyntaxError（2026-11-09 实际踩到）。
// JS API 跨平台一致，也不依赖 npx 的临时下载。

// 生成计数：结尾汇总打印，便于 CI 日志快速确认本轮实际生成了多少派生资产。
let generated = 0

for (const job of JOBS) {
  const src = resolve(job.from)
  const out = resolve(job.to)
  if (!existsSync(src)) {
    // CI 用 `node build-fn-assets.mjs && git diff --exit-code` 做派生资产漂移守卫：
    // 源缺失若 continue 静默跳过，对应派生 JS 会缺文件却仍绿灯，部署到半成品。
    // 因此硬失败，逼出真源路径错误 / 误删。
    console.error(`✖ 找不到源 ${job.from}（目标 ${job.to}），拒绝静默跳过`)
    process.exit(1)
  }
  // bundle：真源里的相对 import（如 video-adapters.ts → ../check-link/ssrf-guard.ts）
  // 必须打进单文件——云函数目录是独立部署单元，运行时不存在跨目录的 .ts 依赖。
  buildSync({
    entryPoints: [src],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    logLevel: 'silent',
  })
  const body = readFileSync(out, 'utf8')
  const header = HEADER.replace('%FROM%', job.from)
  if (!body.startsWith('// 本文件由')) {
    writeFileSync(out, header + body, 'utf8')
  }
  console.log(`✔ ${job.to} ← ${job.from}`)
  generated++
}

// 纯数据文件：原样复制（不包 header，保持合法 JSON）
for (const job of COPY_JOBS) {
  const src = resolve(job.from)
  const out = resolve(job.to)
  if (!existsSync(src)) {
    // CI 用 `node build-fn-assets.mjs && git diff --exit-code` 做派生资产漂移守卫：
    // 源缺失若 continue 静默跳过，对应派生 JS 会缺文件却仍绿灯，部署到半成品。
    // 因此硬失败，逼出真源路径错误 / 误删。
    console.error(`✖ 找不到源 ${job.from}（目标 ${job.to}），拒绝静默跳过`)
    process.exit(1)
  }
  const body = readFileSync(src, 'utf8')
  writeFileSync(out, body, 'utf8')
  console.log(`✔ ${job.to} ← ${job.from}（数据文件复制）`)
  generated++
}

// CI 日志汇总：数量异常（如 0）一眼可见，配合前面的 git diff 守卫定位漂移/缺源。
console.log(`生成完成：共 ${generated} 个派生资产`)
