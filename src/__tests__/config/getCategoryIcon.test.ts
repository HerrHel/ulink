/**
 * D1-19: getCategoryIcon 护栏
 *
 * getCategoryIcon 是三个组件（ActionSheet / BatchPopover / AppNav）模板里
 * `v-html="getCategoryIcon(cat.icon)"` 的唯一图标来源——cat.icon 来自用户数据
 * （分类记录的 icon 字段），经此函数映射成 SVG 字符串后由 v-html 直接注入 DOM。
 *
 * 鉴于它是 v-html 渲染入口，护栏要锁定的安全不变量是：
 *   - 兜底键恒为 `I.star`（未知/falsey/不存在的键**绝不能**回落到用户可控字符串或 undefined，
 *     否则 v-html 会注入非预期 SVG/HTML）。
 *   - 返回值恒为以 `<svg` 开头的静态 SVG 字符串（不含任何与输入拼接的片段）。
 *   - 已知的连字符/非常规键名（miniGrid / taskList / eyeOff / cloudOff / dotsV /
 *     trashFull / emptyBookmark / listCheck 等）仍能命中——这些键最易在重构时被
 *     误判为要规范化或当成误删。
 */
import { describe, it, expect } from 'vitest'
import { getCategoryIcon, I } from '../../config/icons.js'

describe('getCategoryIcon', () => {
  it('已知键命中返回该键的 SVG', () => {
    for (const key of ['history', 'grid', 'mail', 'tool', 'code', 'star']) {
      const got = getCategoryIcon(key)
      expect(got).toBe(I[key])
      expect(got.startsWith('<svg')).toBe(true)
    }
  })

  it('连字符/驼峰非常规键名仍命中（重构易误删点直锁）', () => {
    // 这些是 IconMap 里带连字符或驼峰的键，最易在重构里被误判为要规范化或当成误删
    const trickyKeys = [
      'miniGrid', 'cloudOff', 'eyeOff', 'dotsV', 'taskList',
      'trashFull', 'emptyBookmark', 'listCheck', 'hamburger', 'textColor',
    ]
    for (const key of trickyKeys) {
      expect(Object.prototype.hasOwnProperty.call(I, key)).toBe(true)
      expect(getCategoryIcon(key)).toBe(I[key])
    }
  })

  it('未知键恒兜底到 I.star（v-html 渲染安全塌底线）', () => {
    const unknown = [
      'unknown-xxx', '确实不在表里的键', 'prototype', '<script>alert(1)</script>',
    ]
    for (const key of unknown) {
      expect(getCategoryIcon(key)).toBe(I.star)
    }
    // star 自身即兜底源 —— 显式断言 star 不靠兜底而是真在表里
    expect(Object.prototype.hasOwnProperty.call(I, 'star')).toBe(true)
    expect(getCategoryIcon('star')).toBe(I.star)
  })

  it('原型链键（__proto__/constructor/toString 等）恒兜底到 I.star——v-html 注入面闭合', () => {
    // 这条是护栏抓出的真实 bug 雏形并已修复：
    // 旧实现 `I[icon] || I.star` 对 '__proto__' 返回 I 的原型对象（truthy → 短路 →
    // 返回 [object Object]/函数源码字符串），constructor/toString/hasOwnProperty
    // 同样返回 Object.prototype 上的方法/对象原值——这些是 getCategoryIcon 在三个组件
    // 模板 `v-html="getCategoryIcon(cat.icon)"` 渲染入口会直接注入 DOM 的内容。
    // 修复：用 hasOwnProperty/typeof 守卫只接受 IconMap 自有键的字符串值，原型链键
    // 一律兜底到静态 SVG star。本用例直锁"原型链键恒回 star"这一修复后不变量。
    const protoKeys = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']
    for (const key of protoKeys) {
      const got = getCategoryIcon(key)
      expect(got).toBe(I.star)
      expect(typeof got).toBe('string')
      expect(got.startsWith('<svg')).toBe(true)
      // 兜底值绝不可能是原型方法/对象的字符串化（防止守卫被误删后回归原型键泄露）
      expect(got).not.toMatch(/object Object|native code|function/)
    }
  })

  it('falsey/非字符串入参均恒兜底到 I.star', () => {
    // I[icon] || I.star 对 falsey（'' / 0 / null / undefined / NaN）全一致回 star
    for (const input of ['', 0, null, undefined, NaN] as unknown[]) {
      // @ts-expect-error 故意传入非 string 验证兜底鲁棒性
      expect(getCategoryIcon(input)).toBe(I.star)
    }
  })

  it('star 在映射表里且其值为合法 SVG——兜底源本身必须是安全 SVG', () => {
    expect(typeof I.star).toBe('string')
    expect(I.star.startsWith('<svg')).toBe(true)
    // 兜底 SVG 不应含用户可控拼接种类（恒定字面量）
    expect(I.star).not.toMatch(/<\/?script|javascript:|onerror/i)
  })

  it('返回值恒为以 <svg 开头的静态字符串，绝不返回 undefined/非字符串', () => {
    // 覆盖"命中"与"兜底"两条路径，确认两类返回类型与形态一致
    const samples = ['history', 'mail', 'unknown-xxx', '', null, undefined] as unknown[]
    for (const s of samples) {
      // @ts-expect-error 容错非 string 入参
      const got = getCategoryIcon(s)
      expect(typeof got).toBe('string')
      expect(got.startsWith('<svg')).toBe(true)
    }
  })

  it('映射表键数稳定：现存 65 个左右已知键，护栏防误删整族', () => {
    const keys = Object.keys(I)
    // 现网实测为 65 个键；仅锁"量级稳定+star 永在"，不锁死精确计数防重构增删图标产生噪音
    expect(keys.length).toBeGreaterThanOrEqual(60)
    expect(keys).toContain('star')
    // 兜底源 star 必须是表里真实键（不是靠 || 兜回自身）
    expect(I.star).toBeTruthy()
  })
})
