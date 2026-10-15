import { describe, it, expect } from 'vitest'
/**
 * mimo-chat 转发层守卫单测（对齐 ssrf-guard.test.ts 的纯逻辑直测模式）。
 * 目标：supabase/functions/mimo-chat/mimo-guard.ts（零 Deno 依赖）。
 */
import {
  validateChatBody,
  isOriginAllowed,
  buildCorsHeaders,
  textLength,
  MAX_MESSAGES_DEFAULT,
  MAX_MESSAGE_CHARS_DEFAULT,
  MAX_TOTAL_CHARS_DEFAULT,
} from '../../supabase/functions/mimo-chat/mimo-guard.js'

const opts = {
  defaultModel: 'mimo-v2.6-flash',
  allowedModels: ['mimo-v2.6-pro'],
}

const okMessages = [{ role: 'user', content: '你好' }]

describe('mimo-guard.validateChatBody', () => {
  it('合法请求放行：返回 model/messages/stream，默认流式', () => {
    const res = validateChatBody({ messages: okMessages }, opts)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.model).toBe('mimo-v2.6-flash')
      expect(res.value.messages).toEqual(okMessages)
      expect(res.value.stream).toBe(true)
    }
  })

  it('model 真白名单：默认模型与显式白名单放行', () => {
    expect(validateChatBody({ model: 'mimo-v2.6-flash', messages: okMessages }, opts).ok).toBe(true)
    expect(validateChatBody({ model: 'mimo-v2.6-pro', messages: okMessages }, opts).ok).toBe(true)
  })

  it('model 真白名单：未知模型直接拒绝，绝不静默放行/改写', () => {
    const res = validateChatBody({ model: 'gpt-4o', messages: okMessages }, opts)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(400)
      expect(res.error).toContain('Model not allowed')
    }
  })

  it('model 形状校验：非法字符/超长模型名被拒（防注入上游请求）', () => {
    expect(validateChatBody({ model: 'evil model\u0000name', messages: okMessages }, opts).ok).toBe(false)
    expect(validateChatBody({ model: 'a'.repeat(65), messages: okMessages }, opts).ok).toBe(false)
  })

  it('messages：非数组/空数组/非对象条目被拒', () => {
    expect(validateChatBody({}, opts).ok).toBe(false)
    expect(validateChatBody({ messages: 'hi' }, opts).ok).toBe(false)
    expect(validateChatBody({ messages: [] }, opts).ok).toBe(false)
    expect(validateChatBody({ messages: [null] }, opts).ok).toBe(false)
    expect(validateChatBody({ messages: ['x'] }, opts).ok).toBe(false)
  })

  it('messages：角色越界被拒（只允许 system/user/assistant/tool）', () => {
    expect(validateChatBody({ messages: [{ role: 'developer', content: 'x' }] }, opts).ok).toBe(false)
    expect(validateChatBody({ messages: [{ role: 'tool', content: '结果' }] }, opts).ok).toBe(true)
    expect(validateChatBody({ messages: [{ role: 'assistant', content: '', tool_calls: [] }] }, opts).ok).toBe(true)
  })

  it('预算：消息条数超限 → 413', () => {
    const messages = Array.from({ length: MAX_MESSAGES_DEFAULT + 1 }, (_, i) => ({ role: 'user', content: `m${i}` }))
    const res = validateChatBody({ messages }, opts)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(413)
  })

  it('预算：单条超长 → 413', () => {
    const res = validateChatBody({ messages: [{ role: 'user', content: 'a'.repeat(MAX_MESSAGE_CHARS_DEFAULT + 1) }] }, opts)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(413)
      expect(res.error).toContain('Message too large')
    }
  })

  it('预算：总量超限（多条累计）→ 413', () => {
    const chunk = 'b'.repeat(1000)
    // 130 条 × 1000 字 = 13 万 > 默认 12 万总量预算；条数上限放宽以隔离测累计逻辑
    const messages = Array.from({ length: 130 }, () => ({ role: 'user', content: chunk }))
    const res = validateChatBody({ messages }, {
      ...opts,
      maxMessages: 1000,
      maxMessageChars: 5000,
      maxTotalChars: MAX_TOTAL_CHARS_DEFAULT,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(413)
  })

  it('temperature：非有限数字丢弃、越界钳制到 [0,2]', () => {
    const drop = validateChatBody({ messages: okMessages, temperature: 'hot' }, opts)
    expect(drop.ok).toBe(true)
    if (drop.ok) expect(drop.value.temperature).toBeUndefined()

    const clampHigh = validateChatBody({ messages: okMessages, temperature: 999 }, opts)
    expect(clampHigh.ok).toBe(true)
    if (clampHigh.ok) expect(clampHigh.value.temperature).toBe(2)

    const clampLow = validateChatBody({ messages: okMessages, temperature: -5 }, opts)
    if (clampLow.ok) expect(clampLow.value.temperature).toBe(0)
  })

  it('tools：非数组拒绝、超规模 413、tool_choice 枚举白名单', () => {
    expect(validateChatBody({ messages: okMessages, tools: 'x' }, opts).ok).toBe(false)

    const bigTools = [{ type: 'function', function: { name: 'x', description: 'd'.repeat(40000), parameters: {} } }]
    const big = validateChatBody({ messages: okMessages, tools: bigTools }, opts)
    expect(big.ok).toBe(false)
    if (!big.ok) expect(big.status).toBe(413)

    expect(validateChatBody({ messages: okMessages, tool_choice: 'auto' }, opts).ok).toBe(true)
    expect(validateChatBody({ messages: okMessages, tool_choice: 'hack' }, opts).ok).toBe(false)
  })

  it('白名单收口：未知顶层字段不透传（如 base_url/secret 注入）', () => {
    const res = validateChatBody({
      messages: okMessages,
      base_url: 'https://evil.example',
      api_key: 'sk-stolen',
    }, opts)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.base_url).toBeUndefined()
      expect(res.value.api_key).toBeUndefined()
      expect(Object.keys(res.value).sort()).toEqual(['messages', 'model', 'stream'])
    }
  })
})

describe('mimo-guard CORS (S9 fail-closed)', () => {
  it('无 Origin（非浏览器）不设 CORS 头', () => {
    expect(isOriginAllowed(null, ['https://ulink.ren'])).toBe(true)
    const h = buildCorsHeaders(null, ['https://ulink.ren'])
    expect(h['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('白名单未配置时跨域一律拒绝（fail-closed）', () => {
    expect(isOriginAllowed('https://evil.example', [])).toBe(false)
  })

  it('白名单外来源拒绝，命中才回显 Allow-Origin', () => {
    const allowed = ['https://ulink.ren']
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false)
    expect(isOriginAllowed('https://ulink.ren', allowed)).toBe(true)
    expect(buildCorsHeaders('https://evil.example', allowed)['Access-Control-Allow-Origin']).toBeUndefined()
    expect(buildCorsHeaders('https://ulink.ren', allowed)['Access-Control-Allow-Origin']).toBe('https://ulink.ren')
  })
})

describe('mimo-guard.textLength', () => {
  it('递归估算字符串/数组/嵌套对象规模', () => {
    expect(textLength('abcd')).toBe(4)
    expect(textLength(['ab', 'cd'])).toBe(4)
    expect(textLength({ a: 'x', b: { c: 'yz' } })).toBe(3)
    expect(textLength(null)).toBe(0)
  })
})
