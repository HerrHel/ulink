/**
 * D1-48 — ShareView.groupIconSvg 白名单解析护栏（抽 resolveGroupIconSvg 纯函数后直测）。
 *
 * 背景：ShareView.vue 原 groupIconSvg computed 用 `v-html="groupIconSvg"` 把图标 SVG
 * 直接注入 DOM。group.icon 来自 fetchPublicGroup 远端 RLS 数据（跨用户公开分享组），
 * 不可信——可能是追踪像素、任意字符串、或原型链危险键。白名单防线为
 * `Object.prototype.hasOwnProperty.call(I, icon) ? I[icon] : ''`：仅 icons.ts 已知自有键
 * 才返对应静态 SVG，未知/原型链键一律返空，绝不把任意串当 SVG 键回落到 I.star。
 *
 * 该 v-html 注入入口的白名单判定此前零护栏单测、仅靠 ShareView.vue:104 注释自证——
 * 一旦有人改成 `I[icon] ?? I.star` 或删 hasOwnProperty 改用 `icon in I`（命中原型链），
 * 跨用户分享页会渲染注入内容（如 'constructor' 命中 Object.prototype 字符串化为
 * `function Object() {...}` 注入 DOM、追踪像素 URL 误当键），无测试拦截。
 *
 * 本护栏把白名单契约直锁为可回归断言，尤其「hasOwnProperty 严格判定不命中原型链」
 * 这条最易被未来重构误改的隐安全特性（与 D1-19 getCategoryIcon 原型键泄露面同源）。
 */
import { describe, it, expect } from 'vitest'
import { resolveGroupIconSvg } from '../../views/resolveGroupIconSvg.js'
import { I } from '../../config/icons.js'

/** 真实 icons.ts 已知键集合（取若干代表性键做白名单命中断言，避免硬编码值漂移） */
const KNOWN_KEYS = ['star', 'history', 'mail', 'external', 'trash', 'edit']

describe('resolveGroupIconSvg — 跨用户分享组图标白名单', () => {
  describe('已知自有键命中返对应 SVG', () => {
    for (const key of KNOWN_KEYS) {
      it(`已知键 "${key}" 返 I["${key}"]（与白名单表中值逐字相等）`, () => {
        expect(resolveGroupIconSvg(key, I)).toBe(I[key])
      })
    }

    it('已知键返回值恒以 "<svg" 开头（静态 SVG 字符串非任意注入）', () => {
      for (const key of KNOWN_KEYS) {
        expect(resolveGroupIconSvg(key, I).startsWith('<svg')).toBe(true)
      }
    })

    it('存在多个已知键且白名单值均不同（防 I 表被误改成单值退化）', () => {
      const vals = KNOWN_KEYS.map((k) => resolveGroupIconSvg(k, I))
      expect(new Set(vals).size).toBeGreaterThan(1)
    })
  })

  describe('未知键 / 原型链键一律返空（安全核心）', () => {
    const UNKNOWN = [
      'evil',
      'custom',
      'arbitrary',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'https://tracker.example.com/pixel.gif',
      'my-cool-icon',
      'star2', // 接近已知键但不等于，测短路不前缀匹配
    ]
    for (const key of UNKNOWN) {
      it(`未知字符串 "${key}" 返空串（不当作 SVG 键、不回落 star）`, () => {
        expect(resolveGroupIconSvg(key, I)).toBe('')
      })
    }

    it('Object.prototype 原型链属性键严格不命中（hasOwnProperty 真实安全特性直锁）', () => {
      // 这些键不在 I 自有键里、但 `Object.prototype.hasOwnProperty` 之外的检查（如 `in` 或 `I[key]`）
      // 会命中原型返回非空 truthy 值——本护栏直锁 hasOwnProperty 严格判定拒原型链
      for (const protoKey of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf']) {
        expect(resolveGroupIconSvg(protoKey as string, I)).toBe('')
      }
    })

    it('空对象表（无自有键但原型链完整）对任意键均返空', () => {
      const empty = {} as Record<string, string>
      expect(resolveGroupIconSvg('star', empty)).toBe('')
      expect(resolveGroupIconSvg('constructor', empty)).toBe('')
      expect(resolveGroupIconSvg('toString', empty)).toBe('')
    })
  })

  describe('空/未定义入参返空（falsy 短路）', () => {
    it.each([undefined, '', null as unknown as undefined])('falsy icon 入参返空串', (icon) => {
      expect(resolveGroupIconSvg(icon, I)).toBe('')
    })
  })

  describe('返回恒为 string 类型（v-html 入口确定性）', () => {
    it('已知键 / 未知键 / falsy 入参三种分支返回值 typeof 均为 string', () => {
      expect(typeof resolveGroupIconSvg('star', I)).toBe('string')
      expect(typeof resolveGroupIconSvg('unknown', I)).toBe('string')
      expect(typeof resolveGroupIconSvg(undefined, I)).toBe('string')
    })
  })

  describe('白名单判定——纯函数无副作用 + 恒定', () => {
    it('同入参多次调用返回值恒等（无隐状态）', () => {
      const a = resolveGroupIconSvg('star', I)
      const b = resolveGroupIconSvg('star', I)
      const c = resolveGroupIconSvg('star', I)
      expect(a).toBe(b)
      expect(b).toBe(c)
    })

    it('不 mutate 已知图标表（I 调用前后键集与值不变）', () => {
      const keysBefore = Object.keys(I)
      const starBefore = I.star
      resolveGroupIconSvg('star', I)
      resolveGroupIconSvg('evil', I)
      resolveGroupIconSvg('constructor', I)
      // 仅断言自由键集合与代表性值未变；hasOwnProperty.call 不写表（理论无 mutate，护栏锁契约）
      expect(Object.keys(I)).toEqual(keysBefore)
      expect(I.star).toBe(starBefore)
    })

    it('任意造表替换 knownIcons 参数（注入式纯函数边界）', () => {
      const custom = { a: '<svg/>', b: '<svg/>' } as Record<string, string>
      expect(resolveGroupIconSvg('a', custom)).toBe('<svg/>')
      expect(resolveGroupIconSvg('b', custom)).toBe('<svg/>')
      expect(resolveGroupIconSvg('c', custom)).toBe('') // custom 无自有键 c
      expect(resolveGroupIconSvg('constructor', custom)).toBe('') // 原型链不命中
      expect(resolveGroupIconSvg('toString', custom)).toBe('')
    })
  })
})
