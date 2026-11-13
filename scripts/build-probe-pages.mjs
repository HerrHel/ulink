/**
 * 生成海外探针的 Pages Functions 产物（自包含 bundle）
 *
 * 背景：探针真源在 `functions/_lib/probe-core.ts`（+ cf-guard + ssrf-guard）。
 * Cloudflare Pages 的 Functions 目录是独立部署单元，不能跨目录 import 仓库其他
 * 位置的 .ts，因此这里用 esbuild 预打包成一个自包含的 ESM 文件：
 *
 *   functions/api/check-link.ts  ──bundle──▶  probe-pages/functions/api/check-link.js
 *
 * 部署（详见 probe-worker/README.md 的 Pages 章节）：
 *   cd probe-pages && npx wrangler pages deploy dist --project-name ulink-probe
 *
 * 为何不用 Worker：`*.workers.dev` 在国内直连超时（2026-11-13 实测），而
 * `*.pages.dev` 直连可达（同一时刻实测 200 / 0.43s 建连）。故沿用 Pages 形态。
 *
 * 用法: node scripts/build-probe-pages.mjs
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, 'functions/api/check-link.ts')
const outfile = resolve(root, 'probe-pages/functions/api/check-link.js')

if (!existsSync(entry)) {
  console.error(`✖ 找不到真源 ${entry}`)
  process.exit(1)
}

mkdirSync(dirname(outfile), { recursive: true })

/**
 * TS 项目里源码用 `.js` 后缀 import `.ts` 文件（Node ESM 约定）。
 * esbuild 默认按字面找 `.js`，这里把它重定向到同名 `.ts`（与 vitest alias 一致）。
 */
const jsToTs = {
  name: 'js-to-ts',
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith('.')) return null
      const abs = resolve(args.resolveDir, args.path)
      const ts = abs.replace(/\.js$/, '.ts')
      if (existsSync(ts)) return { path: ts }
      return null
    })
  },
}

// 必须用异步 build()：esbuild 的同步 API 不支持 plugin（js-to-ts 重定向需要它）
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'es2022',
  outfile,
  logLevel: 'silent',
  plugins: [jsToTs],
})

const HEADER =
  '// 本文件由 scripts/build-probe-pages.mjs 从 functions/api/check-link.ts 生成，请勿手改\n'
const body = readFileSync(outfile, 'utf8')
if (!body.startsWith('// 本文件由')) writeFileSync(outfile, HEADER + body, 'utf8')

console.log(`✔ ${outfile.replace(root + '\\', '').replace(root + '/', '')}`)
console.log('  部署：cd probe-pages && npx wrangler pages deploy dist --project-name ulink-probe')
