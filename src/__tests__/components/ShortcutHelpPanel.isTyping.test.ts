import { describe, it, expect } from 'vitest'
import { isTyping } from '../../components/overlays/isTyping.js'

/**
 * isTyping 护栏：ShortcutHelpPanel 全局 `?` 快捷键输入态吞否判定逻辑。
 * 真纯函数：仅读入参 `t` 的 `tagName` / `isContentEditable`，无副作用、无 DOM 全局依赖。
 * 抽自 ShortcutHelpPanel.vue script setup 内联函数（逐字保留）。
 *
 * 生产调用方：ShortcutHelpPanel.vue 行 93 `if (e.key === '?' && !isTyping(e.target))`
 * ——决定用户正在输入框按 `?` (Shift+/) 时是插入问号还是调出帮助面板。
 *
 * 真实行为契约（来自源码逐字保留，构造假 element 对象直测，无需真 DOM）：
 * - tagName 比较用大写常量 'INPUT'/'TEXTAREA'/'SELECT'（HTMLElement.tagName 返回大写）。
 * - null / falsy 入参返回 false（非输入态不该吞快捷键）。
 *
 * 用 helper 构造假 element（类型断言 подав EventTarget）：isTyping 仅读 .tagName/.isContentEditable，
 * 不访问其它 DOM 属性，故纯字面量对象足以覆盖全部分支。
 */
function mkEl(
  tagName: string | undefined,
  isContentEditable = false,
): EventTarget | null {
  // isTyping 仅读 .tagName/.isContentEditable，访问其它 DOM 属性，故纯字面量对象足以覆盖全部分支。
  // 此处 as unknown as EventTarget 绕开 TS 的 DOM 类型约束（仅测试用，不绕运行时）。
  return { tagName, isContentEditable } as unknown as EventTarget
}

describe('isTyping — 输入态判定', () => {
  it('INPUT 命中', () => {
    expect(isTyping(mkEl('INPUT'))).toBe(true)
  })

  it('TEXTAREA 命中', () => {
    expect(isTyping(mkEl('TEXTAREA'))).toBe(true)
  })

  it('SELECT 命中', () => {
    expect(isTyping(mkEl('SELECT'))).toBe(true)
  })

  it('isContentEditable=true 命中（富文本/TipTap 等 contenteditable 区域）', () => {
    expect(isTyping(mkEl('DIV', true))).toBe(true)
  })

  it('isContentEditable=true 即便 tagName 缺省仍命中', () => {
    // 源码先读 tag 再读 isContentEditable，tag 非 INPUT/TEXTAREA/SELECT 后再判 isContentEditable
    expect(isTyping(mkEl('DIV', true))).toBe(true)
    // 显式 tagName 缺省 (undefined) 但 isContentEditable=true 仍命中
    expect(isTyping(mkEl(undefined, true))).toBe(true)
  })

  it('普通元素（DIV/SPAN/A/P/BUTTON 等）不命中', () => {
    expect(isTyping(mkEl('DIV'))).toBe(false)
    expect(isTyping(mkEl('SPAN'))).toBe(false)
    expect(isTyping(mkEl('A'))).toBe(false)
    expect(isTyping(mkEl('P'))).toBe(false)
    expect(isTyping(mkEl('BUTTON'))).toBe(false)
  })

  it('isContentEditable=false 不影响 tag 判定，非输入 tag 仍返 false', () => {
    expect(isTyping(mkEl('DIV', false))).toBe(false)
  })

  it('tagName 大小写敏感：小写 input/textarea/select 不命中', () => {
    // 真实 DOM HTMLElement.tagName 恒返回大写，故源码用大写常量比较；
    // 此用例锁定大小写敏感行为，防未来误改比较引入小写命中破坏契约
    expect(isTyping(mkEl('input'))).toBe(false)
    expect(isTyping(mkEl('textarea'))).toBe(false)
    expect(isTyping(mkEl('select'))).toBe(false)
  })

  it('tagName 为大写非输入 tag 不命中（如 FORM/SECTION）', () => {
    expect(isTyping(mkEl('FORM'))).toBe(false)
    expect(isTyping(mkEl('SECTION'))).toBe(false)
  })

  it('null 入参返回 false', () => {
    expect(isTyping(null)).toBe(false)
  })

  it('falsy undefined 入参返回 false', () => {
    expect(isTyping(undefined as unknown as EventTarget)).toBe(false)
  })

  it('tagName 缺省且非 contenteditable 返回 false', () => {
    expect(isTyping(mkEl(undefined, false))).toBe(false)
  })

  it('返回恒为 boolean 类型', () => {
    expect(typeof isTyping(mkEl('INPUT'))).toBe('boolean')
    expect(typeof isTyping(mkEl('DIV'))).toBe('boolean')
    expect(typeof isTyping(null)).toBe('boolean')
  })

  it('纯函数多次调用一致无副作用', () => {
    const el = mkEl('INPUT')
    const r1 = isTyping(el)
    const r2 = isTyping(el)
    const r3 = isTyping(el)
    expect(r1).toBe(true)
    expect(r2).toBe(true)
    expect(r3).toBe(true)
    // 入参对象不被 mutate
    expect((el as { tagName?: string }).tagName).toBe('INPUT')
    expect((el as { isContentEditable?: boolean }).isContentEditable).toBe(false)
  })

  it('同时 contenteditable + 输入 tag 的对象命中 true（tag 先短路或 isContentEditable 后命中均 true）', () => {
    expect(isTyping(mkEl('INPUT', true))).toBe(true)
    expect(isTyping(mkEl('TEXTAREA', true))).toBe(true)
  })
})
