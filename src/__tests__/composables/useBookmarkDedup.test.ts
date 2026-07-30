/**
 * useBookmarkDedup.test.ts — 书签保存去重前哨纯决策函数护栏
 *
 * 补 useBookmark.ts 顶层两个私有纯决策函数的护栏缺口：
 * - isUrlSuffixVariant(existingUrl, newUrl)：判定 newUrl 是否为 existingUrl 的后缀变体
 *   （如 https://example.com 与 https://example.com/page）。saveBm 去重"后缀变体"分支的唯一判定核。
 * - isExactDuplicate(existingUrl, newUrl)：判定两 URL 是否完全重复（经 URL.href 规范化比较）。
 *   saveBm 去重"完全重复"分支的唯一判定核，exact 优于 suffix（findDuplicateBookmarks line 99-107）。
 *
 * 两函数是 findDuplicateBookmarks（line 80）内联调用的去重语义成对决策核，此前仅经 saveBm
 * 黑盒 happy path 间接覆盖单例（example.com vs example.com/page 一例），密集边界分支零直测：
 * ①protocol 严格相等（http≠https 不算后缀变体，防误合并）
 * ②existingPath 为空/根路径短路 true（根 vs 子页算后缀变体）
 * ③rest 必须空或以 `/` 开头（防 example.com/foo 被误判为 example.com/foobar 的后缀变体）
 * ④isExactDuplicate 用 URL.href 规范化比较（尾斜杠归一；query 参数顺序不重排）
 * ⑤invalid URL 兜底 false（去重判定永不因 URL.parse 异常而误判命中）
 * 任一分支漂移会让用户保存书签时"已存在重复/变体"提示误报或漏检且无测试告警。
 *
 * 口径同 D1-8/D1-24/d1-40：仅给私有纯函数增 export 关键字（零逻辑改动），新建独立测试文件
 * 不扰既有 useBookmark.test.ts。生产逻辑一字未动。
 */
import { describe, it, expect, vi } from 'vitest'

// ── 让 useBookmark 模块可被 import 的最小 mock 集（同 useBookmark.test.ts 口径，纯函数本测不触 store） ──
vi.mock('../../stores/data.js', () => ({ useDataStore: vi.fn(() => ({ bookmarks: [], siblingGroups: [], categories: [], customAttributes: [], bookmarkMap: {}, groupMap: {}, childrenMap: {}, nextBookmarkOrder: () => 0 })) }))
vi.mock('../../stores/ui.js', () => ({ useUIStore: vi.fn(() => ({ curCat: 'all', editingId: null, saveToGroup: null, modals: {}, lastFocusedEl: null, openModal: vi.fn(), closeModal: vi.fn() })) }))
vi.mock('../../stores/e2e.js', () => ({ useE2EStore: vi.fn(() => ({ isE2EEnabled: false, isUnlocked: false, cryptoKey: null, pendingUnlock: [] })) }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: vi.fn(), toastWithUndo: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)), showChoice: vi.fn(() => Promise.resolve(null)) }))
vi.mock('../../utils.js', () => ({ favicon: vi.fn(), domain: vi.fn(), fixUrl: vi.fn((u: string) => u || ''), isMobile: vi.fn(() => false), autoMigratePassword: vi.fn() }))
vi.mock('../interaction/useKeyboardOps.js', () => ({ pushNavState: vi.fn() }))
vi.mock('../ui/useIconPreview.js', () => ({ previewIconUrl: vi.fn(), clearIcon: vi.fn() }))

import { isUrlSuffixVariant, isExactDuplicate } from '../../composables/domain/useBookmark.js'

describe('isUrlSuffixVariant — 后缀变体判定', () => {
  it('根域 vs 子页 → true（根路径短路后缀变体）', () => {
    expect(isUrlSuffixVariant('https://example.com', 'https://example.com/page')).toBe(true)
    // 带尾斜杠的根域与无尾斜杠等价
    expect(isUrlSuffixVariant('https://example.com/', 'https://example.com/page')).toBe(true)
    expect(isUrlSuffixVariant('https://example.com/', 'https://example.com/')).toBe(true)
  })

  it('根域 vs 更深层子路径 → true', () => {
    expect(isUrlSuffixVariant('https://example.com', 'https://example.com/a/b/c')).toBe(true)
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/foo/bar')).toBe(true)
  })

  it('same path equal → true（rest===空 算后缀变体）', () => {
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/foo')).toBe(true)
  })

  it('★rest 必须空或以 / 开头：防 example.com/foo 误判为 example.com/foobar 的后缀变体', () => {
    // example.com/foo 不是 example.com/foobar 的前缀边界（rest='bar' 不以 / 开头）→ false
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/foobar')).toBe(false)
    // foo vs foo/bar：newPath=foo/bar existingPath=foo rest='/bar' 以 / 开头 → true
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/foo/bar')).toBe(true)
    // foo vs foobar — newPath=foobar startsWith foo=true，rest='bar' 不以 / 开头 → false
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/foobar?x=1')).toBe(false)
  })

  it('★existingPath 带尾斜杠敏感：replacement 只去前导斜杠，尾斜杠保留作前缀', () => {
    // existing=foo/ （pathname /foo/ → replace 前导/ → 'foo/'），newPath=foo/bar
    // startsWith('foo/')=true，rest = 'foo/bar'.slice(4) = 'bar'，不以 / 开头 → false
    // 即尾斜杠使 existingPath 末尾是 '/'，比对 foo/ 的子串时 rest 落在非 '/' 字符 → 不算后缀变体
    expect(isUrlSuffixVariant('https://example.com/foo/', 'https://example.com/foo/bar')).toBe(false)
    // existing=foo/，newPath=foo/ 自身：startsWith('foo/')=true，rest='' → true（自身算后缀变体）
    expect(isUrlSuffixVariant('https://example.com/foo/', 'https://example.com/foo/')).toBe(true)
  })

  it('★protocol 必须严格相等：http≠https 不算后缀变体（防误合并跨协议书签）', () => {
    expect(isUrlSuffixVariant('http://example.com', 'https://example.com/page')).toBe(false)
    expect(isUrlSuffixVariant('https://example.com', 'http://example.com/page')).toBe(false)
  })

  it('hostname 必须严格相等（www 子域不算）', () => {
    expect(isUrlSuffixVariant('https://example.com', 'https://www.example.com/page')).toBe(false)
    expect(isUrlSuffixVariant('https://www.example.com', 'https://example.com/page')).toBe(false)
    expect(isUrlSuffixVariant('https://example.com', 'https://example.org/page')).toBe(false)
  })

  it('newUrl 路径不以 existingPath 为前缀 → false', () => {
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/bar')).toBe(false)
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com')).toBe(false)
    expect(isUrlSuffixVariant('https://example.com/foo/bar', 'https://example.com/foo')).toBe(false)
  })

  it('★端口属 hostname 之外：URL.hostname 不含端口，同域名不同端口同 protocol 根→子仍算后缀变体（URL 规范真实行为）', () => {
    // URL.hostname 对 example.com:8080 返回 'example.com'（端口在 port 属性），hostname 严格相等过
    // existingPath 为根（空）短路 → return true。即同域名不同端口的根 vs 子页算后缀变体
    expect(isUrlSuffixVariant('https://example.com:8080', 'https://example.com:9090/page')).toBe(true)
    expect(isUrlSuffixVariant('https://example.com:8080/foo', 'https://example.com:9090/foo/bar')).toBe(true)
    // 但路径不以 existingPath 为前缀时仍 false
    expect(isUrlSuffixVariant('https://example.com:8080/foo', 'https://example.com:9090/bar')).toBe(false)
  })

  it('★invalid URL 兜底 false（任一入参无法解析 → false 不抛）', () => {
    expect(isUrlSuffixVariant('not-a-url', 'https://example.com/page')).toBe(false)
    expect(isUrlSuffixVariant('https://example.com', 'not-a-url')).toBe(false)
    expect(isUrlSuffixVariant('', '')).toBe(false)
    // 空串入参 new URL 会抛 → catch false
    expect(isUrlSuffixVariant('javascript:void(0)', 'https://example.com')).toBe(false)
  })

  it('返回恒为 boolean', () => {
    expect(typeof isUrlSuffixVariant('https://example.com', 'https://example.com/x')).toBe('boolean')
  })
})

describe('isExactDuplicate — 完全重复判定（URL.href 规范化比较）', () => {
  it('同 URL → true', () => {
    expect(isExactDuplicate('https://example.com/foo', 'https://example.com/foo')).toBe(true)
  })

  it('★尾斜杠归一仅对根域生效：example.com 与 example.com/ 视为完全重复（URL.href 对根域补尾斜杠）', () => {
    // https://example.com URL.href → 'https://example.com/'（URL 规范化只对根域补尾斜杠）
    expect(isExactDuplicate('https://example.com', 'https://example.com/')).toBe(true)
    expect(isExactDuplicate('https://example.com/', 'https://example.com')).toBe(true)
    // 带子路径的尾斜杠不归一：/foo/ 与 /foo 的 href 不同 → false（URL 不删尾斜杠）
    expect(isExactDuplicate('https://example.com/foo/', 'https://example.com/foo')).toBe(false)
    // 完全相同的带尾斜杠路径 URL 仍 true
    expect(isExactDuplicate('https://example.com/foo/', 'https://example.com/foo/')).toBe(true)
  })

  it('★query 参数顺序不重排：?a=1&b=2 与 ?b=2&a=1 href 不同 → false（URL.href 不排序 query）', () => {
    expect(isExactDuplicate('https://example.com/x?a=1&b=2', 'https://example.com/x?b=2&a=1')).toBe(false)
    // 但完全相同的 query 串视为重复
    expect(isExactDuplicate('https://example.com/x?a=1&b=2', 'https://example.com/x?a=1&b=2')).toBe(true)
  })

  it('fragment（hash）参与比较', () => {
    expect(isExactDuplicate('https://example.com/foo#sec1', 'https://example.com/foo#sec2')).toBe(false)
    expect(isExactDuplicate('https://example.com/foo#sec1', 'https://example.com/foo#sec1')).toBe(true)
  })

  it('protocol 不同 → false', () => {
    expect(isExactDuplicate('http://example.com', 'https://example.com')).toBe(false)
  })

  it('hostname 不同 → false', () => {
    expect(isExactDuplicate('https://example.com', 'https://example.org')).toBe(false)
    expect(isExactDuplicate('https://www.example.com', 'https://example.com')).toBe(false)
  })

  it('尾斜杠与查询组合：规范化后 true 与 false 的边界', () => {
    // 根 + 尾斜杠归一 true
    expect(isExactDuplicate('https://example.com', 'https://example.com/')).toBe(true)
    // 路径不同 false
    expect(isExactDuplicate('https://example.com/foo', 'https://example.com/bar')).toBe(false)
  })

  it('★invalid URL 兜底 false（任一入参无法解析 → false 不抛）', () => {
    expect(isExactDuplicate('not-a-url', 'https://example.com')).toBe(false)
    expect(isExactDuplicate('https://example.com', 'not-a-url')).toBe(false)
    expect(isExactDuplicate('', '')).toBe(false)
  })

  it('返回恒为 boolean', () => {
    expect(typeof isExactDuplicate('https://example.com', 'https://example.com')).toBe('boolean')
  })
})

describe('去重前哨语义连检 — exact 与 suffix 互补不变量', () => {
  // 复现 findDuplicateBookmarks line 99-107 的去重优先级语义：exact 命中优先于 suffix，
  // isExactDuplicate 为 true 时同对 URL isUrlSuffixVariant 也应为 true（完全重复必属后缀变体），
  // 反之不成立（后缀变体未必完全重复）。锁这条互补不变量防两函数语义漂移成互相矛盾。
  it('isExactDuplicate 命中的对，isUrlSuffixVariant 必也命中（完全重复⊂后缀变体）', () => {
    const pairs = [
      ['https://example.com', 'https://example.com'],
      ['https://example.com/foo', 'https://example.com/foo'],
      ['https://example.com/', 'https://example.com'],
      ['https://example.com/foo/bar', 'https://example.com/foo/bar'],
    ]
    for (const [a, b] of pairs) {
      expect(isExactDuplicate(a, b)).toBe(true)
      expect(isUrlSuffixVariant(a, b)).toBe(true)
    }
  })

  it('isUrlSuffixVariant 命中但 isExactDuplicate 不命中的真后缀变体例', () => {
    // 根 vs 子页：后缀变体 true，但完全重复 false
    expect(isUrlSuffixVariant('https://example.com', 'https://example.com/page')).toBe(true)
    expect(isExactDuplicate('https://example.com', 'https://example.com/page')).toBe(false)
    // foo vs foo/bar
    expect(isUrlSuffixVariant('https://example.com/foo', 'https://example.com/foo/bar')).toBe(true)
    expect(isExactDuplicate('https://example.com/foo', 'https://example.com/foo/bar')).toBe(false)
  })
})
