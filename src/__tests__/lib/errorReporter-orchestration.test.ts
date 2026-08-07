/**
 * 行为契约护栏：errorReporter 三函数运行时错误上报编排
 *
 * Explore agentId a72cc7887c578005d 扫真缺口首位：
 * reportError / vueErrorHandler / unhandledRejectionHandler 三函数全测试目录 0 直断言
 * （src/__tests__/errorReporter.test.ts 仅锁 sanitizeReportUrl/looksLikeSecret 两纯函数，
 *  其编排层集成断言空白）。生产调用方：
 *   - ErrorBoundary.vue:43 → reportError({message,stack,component})
 *   - main.ts:13 → app.config.errorHandler = vueErrorHandler
 *   - main.ts:39 → window.addEventListener('unhandledrejection', unhandledRejectionHandler)
 * 三函数是全 App 运行时错误上报唯一入口，承载三道模块级安全契约编排：
 *   H8 URL 脱敏集成（payload.url 缺则用 window.href，均经 sanitizeReportUrl 只存 origin+pathname）
 *   H9 含密抑制短路（looksLikeSecret(message)||looksLikeSecret(stack) 命中即 console.warn + return 不入库）
 *   R28 孤儿 timer 清理（insertP.finally clearTimeout，慢网兜底防泄漏 timer 句柄）
 *   外加 5s 节流 + LRU 100 上限防 error_logs 表穷举。
 * 回归即让用户书签 URL/笔记/密码以报错形态进云端 error_logs 表（RLS 匿名 INSERT）= silent credential leak。
 *
 * 纯加测试零源文件改动：三函数均 src/lib/errorReporter.ts:75/129/156 export，直接 import 测。
 * mock 仅桩：useAuthStore（可控 user.id / 抛错验证 try）+ supabase.from().insert()（可控 success/error
 * + spy 断言 row 字段）+ fake timers 验 R28 clearTimeout + Promise.race 超时。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── useAuthStore mock：可控 user.id 供 reportError 取 user_id（登录/未登录/抛错三分态）──
const _auth = vi.hoisted(() => ({
  user: { id: 'user-abc' } as { id: string } | null,
  throwOnAccess: false,
}))
vi.mock('../../stores/auth.js', () => ({
  useAuthStore: () => {
    if (_auth.throwOnAccess) throw new Error('auth not ready')
    return { user: _auth.user }
  },
}))

// ── supabase mock：from().insert(row) 链可控 success/error + spy 断言 row ──
const _sb = vi.hoisted(() => ({
  insertSpy: vi.fn(),
  resolved: { error: null } as { error: { message: string } | null } | Promise<{ error: { message: string } | null }>,
}))
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: (row: unknown) => {
        _sb.insertSpy(row)
        return _sb.resolved
      },
    })),
  },
}))

import {
  reportError,
  vueErrorHandler,
  unhandledRejectionHandler,
} from '../../lib/errorReporter.js'

describe('reportError 编排护栏', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    _auth.user = { id: 'user-abc' }
    _auth.throwOnAccess = false
    _sb.insertSpy.mockClear()
    // 默认 insert 返回速成功的 thenable（fake timers 下不带 timer）
    _sb.resolved = Promise.resolve({ error: null })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    warnSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('正常上报：from(error_logs).insert(row) 被调 + row 字段正确（user_id + message + stack + component + sanitized url + user_agent）', async () => {
    reportError({
      message: 'boom',
      stack: 'at foo',
      component: 'Comp',
      url: 'https://app.example.com/path?secret=1#frag',
      user_agent: 'Mozilla/5.0',
    })
    // 触发微任务让 spy 被 sync 段调用（insert 是 fire-and-forget 但 resolve 同步触发 spy）
    await vi.advanceTimersByTimeAsync(0)

    expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.user_id).toBe('user-abc')
    expect(row.message).toBe('boom')
    expect(row.stack).toBe('at foo')
    expect(row.component).toBe('Comp')
    // H8：payload.url 经 sanitizeReportUrl 仅留 origin+pathname
    expect(row.url).toBe('https://app.example.com/path')
    expect(row.user_agent).toBe('Mozilla/5.0')
  })

  it('H8 URL 脱敏集成：payload.url 缺省时用 window.location.href 也经 sanitize（仅 origin+pathname）', async () => {
    const hrefSpy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      href: 'https://app.example.com/current?q=leak#frag',
    } as Location)
    try {
      reportError({ message: 'no-url' })
      await vi.advanceTimersByTimeAsync(0)
      expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
      const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
      expect(row.url).toBe('https://app.example.com/current')
    } finally {
      hrefSpy.mockRestore()
    }
  })

  it('H9 含密 message 抑制：looksLikeSecret(message) 命中 → insert 不调 + console.warn 入', () => {
    reportError({ message: 'password=supersecret123', stack: 'ok' })
    expect(_sb.insertSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('suppressed report containing secret-like content'),
    )
  })

  it('H9 含密 stack 抑制：looksLikeSecret(stack) 命中（message 干净）→ insert 不调', () => {
    reportError({
      message: 'clean error msg',
      stack: 'at foo (Bearer abcdefghijklmnopqrstuvwxyz012345)',
    })
    expect(_sb.insertSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('节流命中：同 message 5s 内二次调 insert 仅 1 次', async () => {
    reportError({ message: 'throttled-msg' })
    await vi.advanceTimersByTimeAsync(0)
    expect(_sb.insertSpy).toHaveBeenCalledTimes(1)

    // 同 message 再调：节流命中 return，不 insert
    reportError({ message: 'throttled-msg' })
    await vi.advanceTimersByTimeAsync(0)
    expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
  })

  it('节流过期放行：同 message 超过 5s 后再次上报 insert 2 次', async () => {
    reportError({ message: 'after-5s' })
    await vi.advanceTimersByTimeAsync(0)
    expect(_sb.insertSpy).toHaveBeenCalledTimes(1)

    // 推进超过 THROTTLE_MS=5000
    await vi.advanceTimersByTimeAsync(5001)
    reportError({ message: 'after-5s' })
    await vi.advanceTimersByTimeAsync(0)
    expect(_sb.insertSpy).toHaveBeenCalledTimes(2)
  })

  it('H9 抑制不计入节流后续放行（含密独立 message 不占节流槽后正常 message 仍上报）', async () => {
    reportError({ message: 'password=wrong1' }) // 被抑制 return
    await vi.advanceTimersByTimeAsync(0)
    expect(_sb.insertSpy).not.toHaveBeenCalled()

    reportError({ message: 'clean-msg-after-suppress' })
    await vi.advanceTimersByTimeAsync(0)
    expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
  })

  it('auth try/catch：useAuthStore 抛错 → user_id=null 不阻断 insert', async () => {
    _auth.throwOnAccess = true
    reportError({ message: 'auth-throws' })
    await vi.advanceTimersByTimeAsync(0)
    expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
    expect((_sb.insertSpy.mock.calls[0][0] as Record<string, unknown>).user_id).toBeNull()
  })

  it('未登录：user=null → row.user_id=null', async () => {
    _auth.user = null
    reportError({ message: 'anon' })
    await vi.advanceTimersByTimeAsync(0)
    expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
    expect((_sb.insertSpy.mock.calls[0][0] as Record<string, unknown>).user_id).toBeNull()
  })

  it('row slice 长度上界：message<=1000 / stack<=5000 / component<=200 / url<=2048 / user_agent<=1024', async () => {
    const longMsg = 'x'.repeat(2000)
    const longStack = 'y'.repeat(7000)
    const longComp = 'z'.repeat(500)
    const longUrl = 'https://app.example.com/' + 'p'.repeat(3000)
    const longUA = 'ua'.repeat(2000)
    reportError({
      message: longMsg,
      stack: longStack,
      component: longComp,
      url: longUrl,
      user_agent: longUA,
    })
    await vi.advanceTimersByTimeAsync(0)
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect((row.message as string).length).toBe(1000)
    expect((row.stack as string).length).toBe(5000)
    expect((row.component as string).length).toBe(200)
    expect((row.url as string).length).toBeLessThanOrEqual(2048)
    expect((row.user_agent as string).length).toBeLessThanOrEqual(1024)
  })

  it('payload 缺省栈/组件/url/user_agent：stack=空串 / component=空串 / url 走 window.href / user_agent 走 navigator.userAgent', async () => {
    reportError({ message: 'minimal' })
    await vi.advanceTimersByTimeAsync(0)
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.stack).toBe('')
    expect(row.component).toBe('')
    expect(typeof row.url).toBe('string')
    expect(typeof row.user_agent).toBe('string')
  })

  it('R28 孤儿 timer 清理：insertP settle 后 clearTimeout 被调（防成功上报泄漏 timer 句柄）', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    reportError({ message: 'r28-cleanup' })
    // 触发 Promise.race resolve + .finally
    await vi.advanceTimersByTimeAsync(0)
    // insert 速成功，finally 段 clearTimeout 应被调一次清掉 INSERT_TIMEOUT_MS timer
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('R28 超时兜底分支：insert 8s 不 settle → Promise.race 取 timeoutP，error.message==="timeout" 不 console.warn', async () => {
    // pending insert 永不 settle
    _sb.resolved = new Promise(() => {})
    reportError({ message: 'slow-insert' })
    // 未达超时前不 warn
    await vi.advanceTimersByTimeAsync(100)
    expect(warnSpy).not.toHaveBeenCalled()
    // 达 INSERT_TIMEOUT_MS=8000 后 race 取 timeoutP（error.message==='timeout'，专判 exclude warn）
    await vi.advanceTimersByTimeAsync(8000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('insert error 分支（非 timeout）：console.warn 上报失败', async () => {
    _sb.resolved = Promise.resolve({ error: { message: 'insert rejected' } })
    reportError({ message: 'insert-fails' })
    await vi.advanceTimersByTimeAsync(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[errorReporter] insert failed:'),
      expect.anything(),
    )
  })
})

describe('vueErrorHandler 编排护栏', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _auth.user = { id: 'user-abc' }
    _sb.insertSpy.mockClear()
    _sb.resolved = Promise.resolve({ error: null })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errSpy.mockRestore()
  })

  it('component name 三段降序 ①：instance.$options.name 命中', async () => {
    const err = new Error('render fail')
    vueErrorHandler(err, { $options: { name: 'TopComp' } } as any, 'render')
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.component).toBe('TopComp [render]')
    expect(row.message).toBe('render fail')
  })

  it('component name 三段降序 ②：$options 缺则走 instance?.$?.type.name', async () => {
    const err = new Error('render fail 2')
    vueErrorHandler(err, { $: { type: { name: 'MidComp' } } } as any, 'setup')
    // promise 异步；不 await，断 row.component
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.component).toBe('MidComp [setup]')
  })

  it('component name 三段降序 ③：$options.name + $?.type.name 均缺则走 $options._componentTag', async () => {
    const err = new Error('render fail 3')
    vueErrorHandler(err, { $options: { _componentTag: '<my-tag>' } } as any, 'beforeCreate')
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.component).toBe('<my-tag> [beforeCreate]')
  })

  it('component name 三段全缺 → "unknown" 兜底', async () => {
    const err = new Error('render fail 4')
    vueErrorHandler(err, {} as any, 'render')
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.component).toBe('unknown [render]')
  })

  it('err 非 Error（裸 string）→ message 走 String(err) + stack undefined', async () => {
    vueErrorHandler('bare string err', { $options: { name: 'X' } } as any, 'hook')
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.message).toBe('bare string err')
    expect(row.stack).toBe('')
  })

  it('err 非 Error（数字）→ String(err) 数字串', async () => {
    vueErrorHandler(404 as any, { $options: { name: 'X' } } as any, 'hook')
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.message).toBe('404')
  })

  it('保留控制台调试输出：3 console.error（Vue error + Component + Info）', () => {
    vueErrorHandler(new Error('e'), { $options: { name: 'C' } } as any, 'i')
    const errCalls = errSpy.mock.calls as unknown as [string, ...unknown[]][]
    const msgs = errCalls.map((c) => String(c[0]))
    expect(msgs.filter((m: string) => m.includes('Vue error')).length).toBe(1)
    expect(msgs.filter((m: string) => m.includes('Component')).length).toBe(1)
    expect(msgs.filter((m: string) => m.includes('Info')).length).toBe(1)
  })

  it('经 reportError 节流：同 component+info 的 Err 二次调 insert 受节流约束（5s 内不再 insert）', async () => {
    vi.useFakeTimers()
    try {
      vueErrorHandler(new Error('dup'), { $options: { name: 'C' } } as any, 'i')
      await vi.advanceTimersByTimeAsync(0)
      expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
      vueErrorHandler(new Error('dup'), { $options: { name: 'C' } } as any, 'i')
      await vi.advanceTimersByTimeAsync(0)
      // reportError 节流同 message（'dup'）5s 内不再 insert
      expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('unhandledRejectionHandler 编排护栏', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _auth.user = { id: 'user-abc' }
    _sb.insertSpy.mockClear()
    _sb.resolved = Promise.resolve({ error: null })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('reason Error：message 加 [UnhandledRejection] 前缀 + stack 保留 + component=global', async () => {
    const err = new Error('async boom')
    const fakeEvent = { reason: err } as PromiseRejectionEvent
    unhandledRejectionHandler(fakeEvent)
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.message).toBe('[UnhandledRejection] async boom')
    expect(row.stack).toBe(err.stack)
    expect(row.component).toBe('global')
  })

  it('reason 非 Error（裸 string）：String(reason) 加前缀', async () => {
    const fakeEvent = { reason: 'a rejected string' } as unknown as PromiseRejectionEvent
    unhandledRejectionHandler(fakeEvent)
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.message).toBe('[UnhandledRejection] a rejected string')
    expect(row.stack).toBe('')
  })

  it('reason 非 Error（数字）：String(reason) 加前缀', async () => {
    const fakeEvent = { reason: 500 } as unknown as PromiseRejectionEvent
    unhandledRejectionHandler(fakeEvent)
    const row = _sb.insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(row.message).toBe('[UnhandledRejection] 500')
  })

  it('经 reportError 节流：同 reason Err 二次调受 5s 节流约束', async () => {
    vi.useFakeTimers()
    try {
      unhandledRejectionHandler({ reason: new Error('ur-throttle') } as PromiseRejectionEvent)
      await vi.advanceTimersByTimeAsync(0)
      expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
      unhandledRejectionHandler({ reason: new Error('ur-throttle') } as PromiseRejectionEvent)
      await vi.advanceTimersByTimeAsync(0)
      expect(_sb.insertSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
