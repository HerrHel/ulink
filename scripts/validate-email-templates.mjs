/**
 * 校验 CloudBase 邮件模板是否符合平台入参限制
 *
 * 规则来源：CloudBase 登录配置文档 EmailTemplateConfig
 *   - 必须包含 {{.VerificationCode}}
 *   - 可选变量：{{.Usage}} {{.ExpireMinutes}} {{.Email}}
 *   - 禁止：script / javascript / onclick / onload / iframe / link 标签、
 *           CSS expression、CSS url()
 *
 * 用法: node scripts/validate-email-templates.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DIR = resolve('cloudbase/email-templates')

const FORBIDDEN = [
  { re: /<script/i, label: '<script> 标签' },
  { re: /javascript:/i, label: 'javascript: 协议' },
  { re: /\sonclick\s*=/i, label: 'onclick 属性' },
  { re: /\sonload\s*=/i, label: 'onload 属性' },
  { re: /<iframe/i, label: '<iframe> 标签' },
  { re: /<link\b/i, label: '<link> 标签' },
  { re: /<meta\b/i, label: '<meta> 标签（实测被拒）' },
  { re: /<!DOCTYPE/i, label: '<!DOCTYPE>（应只提交 HTML 片段）' },
  { re: /expression\s*\(/i, label: 'CSS expression()' },
  { re: /url\s*\(/i, label: 'CSS url()' },
]

const ALLOWED_VARS = new Set(['VerificationCode', 'Usage', 'ExpireMinutes', 'Email'])

const files = readdirSync(DIR).filter((f) => f.endsWith('.html'))
if (files.length === 0) {
  console.error(`✖ ${DIR} 下没有 .html 模板`)
  process.exit(1)
}

let failed = 0

for (const file of files) {
  const html = readFileSync(join(DIR, file), 'utf8')
  const problems = []

  if (!/\{\{\s*\.VerificationCode\s*\}\}/.test(html)) {
    problems.push('缺少必填变量 {{.VerificationCode}}')
  }

  for (const { re, label } of FORBIDDEN) {
    if (re.test(html)) problems.push(`含禁用项：${label}`)
  }

  // 变量名白名单：抓出 {{.Xxx}} 里不在允许列表内的
  const vars = [...html.matchAll(/\{\{\s*\.(\w+)\s*\}\}/g)].map((m) => m[1])
  const unknown = [...new Set(vars)].filter((v) => !ALLOWED_VARS.has(v))
  if (unknown.length) problems.push(`未知变量：${unknown.map((v) => `{{.${v}}}`).join(' ')}`)

  // 残留的 Supabase/Go 模板写法
  if (/\{\{\s+\.(Token|SiteURL|ConfirmationURL|Email)\s+\}\}/.test(html)) {
    problems.push('残留 Supabase 模板变量（{{ .Token }} / {{ .SiteURL }} 等）')
  }

  // 注释闭合符后跟了字符 → 会被当成正文原样渲染（真实事故：`-->;` 让邮件开头多出一个「；」）
  // 先剥掉注释，再看「第一个标签之前」有没有游离文字，避免把注释内部的 `-->` 误判。
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '')
  const leadingText = /^[^<]+/.exec(stripped.trimStart())
  if (leadingText && leadingText[0].trim()) {
    problems.push(`正文开头有游离字符「${leadingText[0].trim().slice(0, 8)}」，通常是注释 \`-->\` 后多打的字符`)
  }
  // style 块之后、下一个标签之前同理：那段文字会直接渲染在邮件最上面
  const afterStyle = /<\/style>([^<]*)/i.exec(stripped)
  if (afterStyle && afterStyle[1].trim()) {
    problems.push(`</style> 之后有游离字符「${afterStyle[1].trim().slice(0, 8)}」`)
  }

  const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)

  if (problems.length) {
    failed += 1
    console.log(`✖ ${file}（${sizeKb} KB）`)
    for (const p of problems) console.log(`    - ${p}`)
  } else {
    console.log(`✔ ${file}（${sizeKb} KB）变量: ${[...new Set(vars)].join(', ') || '无'}`)
  }
}

console.log(`\n${files.length - failed}/${files.length} 个模板通过`)
process.exit(failed ? 1 : 0)
