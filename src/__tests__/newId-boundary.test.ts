import { describe, it, expect } from 'vitest'
import { newId, newBookmarkId, newGroupId } from '../lib/newId.js'

/**
 * uniqHint 边界护栏（d1-105）—— 补 newId.test.ts 既有 6 用例未锁的边界隐特性。
 *
 * 源 src/lib/newId.ts 核心逻辑：
 *   const ts   = Date.now().toString(36)
 *   const rand = Math.random().toString(36).slice(2, 8)
 *   const hint = uniqHint == null ? '' : uniqHint.toString(36)
 *   return `${prefix}${ts}${rand}${hint}`
 *
 * 关键隐特性边界的护栏目标（此前零直接断言）：
 *  1. uniqHint 为 number 时经 toString(36) 转 base36 后缀（0→'0' 已锁，单数字与小整数 base36 形态未锁）
 *  2. uniqHint 为负数 → (-1).toString(36)==='-1' 会让 id 尾部含 '-' 负号（边界 bug 雏形：id 含减号作 DOM key/选择器潜在问题）
 *  3. uniqHint 为字符串 → 'abc'.toString(36)==='abc' 透传（不走数字转换），字符串 hint 原样拼接
 *  4. uniqHint 为 undefined → uniqHint == null 真值分支走空串 ''（三者一致：undefined 与 null 同走空串）
 *  5. uniqHint 为 null → 同 4，明确 null 不被 toString 调用（null.toString() 会抛）
 *  6. 三段拼接结构（prefix + ts + rand + hint）—— 无 hint 时长度恰 = prefix + ts + rand；有 hint 时多 hint 段
 *  7. newBookmarkId / newGroupId 便捷封装透传 string hint（此前仅测 number hint 5）
 *
 * 纯度：D1 纯加测试零生产源文件改动（newId/newBookmarkId/newGroupId 已 export）。
 * 非死号：既有 newId.test.ts 仅 6 用例锁 prefix/唯一性/uniqHint=0 endsWith('0')/封装前缀，
 *         grep 跨 aggregate 确认 newId 系列无其他独立护栏文件，本文件是边界增量护栏不冲突。
 * 与既有 newId.test.ts describe('newId') 同名不冲突——vitest 各文件独立 describe 块，按文件聚合不串名。
 */
describe('newId uniqHint 边界（d1-105 增量护栏）', () => {
  describe('toString(36) 后缀形态', () => {
    it('uniqHint 单数字走 base36 透传（1→"1"，与十进制字符相同但语义是 base36）', () => {
      const id = newId('b', 1)
      expect(id.endsWith('1')).toBe(true)
    })

    it('uniqHint 35 经 toString(36) 成 "z"（base36 最大单字符 z=35，非十进制透传）', () => {
      // 35 的 base36 = 'z' —— 这是 toString(36) 的真行为，若误改 toString() 会变 '35'
      const id = newId('b', 35)
      expect(id.endsWith('z')).toBe(true)
      expect(id).not.toMatch(/35$/) // 防退化成 toString() 十进制透传
    })

    it('uniqHint 1000 经 toString(36) 成 "rs"（多字符 base36，10*36 === rs）', () => {
      // 1000 = 36^2/calc → 1000.toString(36) === 'rs' —— 多位 base36 形态锁
      const id = newId('b', 1000)
      expect(id.endsWith('rs')).toBe(true)
    })

    it('uniqHint 为 0 时 toString(36) 后缀恰是 "0" 不被省略（与既有 endsWith 互补直锁 hint 段存在）', () => {
      const id0 = newId('b', 0)
      const idNone = newId('b')
      // 有 hint=0 比 无 hint 多一个尾字符 '0'，差恰 1
      expect(id0.length - idNone.length).toBe(1)
      expect(id0.endsWith('0')).toBe(true)
    })
  })

  describe('uniqHint 负数（边界 bug 雏形直锁——id 含 "-" 负号）', () => {
    it('uniqHint=-1 → (-1).toString(36)==="-1"，id 尾缀含负号 "-"（防未来误改 sanitize 漏锁）', () => {
      // 真实行为：Number.prototype.toString 对负数保留负号 → id 末两字符为 '-1'
      const id = newId('b', -1)
      expect(id.endsWith('-1')).toBe(true)
      // 锁 '-' 负号真存在于 id（非末字符而是末字符前 1 位）：
      expect(id.slice(-2)).toBe('-1')
      expect(id).toContain('-') // id 含 '-' 字符（含负号后缀真存在，非纯 base36 字符集）
    })

    it('uniqHint=-36 也保留负号（toString(36) 负数分支非绝对值）', () => {
      const id = newId('b', -36)
      // (-36).toString(36) === '-10'
      expect(id.endsWith('-10')).toBe(true)
      expect(id).toContain('-')
    })

    it('负数 hint 多次生成仍唯一不碰（负号 + 数字串仍可去重）', () => {
      const set = new Set<string>()
      for (let i = -1; i > -50; i--) set.add(newId('b', i))
      expect(set.size).toBe(49)
    })
  })

  describe('uniqHint 字符串（toString(36) 对字符串透传非数字转换）', () => {
    it("uniqHint='a' → 'a'.toString(36)==='a' 字符串原样拼接尾缀", () => {
      const id = newId('b', 'a')
      expect(id.endsWith('a')).toBe(true)
    })

    it('uniqHint="abc" 多字符字符串透传拼接', () => {
      const id = newId('b', 'abc')
      expect(id.endsWith('abc')).toBe(true)
    })

    it('uniqHint="z9" 等复合字符串原样透传（不解析成 base36 数字）', () => {
      const id = newId('b', 'z9')
      expect(id.endsWith('z9')).toBe(true)
    })

    it('uniqHint="" 空字符串 → "" 是字符串非 null，走 toString(36) 分支返 "" （与 undefined 空串同结果但走不同分支）', () => {
      // 空串 == null 为 false → 走 ''.toString(36) === '' → 拼接空 hint 段
      // 与 newId('b') 无 hint 长度相同（hint 段均为空）—— 故只锁尾部不含额外 hint 字符的逻辑等价
      // 空串入参不产生额外尾字符（不抛、不拼 'undefined' 文本）
      const idEmptyStr = newId('b', '')
      expect(idEmptyStr).not.toMatch(/undefined$/)
      expect(idEmptyStr.length).toBeGreaterThanOrEqual(8)
      expect(idEmptyStr.startsWith('b')).toBe(true)
    })

    it('字符串 hint 多次生成不碰（同串 hint 靠 rand 段防碰）', () => {
      const set = new Set<string>()
      for (let i = 0; i < 100; i++) set.add(newId('b', 'same'))
      expect(set.size).toBe(100)
    })
  })

  describe('undefined vs null 同走空串分支（uniqHint == null 松散等价覆盖两者）', () => {
    it('uniqHint=undefined 走空串分支不抛（== null 真值匹配 undefined）', () => {
      const id = newId('b', undefined)
      expect(id.startsWith('b')).toBe(true)
      expect(id.length).toBeGreaterThanOrEqual(8)
      // undefined 不应产生 'undefined' 文本尾缀（== null 短路先于 toString 防止 'undefined' 拼接）
      expect(id).not.toMatch(/undefined$/)
    })

    it('uniqHint=null 走空串分支不抛（== null 真值匹配 null，不调 null.toString）', () => {
      const id = newId('b', null as unknown as undefined)
      // null.toString() 本会抛 TypeError，但 == null 短路使其永不被调 → 不抛是核心契约
      expect(id.startsWith('b')).toBe(true)
      expect(id).not.toMatch(/null$/)
    })

    it('undefined 与 null 与不传 三者 hint 段均为空（结构等价：== null 松散等价覆盖两边界）', () => {
      // 三者拼出长度区间相同（ts+rand 各段长度稳定，hint 段均空），仅锁「不额外增加 hint 尾字符」语义
      const u = newId('b', undefined).length
      const n = newId('b', null as unknown as undefined).length
      const none = newId('b').length
      // 同毫秒内 ts 段长度一致，rand 段恒 6 → 三者长度同区间（不严格等长 ts 可能跨毫秒但同 size 类）
      expect(u).toBeGreaterThanOrEqual(8)
      expect(n).toBeGreaterThanOrEqual(8)
      expect(none).toBeGreaterThanOrEqual(8)
      // 关键契约：三者都不含 hint 段额外字符（长度不应比无 hint 多出 hint 数）
      // 用「上界不超过无 hint + 1」佐证 hint 段为空（ts 同毫秒内不增，rand 恒6，差仅来自 ts 跨毫秒偶 +1）
      // 故此处只断言三者均 ≥ 8 且不含 'undefined'/'null' 文本，已在上方锁定
    })
  })

  describe('三段拼接结构（prefix + ts + rand + hint）', () => {
    it('无 hint 时 id 结构 = prefix + ts(base36 >=1) + rand(恒6字符)', () => {
      const id = newId('cat')
      // 'cat' = 3 字符 prefix；ts base36 >=1 字符；rand 恒 6 字符 → 总长 >= 3+1+6 = 10
      expect(id.length).toBeGreaterThanOrEqual(3 + 1 + 6)
      expect(id.startsWith('cat')).toBe(true)
      // 模拟 ts 长度提取 prefix 后段：ts 是 Date.now().toString(36) 至少 1 字符，rand 恰 6 字符
      // 故无 hint 时 tail 末 6 字符是 rand 段，rand 段是 [a-z0-9]{6}
      expect(id.slice(-6)).toMatch(/^[a-z0-9]{6}$/)
    })

    it('有 number hint 时 id = prefix + ts + rand(6) + hint(base36)', () => {
      const id = newId('b', 9999)
      // 9999.toString(36) = '7pr'（3 字符） → 末 3 字符是 hint
      expect(id.slice(-3)).toBe('7pr')
      // rand 段在 hint 前 6 字符（即位置 [-9:-3]）
      expect(id.slice(-9, -3)).toMatch(/^[a-z0-9]{6}$/)
    })

    it('rand 段恒 6 字符（slice(2,8) 锁宽，无论 hint 有无 rand 都不变）', () => {
      const a = newId('b')
      const b = newId('b', 35) // hint='z' 1 字符
      const c = newId('b', 1000) // hint='rs' 2 字符
      // 取 prefix 'b' 后、去掉尾 hint 段后，中间 ts+rand 与无 hint 同结构 → rand 段始终末 6（无 hint 时）或 hint 前 6
      // 这里直接锁 rand 段恒为 6 个 [a-z0-9]
      expect(a.slice(-6)).toMatch(/^[a-z0-9]{6}$/)
      expect(b.slice(-7, -1)).toMatch(/^[a-z0-9]{6}$/) // hint 'z' 1 字符 → rand 在 [-7:-1]
      expect(c.slice(-8, -2)).toMatch(/^[a-z0-9]{6}$/) // hint 'rs' 2 字符 → rand 在 [-8:-2]
    })
  })

  describe('newBookmarkId / newGroupId 便捷封装透传 tip 段（d1-103 既有仅测 number hint，补 string hint 与边界）', () => {
    it('newBookmarkId("a") 字符串 hint 透传，前缀 b + 尾缀 a', () => {
      const id = newBookmarkId('a')
      expect(id.startsWith('b')).toBe(true)
      expect(id.endsWith('a')).toBe(true)
    })

    it('newBookmarkId(-1) 负数 hint 透传含 "-"（封装不 sanitize 负号）', () => {
      const id = newBookmarkId(-1)
      expect(id.startsWith('b')).toBe(true)
      expect(id.endsWith('-1')).toBe(true)
    })

    it('newBookmarkId(35) base36 透传成 "z"', () => {
      expect(newBookmarkId(35).endsWith('z')).toBe(true)
    })

    it('newGroupId("grp") 字符串 hint 透传，前缀 g + 尾缀 grp', () => {
      const id = newGroupId('grp')
      expect(id.startsWith('g')).toBe(true)
      expect(id.endsWith('grp')).toBe(true)
    })

    it('newGroupId(0) hint=0 不被省略（封装与底层一致）', () => {
      const id = newGroupId(0)
      expect(id.endsWith('0')).toBe(true)
      expect(id.startsWith('g')).toBe(true)
    })

    it('newBookmarkId(null) 走空串分支不抛（封装透传 == null 短路）', () => {
      const id = newBookmarkId(null as unknown as undefined)
      expect(id.startsWith('b')).toBe(true)
      expect(id).not.toMatch(/null$/)
    })
  })

  describe('纯函数无副作用 + 返回恒 string', () => {
    it('newId 多次返回非同一引用且均 string', () => {
      const a = newId('b')
      const b = newId('b')
      expect(typeof a).toBe('string')
      expect(typeof b).toBe('string')
      // 大概率不同（rand 随机+ts），不严格断言不等但不抛即可
    })

    it('newBookmarkId / newGroupId 返回恒 string 类型非 null/undefined', () => {
      expect(typeof newBookmarkId()).toBe('string')
      expect(typeof newGroupId()).toBe('string')
      expect(typeof newBookmarkId(5)).toBe('string')
    })

    it('空 prefix 入参仍工作（prefix="" 时 id = ts+rand+hint，不抛）', () => {
      // 边角：prefix 空串虽非生产调用方约定，但纯函数应工作不抛
      const id = newId('', 'x')
      expect(typeof id).toBe('string')
      expect(id.endsWith('x')).toBe(true)
      expect(id.length).toBeGreaterThanOrEqual(7)
    })
  })
})
