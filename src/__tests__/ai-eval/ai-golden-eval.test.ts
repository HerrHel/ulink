/**
 * ai-golden-eval.test.ts — 真模型 golden 回归评测（手动触发，不进默认 CI）
 *
 * 目的：提示词 / 检索 / 工具 schema 的改动后，用固定输入打真实 MiMo 通道，
 * 比对关键要素（非全文），防止「结构断言全绿但真实模型答非所问」的假闭环回归。
 *
 * 运行：`npm run test:ai-eval`（走 vitest.ai-eval.config.ts，自动注入 AI_EVAL_REQUIRE=1）。
 * 默认 `npm run test` 下本套件整体跳过（不产生网络调用与费用）。
 *
 * 鉴权（二选一，须为真实登录态，评测走与生产完全相同的 mimo-chat Edge Function 转发通道）：
 *   - AI_EVAL_TOKEN：Supabase access_token（应用登录后可从会话中取）
 *   - AI_EVAL_EMAIL + AI_EVAL_PASSWORD：密码登录自动获取 token
 * 另需 .env 中的 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（与生产客户端同源）。
 * 凭据缺失时如实 FAIL 并给出指引，绝不静默跳过（防假绿）。
 *
 * 说明：为便于解析，评测以 stream=false 打同一转发通道（mimo-guard 放行该字段），
 * 其余请求组装（系统提示词 / 温度 / tools）与生产 askMiMoStream 同口径。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { buildUlinkSystemPrompt } from '../../lib/ai/mimoPrompt.js'
import { getMiMoConfig } from '../../lib/ai/mimoStream.js'
import { ULINK_AGENT_TOOLS } from '../../lib/ai/tools.js'
import { GOLDEN_CASES, checkGoldenExpectation, type GoldenCase, type GoldenReply } from './goldenCases.js'

const ENABLED = !!process.env.AI_EVAL_REQUIRE
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || process.env.VITE_SUPABASE_ANON_KEY || ''

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
  const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/mimo-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
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

describe.skipIf(!ENABLED)('AI 真模型 golden 回归评测（手动门控）', () => {
  let token = ''

  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（请检查 .env），评测无法进行')
    }
    const direct = process.env.AI_EVAL_TOKEN
    if (direct) {
      token = direct
      return
    }
    const email = process.env.AI_EVAL_EMAIL
    const password = process.env.AI_EVAL_PASSWORD
    if (!email || !password) {
      throw new Error(
        '缺少评测凭据：请设置 AI_EVAL_TOKEN 或 AI_EVAL_EMAIL + AI_EVAL_PASSWORD（详见文件头注释），评测无法进行',
      )
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session?.access_token) {
      throw new Error(`评测账号登录失败：${error?.message || '无会话返回'}`)
    }
    token = data.session.access_token
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
