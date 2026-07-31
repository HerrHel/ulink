import { describe, it, expect } from 'vitest'
// 同 BookmarkCard.highlight.test.ts 口径：相对路径 + .js 后缀，esbuild 解析到 .ts
import { getPreview } from '../../components/modals/getPreview.js'

/**
 * C-3 护栏：HistoryPanel.vue 版本历史列表项预览文本规范化纯函数。
 *
 * 源码（逐字同原内联实现，抽独立模块零行为变化，c1-highlight 同口径）：
 *   (d.title || d.name || d.url || '').toString().slice(0, 50)
 *
 * 护栏价值：用户可见——版本历史面板每条历史项的「预览」列展示什么文本（title 优先、其次 name、
 * 再次 url、全空空串，超 50 字符截断）。决定「多条历史版本里用户如何快速辨认哪条对应哪个书签/组」
 * 这一用户可见行为。字段优先级与 falsy 跳过语义此前零直测、靠实现口头维护，任一漂移（如未来误改为
 * `d.title ?? d.name`、或加 nullish 严格守卫）会改变旧数据/非标准字段类型的预览展示。
 *
 * 关键隐特性护栏：
 * 1. `||` short-circuit——falsy 值（''、0、false、null、undefined）一律跳到下字段（非仅 undefined）。
 * 2. `.toString()` 对非字符串字段生效——number/对象/数组经 toString 后再进 slice。
 * 3. data 非对象（null/array/primitive）经 `as Record` cast 后字段 undefined，走兜底返 ''。
 * 4. `slice(0,50)`——恰好 50 字符原样保留、51 截到 50、超长截断。
 */

describe('getPreview 历史预览文本规范化护栏 (C-3)', () => {
  // --- 三字段优先级 short-circuit ---
  it('title 优先：title 有值时直接用 title', () => {
    expect(getPreview({ title: '书签A', name: '组名', url: 'http://a' })).toBe('书签A')
  })

  it('title 为 falsy 时回退到 name', () => {
    expect(getPreview({ title: '', name: '组名', url: 'http://a' })).toBe('组名')
  })

  it('title 与 name 均为 falsy 时回退到 url', () => {
    expect(getPreview({ title: '', name: '', url: 'http://a' })).toBe('http://a')
  })

  // --- 全空返回空串 ---
  it('三字段全 undefined 返回空串（非 "undefined" 字符串）', () => {
    expect(getPreview({})).toBe('')
  })

  it('三字段全 null 返回空串（null 是 falsy 被 || 跳过非走 toString）', () => {
    expect(getPreview({ title: null, name: null, url: null })).toBe('')
  })

  // --- falsy 跳过（真实隐特性：|| 短路对 0/false/'' 一视同仁，非仅 undefined）---
  it('title=0（数字 falsy）被 || 跳过回退到 name（非 toString 成 "0"）', () => {
    const r = getPreview({ title: 0, name: 'name值', url: 'http://a' })
    expect(r).toBe('name值')
  })

  it('title=false（布尔 falsy）被 || 跳过回退到 name', () => {
    const r = getPreview({ title: false, name: 'name值', url: 'http://a' })
    expect(r).toBe('name值')
  })

  it('url=0 被跳过，三字段全 falsy 时最终兜底空串而非 "0"', () => {
    expect(getPreview({ title: 0, name: false, url: 0 })).toBe('')
  })

  // --- .toString() 对非字符串字段生效 ---
  it('title=数字经 toString() 字符串化（123 → "123"）', () => {
    expect(getPreview({ title: 123, name: '', url: '' })).toBe('123')
  })

  it('title=对象经 toString() 成 "[object Object]"', () => {
    expect(getPreview({ title: { a: 1 }, name: '', url: '' })).toBe('[object Object]')
  })

  it('title=数组经 toString() 成逗号拼接（["a","b","c"] → "a,b,c"）', () => {
    expect(getPreview({ title: ['a', 'b', 'c'], name: '', url: '' })).toBe('a,b,c')
  })

  // --- slice(0,50) 截断边界 ---
  it('url 恰好 50 字符不截断原样返回', () => {
    const s = 'x'.repeat(50)
    expect(getPreview({ title: '', name: '', url: s })).toBe(s)
    expect(getPreview({ title: '', name: '', url: s }).length).toBe(50)
  })

  it('url 51 字符截断到 50', () => {
    const s = 'x'.repeat(51)
    expect(getPreview({ title: '', name: '', url: s })).toBe('x'.repeat(50))
    expect(getPreview({ title: '', name: '', url: s }).length).toBe(50)
  })

  it('超长 url 严格截断到 50（多字节中文也按 substring 50 处理）', () => {
    const s = '书'.repeat(60) // 60 个中文
    const r = getPreview({ title: '', name: '', url: s })
    expect(r.length).toBe(50)
    expect(r).toBe('书'.repeat(50))
  })

  it('title 超 50 优先用 title 截断（短路不落到 url）', () => {
    const longTitle = 'T'.repeat(60)
    const r = getPreview({ title: longTitle, name: '', url: 'http://short' })
    expect(r).toBe('T'.repeat(50))
    expect(r).not.toContain('http') // 确证取自 title 而非 url 兜底
  })

  // --- data 非对象入参（经 as Record cast 后真实运行时行为分级锁）---
  it('data=null 真实抛 TypeError（cast 只骗编译器，d.title 访问 null 属性运行时抛）', () => {
    // 护栏锁定真实行为：as Record 不挡 null/undefined 运行时属性访问，null/undefined 入参会抛。
    // 生产模板调用方 v.data 来自 history 快照恒为对象，不触此分支——此护栏防未来误以为 cast 后安全。
    expect(() => getPreview(null)).toThrow(TypeError)
  })

  it('data=undefined 真实抛 TypeError（同 null，cast 不防 undefined）', () => {
    expect(() => getPreview(undefined)).toThrow(TypeError)
  })

  it('data=数组（访问 .title 得 undefined 不抛）返回空串走兜底', () => {
    expect(getPreview([1, 2, 3])).toBe('')
  })

  it('data=primitive string（字符串访问 .title 得 undefined 不抛）返回空串', () => {
    expect(getPreview('just a string')).toBe('')
  })

  it('data=primitive number（数字访问 .title 得 undefined 不抛）返回空串', () => {
    expect(getPreview(12345)).toBe('')
  })

  // --- 优先级链与兜底混合：中间字段有值但 truthy 非 string ---
  it('title 为 truthy 对象优先用其 toString，不因非字符串回退到 name', () => {
    const r = getPreview({ title: { x: 1 }, name: 'name值', url: 'http://a' })
    expect(r).toBe('[object Object]') // title truthy 短路，不回退 name
  })
})
