/**
 * jinaReader — 服务端转发降级链路的隐私披露与安全护栏
 * 1. 请求只发往自家 jina-proxy Edge Function（服务端转发 r.jina.ai），禁止前端直连第三方；
 *    转发前必须以 toast 向用户披露「目标 URL 会发送给第三方」（不做静默外送）；
 * 2. 私有/局域网地址在发出任何外部请求前即被拦截；
 * 3. 未登录时诚实失败（不外送、不披露、不回退成前端直连）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
}))

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('../../lib/supabase.js', () => ({
  supabase: { auth: { getSession: h.getSession } },
  isSupabaseConfigured: true,
}))

import { fetchPageContentViaJina } from '../../lib/ai/jinaReader.js'
import { toast } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'

const toastMock = vi.mocked(toast)

describe('jinaReader — 隐私披露与护栏', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } })
  })

  it('1. 仅经 jina-proxy 服务端转发（零直连 r.jina.ai），转发前以 toast 披露目标 URL 将发送给第三方', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: 'https://example.com/page', text: 'Title: Demo\n\ncontent' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      const res = await fetchPageContentViaJina('https://example.com/page')
      expect(res.success).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      // 请求只发往自家 jina-proxy Edge Function
      expect(String(endpoint)).toContain('/functions/v1/jina-proxy')
      expect(String(endpoint)).not.toContain('r.jina.ai')
      // 目标 URL 走请求体交给服务端转发
      expect(String(init.body)).toContain('https://example.com/page')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
      // 每次触发均披露（防静默外送 URL）
      expect(toastMock).toHaveBeenCalledWith(t('ai.jinaThirdPartyNotice'))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('2. 私有/局域网地址在发请求前拦截：无外部请求、无第三方披露', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    try {
      const res = await fetchPageContentViaJina('http://192.168.1.10/admin')
      expect(res.success).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(toastMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('3. 未登录时诚实失败：不发任何请求、不披露、不回退成前端直连', async () => {
    h.getSession.mockResolvedValueOnce({ data: { session: null } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    try {
      const res = await fetchPageContentViaJina('https://example.com/page')
      expect(res.success).toBe(false)
      expect(res.error).toBe(t('ai.jinaUnavailable'))
      expect(fetchMock).not.toHaveBeenCalled()
      expect(toastMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
