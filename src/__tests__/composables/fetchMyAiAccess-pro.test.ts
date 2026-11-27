import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbRpcMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/dbApi.js', () => ({ dbRpc: dbRpcMock }))

import { fetchMyAiAccess, setMyTimezone } from '../../composables/domain/useRedeem.js'

describe('fetchMyAiAccess — 解析 my_ai_access 返回', () => {
  beforeEach(() => dbRpcMock.mockReset())

  it('PRO 新服务端：解析今日次数与本月 token 用量', async () => {
    dbRpcMock.mockResolvedValue({
      data: {
        tier: 'pro', daily_used: 37, daily_limit: 300, monthly_used_tokens: 1200000, monthly_limit_tokens: 3000000,
        requests_month_used: 412, requests_month_limit: 3000, requests_month_resets_at: '2026-11-30T16:00:00+00:00',
        monthly_resets_at: '2026-11-30T16:00:00+00:00',
      },
      error: null,
    })
    const a = await fetchMyAiAccess()
    expect(a.tier).toBe('pro')
    expect(a.pro).toEqual({
      dailyUsed: 37, dailyLimit: 300, monthlyUsedTokens: 1200000, monthlyLimitTokens: 3000000,
      requestsMonthUsed: 412, requestsMonthLimit: 3000,
      requestsMonthResetsAt: '2026-11-30T16:00:00+00:00', monthlyResetsAt: '2026-11-30T16:00:00+00:00',
    })
  })

  it('PRO 旧服务端（只返回 tier）：不带 pro 字段，前端按旧行为不展示用量', async () => {
    dbRpcMock.mockResolvedValue({ data: { tier: 'pro' }, error: null })
    const a = await fetchMyAiAccess()
    expect(a.tier).toBe('pro')
    expect(a.pro).toBeUndefined()
  })

  it('解析额度时区状态与恢复时刻；未登录不带时区', async () => {
    dbRpcMock.mockResolvedValue({
      data: {
        tier: 'trial', used: 1, limit: 30, remaining: 29,
        quota_tz: 'America/Los_Angeles', quota_tz_set: true,
        pending_tz: 'Europe/Berlin', pending_effective_at: '2026-11-28T08:00:00+00:00',
        tz_changed_at: '2026-11-27T10:00:00+00:00', daily_resets_at: '2026-11-28T08:00:00+00:00',
      },
      error: null,
    })
    const a = await fetchMyAiAccess()
    expect(a.tz).toEqual({
      zone: 'America/Los_Angeles', isSet: true,
      pendingZone: 'Europe/Berlin', pendingAt: '2026-11-28T08:00:00+00:00',
      changedAt: '2026-11-27T10:00:00+00:00', dailyResetsAt: '2026-11-28T08:00:00+00:00',
    })
    dbRpcMock.mockResolvedValue({ data: { tier: 'anonymous', quota_tz: 'Asia/Shanghai' }, error: null })
    expect((await fetchMyAiAccess()).tz).toBeUndefined()
  })

  it('setMyTimezone：传参正确，解析成功 / 冷却 / 网络失败', async () => {
    dbRpcMock.mockResolvedValue({ data: { ok: true, quota_tz: 'Asia/Shanghai', quota_tz_set: true, pending_tz: 'Asia/Tokyo' }, error: null })
    const ok = await setMyTimezone('Asia/Tokyo')
    expect(dbRpcMock).toHaveBeenCalledWith('set_my_timezone', { p_tz: 'Asia/Tokyo', p_initial: false })
    expect(ok).toMatchObject({ ok: true, tz: { zone: 'Asia/Shanghai', pendingZone: 'Asia/Tokyo' } })

    dbRpcMock.mockResolvedValue({ data: { ok: false, reason: 'cooldown', next_allowed_at: '2026-12-27T00:00:00Z', quota_tz: 'Asia/Shanghai', quota_tz_set: true }, error: null })
    expect(await setMyTimezone('Asia/Tokyo')).toMatchObject({ ok: false, reason: 'cooldown', nextAllowedAt: '2026-12-27T00:00:00Z' })

    dbRpcMock.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await setMyTimezone('Asia/Tokyo', true)).toEqual({ ok: false, reason: 'network' })
    expect(dbRpcMock).toHaveBeenLastCalledWith('set_my_timezone', { p_tz: 'Asia/Tokyo', p_initial: true })
  })

  it('免费用户结构不变；脏值按 0 处理', async () => {
    dbRpcMock.mockResolvedValue({ data: { tier: 'trial', used: 4, limit: 30, remaining: 26 }, error: null })
    expect(await fetchMyAiAccess()).toEqual({ tier: 'trial', used: 4, limit: 30, remaining: 26 })
    dbRpcMock.mockResolvedValue({ data: { tier: 'pro', daily_used: 'x', daily_limit: null }, error: null })
    expect((await fetchMyAiAccess()).pro).toEqual({
      dailyUsed: 0, dailyLimit: 0, monthlyUsedTokens: 0, monthlyLimitTokens: 0, requestsMonthUsed: 0, requestsMonthLimit: 0,
    })
  })
})
