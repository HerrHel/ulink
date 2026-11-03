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
  mediaStats,
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

describe('mimo-guard 音视频多模态预算（2026-11-03 支持 video_url / input_audio）', () => {
  const base = {
    model: 'mimo-v2.6-flash',
    stream: true,
  }
  const videoPart = (url: string) => ({ type: 'video_url', video_url: { url } })
  const audioPart = (len: number) => ({
    type: 'input_audio',
    input_audio: { data: 'data:audio/mpeg;base64,' + 'A'.repeat(len), format: 'mp3' },
  })

  it('video_url 不计入文本字符预算（长 URL 不会误触 12 万上限）', () => {
    const url = 'https://cdn.example.com/' + 'x'.repeat(200000) + '.mp4'
    const body = { ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }, videoPart(url)] }] }
    const r = validateChatBody(body, opts)
    expect(r.ok).toBe(true)
  })

  it('最多 1 个视频，第二个直接 413', () => {
    const body = {
      ...base,
      messages: [{
        role: 'user',
        content: [videoPart('https://a/1.mp4'), videoPart('https://a/2.mp4')],
      }],
    }
    const r = validateChatBody(body, opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Too many videos')
  })

  it('input_audio 的 base64 不计入文本预算，独立上限 12M 字符（对齐 MiMo 实测容量）', () => {
    // 8.53MB 源文件 → 11.9M 字符，实测 MiMo 可处理（44s），故上限设在 12M
    const okBody = { ...base, messages: [{ role: 'user', content: [audioPart(11_900_000)] }] }
    expect(validateChatBody(okBody, opts).ok).toBe(true)

    const tooBig = { ...base, messages: [{ role: 'user', content: [audioPart(12_500_000)] }] }
    const r = validateChatBody(tooBig, opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Audio too large')
  })

  it('input_audio 支持存储 URL（base64 由云函数物化），仅接受 https 且长度受限', () => {
    const urlPart = (url: string) => ({ type: 'input_audio', input_audio: { url, format: 'mp3' } })

    // 正常：自家存储 URL 通过，且不占 base64 预算
    const ok = validateChatBody(
      { ...base, messages: [{ role: 'user', content: [urlPart('https://xxx.tcb.qcloud.la/u/deep/a.mp3')] }] },
      opts,
    )
    expect(ok.ok).toBe(true)

    // 非 https 拒绝（防明文与 file:// 等协议）
    const http = validateChatBody(
      { ...base, messages: [{ role: 'user', content: [urlPart('http://xxx.tcb.qcloud.la/a.mp3')] }] },
      opts,
    )
    expect(http.ok).toBe(false)
    if (!http.ok) expect(http.error).toContain('must be https')

    // 超长 URL 拒绝
    const longUrl = 'https://x.tcb.qcloud.la/' + 'a'.repeat(2100) + '.mp3'
    const tooLong = validateChatBody(
      { ...base, messages: [{ role: 'user', content: [urlPart(longUrl)] }] },
      opts,
    )
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.error).toContain('too long')
  })

  it('图片内联预算收紧到 40 万字符（对齐网关约 512KB 入站上限）', () => {
    const imgPart = (len: number) => ({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,' + 'A'.repeat(len) },
    })
    expect(validateChatBody({ ...base, messages: [{ role: 'user', content: [imgPart(300_000)] }] }, opts).ok).toBe(true)
    const r = validateChatBody({ ...base, messages: [{ role: 'user', content: [imgPart(450_000)] }] }, opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('Images too large')
  })

  it('mediaStats 统计视频/音频数量与载荷规模', () => {
    const value = {
      content: [videoPart('https://a/1.mp4'), audioPart(100)],
    }
    const st = mediaStats(value)
    expect(st.video).toBe(1)
    expect(st.audio).toBe(1)
    expect(st.chars).toBeGreaterThan(100)
  })
})
