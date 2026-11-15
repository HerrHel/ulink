/**
 * ai-golden-eval.test.ts — 真模型 golden 回归评测（手动触发，不进默认 CI）
 *
 * 目的：提示词 / 检索 / 工具 schema 的改动后，用固定输入打真实 MiMo 通道，
 * 比对关键要素（非全文），防止「结构断言全绿但真实模型答非所问」的假闭环回归。
 *
 * 运行：`npm run test:ai-eval`（走 vitest.ai-eval.config.ts，自动注入 AI_EVAL_REQUIRE=1）。
 * 默认 `npm run test` 下本套件整体跳过（不产生网络调用与费用）。
 *
 * 鉴权（必须为真实登录态，评测走与生产完全相同的 CloudBase mimo-chat 通道）：
 *   - AI_EVAL_TOKEN：CloudBase access token（浏览器登录 ulink.ren 后从会话中取，
 *     即客户端 authDriver.getApiToken() 的返回值）
 *   - 可选 AI_EVAL_FN_BASE：覆盖转发基址（默认与 .env.production 一致 https://ulink.ren）
 * 缺凭据时如实 FAIL 并给出指引，绝不静默跳过（防假绿）。
 *
 * 2026-11-15：旧版打 `${VITE_SUPABASE_URL}/functions/v1/mimo-chat` 并用 supabase-js
 * 密码登录换 token —— 生产 11-10 已全量 CloudBase，这条通道必然 404 / 登录失败。
 * 现改为同域 `${VITE_CLOUDBASE_FN_BASE}/mimo-chat`，Bearer 直接带 CloudBase token。
 *
 * 说明：为便于解析，评测以 stream=false 打同一转发通道（mimo-guard 放行该字段），
 * 其余请求组装（系统提示词 / 温度 / tools）与生产 askMiMoStream 同口径。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { buildUlinkSystemPrompt } from '../../lib/ai/mimoPrompt.js'
import { getMiMoConfig } from '../../lib/ai/mimoStream.js'
import { ULINK_AGENT_TOOLS } from '../../lib/ai/tools.js'
import { GOLDEN_CASES, checkGoldenExpectation, type GoldenCase, type GoldenReply } from './goldenCases.js'

const ENABLED = !!process.env.AI_EVAL_REQUIRE

/** 与生产同一个 HTTP 函数网关；允许 AI_EVAL_FN_BASE 覆盖（联调自测用） */
export function evalFnUrl(): string {
  const base =
    (import.meta.env.VITE_CLOUDBASE_FN_BASE as string | undefined) ||
    process.env.AI_EVAL_FN_BASE ||
    'https://ulink.ren'
  return `${String(base).replace(/\/+$/, '')}/mimo-chat`
}

/** 单条用例最大尝试次数：首跑失败再复跑一次区分采样波动与真实回归（两次全败才判 FAIL） */
const MAX_ATTEMPTS = 2

/** 真通道单条请求（非流式 JSON，与生产同通道同参数） */
async function callMimoForEval(c: GoldenCase, token: string): Promise<GoldenReply> {
  const systemPrompt = buildUlinkSystemPrompt({
    categories: c.categories || [],
    customAttributes: c.customAttributes || [],
    isZh: c.isZh !== false,
    contextSlice: c.contextSlice,
  })
  const conf = getMiMoConfig()
  const body = {
    model: conf.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: c.query },
    ],
    temperature: 0.3,
    stream: false,
    tools: ULINK_AGENT_TOOLS,
    tool_choice: 'auto',
  }
  const res = await fetch(evalFnUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`mimo-chat 请求失败 (${res.status}): ${errText.slice(0, 300)}`)
  }
  const json = await res.json()
  const message = json?.choices?.[0]?.message
  if (!message) throw new Error(`响应缺少 choices[0].message：${JSON.stringify(json).slice(0, 300)}`)
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((tc: { function?: { name?: string } }) => ({ name: tc?.function?.name || '' }))
    : []
  return { content: String(message.content || ''), toolCalls }
}

/**
 * #55（审计 2026-11-14）：真模型评测默认整体 describe.skipIf、独立 ai-eval 配置也不进
 * CI，导致该文件在默认套件里 0 执行。这里把「golden expectation 可解析性」做成
 * **不受 AI_EVAL_REQUIRE 门控**的结构性检查，纳入默认 `npm run test`：
 * 零网络、零凭据、零费用，但能挡住「配置写错（工具名拼错 / 期望为空 / 数组元素非法）
 * 导致真模型评测永远失败、而默认套件全绿却无人发现」这类假绿。
 * 真模型调用仍由下方 describe.skipIf 门控，绝不在 CI 跑（需凭据 + 计费）。
 * 注：vitest.ai-eval.config.ts 同样 include 本文件，届时 ENABLED=true，两类一起跑，无副作用。
 */
describe('真模型评测通道与生产一致（零网络）', () => {
  it('打 CloudBase 同域 mimo-chat，不再指向 Supabase /functions/v1/', () => {
    const url = evalFnUrl()
    expect(url).toMatch(/\/mimo-chat$/)
    expect(url).not.toMatch(/\/functions\/v1\//)
  })
})

describe('golden expectation 结构性校验（默认套件常跑，零网络）', () => {
  const toolNames = new Set(ULINK_AGENT_TOOLS.map((t) => t.function.name))

  it('每条用例 id 唯一、query / note 非空', () => {
    const ids = GOLDEN_CASES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of GOLDEN_CASES) {
      expect(c.id.trim(), '用例 id 不能为空').not.toBe('')
      expect(c.query.trim(), `用例 ${c.id} 的 query 不能为空`).not.toBe('')
      expect(c.note.trim(), `用例 ${c.id} 的 note 不能为空`).not.toBe('')
    }
  })

  it('expect 至少含一项有效判据，且数组字段都是非空字符串数组', () => {
    for (const c of GOLDEN_CASES) {
      const e = c.expect
      const hasExpectation = !!(
        e.allOf?.length || e.anyOf?.length || e.noneOf?.length || e.noneOfExact?.length ||
        e.expectToolCall || e.expectCard || e.expectEnglish
      )
      expect(hasExpectation, `用例 ${c.id} 缺少关键要素期望（空期望会恒真通过）`).toBe(true)
      for (const key of ['allOf', 'anyOf', 'noneOf', 'noneOfExact'] as const) {
        const arr = e[key]
        if (arr === undefined) continue
        expect(Array.isArray(arr), `用例 ${c.id} 的 ${key} 必须是数组`).toBe(true)
        for (const item of arr) {
          expect(typeof item, `用例 ${c.id} 的 ${key} 元素必须是字符串`).toBe('string')
          expect((item as string).trim(), `用例 ${c.id} 的 ${key} 元素不能为空串`).not.toBe('')
        }
      }
    }
  })

  it('expectToolCall 必须是 ULINK_AGENT_TOOLS 里真实存在的工具名（真跑才可能命中）', () => {
    for (const c of GOLDEN_CASES) {
      if (!c.expect.expectToolCall) continue
      expect(
        toolNames.has(c.expect.expectToolCall),
        `用例 ${c.id} 期望的工具 ${c.expect.expectToolCall} 不在 ULINK_AGENT_TOOLS 中，真模型评测必 FAIL`,
      ).toBe(true)
    }
  })

  it('每条期望可被 checkGoldenExpectation 解析出区分度（空回复必至少 1 条失败）', () => {
    for (const c of GOLDEN_CASES) {
      const failures = checkGoldenExpectation({ content: '', toolCalls: [] }, c.expect, {
        categories: c.categories,
        attributes: c.customAttributes,
      })
      expect(failures.length, `用例 ${c.id} 的期望对空回复无区分度（恒真）`).toBeGreaterThan(0)
    }
  })
})

describe.skipIf(!ENABLED)('AI 真模型 golden 回归评测（手动门控）', () => {
  let token = ''

  beforeAll(() => {
    // CloudBase 的用户密码登录依赖浏览器侧 SDK，Node 评测进程里无法复现；
    // 旧版用 supabase-js 登录换 token 的路径在生产切 CloudBase 后必然失败。
    // 因此只接受显式传入的真实 CloudBase access token，缺就 fail-closed。
    const direct = process.env.AI_EVAL_TOKEN
    if (!direct) {
      throw new Error(
        '缺少 AI_EVAL_TOKEN（CloudBase access token）。请在 ulink.ren 登录后从会话取 token，' +
          '或用 AI_EVAL_FN_BASE 指定联调环境；评测不会静默跳过。',
      )
    }
    token = direct
  }, 60000)

  for (const c of GOLDEN_CASES) {
    it(
      `${c.id} — ${c.note}`,
      async () => {
        const attemptFailures: string[][] = []
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const reply = await callMimoForEval(c, token)
          const failures = checkGoldenExpectation(reply, c.expect, {
            categories: c.categories,
            attributes: c.customAttributes,
          })
          if (failures.length === 0) return
          attemptFailures.push(failures)
          console.warn(`[ai-eval] ${c.id} 第 ${attempt} 次未达关键要素：${failures.join('；')}`)
        }
        // 两次全败才判 FAIL（区分采样波动与真实回归），报告如实列出每次的缺失要素
        const detail = attemptFailures
          .map((f, i) => `第 ${i + 1} 次：${f.join('；')}`)
          .join('\n')
        expect.fail(`用例 ${c.id}（${c.note}）关键要素未达标：\n${detail}`)
      },
      120000,
    )
  }
})
