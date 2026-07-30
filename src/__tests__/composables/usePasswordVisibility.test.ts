/**
 * usePasswordVisibility — 密码显隐单例行为护栏
 *
 * 该 composable 是 BookmarkCard.vue 与 DetailPanel.vue 共用的密码明文显隐状态管理
 * （模块级单例），承担两条用户可见/安全相关语义：
 *   1. toggle(id)/isVisible(id)/hideAll() 控制某卡密码字段点「眼睛」是否展示明文，
 *      且可见后 setTimeout(_autoHideMs) 自动隐藏（防用户忘记关明文长期挂 DOM）；
 *   2. E3-007 防肩窥：document visibilitychange(hidden) / pagehide / window blur 触发
 *      _hideAll 立即清空所有明文态，避免切后台/失焦后明文仍挂在 DOM 被旁人窥见。
 * 另审计 R29：监听懒绑单例（首次 usePasswordVisibility 才绑 3 个全局监听，后续不再重绑）。
 *
 * 全部上述行为此前零直接测试、靠实现口头维护。本护栏把行为契约直锁为可回归断言，
 * 防未来漂移（漏 clearTimeout 致 auto-hide 失效、漏 emit hidden 仍隐藏、重绑监听致 N 个监听复活）。
 * 仅给 _hideAll 增 export + 新增 __testReset 测试钩子（同 __testPendingSync/__testHistDebounce 口径），
 * 生产隐藏逻辑一字未动。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  usePasswordVisibility,
  _hideAll,
  __testReset,
} from '../../composables/ui/usePasswordVisibility.js'

beforeEach(() => {
  __testReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('toggle / isVisible — 显隐轮显契约', () => {
  it('toggle 后 isVisible 返回 true（点眼睛变明文）', () => {
    const { toggle, isVisible } = usePasswordVisibility()
    toggle('bm1')
    expect(isVisible('bm1')).toBe(true)
  })

  it('同 id 再 toggle 回 false（再点眼睛收明文）', () => {
    const { toggle, isVisible } = usePasswordVisibility()
    toggle('bm1')
    expect(isVisible('bm1')).toBe(true)
    toggle('bm1')
    expect(isVisible('bm1')).toBe(false)
  })

  it('多 id 独立：显示一个不影响另一个', () => {
    const { toggle, isVisible } = usePasswordVisibility()
    toggle('bm1')
    toggle('bm2')
    expect(isVisible('bm1')).toBe(true)
    expect(isVisible('bm2')).toBe(true)
    toggle('bm1')
    expect(isVisible('bm1')).toBe(false)
    expect(isVisible('bm2')).toBe(true)
  })

  it('未 toggle 的 id 恒不可见', () => {
    const { isVisible } = usePasswordVisibility()
    expect(isVisible('unknown')).toBe(false)
  })
})

describe('auto-hide timer — 自动隐藏契约', () => {
  it('toggle 后 autoHideMs 到期清空所有可见（防明文长期挂 DOM）', () => {
    const { toggle, isVisible } = usePasswordVisibility(5000)
    toggle('bm1')
    expect(isVisible('bm1')).toBe(true)
    vi.advanceTimersByTime(4999)
    expect(isVisible('bm1')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isVisible('bm1')).toBe(false)
  })

  it('autoHideMs 用首次绑定的值（单例锁定，后续调用忽略）', () => {
    // 首次绑定 autoHideMs=3000
    usePasswordVisibility(3000)
    const { toggle, isVisible } = usePasswordVisibility(999999)
    toggle('bm1')
    expect(isVisible('bm1')).toBe(true)
    // 后续传的 999999 被忽略，用首次 3000
    vi.advanceTimersByTime(2999)
    expect(isVisible('bm1')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isVisible('bm1')).toBe(false)
  })

  it('auto-hide 后多 id 全被清空（一次到期清全部明文）', () => {
    const { toggle, isVisible } = usePasswordVisibility(5000)
    toggle('bm1')
    toggle('bm2')
    toggle('bm3')
    vi.advanceTimersByTime(5000)
    expect(isVisible('bm1')).toBe(false)
    expect(isVisible('bm2')).toBe(false)
    expect(isVisible('bm3')).toBe(false)
  })

  it('已可见 id toggle 回 false 删除时不重置既有 timer 边界', () => {
    const { toggle, isVisible } = usePasswordVisibility(5000)
    toggle('bm1')
    // 第二个 id 触发 clearTimeout 旧 + 布新（复用同一 timer）
    toggle('bm2')
    // 关掉 bm1（删除态，不布新 timer，既有 bm2 的 timer 保留）
    toggle('bm1')
    expect(isVisible('bm1')).toBe(false)
    expect(isVisible('bm2')).toBe(true)
    vi.advanceTimersByTime(5000)
    // bm2 仍随 timer 到期隐藏
    expect(isVisible('bm2')).toBe(false)
  })
})

describe('hideAll — 手动清空契约', () => {
  it('hideAll 清空全部可见 + 清掉 in-flight timer（手动收起所有明文）', () => {
    const { toggle, isVisible, hideAll } = usePasswordVisibility(5000)
    toggle('bm1')
    toggle('bm2')
    hideAll()
    expect(isVisible('bm1')).toBe(false)
    expect(isVisible('bm2')).toBe(false)
    // timer 已被清，advance 不会触发多余回调（幂等）
    vi.advanceTimersByTime(5000)
    expect(isVisible('bm1')).toBe(false)
  })

  it('_hideAll 直接调用同 hideAll 语义（导出可直测）', () => {
    const { toggle, isVisible } = usePasswordVisibility(5000)
    toggle('bm1')
    _hideAll()
    expect(isVisible('bm1')).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(isVisible('bm1')).toBe(false)
  })
})

describe('E3-007 防肩窥 — 切页/失焦自动隐藏契约', () => {
  it('document visibilitychange → hidden 触发 _hideAll 清明文', () => {
    const { toggle, isVisible } = usePasswordVisibility(5000)
    toggle('bm1')
    expect(isVisible('bm1')).toBe(true)
    // 模拟页面隐藏（切后台）
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(isVisible('bm1')).toBe(false)
    // 还原 hidden 供后续用例
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })
  })

  it('pagehide 事件复用 _onVisChange —— 仅当 document.hidden=true 才 _hideAll（真实行为锁定：pagehide 走 _onVisChange 而非 _onBlur，共享 hidden 判定）', () => {
    const { toggle, isVisible } = usePasswordVisibility(5000)
    toggle('bm1')
    // pagehide 绑定的是 _onVisChange，jsdom document.hidden 默认 false 时不清
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })
    window.dispatchEvent(new Event('pagehide'))
    expect(isVisible('bm1')).toBe(true)
    // 仅当 pagehide 时 document.hidden 也为 true 才清
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    })
    window.dispatchEvent(new Event('pagehide'))
    expect(isVisible('bm1')).toBe(false)
    // 还原
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })
  })

  it('window blur 事件触发 _hideAll（失焦时清明文）', () => {
    const { toggle, isVisible } = usePasswordVisibility(5000)
    toggle('bm1')
    window.dispatchEvent(new Event('blur'))
    expect(isVisible('bm1')).toBe(false)
  })

  it('visibilitychange → visible 不触发 _hideAll（回到前台不清空）', () => {
    const { toggle, isVisible } = usePasswordVisibility(5000)
    toggle('bm1')
    // hidden=false 时 _onVisChange 不调 _hideAll
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(isVisible('bm1')).toBe(true)
  })
})

describe('R29 监听懒绑单例 — 防重复监听', () => {
  it('首次 usePasswordVisibility 绑 3 个全局监听（visibilitychange/pagehide/blur）', () => {
    const docSpy = vi.spyOn(document, 'addEventListener')
    const winSpy = vi.spyOn(window, 'addEventListener')
    usePasswordVisibility()
    expect(docSpy).toHaveBeenCalledTimes(1) // visibilitychange
    expect(winSpy).toHaveBeenCalledTimes(2) // pagehide + blur
  })

  it('第二次 usePasswordVisibility 不再重复绑监听（单例防 N 个监听复活）', () => {
    usePasswordVisibility()
    const docSpy = vi.spyOn(document, 'addEventListener')
    const winSpy = vi.spyOn(window, 'addEventListener')
    usePasswordVisibility()
    usePasswordVisibility()
    expect(docSpy).not.toHaveBeenCalled()
    expect(winSpy).not.toHaveBeenCalled()
  })

  it('visibleIds 是共享单例 Set（两次 usePasswordVisibility 返回同一引用）', () => {
    const a = usePasswordVisibility()
    const b = usePasswordVisibility()
    expect(a.visibleIds).toBe(b.visibleIds)
    a.toggle('bm1')
    expect(b.isVisible('bm1')).toBe(true)
  })
})
