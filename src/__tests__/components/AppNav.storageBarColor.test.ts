import { describe, it, expect } from 'vitest'
import { storageBarColorFor } from '../../components/shell/storageBarColor.js'

/**
 * AppNav.storageBarColor 护栏：左侧导航栏「存储占用条」颜色承载逻辑。
 * 真纯函数（仅依赖入参 percent），抽自 AppNav.vue:85 computed 内联表达式（逐字保留）。
 * 锁定 percent → CSS var 三档阈值映射 + null/undefined/0/NaN 兜底语义。
 *
 * 生产消费方：AppNav.vue 模板 `:style="{ width: storageInfo.percent + '%', background: storageBarColor }"`
 * ——决定侧边栏存储占用条用户可见的颜色（充裕 accent / 警告 warn / 风险 danger）。
 */
describe('storageBarColorFor — 存储条三档阈值颜色映射', () => {
  // === 三档正路径 ===
  it('p > 90 → danger（超额风险，91）', () => {
    expect(storageBarColorFor(91)).toBe('var(--danger)')
  })

  it('p > 70 且 <= 90 → warn（接近上限警告，71 与 90 均落 warn）', () => {
    expect(storageBarColorFor(71)).toBe('var(--warn)')
    expect(storageBarColorFor(90)).toBe('var(--warn)')
  })

  it('p <= 70 → accent（充裕，69 与 50 均落 accent）', () => {
    expect(storageBarColorFor(69)).toBe('var(--accent)')
    expect(storageBarColorFor(50)).toBe('var(--accent)')
  })

  // === 严格 `>` 边界（最易被误改成 `>=`） ===
  it('严格 > 边界：p=90 不进 danger 落 warn（90 > 90 false）', () => {
    expect(storageBarColorFor(90)).toBe('var(--warn)')
    // 对照 p=91 才进 danger
    expect(storageBarColorFor(91)).toBe('var(--danger)')
  })

  it('严格 > 边界：p=70 不进 warn 落 accent（70 > 70 false）', () => {
    expect(storageBarColorFor(70)).toBe('var(--accent)')
    // 对照 p=71 才进 warn
    expect(storageBarColorFor(71)).toBe('var(--warn)')
  })

  // === null/undefined 兜底（对应 storageInfo.value 为 null 的 `?.percent` 短路） ===
  it('null 入参兜底 accent（storageInfo.value 为 null）', () => {
    expect(storageBarColorFor(null)).toBe('var(--accent)')
  })

  it('undefined 入参兜底 accent（storageInfo.value?.percent 链解析为 undefined）', () => {
    expect(storageBarColorFor(undefined)).toBe('var(--accent)')
  })

  // === 0 / NaN 兜底（falsy 短路与原三档条件链逐字一致） ===
  it('0 入参兜底 accent（合法「完全空闲」percent，原三档 0 也落 accent）', () => {
    // 0 是合法 number：原 computed 非 null 分支 const p=0 → 0>90 false → 0>70 false → accent
    // !p 兜底对 0 也返 accent，与原三档条件链逐字一致
    expect(storageBarColorFor(0)).toBe('var(--accent)')
  })

  it('NaN 入参兜底 accent（NaN>90 NaN→false 与 NaN>70 NaN→false 走兜底一致）', () => {
    expect(storageBarColorFor(NaN)).toBe('var(--accent)')
  })

  // === 全程 0-100 区间典型档位 ===
  it('全档典型值：100 danger / 95 danger / 80 warn / 30 accent / 1 accent', () => {
    expect(storageBarColorFor(100)).toBe('var(--danger)')
    expect(storageBarColorFor(95)).toBe('var(--danger)')
    expect(storageBarColorFor(80)).toBe('var(--warn)')
    expect(storageBarColorFor(30)).toBe('var(--accent)')
    expect(storageBarColorFor(1)).toBe('var(--accent)')
  })

  // === 返回恒 string + 三色互不相同防映射漂移 ===
  it('返回值恒为 string', () => {
    expect(typeof storageBarColorFor(91)).toBe('string')
    expect(typeof storageBarColorFor(71)).toBe('string')
    expect(typeof storageBarColorFor(0)).toBe('string')
    expect(typeof storageBarColorFor(null)).toBe('string')
  })

  it('三档颜色互不相同（防映射漂移把 danger/warn/accent 指向同一变量）', () => {
    const danger = storageBarColorFor(91)
    const warn = storageBarColorFor(71)
    const accent = storageBarColorFor(50)
    expect(danger).not.toBe(warn)
    expect(danger).not.toBe(accent)
    expect(warn).not.toBe(accent)
  })

  // === 纯函数无副作用 + 同入参恒定 ===
  it('纯函数无副作用：同入参多次调用返回一致', () => {
    expect(storageBarColorFor(85)).toBe(storageBarColorFor(85))
    expect(storageBarColorFor(null)).toBe(storageBarColorFor(null))
  })

  it('所有返回值均为合法 CSS var 字面（var(--X) 形式）', () => {
    const all = [storageBarColorFor(91), storageBarColorFor(71), storageBarColorFor(50), storageBarColorFor(null), storageBarColorFor(0)]
    all.forEach((v) => {
      expect(v).toMatch(/^var\(--[a-z]+\)$/)
    })
  })
})
