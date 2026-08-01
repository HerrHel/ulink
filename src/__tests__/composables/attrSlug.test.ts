import { describe, it, expect } from 'vitest'
import { attrSlug } from '../../composables/domain/attrSlug.js'

// attrSlug 是属性 id 规范化（slug）纯函数，逐字搬自 AttributeModal.vue:53 与 useAttrFilter.ts:37
// 两处原内联实现——抽离到独立纯模块统一真相源，防两处独立副本漂移分叉致跨路径 dedup 失效。
// 与 attrFilter.test.ts d1-11 的 addAttrQuick 黑盒护栏互补：本护栏直锁 attrSlug 纯函数契约
// （slug 链四段语义 + 空串返空串 falsy 短路边界——调用方各自接 `|| gid()` 兜底）。
describe('attrSlug', () => {
  it('把空格折叠成单横线（[\\s]+ → -）', () => {
    expect(attrSlug('my tag')).toBe('my-tag')
    expect(attrSlug('a    b')).toBe('a-b')
    expect(attrSlug('a\tb')).toBe('a-b')
  })

  it('转小写', () => {
    expect(attrSlug('MyTag')).toBe('mytag')
    expect(attrSlug('ABC')).toBe('abc')
  })

  it('剔除非字母数字与横线（[^a-z0-9-] → 空）', () => {
    expect(attrSlug('my-tag!')).toBe('my-tag')
    expect(attrSlug('a@b#c')).toBe('abc')
  })

  it('折叠连续横线（-+ → -）', () => {
    expect(attrSlug('a---b')).toBe('a-b')
    expect(attrSlug('a--b--c')).toBe('a-b-c')
  })

  it('去除首尾横线（^-|-$ → 空）', () => {
    expect(attrSlug('-my-tag-')).toBe('my-tag')
    expect(attrSlug('---abc---')).toBe('abc')
  })

  it('组合 happy path：My Tag! → my-tag（与 d1-11 addAttrQuick it6 同款基线锚）', () => {
    expect(attrSlug('My Tag!')).toBe('my-tag')
  })

  it('空串返空串——falsy 短路边界，调用方接 || gid() 兜底（防误加 if(!name) throw 早退）', () => {
    expect(attrSlug('')).toBe('')
  })

  it('纯特殊字符全剔返空串——falsy 兜底场景（!!! 经剔非字母数字后成空，调用方走 gid()）', () => {
    expect(attrSlug('!!!')).toBe('')
    expect(attrSlug('！@#')).toBe('')
  })

  it('首尾/内部多空格多横线混合：  --a-- b--   → a-b', () => {
    expect(attrSlug('  --a-- b--  ')).toBe('a-b')
  })

  it('中文被剔、拉丁与数字保留：中文Tag!!201 → tag201（与 d1-11 addAttrQuick it9 同款）', () => {
    expect(attrSlug('中文Tag!!201')).toBe('tag201')
  })

  it('下划线被剔成空（非转横线）+ 连续横线折叠：__a___b → ab（真实特性：_ 在段3 被剔成空非转横线，故连续 _ 不留横线，与多横线 _ 连续折叠不同）', () => {
    expect(attrSlug('__a___b')).toBe('ab')
  })

  it('纯函数：不 mutate 入参 + 同入参恒定返回', () => {
    const input = 'My Tag!'
    const snapshot = input
    const a = attrSlug(input)
    const b = attrSlug(input)
    expect(a).toBe(b)
    expect(input).toBe(snapshot) // 入参未被 mutate
    expect(typeof a).toBe('string')
  })
})
