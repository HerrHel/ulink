import { describe, it, expect } from 'vitest'
import { cleanZeroWidth } from '../utils.js'

// D1-98：cleanZeroWidth 单零宽保留 + 边界护栏（utils.ts:134）
// 该函数是旧盘升级步骤6「group notes 零宽压缩」唯一承载（migrations.ts:116 经 runMigrations 调），
// 正则 /​{2,}/g 仅压缩「≥2 连续」零宽成单个，单个零宽原样保留——此「单零宽保留」边界
// 此前零直测（既有 utils.test.ts:92 cleanZeroWidth describe 仅测 2 连续→1 与无零宽不变两用例）。
// 真实回归风险：若未来误改正则为 /​+/g（贪婪单零宽也吞）会让仅含单零宽的正常文本被无端删字符，
// 用户笔记里故意保留的零宽分隔符（如不可见排版标记）静默丢失且无测试告警。

describe('cleanZeroWidth D1-98 — 单零宽保留 + 边界护栏', () => {
  it('单零宽原样保留不被删（正则 {2,} 严格 ≥2 边界核心契约）', () => {
    // 单个 ​ 不满足 {2,} → replace 无匹配 → 原文不动
    expect(cleanZeroWidth('a​b')).toBe('a​b')
  })

  it('多个不连续零宽各自保留（不跨字符合并亦不删任一）', () => {
    // 两个孤立 ​ 中间隔普通字符，各不满足连续 {2,} → 各自保留
    expect(cleanZeroWidth('a​b​c')).toBe('a​b​c')
  })

  it('恰好 2 连续零宽 → 压成单个（{2,} 下界对齐既有用例）', () => {
    expect(cleanZeroWidth('hello​​world')).toBe('hello​world')
  })

  it('3 连续零宽 → 压成单个（{2,} 贪婪对长连续同样合并）', () => {
    expect(cleanZeroWidth('x​​​y')).toBe('x​y')
  })

  it('4+ 连续零宽 → 压成单个（量词上界核验）', () => {
    expect(cleanZeroWidth('a​​​​b')).toBe('a​b')
  })

  it('连续零宽出现在串头/尾 → 同样压缩，首尾普通字符不动', () => {
    expect(cleanZeroWidth('​​head')).toBe('​head')
    expect(cleanZeroWidth('tail​​')).toBe('tail​')
  })

  it('空串入参 → 原样空串不抛', () => {
    expect(cleanZeroWidth('')).toBe('')
  })

  it('单零宽与正常空白混排 → 普通空格不被吞、零宽保留', () => {
    // 普通空格 U+0020 与零宽 U+200B 互不干扰
    expect(cleanZeroWidth('a ​ b')).toBe('a ​ b')
  })

  it('单零宽与中文混排 → 中文字符不动、零宽保留', () => {
    expect(cleanZeroWidth('中​文')).toBe('中​文')
  })

  it('纯零宽串「恰好1个」→ 保留为单零宽（不被当连续压成更少）', () => {
    // 仅含 1 个零宽的串：replace 无命中 → 原样单零宽
    expect(cleanZeroWidth('​')).toBe('​')
  })

  it('纯零宽串「3 个」→ 压成单零宽（全串皆连续零宽）', () => {
    expect(cleanZeroWidth('​​​')).toBe('​')
  })

  it('无零宽的普通文本 → 原样透传（同既有用例重复守恒）', () => {
    expect(cleanZeroWidth('hello world')).toBe('hello world')
  })

  it('返回恒 string，纯函数无副作用（同入参恒定）', () => {
    const s = 'a​​b'
    expect(typeof cleanZeroWidth(s)).toBe('string')
    expect(cleanZeroWidth(s)).toBe('a​b')
    // 入参不被 mutate
    expect(s).toBe('a​​b')
  })
})
