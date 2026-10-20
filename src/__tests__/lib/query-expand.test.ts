/**
 * query-expand.test.ts — 模型辅助查询改写（queryExpand.ts）
 * 覆盖：回复解析容错、缓存命中不重复请求（断言 mock 调用次数防假绿）、
 * 失败/超时 fail-open、隐私红线（外发 messages 不含书签库数据）、词条清洗上限。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const askMiMoRawMock = vi.fn()
vi.mock('../../lib/ai/mimoClient.js', () => ({
  askMiMoRaw: (...args: unknown[]) => askMiMoRawMock(...args),
}))

const K_EXPAND_CACHE = 'lv_ai_query_expand_v1'

/** 每个用例重新加载模块，隔离模块级缓存状态 */
async function freshModule() {
  vi.resetModules()
  return await import('../../lib/ai/queryExpand.js')
}

beforeEach(() => {
  askMiMoRawMock.mockReset()
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('parseExpandReply 解析容错', () => {
  it('解析 JSON 数组（含夹带文本）', async () => {
    const { parseExpandReply } = await freshModule()
    expect(parseExpandReply('好的，以下是 ["旅行","行程","地图"] 供参考')).toEqual(['旅行', '行程', '地图'])
  })

  it('逗号/顿号/空白分割兜底', async () => {
    const { parseExpandReply } = await freshModule()
    expect(parseExpandReply('旅行、行程 地图')).toEqual(['旅行', '行程', '地图'])
  })

  it('垃圾/拒答回复返回 []', async () => {
    const { parseExpandReply } = await freshModule()
    expect(parseExpandReply('抱歉，我无法帮您完成这个请求。')).toEqual([])
    expect(parseExpandReply('')).toEqual([])
    expect(parseExpandReply('   ')).toEqual([])
  })

  it('破损 JSON 落入文本分割兜底', async () => {
    const { parseExpandReply } = await freshModule()
    expect(parseExpandReply('["旅行", 行程')).toEqual(['旅行', '行程'])
  })

  it('词条去重、截断 12 字、上限 8 个', async () => {
    const { parseExpandReply } = await freshModule()
    const terms = parseExpandReply('["旅行","旅行","这是一个超过十二个字的超长扩展词条","行程","地图","攻略","酒店","机票","美食","摄影","户外"]')
    expect(terms.length).toBe(8)
    expect(terms[0]).toBe('旅行')
    expect(terms[1]).toBe('这是一个超过十二个字的超')
    expect(new Set(terms).size).toBe(terms.length)
    for (const t of terms) expect(t.length).toBeLessThanOrEqual(12)
  })
})

describe('expandQueryTerms 请求与隐私', () => {
  it('外发 messages 仅含 query 与固定系统提示，不含书签库数据', async () => {
    const { expandQueryTerms } = await freshModule()
    askMiMoRawMock.mockResolvedValue('["行程","地图"]')
    await expandQueryTerms('找个能做旅行攻略的地方', { isZh: true })
    expect(askMiMoRawMock).toHaveBeenCalledTimes(1)
    const messages = askMiMoRawMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages).toHaveLength(2)
    expect(messages[1]).toEqual({ role: 'user', content: '找个能做旅行攻略的地方' })
    expect(messages[0].role).toBe('system')
    const payload = JSON.stringify(messages)
    expect(payload).not.toMatch(/https?:\/\//i)
  })

  it('缓存命中不重复请求（断言调用次数）', async () => {
    const { expandQueryTerms } = await freshModule()
    askMiMoRawMock.mockResolvedValue('["行程","地图"]')
    const first = await expandQueryTerms('旅行攻略')
    const second = await expandQueryTerms('  旅行攻略 ')
    expect(first).toEqual(['行程', '地图'])
    expect(second).toEqual(['行程', '地图'])
    expect(askMiMoRawMock).toHaveBeenCalledTimes(1)
  })

  it('缓存持久化到 localStorage，重载模块后同 query 不再请求', async () => {
    {
      const { expandQueryTerms } = await freshModule()
      askMiMoRawMock.mockResolvedValue('["行程","地图"]')
      await expandQueryTerms('旅行攻略')
    }
    expect(localStorage.getItem(K_EXPAND_CACHE)).toBeTruthy()
    askMiMoRawMock.mockClear()
    {
      const { expandQueryTerms } = await freshModule()
      const result = await expandQueryTerms('旅行攻略')
      expect(result).toEqual(['行程', '地图'])
      expect(askMiMoRawMock).not.toHaveBeenCalled()
    }
  })

  it('请求失败 fail-open 返回 [] 且不缓存', async () => {
    const { expandQueryTerms } = await freshModule()
    askMiMoRawMock.mockRejectedValue(new Error('network down'))
    await expect(expandQueryTerms('旅行攻略')).resolves.toEqual([])
    // 失败结果不入缓存：同 query 再次发起仍会请求
    await expect(expandQueryTerms('旅行攻略')).resolves.toEqual([])
    expect(askMiMoRawMock).toHaveBeenCalledTimes(2)
  })

  it('超时 4s 自动中止并 fail-open 返回 []', async () => {
    const { expandQueryTerms } = await freshModule()
    vi.useFakeTimers()
    askMiMoRawMock.mockImplementation(
      (_messages: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const p = expandQueryTerms('旅行攻略')
    await vi.advanceTimersByTimeAsync(4100)
    await expect(p).resolves.toEqual([])
    expect(askMiMoRawMock).toHaveBeenCalledTimes(1)
  })

  it('外部信号已中止时不发起请求', async () => {
    const { expandQueryTerms } = await freshModule()
    const controller = new AbortController()
    controller.abort()
    await expect(expandQueryTerms('旅行攻略', { signal: controller.signal })).resolves.toEqual([])
    expect(askMiMoRawMock).not.toHaveBeenCalled()
  })

  it('空 query 直接返回 [] 不请求', async () => {
    const { expandQueryTerms } = await freshModule()
    await expect(expandQueryTerms('   ')).resolves.toEqual([])
    expect(askMiMoRawMock).not.toHaveBeenCalled()
  })

  it('模型空回复返回 [] 且不缓存', async () => {
    const { expandQueryTerms } = await freshModule()
    askMiMoRawMock.mockResolvedValue('')
    await expect(expandQueryTerms('旅行攻略')).resolves.toEqual([])
    askMiMoRawMock.mockResolvedValue('["行程"]')
    await expect(expandQueryTerms('旅行攻略')).resolves.toEqual(['行程'])
    expect(askMiMoRawMock).toHaveBeenCalledTimes(2)
  })
})
