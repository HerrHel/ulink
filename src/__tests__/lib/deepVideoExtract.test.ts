/**
 * deepVideoExtract.test.ts — 视频深度解析客户端（submitDeepVideo / pollDeepVideo）
 *
 * 覆盖契约 docs/VIDEO_DEEP_EXTRACT.md §4：
 * - 提交 action=deep → job_id；轮询 action=deep_status → done 结果；
 * - 401 login_required / 429 deep_quota_exceeded / 503 deep_unavailable 映射为结构化错误（不静默降级）；
 * - 任务 failed 如实返回错误码；轮询总时长上限超时；AbortSignal 取消。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 登录态桩：Supabase 分支需要会话 token；isSupabaseConfigured=true 才允许走网络
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'test-token' } } })),
    },
  },
  isSupabaseConfigured: true,
}))

import {
  submitDeepVideo,
  pollDeepVideo,
  isDeepVideoError,
  isDeepVideoAvailable,
  deepStageLabel,
  DeepVideoError,
} from '../../lib/ai/deepVideoExtract.js'

const fetchMock = vi.fn()

describe('deepVideoExtract — 提交与轮询', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('后端可用性：测试环境（Supabase 已配置 + 函数地址可拼出）判定可用', () => {
    expect(isDeepVideoAvailable()).toBe(true)
  })

  it('submitDeepVideo：POST action=deep 并返回 job_id/status/eta_seconds', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job_id: 'job-abc123', status: 'queued', eta_seconds: 60 }),
    })

    const job = await submitDeepVideo('https://www.bilibili.com/video/BV1xx411c7mD')

    expect(job).toEqual({ job_id: 'job-abc123', status: 'queued', eta_seconds: 60 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, init] = fetchMock.mock.calls[0]
    expect(String(endpoint)).toContain('/functions/v1/extract-video')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      action: 'deep',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
    })
  })

  it('submitDeepVideo：非法/缺失 URL 不发请求（结构化 invalid_url）', async () => {
    await expect(submitDeepVideo('not-a-url')).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(submitDeepVideo('')).rejects.toMatchObject({ code: 'invalid_url' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submitDeepVideo：响应缺 job_id 视为服务不可用，不伪造任务', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'queued' }) })
    await expect(submitDeepVideo('https://www.bilibili.com/video/BV1')).rejects.toMatchObject({
      code: 'deep_unavailable',
    })
  })

  it('轮询到 done：按 2s/自定义间隔轮询，onProgress 上报阶段与进度，返回转写与画面网址', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ job_id: 'job-1', status: 'running', progress: 0.4, stage: 'asr' }),
      })
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
            source: 'bilibili',
            url: 'https://www.bilibili.com/video/BV1',
            title: '工具分享',
            duration: 123,
            uploader: 'UP 主',
            transcript: { text: '本期推荐即时设计', provider: 'faster_whisper', language: 'zh' },
            on_screen_urls: [{ url: 'https://js.design', confidence: 0.92, frames: 3 }],
            degraded: false,
          },
        }),
      })

    const progressCalls: Array<[string | undefined, number]> = []
    const status = await pollDeepVideo('job-1', {
      intervalMs: 5,
      maxMs: 5000,
      onProgress: (stage, progress) => progressCalls.push([stage, progress]),
    })

    expect(status.status).toBe('done')
    expect(status.result?.transcript?.text).toBe('本期推荐即时设计')
    expect(status.result?.on_screen_urls?.[0]).toMatchObject({ url: 'https://js.design', confidence: 0.92 })
    expect(progressCalls).toEqual([
      ['asr', 0.4],
      ['done', 1],
    ])
    // 两次请求都是 deep_status
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(call[1].body)).toMatchObject({ action: 'deep_status' })
    }
  })

  it('任务 failed：如实返回状态与 worker 错误码（不抛成功假象）', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        job_id: 'job-2',
        status: 'failed',
        progress: 0.5,
        stage: 'asr',
        error: { code: 'asr_unavailable', message: 'ASR 未配置' },
      }),
    })

    const status = await pollDeepVideo('job-2', { intervalMs: 5 })
    expect(status.status).toBe('failed')
    expect(status.error).toMatchObject({ code: 'asr_unavailable' })
  })
})

describe('deepVideoExtract — 结构化错误映射（不静默降级）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('429 deep_quota_exceeded：抛结构化错误并带每日上限', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        error: '今日深度解析额度已用完（PRO 2 次/日）',
        code: 'deep_quota_exceeded',
        quota: { limit: 2 },
      }),
    })

    const err = await submitDeepVideo('https://www.bilibili.com/video/BV1').catch((e) => e)
    expect(isDeepVideoError(err)).toBe(true)
    expect(err).toBeInstanceOf(DeepVideoError)
    expect(err.code).toBe('deep_quota_exceeded')
    expect(err.limit).toBe(2)
    expect(err.message).toContain('额度已用完')
  })

  it('401 login_required：映射为登录错误（不当作普通网络失败）', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: '登录后可使用深度解析', code: 'login_required' }),
    })
    await expect(submitDeepVideo('https://www.bilibili.com/video/BV1')).rejects.toMatchObject({
      code: 'login_required',
    })
  })

  it('503 deep_unavailable：映射为服务不可用（不降级 jina 伪装成功）', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: '深度解析服务暂不可用', code: 'deep_unavailable' }),
    })
    await expect(submitDeepVideo('https://www.bilibili.com/video/BV1')).rejects.toMatchObject({
      code: 'deep_unavailable',
    })
  })

  it('轮询阶段同样映射 429（配额在 status 查询时耗尽也如实告知）', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ code: 'deep_quota_exceeded', quota: { limit: 2 } }),
    })
    await expect(pollDeepVideo('job-1', { intervalMs: 5 })).rejects.toMatchObject({
      code: 'deep_quota_exceeded',
    })
  })

  it('fetch 网络异常：抛 network 结构化错误', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    await expect(submitDeepVideo('https://www.bilibili.com/video/BV1')).rejects.toMatchObject({
      code: 'network',
    })
  })
})

describe('deepVideoExtract — 超时与取消', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('轮询超过总时长上限：抛 timeout（不伪造 done）', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job_id: 'job-1', status: 'running', progress: 0.1, stage: 'download' }),
    })

    const pending = expect(
      pollDeepVideo('job-1', { intervalMs: 2000, maxMs: 4000 }),
    ).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(10000)
    await pending
  })

  it('单次请求超时（fake timers）：submitDeepVideo 抛 timeout 而非无限挂起', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url: string, init: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })

    const pending = expect(submitDeepVideo('https://www.bilibili.com/video/BV1')).rejects.toMatchObject({
      code: 'timeout',
    })
    await vi.advanceTimersByTimeAsync(30000)
    await pending
  })

  it('已取消的 signal：轮询立即抛 aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      pollDeepVideo('job-1', { signal: controller.signal, intervalMs: 5 }),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('等待轮询间隔期间取消：立即抛 aborted', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ job_id: 'job-1', status: 'running', progress: 0.1 }),
    })
    const controller = new AbortController()
    const pending = pollDeepVideo('job-1', { signal: controller.signal, intervalMs: 200, maxMs: 5000 })
    setTimeout(() => controller.abort(), 10)
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
  })
})

describe('deepVideoExtract — 阶段中文标签', () => {
  it('已知阶段返回本地化文案，未知阶段回落「处理中」而非内部枚举', () => {
    expect(deepStageLabel('asr')).not.toBe('asr')
    expect(deepStageLabel('download')).not.toBe('download')
    expect(deepStageLabel('ocr')).not.toBe('ocr')
    expect(deepStageLabel('aggregate')).not.toBe('aggregate')
    expect(deepStageLabel('nonsense')).toBe(deepStageLabel(undefined))
  })
})
