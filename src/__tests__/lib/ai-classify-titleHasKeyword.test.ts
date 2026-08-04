/**
 * D1-117(本轮 r9)：ai-classify.ts `titleHasKeyword` 关键词命中决策护栏
 *
 * `titleHasKeyword(titleLower, kw)` 是 suggestCategory/suggestAttributes 的底层
 * 布尔决策核——决定一个书签标题是否命中某关键词从而归入某分类/属性建议。
 * 两条分支由 `_ASCII_KW = /^[a-z0-9.+#-]{1,12}$/i` 判定 kw 形态分流：
 *   - 分支 A：纯 ASCII 短词（≤12，仅 a-z0-9.+#-）走词边界正则
 *     `(?:^|[^a-z0-9])<escaped-kw>(?=[^a-z0-9]|$)`，i 标志大小写不敏感；
 *     kw 中的 `.`/`+`/`#`/`-` 被转义成字面量（防 `.` 通配、`+` 量词误导）。
 *   - 分支 B：非 ASCII kw（含中文/超 12 字符/含其他符号）走 `titleLower.includes(kw)`。
 *
 * 真实隐性行为靠实现口头维护，此前零直接单测，仅经 suggestCategory/suggestAttributes
 * 黑盒间接覆盖。补 13 用例直接锁两条分支的边界契约：
 *   - ASCII 词边界命中（中/首/尾/连字符边界）
 *   - ASCII 子串嵌入字母数字中不误命中（防 'tool' 命中 'github'/'atool' 致过宽分类）
 *   - ASCII 特殊字符转义（`.`/`+`/`#/`-` 作字面量非通配）
 *   - 非 ASCII kw 走 includes（中文关键词、混合字符）
 *   - 形态判定边界（超 12 字符降级、含中文降级、单 char ASCII 仍走正则）
 *   - i 标志大小写不敏感（即便入参约定已 lower，正则本身也 i）
 *   - 空 kw 经 includes 恒 true（形态判定 false 因 {1,12} 要 ≥1 → 走 includes('')）
 *
 * 仅给私有 `titleHasKeyword` 增 `export` 关键字供测试 import，函数体逐字未动，零逻辑改动。
 * 同 D1-14/15/16 search/aiclassify 系「数据核硬约束但不借优化之名改 vs 纯加测试锁契约」口径。
 */
import { describe, it, expect } from 'vitest'
import { titleHasKeyword } from '../../lib/ai-classify.js'

describe('titleHasKeyword', () => {
  // ─── 分支 A：ASCII 词边界正则 ───
  it('ASCII kw 词中间命中（两侧空格边界）→ true', () => {
    expect(titleHasKeyword('good tool guide', 'tool')).toBe(true)
  })

  it('ASCII kw 位于标题开头（^ 边界）→ true', () => {
    expect(titleHasKeyword('tool guide', 'tool')).toBe(true)
  })

  it('ASCII kw 位于标题结尾（$ 边界）→ true', () => {
    expect(titleHasKeyword('a tool', 'tool')).toBe(true)
  })

  it('ASCII kw 两侧连字符边界命中 → true', () => {
    expect(titleHasKeyword('a-tool-guide', 'tool')).toBe(true)
  })

  it('ASCII kw 嵌入字母中不误命中（防 tool 命中 tools/atool）', () => {
    // 'tools2' 内 'tool' 后跟 's'（在 [a-z0-9]）→ lookahead 失败
    expect(titleHasKeyword('tools2', 'tool')).toBe(false)
    // 'atool' 内 'tool' 前是 'a'（在 [a-z0-9]）→ 前边界失败且唯一位置
    expect(titleHasKeyword('atool', 'tool')).toBe(false)
    // 'github' 含 'tool'? 否——但不命中是因不含 'tool' 子串本身
    expect(titleHasKeyword('github', 'tool')).toBe(false)
  })

  it('ASCII kw 子串中点存在但仅词边界处命中（多处出现其一即可）', () => {
    // 'a-tool-tools'：'a-' 后的 'tool' 前边界 '-'，lookahead '-' → 第一处即命中
    expect(titleHasKeyword('a-tool-tools', 'tool')).toBe(true)
  })

  // ─── 分支 A：特殊字符转义 ───
  it('ASCII kw 含 "." 被转义为字面量（防通配）→ 命中字面点', () => {
    expect(titleHasKeyword('node.js guide', 'node.js')).toBe(true)
    // 'nodeXjs' 不含字面 '.' → 不命中（证 . 是字面量非通配）
    expect(titleHasKeyword('nodeXjs guide', 'node.js')).toBe(false)
  })

  it('ASCII kw 含 "+" 被转义为字面量（防量词）→ 命中字面加号', () => {
    expect(titleHasKeyword('learn c++ today', 'c++')).toBe(true)
    // 'cppp' 含 'pp' 但 '+' 在 kw 里是字面 → 'cppp' 无字面 'c++' → 不命中
    expect(titleHasKeyword('cppp today', 'c++')).toBe(false)
  })

  it('ASCII kw 含 "#" 被转义为字面量', () => {
    expect(titleHasKeyword('c# tutorial', 'c#')).toBe(true)
  })

  it('ASCII kw 含 "-" 被转义为字面量（在字符类外也是字面）', () => {
    expect(titleHasKeyword('use b-variant', 'b-variant')).toBe(true)
  })

  // ─── 分支 B：非 ASCII 形态走 includes ───
  it('中文 kw 走 includes 命中 → true', () => {
    expect(titleHasKeyword('免费游戏平台', '游戏')).toBe(true)
  })

  it('中文 kw 不 includes → false', () => {
    expect(titleHasKeyword('购物商城', '游戏')).toBe(false)
  })

  it('超 12 字符的 ASCII kw 降级走 includes（形态判定 false）', () => {
    const long = 'abcdefghijkl' // 13 字符，超 _ASCII_KW {1,12}
    expect(titleHasKeyword('prefix abcdefghijkl suffix', long)).toBe(true)
  })

  it('含中文混合字符的 kw 走 includes（形态判定 false）', () => {
    // '游戏x' 含中文 → _ASCII_KW.test 为 false → 走 includes 分支
    expect(titleHasKeyword('我的游戏x空间', '游戏x')).toBe(true)
    expect(titleHasKeyword('我的游戏空间', '游戏x')).toBe(false)
  })

  it('单字符 ASCII kw 仍走正则分支（{1,12} 允许 1 字符）', () => {
    // 'c' 在 'c++ guide' 中：前 ^ 边界，lookahead '+' 是 [^a-z0-9] → 命中
    expect(titleHasKeyword('c++ guide', 'c')).toBe(true)
    // 'c' 嵌入 'ace' 中：前 'a' 在 [a-z0-9] → 失败，lookahead 'e' 也失败
    expect(titleHasKeyword('ace', 'c')).toBe(false)
  })

  // ─── i 标志大小写不敏感（入参约定已 lower，但正则本身 i 兜底）───
  it('正则 i 标志对 ASCII kw 大小写不敏感', () => {
    // 即便传非 lower 的 title（违背约定但测正则行为），i 应仍工作
    expect(titleHasKeyword('Good TOOL Guide', 'tool')).toBe(true)
  })

  // ─── 空 kw 行为（形态判定 false 走 includes）───
  it('空 kw 经 includes 恒 true（_ASCII_KW {1,12} 拒空 → 走 includes("")）', () => {
    expect(titleHasKeyword('any title', '')).toBe(true)
  })

  // ─── 缓存复用不影响行为（同入参同出参，幂等）───
  it('重复调用同 kw 行为幂等（_kwReCache 仅缓存正则不影响结果）', () => {
    const a1 = titleHasKeyword('tool guide', 'tool')
    const a2 = titleHasKeyword('tool guide', 'tool')
    const a3 = titleHasKeyword('atool', 'tool')
    expect(a1).toBe(true)
    expect(a2).toBe(true) // 复用缓存的同一正则
    expect(a3).toBe(false)
  })
})
