import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * P2-7：双份分享渲染的 T 字典同步护栏。
 *
 * 背景：分享页 SSR 有两个实现——
 *   1. functions/_lib/share-render.ts（Cloudflare Pages Functions，**当前真源**，
 *      含分类分享渲染 v2 卡片网格）
 *   2. supabase/functions/share-html/index.ts（Supabase Edge Function，旧方案保底，
 *      仅组分享渲染，不含分类页 key）
 * 两份 T 字典（zh-CN / en-US）靠手工同步——share-html 之前以「单文件镜像」方式内联，
 * 字典漏抄/漂移无人发现（P2-7）。
 *
 * 断言不变量（保守、不脆）：
 *   1. share-html 的 T key 集合 ⊆ share-render 的 T key 集合
 *      （share-render 是功能超集：多分类分享 key；share-html 不应有它没有的 key，
 *       否则说明改动顺序反了——CF 真源漏抄了 Deno 旧版）
 *   2. 上述子集关系对 zh-CN 与 en-US 两个语言分支分别成立
 *   3. 共享 key 的文案值必须逐字一致（双语都是）——同义不同文是漂移。
 *      实测基线：zh 18 / en 20 个共享 key 文案零差异（2026-09-02）。
 *
 * 注意：文案一致性断言较严，若未来有意让旧保底版文案不同步（例如停更文案），
 * 需先在注释中说明并拆分断言，不要直接放宽到「仅 key 子集」。
 */

const ROOT = resolve(import.meta.dirname, '../..')

const SHARE_RENDER = resolve(ROOT, 'functions/_lib/share-render.ts')
const SHARE_HTML = resolve(ROOT, 'supabase/functions/share-html/index.ts')

/** 提取 `const NAME = {` 到括号配平的 `}`（含）之间的源码 */
function extractConst(src: string, name: string): string {
  const m = new RegExp(`\\bconst\\s+${name}\\s*=\\s*(\\{)`).exec(src)
  if (!m) throw new Error(`const ${name} 未找到`)
  const start = m.index + m[0].indexOf('{')
  let depth = 0
  let inStr: "'" | '"' | null = null
  let esc = false
  let i = start
  for (; i < src.length; i++) {
    const c = src[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === inStr) inStr = null
    } else if (c === "'" || c === '"') {
      inStr = c
    } else if (c === '{') {
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`const ${name} 括号未配平`)
}

/**
 * 递归收集 TS 对象字面量的扁平 key 路径集合（跳过注释与字符串内容）。
 * 仅支持纯字面量（key: string | { … }），不支持函数/模板串——T 字典满足该前提，
 * 若未来 T 引入函数值需先升级本解析器。
 */
function collectKeyValues(body: string): Map<string, string> {
  const values = new Map<string, string>()
  const n = body.length

  function skipTrivia(i: number): number {
    // 空白 / 注释 / 字符串整体
    while (i < n) {
      const c = body[i]
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
      if (c === '/' && body[i + 1] === '/') { while (i < n && body[i] !== '\n') i++; continue }
      if (c === '/' && body[i + 1] === '*') {
        i += 2
        while (i < n && !(body[i] === '*' && body[i + 1] === '/')) i++
        i += 2
        continue
      }
      break
    }
    return i
  }

  function readString(i: number): [value: string, next: number] {
    const quote = body[i]
    let j = i + 1
    let out = ''
    while (j < n) {
      const c = body[j]
      if (c === '\\') { out += body[j + 1] ?? ''; j += 2; continue }
      if (c === quote) return [out, j + 1]
      out += c
      j++
    }
    throw new Error('字符串未闭合')
  }

  function parseObject(i: number, prefix: string): number {
    // body[i] === '{'
    i = skipTrivia(i + 1)
    while (i < n) {
      i = skipTrivia(i)
      if (i >= n) throw new Error('对象未闭合')
      if (body[i] === '}') return i + 1

      // key
      let key: string
      if (body[i] === "'" || body[i] === '"') {
        ;[key, i] = readString(i)
      } else {
        const m = /^[A-Za-z_$][\w$]*/.exec(body.slice(i))
        if (!m) throw new Error(`无法解析 key：${body.slice(i, i + 20)}`)
        key = m[0]
        i += m[0].length
      }
      i = skipTrivia(i)
      if (body[i] !== ':') throw new Error(`key ${key} 后缺冒号`)

      const path = prefix ? `${prefix}.${key}` : key
      i = skipTrivia(i + 1)
      if (body[i] === '{') {
        i = parseObject(i, path)
      } else if (body[i] === "'" || body[i] === '"') {
        // 字符串叶子：记录 key → value（readString 已解转义）
        const [v, ni] = readString(i)
        values.set(path, v)
        i = ni
      } else {
        // 裸标量（不应出现于纯文案字典）：跳至分隔符，值记空串
        while (i < n && body[i] !== ',' && body[i] !== '}') i++
        values.set(path, '')
      }
      i = skipTrivia(i)
      if (i < n && body[i] === ',') i++
    }
    throw new Error('对象未闭合')
  }

  parseObject(0, '')
  return values
}

/** 提取字典并按语言分支返回扁平 key → 文案 映射（去掉 zh-CN./en-US. 前缀） */
function dictOf(src: string): Record<'zh' | 'en', Map<string, string>> {
  const body = extractConst(src, 'T')
  const all = collectKeyValues(body)
  const zh = new Map<string, string>()
  const en = new Map<string, string>()
  for (const [p, v] of all) {
    if (p.startsWith('zh-CN.')) zh.set(p.slice('zh-CN.'.length), v)
    else if (p.startsWith('en-US.')) en.set(p.slice('en-US.'.length), v)
  }
  return { zh, en }
}

describe('P2-7 双份分享渲染 T 字典同步', () => {
  const renderSrc = readFileSync(SHARE_RENDER, 'utf8')
  const htmlSrc = readFileSync(SHARE_HTML, 'utf8')

  it('两个文件都存在且含 T 字典', () => {
    expect(renderSrc.length).toBeGreaterThan(1000)
    expect(htmlSrc.length).toBeGreaterThan(1000)
    expect(extractConst(renderSrc, 'T')).toContain('zh-CN')
    expect(extractConst(htmlSrc, 'T')).toContain('zh-CN')
  })

  it('share-html（旧保底）T key ⊆ share-render（CF 真源）T key —— zh-CN', () => {
    const render = dictOf(renderSrc)
    const html = dictOf(htmlSrc)
    const missing = [...html.zh.keys()].filter(k => !render.zh.has(k))
    expect(missing).toEqual([])
  })

  it('share-html T key ⊆ share-render T key —— en-US', () => {
    const render = dictOf(renderSrc)
    const html = dictOf(htmlSrc)
    const missing = [...html.en.keys()].filter(k => !render.en.has(k))
    expect(missing).toEqual([])
  })

  it('share-render 分类分享 key 存在于 share-render 中（防误删）', () => {
    const render = dictOf(renderSrc)
    for (const k of ['defaultCategoryName', 'emptyCategory', 'catDesc', 'catBookmarks', 'categoryMeta']) {
      expect(render.zh.has(k), `zh.${k}`).toBe(true)
      expect(render.en.has(k), `en.${k}`).toBe(true)
    }
  })

  it('共享 key 文案逐字一致 —— zh-CN（防手工同步漂移）', () => {
    const render = dictOf(renderSrc)
    const html = dictOf(htmlSrc)
    const drifted: string[] = []
    for (const [k, v] of html.zh) {
      if (render.zh.has(k) && render.zh.get(k) !== v) drifted.push(`${k}: html=${JSON.stringify(v)} render=${JSON.stringify(render.zh.get(k))}`)
    }
    expect(drifted).toEqual([])
  })

  it('共享 key 文案逐字一致 —— en-US（防手工同步漂移）', () => {
    const render = dictOf(renderSrc)
    const html = dictOf(htmlSrc)
    const drifted: string[] = []
    for (const [k, v] of html.en) {
      if (render.en.has(k) && render.en.get(k) !== v) drifted.push(`${k}: html=${JSON.stringify(v)} render=${JSON.stringify(render.en.get(k))}`)
    }
    expect(drifted).toEqual([])
  })
})
