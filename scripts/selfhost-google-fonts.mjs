#!/usr/bin/env node
/**
 * selfhost-google-fonts.mjs — 把 Google Fonts（Noto Sans SC + JetBrains Mono）镜像到 public/fonts/gf/
 *
 * 为什么：index.html / app.html 原先同步引入 fonts.googleapis.com 样式表（阻塞渲染）。
 * 国内访问 Google 时快时慢，实测样式表 6.8s、首屏骨架 5.5~30s 才完成；自托管后走 CloudBase
 * 国内节点同域加载。
 *
 * 做法：保留 Google 的 unicode-range 切片（Noto Sans SC ~101 片，每片 ~50KB），浏览器仍只下载
 * 页面实际用到字符所在的切片（与原先一致）。两款都是可变字体，同一文件覆盖多个字重，
 * 生成 CSS 时把同文件同 range 的多个 weight 合并为 `font-weight: <min> <max>`（体积约 1/4）。
 *
 * 用法：node scripts/selfhost-google-fonts.mjs
 *   - 下载优先用 aria2（环境变量 ARIA2C 或 PATH 中的 aria2c，Windows 默认路径兜底）；
 *     不可用时退回 Node fetch 逐个下载。
 *   - 产物：public/fonts/gf/*.woff2 + public/fonts/gf.css（生成文件，勿手改；改字体/字重改下方常量后重跑）。
 *   - workbox 预缓存已排除 fonts/gf/**（vite.config.ts globIgnores），由运行时 CacheFirst 按需缓存。
 */
import { mkdir, writeFile, readdir, rm, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Noto+Sans+SC:wght@400;500;600;700&display=swap'
// 用现代 Chrome UA 请求，Google 才会返回 woff2 + unicode-range 切片版本
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const OUT_DIR = path.join(ROOT, 'public', 'fonts', 'gf')
const OUT_CSS = path.join(ROOT, 'public', 'fonts', 'gf.css')

function slug(family) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

/**
 * 解析 Google 返回的 CSS。拉丁类子集块前有 /* latin *\/ 之类注释；Noto Sans SC 的编号切片
 * 没有注释，编号在 URL 末尾（….<n>.woff2）。两者都取不到时用序号兜底。
 */
function parseFaces(css) {
  const re = /(?:\/\*\s*([^*]+?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g
  const faces = []
  let m
  while ((m = re.exec(css))) {
    const body = m[2]
    const pick = (k) => (body.match(new RegExp(`${k}\\s*:\\s*([^;]+);`)) || [])[1]?.trim()
    const url = (body.match(/url\(([^)]+)\)/) || [])[1]
    if (!url) continue
    const sliceNo = (url.match(/\.(\d+)\.woff2$/) || [])[1]
    faces.push({
      subset: m[1] ? m[1].replace(/[[\]]/g, '') : sliceNo ?? `s${faces.length}`,
      family: pick('font-family').replace(/['"]/g, ''),
      style: pick('font-style') || 'normal',
      weight: Number(pick('font-weight')),
      range: pick('unicode-range'),
      url,
    })
  }
  return faces
}

function resolveAria2() {
  const candidates = [process.env.ARIA2C, 'aria2c', 'D:/Software/Tools/aria2/aria2c.exe'].filter(Boolean)
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { stdio: 'ignore' })
    if (r.status === 0) return c
  }
  return null
}

async function downloadAll(jobs) {
  const aria2 = resolveAria2()
  if (aria2) {
    const list = jobs.map((j) => `${j.url}\n  out=${j.file}`).join('\n') + '\n'
    const listFile = path.join(OUT_DIR, '.aria2-input.txt')
    await writeFile(listFile, list)
    console.log(`[fonts] aria2 下载 ${jobs.length} 个文件（${aria2}）`)
    const r = spawnSync(aria2, ['-i', listFile, '-d', OUT_DIR, '-j', '16', '-x', '4', '--allow-overwrite=true',
      '--auto-file-renaming=false', '--console-log-level=warn', '--summary-interval=0'], { stdio: 'inherit' })
    await rm(listFile, { force: true })
    if (r.status !== 0) throw new Error(`aria2 退出码 ${r.status}`)
    return
  }
  console.log(`[fonts] 未找到 aria2，退回 fetch 逐个下载 ${jobs.length} 个文件`)
  for (const j of jobs) {
    const res = await fetch(j.url)
    if (!res.ok) throw new Error(`下载失败 ${res.status} ${j.url}`)
    await writeFile(path.join(OUT_DIR, j.file), Buffer.from(await res.arrayBuffer()))
  }
}

async function main() {
  const res = await fetch(CSS_URL, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`获取 Google Fonts CSS 失败：${res.status}`)
  const faces = parseFaces(await res.text())
  if (faces.length === 0) throw new Error('未解析到任何 @font-face（Google 返回格式可能变了）')

  // 同文件 + 同 range 的多个字重合并为一个 @font-face（可变字体）
  const groups = new Map()
  for (const f of faces) {
    const key = `${f.family}|${f.style}|${f.url}|${f.range}`
    const g = groups.get(key) || { ...f, weights: [] }
    g.weights.push(f.weight)
    groups.set(key, g)
  }

  // 文件名：<family-slug>-<子集名>.woff2（Noto 为切片编号，拉丁字体为 latin/cyrillic…），稳定可读
  const fileOf = new Map()
  for (const g of groups.values()) {
    if (!fileOf.has(g.url)) fileOf.set(g.url, `${slug(g.family)}-${slug(g.subset)}.woff2`)
  }

  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  await downloadAll([...fileOf].map(([url, file]) => ({ url, file })))

  // 校验：每个文件都落地且非空
  const files = await readdir(OUT_DIR)
  for (const file of fileOf.values()) {
    if (!files.includes(file) || (await stat(path.join(OUT_DIR, file))).size === 0) {
      throw new Error(`文件缺失或为空：${file}`)
    }
  }

  const blocks = [...groups.values()].map((g) => {
    const lo = Math.min(...g.weights)
    const hi = Math.max(...g.weights)
    const weight = lo === hi ? `${lo}` : `${lo} ${hi}`
    return `@font-face{font-family:'${g.family}';font-style:${g.style};font-weight:${weight};font-display:swap;` +
      `src:url(./gf/${fileOf.get(g.url)}) format('woff2');unicode-range:${g.range}}`
  })
  const header = `/* 由 scripts/selfhost-google-fonts.mjs 生成，勿手改。来源：${CSS_URL} */\n`
  await writeFile(OUT_CSS, header + blocks.join('\n') + '\n')

  let total = 0
  for (const file of fileOf.values()) total += (await stat(path.join(OUT_DIR, file))).size
  console.log(`[fonts] 完成：${groups.size} 条 @font-face（原 ${faces.length} 条），${fileOf.size} 个文件，共 ${(total / 1048576).toFixed(2)} MB`)
}

main().catch((e) => {
  console.error('[fonts]', e.message)
  process.exit(1)
})
