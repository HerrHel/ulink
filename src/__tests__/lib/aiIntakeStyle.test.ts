/**
 * AI 预填（2026-11-21）：一句话人话备注 + 模仿用户写法 + 套餐闸门。
 *
 * 三层：
 *  1. 服务端纯函数（functions/api/extract-metadata.ts）：提示词、风格样本消毒、句末清洗
 *  2. 服务端闸门：AI_ALLOWED=false 时绝不调用大模型，只回网页原标题（免费能力）；放行时提示词带上风格样本
 *  3. 前端选样（lib/ai/styleSamples.ts）与透传（smartIntake）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildIntakePrompt,
  sanitizeStyleSamples,
  tidyOneLiner,
  onRequest as extractOnRequest,
} from '../../../functions/api/extract-metadata.js'
import { collectStyleSamples, rememberAiSuggestion, MAX_STYLE_SAMPLES } from '../../lib/ai/styleSamples.js'
import { fetchUrlMetadataAsync } from '../../lib/ai/smartIntake.js'
import { UI_STATE_KEY } from '../../config/constants.js'
import type { Bookmark } from '../../types.js'

const bm = (id: string, notes: string, updatedAt: number, extra: Partial<Bookmark> = {}): Bookmark => ({
  id, title: id, url: `https://${id}.example.com`, username: '', password: '', notes, icon: '',
  categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0, attributes: {},
  isExpanded: false, createdAt: updatedAt, updatedAt, ...extra,
} as Bookmark)

describe('服务端提示词：一句话、像人写的', () => {
  it('明确要求一句话口语备注，并禁止宣传腔', () => {
    const p = buildIntakePrompt({ url: 'https://www.bilibili.com/', title: '哔哩哔哩', description: '国内领先的视频网站' })
    expect(p).toContain('一句话备注')
    expect(p).toContain('像人随手记的')
    for (const w of ['一站式', '致力于', '为您提供', '海量']) expect(p).toContain(w) // 出现在禁用词清单里
    expect(p).toContain('不好的例子')
    // 旧提示词的「文雅 / 典雅 / 20-60字」正是 AI 腔来源，不得回潮
    expect(p).not.toMatch(/文雅|典雅|20-60/)
  })

  it('无风格样本时不出现样本段；有样本时逐条列出并声明只读、不照抄', () => {
    expect(buildIntakePrompt({ url: 'https://a.com' })).not.toContain('用户自己写过的备注】')
    const p = buildIntakePrompt({ url: 'https://a.com', styleSamples: ['查快递用', '看番'] })
    expect(p).toContain('【用户自己写过的备注】')
    expect(p).toContain('- 查快递用')
    expect(p).toContain('- 看番')
    expect(p).toContain('不要照抄内容')
    expect(p).toContain('用户的习惯优先于下面的字数建议')
  })

  it('sanitizeStyleSamples：只收字符串、去控制字符与反引号、去重、单条 ≤80 字、最多 8 条', () => {
    expect(sanitizeStyleSamples('x')).toEqual([])
    const out = sanitizeStyleSamples([1, null, 'a', '`注入`\u0000文本', '重复', '重复', 'x'.repeat(200),
      ...Array.from({ length: 20 }, (_, i) => `样本${i}`)])
    expect(out).not.toContain('a') // 过短
    expect(out[0]).toBe('注入 文本')
    expect(out.filter((s) => s === '重复')).toHaveLength(1)
    expect(out.find((s) => s.startsWith('xxx'))!.length).toBe(80)
    expect(out).toHaveLength(8)
  })

  it('tidyOneLiner：去掉句末句号与首尾引号', () => {
    expect(tidyOneLiner('「免费可商用的图标库。」')).toBe('免费可商用的图标库')
    expect(tidyOneLiner('  查快递、寄快递。 ')).toBe('查快递、寄快递')
  })
})

describe('服务端闸门：AI_ALLOWED 决定是否调用大模型', () => {
  const PAGE = '<html><head><title>Iconfont 图标库</title><meta name="description" content="阿里巴巴矢量图标库，提供海量图标"></head><body></body></html>'
  let mimoCalls: Array<{ prompt: string }> = []
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    mimoCalls = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('xiaomimimo.com')) {
        const body = JSON.parse(String(init?.body || '{}'))
        mimoCalls.push({ prompt: body.messages?.[0]?.content || '' })
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"title":"Iconfont","description":"免费可商用的图标库。","suggestedCategoryId":null,"suggestedAttrIds":[]}' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('userinfo') || url.includes('/auth/')) {
        return new Response('{"sub":"u1"}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      // 目标网页（公网 IP 字面量，免 DNS）
      return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    }) as typeof fetch
  })
  afterEach(() => { globalThis.fetch = originalFetch })

  const call = (env: Record<string, unknown>) => extractOnRequest({
    request: new Request('https://ulink.ren/ai-api?action=extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      body: JSON.stringify({ url: 'https://93.184.216.34/', styleSamples: ['看番用', '查快递'] }),
    }),
    env: env as never,
  })

  it('未放行（试用用完 / 未登录）：不调用大模型，仍返回网页原标题，ai=skipped', async () => {
    const res = await call({ MIMO_API_KEY: 'k', AI_ALLOWED: false })
    const data = await res.json() as Record<string, unknown>
    expect(mimoCalls).toHaveLength(0)
    expect(data.success).toBe(true)
    expect(data.title).toContain('Iconfont')
    expect(data.ai).toBe('skipped')
  })

  it('放行：调用大模型，提示词带上用户风格样本，备注经句末清洗，ai=used', async () => {
    const res = await call({ MIMO_API_KEY: 'k', AI_ALLOWED: true })
    const data = await res.json() as Record<string, unknown>
    expect(mimoCalls).toHaveLength(1)
    expect(mimoCalls[0].prompt).toContain('- 看番用')
    expect(data.description).toBe('免费可商用的图标库')
    expect(data.ai).toBe('used')
  })
})

describe('前端选样：只取用户自己写的短备注', () => {
  beforeEach(() => localStorage.clear())

  it('排除已删除、官网书签、未改动的示例备注、多行笔记、过短/过长，按最近更新优先', () => {
    const list = [
      bm('old', '很早写的', 1),
      bm('new', '最近写的', 100),
      bm('del', '删掉的', 99, { deletedAt: 99 }),
      bm('bm_ulink_home', '官网', 98),
      bm('b1', '代码托管平台', 97), // 示例数据 b1 的默认备注，未改动
      bm('b4', '刷短视频摸鱼', 96), // 示例 id 但备注被用户改过 → 算用户写法
      bm('multi', '第一行\n第二行', 95),
      bm('short', 'a', 94),
      bm('long', '长'.repeat(81), 93),
    ]
    expect(collectStyleSamples(list)).toEqual(['最近写的', '刷短视频摸鱼', '很早写的'])
  })

  it('AI 给出后被原样保存的备注不当作用户写法（防止越学越像 AI）', () => {
    rememberAiSuggestion('免费可商用的图标库')
    expect(collectStyleSamples([bm('x', '免费可商用的图标库', 2), bm('y', '我自己写的', 1)])).toEqual(['我自己写的'])
  })

  it('最多取 8 条；关闭「模仿我的写法」后一条不取', () => {
    const many = Array.from({ length: 20 }, (_, i) => bm(`m${i}`, `备注${i}`, i))
    expect(collectStyleSamples(many)).toHaveLength(MAX_STYLE_SAMPLES)
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({ aiStyleAdapt: false }))
    expect(collectStyleSamples(many)).toEqual([])
  })
})

describe('前端透传：smartIntake 发送风格样本并带回 ai / aiGate', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = originalFetch })

  it('请求体含 styleSamples；服务端回报试用用完时结果带 aiGate', async () => {
    let sentBody: Record<string, unknown> = {}
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({ success: true, title: '图标库', description: '阿里巴巴矢量图标库', ai: 'skipped', aiGate: 'ai_trial_exhausted' }), { status: 200 })
    }) as typeof fetch
    const res = await fetchUrlMetadataAsync('https://www.iconfont.cn/', [], [], { styleSamples: ['看番用'] })
    expect(sentBody.url).toBe('https://www.iconfont.cn/')
    expect(sentBody.styleSamples).toEqual(['看番用'])
    expect(res.ai).toBe('skipped')
    expect(res.aiGate).toBe('ai_trial_exhausted')
  })
})
