import { describe, it, expect } from 'vitest'
import { stripEntranceAnim } from '../utils.js'

/**
 * stripEntranceAnim: src/utils.ts:221
 * 列表展开（listExpandIn）/ 卡片入场（listCardIn）animationend 触发后的
 * style.animationName 清理监听器 —— 防动画名残留复播。
 *
 * 关键承载语义（静态读源，见下护栏逐条锁）：
 *  1) null 入参 → 返回 null，不挂监听器（防空 element 误绑）
 *  2) animationName==='listExpandIn' → 从 style.animationName 剥离该名
 *     （正则去掉 listExpandIn 及尾随逗号与空格，trim 后空则 'none'）
 *     —— **不拆监听器**：listExpandIn 列表展开动画可多次触发，监听保留以复处理
 *  3) animationName==='listCardIn' → style.animationName 设 'none' 且 **拆监听器**
 *     —— 卡片入场动画一次性，处理完即解绑，后续同名事件不再触发回调
 *  4) 其他 animationName → 两 if 均不命中，style 不变、监听保留（保持挂载以等目标动画）
 *  5) 返回的清理函数 → removeEventListener 后解除监听；幂等可重复调
 *
 * jsdom 无全局 AnimationEvent 构造器（生产环境为浏览器原生 AnimationEvent），
 * 故测试用 plain Event('animationend') + Object.defineProperty 补 animationName
 * 模拟真实 animationend 事件载荷，锁的是 stripEntranceAnim 的逻辑而非浏览器 css 触发。
 */

/** 构造带 animationName 的 animationend 事件（jsdom 无 AnimationEvent 构造器的兜底）。 */
function animEnd(name: string): Event {
  const ev = new Event('animationend')
  Object.defineProperty(ev, 'animationName', { value: name, configurable: true })
  return ev
}

describe('stripEntranceAnim: null / 兜底分支', () => {
  it('null 入参返回 null 且不挂监听（document.body 上无 animationend 监听残留）', () => {
    const cleanup = stripEntranceAnim(null)
    expect(cleanup).toBeNull()
  })
})

describe('stripEntranceAnim: listExpandIn 分支（不拆监听器）', () => {
  it('纯 listExpandIn → style.animationName 剥离后空 trim 走 none', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listExpandIn'
    stripEntranceAnim(el)
    el.dispatchEvent(animEnd('listExpandIn'))
    expect(el.style.animationName).toBe('none')
  })

  it('listExpandIn 与其它动画共存 → 只剥离 listExpandIn 保留其余（regex 去尾随逗号/空格）', () => {
    const el = document.createElement('div')
    el.style.animationName = 'foo, listExpandIn, bar'
    stripEntranceAnim(el)
    el.dispatchEvent(animEnd('listExpandIn'))
    // regex /listExpandIn\s*,?\s*/ 去掉首个 'listExpandIn, '，trim 后剩 'foo, bar'
    expect(el.style.animationName).toBe('foo, bar')
  })

  it('listExpandIn 后 listExpandIn 可复触发（监听器未拆，复处理再剥一次）', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listExpandIn'
    stripEntranceAnim(el)
    el.dispatchEvent(animEnd('listExpandIn'))
    expect(el.style.animationName).toBe('none')
    // 监听未拆 → 再补一个 listExpandIn 名仍能被剥
    el.style.animationName = 'listExpandIn'
    el.dispatchEvent(animEnd('listExpandIn'))
    expect(el.style.animationName).toBe('none')
  })

  it('listExpandIn 后 dispatch listCardIn 仍命中（监听仍在 → 走 listCardIn 分支设 none 拆监听）', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listExpandIn'
    stripEntranceAnim(el)
    el.dispatchEvent(animEnd('listExpandIn'))
    expect(el.style.animationName).toBe('none')
    // 同一监听仍在 → listCardIn 命中并拆监听
    el.style.animationName = 'listCardIn'
    el.dispatchEvent(animEnd('listCardIn'))
    expect(el.style.animationName).toBe('none')
  })
})

describe('stripEntranceAnim: listCardIn 分支（拆监听器）', () => {
  it('listCardIn → style.animationName 设 none 且监听器拆解（后续同名事件不再触发）', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listCardIn'
    stripEntranceAnim(el)
    el.dispatchEvent(animEnd('listCardIn'))
    expect(el.style.animationName).toBe('none')
    // 监听已拆 → 再 dispatch 不再改 style
    el.style.animationName = 'listCardIn'
    el.dispatchEvent(animEnd('listCardIn'))
    expect(el.style.animationName).toBe('listCardIn')
  })

  it('listCardIn 处理后非 listExpandIn/listCardIn 的事件不触发任何改 style', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listCardIn'
    stripEntranceAnim(el)
    el.dispatchEvent(animEnd('listCardIn'))
    el.style.animationName = 'someOther'
    el.dispatchEvent(animEnd('someOther'))
    expect(el.style.animationName).toBe('someOther')
  })
})

describe('stripEntranceAnim: 其他 animationName（不命中两 if）', () => {
  it('未知 animationName → style.animationName 不变、监听器保留', () => {
    const el = document.createElement('div')
    el.style.animationName = 'fadeIn'
    stripEntranceAnim(el)
    el.dispatchEvent(animEnd('fadeIn'))
    expect(el.style.animationName).toBe('fadeIn')
    // 监听仍在 → 之后 dispatch listCardIn 命中并拆监听（证明监听未因未知名而拆）
    el.style.animationName = 'listCardIn'
    el.dispatchEvent(animEnd('listCardIn'))
    expect(el.style.animationName).toBe('none')
  })

  it('空字符串 animationName → 两 if 均不命中，style 不变、监听保留', () => {
    const el = document.createElement('div')
    el.style.animationName = 'fade'
    stripEntranceAnim(el)
    el.dispatchEvent(animEnd(''))
    expect(el.style.animationName).toBe('fade')
  })
})

describe('stripEntranceAnim: 返回的清理函数', () => {
  it('清理函数调一次 → 监听拆解，后续 animationend 不再触发 style 改动', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listCardIn'
    const cleanup = stripEntranceAnim(el)
    expect(typeof cleanup).toBe('function')
    cleanup!()
    // 监听已拆 → dispatch 无效
    el.style.animationName = 'listCardIn'
    el.dispatchEvent(animEnd('listCardIn'))
    expect(el.style.animationName).toBe('listCardIn')
  })

  it('清理函数幂等可重复调（removeEventListener 对未注册 handler 安全）', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listCardIn'
    const cleanup = stripEntranceAnim(el)
    expect(() => { cleanup!(); cleanup!() }).not.toThrow()
    el.style.animationName = 'listCardIn'
    el.dispatchEvent(animEnd('listCardIn'))
    expect(el.style.animationName).toBe('listCardIn')
  })

  it('清理后 listExpandIn 监听也失效（同一 onEnd 被整体 removeEventListener）', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listExpandIn'
    const cleanup = stripEntranceAnim(el)
    cleanup!()
    // cleanup 已拆 onEnd → 即便再设 listExpandIn 名 dispatch 也不应剥离
    el.style.animationName = 'listExpandIn'
    el.dispatchEvent(animEnd('listExpandIn'))
    expect(el.style.animationName).toBe('listExpandIn')
  })
})

describe('stripEntranceAnim: 初始状态不变量', () => {
  it('调用后未 dispatch 任何事件时 style.animationName 不被预先改动', () => {
    const el = document.createElement('div')
    el.style.animationName = 'listExpandIn'
    stripEntranceAnim(el)
    // 仅挂监听未触发 → style 维持原值
    expect(el.style.animationName).toBe('listExpandIn')
  })
})
