/**
 * deepReadVideoTool.test.ts — AI 工具 deep_read_video 的执行器接线
 *
 * 锁死契约 §4 的客户端行为：
 * - 仅视频平台链接可执行（普通网页/非 URL 直接拒绝，不消耗额度）；
 * - 成功路径：提交 → 轮询（steps 展示阶段）→ 拼转写/画面网址 → 交给 LLM 提炼；
 * - 配额 429 / 登录 401 / 服务 503 用明确文案 + toast，不伪造成功、不静默降级。
 *
 * 真实 deepVideoExtract 模块参与（只 mock 网络与登录态），保证错误映射链路被测到。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-token' } } })),
    },
  },
  isSupabaseConfigured: true,
}))

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(async () => true),
}))

// 只替换 LLM 提炼（避免真实网络），其余视频解析纯逻辑保留真实实现
const mockInsights = vi.hoisted(() => vi.fn())
vi.mock('../../lib/ai/videoExtract.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/ai/videoExtract.js')>()
  return {
    ...actual,
    extractVideoInsightsWithAI: (...args: unknown[]) => mockInsights(...args),
  }
})

import { createAiAgentToolRunner } from '../../composables/domain/useAiChatAgent.js'
import { toast } from '../../lib/toast.js'
import type { ChatTurn } from '../../lib/ai/chatSessions.js'

const fetchMock = vi.fn()

function makeRunner() {
  return createAiAgentToolRunner({
    ds: { categories: [], customAttributes: [] } as never,
    ui: {} as never,
    t: (key: string, params?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        'ai.deepReadNeedVideoUrl': '深度解析仅支持视频平台链接（B站/抖音/小红书/YouTube 等），未执行。',
        'ai.deepLoginRequired': '深度解析需登录后使用，请先登录账号。',
        'ai.deepUnavailable': '深度解析服务暂不可用，请稍后重试。',
        'ai.deepQuotaExceeded': '今日深度解析额度已用完（每日上限 {limit} 次），明天再来或升级 PRO',
        'ai.deepQuotaExceededUnknown': '今日深度解析额度已用完，明天再来或升级 PRO',
        'ai.deepTimeout': '深度解析超时，请稍后重试或换更短的视频。',
        'ai.deepSubmitting': '已提交视频深度解析任务：{url}',
        'ai.deepJobQueued': '深度解析排队中（预计 {eta} 秒）',
        'ai.deepStageProgress': '深度解析中：{stage}（{progress}%）',
        'ai.deepStageDone': '完成',
        'ai.deepResultEmpty': '深度解析已完成，但没有拿到可读的口播转写或画面网址。',
        'ai.deepFailed': '深度解析失败（{code}）：{message}',
        'ai.deepRequestFailedNetwork': '深度解析请求失败，请检查网络后重试。',
        'ai.stopped': '已中断生成。',
        'ai.toolResultUnknown': '未知工具 {name}，未执行。',
      }
      let text = dict[key] || key
      for (const [k, v] of Object.entries(params || {})) text = text.split(`{${k}}`).join(String(v))
      return text
    },
    tN: (_key: string, n: number) => String(n),
  })
}

function makeTurn(): ChatTurn {
  return { id: 'turn-1', role: 'assistant', content: '', timestamp: 0, candidates: [] }
}

describe('deep_read_video — 参数与可用性守卫', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockInsights.mockResolvedValue({ summary: null, candidates: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('非视频平台链接：直接拒绝且不发任何网络请求（不消耗深度额度）', async () => {
    const runner = makeRunner()
    const turn = makeTurn()
    const result = await runner(turn, new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'https://example.com/article' },
    })

    expect(result).toContain('仅支持视频平台链接')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(turn.steps?.length ?? 0).toBe(0)
  })

  it('缺失/非法 URL：同样拒绝执行', async () => {
    const runner = makeRunner()
    const result = await runner(makeTurn(), new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'not-a-url' },
    })
    expect(result).toContain('仅支持视频平台链接')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('deep_read_video — 成功路径与如实失败', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    mockInsights.mockResolvedValue({ summary: '视频里提到了即时设计。', candidates: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('提交 → 轮询（steps 展示阶段）→ 拼转写与画面网址 → 交给 LLM 提炼', async () => {
    vi.useFakeTimers()
    fetchMock
      // 1) 提交
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ job_id: 'job-1', status: 'queued', eta_seconds: 30 }),
      })
      // 2) 第一次状态查询：运行中
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ job_id: 'job-1', status: 'running', progress: 0.5, stage: 'asr' }),
      })
      // 3) 第二次状态查询：完成
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          job_id: 'job-1',
          status: 'done',
          progress: 1,
          stage: 'done',
          result: {
            success: true,
            title: '工具分享',
            duration: 128,
            uploader: 'UP 主',
            transcript: { text: '本期推荐即时设计这个工具' },
            on_screen_urls: [{ url: 'https://js.design', confidence: 0.9, frames: 4 }],
            degraded: false,
          },
        }),
      })

    const runner = makeRunner()
    const turn = makeTurn()
    const pending = runner(turn, new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'https://www.bilibili.com/video/BV1xx411c7mD', question: '视频里提到的网站有哪些' },
    })
    // 轮询默认间隔 2s：推进定时器让第二次 deep_status 发出
    await vi.advanceTimersByTimeAsync(2500)
    const result = await pending

    // 结果文本包含标题/时长/转写/画面网址，并带 LLM 速览
    expect(result).toContain('视频里提到了即时设计。')
    expect(result).toContain('本期推荐即时设计这个工具')
    expect(result).toContain('https://js.design')
    expect(result).toContain('时长：2 分 8 秒')
    // 交给 LLM 提炼的内容里含画面网址（供候选卡片生成）
    const insightInput = mockInsights.mock.calls[0][0] as string
    expect(insightInput).toContain('https://js.design')
    expect(mockInsights.mock.calls[0][1]).toEqual([])
    expect(mockInsights.mock.calls[0][3]).toMatchObject({ question: '视频里提到的网站有哪些' })
    // steps 从提交 → 排队 → 阶段 → 完成，最后标记 done
    expect(turn.steps?.length).toBe(1)
    expect(turn.steps?.[0].done).toBe(true)
    expect(turn.steps?.[0].text).toBe('完成')
  })

  it('429 deep_quota_exceeded：明确告知额度用完并 toast，不伪造结果', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ code: 'deep_quota_exceeded', error: '今日深度解析额度已用完（PRO 2 次/日）', quota: { limit: 2 } }),
    })

    const runner = makeRunner()
    const result = await runner(makeTurn(), new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'https://www.bilibili.com/video/BV1' },
    })

    expect(result).toContain('额度已用完')
    expect(result).toContain('2')
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('额度已用完'), false)
    // 不降级去抓 jina（只有一次 deep 提交请求）
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('401 login_required：提示登录，不当作成功', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ code: 'login_required', error: '登录后可使用深度解析' }),
    })

    const result = await makeRunner()(makeTurn(), new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'https://www.bilibili.com/video/BV1' },
    })
    expect(result).toContain('需登录')
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('需登录'), false)
  })

  it('503 deep_unavailable：如实告知服务不可用', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: 'deep_unavailable', error: '深度解析服务暂不可用' }),
    })

    const result = await makeRunner()(makeTurn(), new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'https://www.bilibili.com/video/BV1' },
    })
    expect(result).toContain('暂不可用')
  })

  it('worker 任务失败：返回真实错误码（asr_unavailable），不伪装完成', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ job_id: 'job-9', status: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          job_id: 'job-9',
          status: 'failed',
          progress: 0.6,
          stage: 'asr',
          error: { code: 'asr_unavailable', message: 'ASR 未配置' },
        }),
      })

    const runner = makeRunner()
    const turn = makeTurn()
    const result = await runner(turn, new AbortController(), {
      name: 'deep_read_video',
      arguments: { url: 'https://www.bilibili.com/video/BV1' },
    })
    expect(result).toContain('asr_unavailable')
    expect(turn.steps?.[0].done).toBe(false)
    // 失败时不得调用 LLM 编造总结
    expect(mockInsights).not.toHaveBeenCalled()
  })
})
