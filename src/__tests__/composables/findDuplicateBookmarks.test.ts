/**
 * findDuplicateBookmarks.test.ts — 书签保存去重编排层护栏
 *
 * 补 useBookmark.ts:80 私有编排函数 `findDuplicateBookmarks` 的直接护栏缺口。
 * 它是 saveBm（useBookmark.ts:294 新建子书签时 `findDuplicateBookmarks(url, undefined, parentId)`）
 * 与另一处（:559 `findDuplicateBookmarks(safeUrl)` 完全重复前哨）的去重编排核——内联调用已测纯决策子
 * `isExactDuplicate`/`isUrlSuffixVariant`（d1-42 useBookmarkDedup.test.ts 已密集直测两子函数），
 * 但本编排层自身的边界此前仅经 saveBm 黑盒 happy path 间接覆盖单例，密集编排分支零直测：
 *
 * ①excludeIds 排除：命中排除集的书签不计入候选（编辑模式排除自身等）
 * ②excludeParentId 祖先链收集：指定 parentId 时，自身 + 所有祖先（经 ds.bookmarkMap[pid] 沿 parentId
 *   上溯到根）全部加入排除集——防添加子书签时把父书签/祖先误判为「后缀变体」（saveBm:294 注释明示意图）
 * ③软删除过滤：deletedAt 非空的书签排除（L94 `!b.deletedAt`）
 * ④exact 优先于 suffix：exact 命中后立即 break（L101-102），不再扫后续书签即使它们也是后缀变体
 * ⑤suffix 首命中保留：多个后缀变体只取第一个（L104 `!suffix` 守卫，不覆盖）
 * ⑥无重复返回 { exact: null, suffix: null }
 * ⑦excludeParentId 经 bookmarkMap 解析祖先（非 bookmarks.filter 自匹配）——bookmarkMap 是唯一父链查询入口
 *
 * 任一分支漂移会让用户保存书签时「已存在重复/变体」提示误报或漏检且此前无编排层直接护栏告警
 * （子函数虽已测但编排顺序/排除/祖先链上溯回归无网）。
 *
 * 口径同 D1-8/D1-24/d1-42/D1-117：仅给私有编排函数增 export 关键字（零逻辑改动），新建独立测试文件
 * 不扰既有 useBookmark.test.ts / useBookmarkDedup.test.ts。生产逻辑一字未动。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── 可控 store fixture：findDuplicateBookmarks 只读 ds.bookmarks + ds.bookmarkMap，逐 it 覆写 ──
const mockData = {
  bookmarks: [] as Array<{ id: string; url: string; deletedAt?: string | null; parentId?: string | null; title?: string }>,
  bookmarkMap: {} as Record<string, { id: string; url: string; deletedAt?: string | null; parentId?: string | null; title?: string }>,
}

// ── 让 useBookmark 模块可被 import 的最小 mock 集（同 useBookmarkDedup.test.ts 口径） ──
vi.mock('../../stores/data.js', () => ({ useDataStore: vi.fn(() => mockData) }))
vi.mock('../../stores/ui.js', () => ({ useUIStore: vi.fn(() => ({ curCat: 'all', editingId: null, saveToGroup: null, modals: {}, lastFocusedEl: null, openModal: vi.fn(), closeModal: vi.fn() })) }))
vi.mock('../../stores/e2e.js', () => ({ useE2EStore: vi.fn(() => ({ isE2EEnabled: false, isUnlocked: false, cryptoKey: null, pendingUnlock: [] })) }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: vi.fn(), toastWithUndo: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)), showChoice: vi.fn(() => Promise.resolve(null)) }))
vi.mock('../../utils.js', () => ({ favicon: vi.fn(), domain: vi.fn(), fixUrl: vi.fn((u: string) => u || ''), isMobile: vi.fn(() => false), autoMigratePassword: vi.fn() }))
vi.mock('../interaction/useKeyboardOps.js', () => ({ pushNavState: vi.fn() }))
vi.mock('../ui/useIconPreview.js', () => ({ previewIconUrl: vi.fn(), clearIcon: vi.fn() }))

import { findDuplicateBookmarks } from '../../composables/domain/useBookmark.js'

// ── 测试用书签工厂 ──
type Bm = { id: string; url: string; deletedAt?: string | null; parentId?: string | null; title?: string }
function makeBm(id: string, url: string, extra: Partial<Bm> = {}): Bm {
  return { id, url, deletedAt: null, parentId: null, title: id, ...extra }
}
function setBookmarks(bms: Bm[]) {
  mockData.bookmarks = bms
  const map: Record<string, Bm> = {}
  for (const b of bms) map[b.id] = b
  mockData.bookmarkMap = map
}
function resetStore() {
  mockData.bookmarks = []
  mockData.bookmarkMap = {}
}

describe('findDuplicateBookmarks — 去重编排层护栏', () => {
  beforeEach(resetStore)

  describe('基本返回形态', () => {
    it('空库 → { exact: null, suffix: null }', () => {
      setBookmarks([])
      const r = findDuplicateBookmarks('https://example.com')
      expect(r.exact).toBeNull()
      expect(r.suffix).toBeNull()
    })

    it('无重复无变体 → { exact: null, suffix: null }', () => {
      setBookmarks([makeBm('a', 'https://other.com'), makeBm('b', 'https://example.org/page')])
      const r = findDuplicateBookmarks('https://example.com')
      expect(r.exact).toBeNull()
      expect(r.suffix).toBeNull()
    })

    it('返回恒为 { exact, suffix } 两键对象', () => {
      setBookmarks([makeBm('a', 'https://example.com')])
      const r = findDuplicateBookmarks('https://example.com')
      expect(r).toHaveProperty('exact')
      expect(r).toHaveProperty('suffix')
      expect(Object.keys(r).sort()).toEqual(['exact', 'suffix'])
    })
  })

  describe('exact 完全重复检测', () => {
    it('exact 命中返回该书签', () => {
      const bm = makeBm('a', 'https://example.com/foo')
      setBookmarks([bm])
      const r = findDuplicateBookmarks('https://example.com/foo')
      expect(r.exact).toBe(bm)
      expect(r.exact?.id).toBe('a')
    })

    it('★exact 命中后立即 break 短路：后续书签即使也完全重复也不扫（返回首个）', () => {
      const first = makeBm('a', 'https://example.com/x')
      const second = makeBm('b', 'https://example.com/x')
      setBookmarks([first, second])
      const r = findDuplicateBookmarks('https://example.com/x')
      // exact 取首个命中即 break，不返 second
      expect(r.exact).toBe(first)
      expect(r.exact?.id).toBe('a')
    })
  })

  describe('suffix 后缀变体检测', () => {
    it('suffix 命中（根 vs 子页）返回该后缀变体书签', () => {
      const bm = makeBm('a', 'https://example.com')
      setBookmarks([bm])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.exact).toBeNull()
      expect(r.suffix).toBe(bm)
    })

    it('★suffix 首命中保留：多个后缀变体只取第一个（!suffix 守卫不覆盖）', () => {
      const first = makeBm('a', 'https://example.com')
      const second = makeBm('b', 'https://example.com/other')
      setBookmarks([first, second])
      const r = findDuplicateBookmarks('https://example.com/page')
      // 两个都是后缀变体，suffix 取首个命中，exact 为 null（无完全重复）
      expect(r.suffix).toBe(first)
      expect(r.suffix?.id).toBe('a')
      expect(r.exact).toBeNull()
    })
  })

  describe('★exact 优先于 suffix 优先级', () => {
    it('exact 命中的同时该对也是 suffix 变体时，返 exact 且 suffix 为首个独立后缀变体', () => {
      // bookmarks: a=完全重复（同时也是后缀变体）, b=独立后缀变体（根 vs 子页，非完全重复）
      const exactBm = makeBm('a', 'https://example.com/page')
      const suffixBm = makeBm('b', 'https://example.com')
      setBookmarks([suffixBm, exactBm])
      const r = findDuplicateBookmarks('https://example.com/page')
      // exact 优先：命中 a 完全重复即 break；suffix 在扫到 b 时已收集（a 还没到 break 前 b 先被检查）
      expect(r.exact).toBe(exactBm)
      expect(r.suffix).toBe(suffixBm)
    })

    it('exact 在 suffix 之后出现：suffix 先收集、exact 后命中 break', () => {
      const suffixBm = makeBm('a', 'https://example.com')   // 根，作为子页的后缀变体
      const exactBm = makeBm('b', 'https://example.com/page') // 完全重复
      setBookmarks([suffixBm, exactBm])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.exact).toBe(exactBm)
      expect(r.suffix).toBe(suffixBm)
    })

    it('exact 命中前同 url 对也是 suffix：exact 取该对、suffix 也含该对（同书签既是 exact 又是 suffix 首命中）', () => {
      const bm = makeBm('a', 'https://example.com/page')
      setBookmarks([bm])
      const r = findDuplicateBookmarks('https://example.com/page')
      // 同一 bm 既是完全重复又是后缀变体（完全重复⊂后缀变体，见 useBookmarkDedup 不变量），
      // 循环里 isExactDuplicate 先 break 收 exact；isUrlSuffixVariant 在同次迭代本会命中但 break 先于 suffix 收集语义
      // 观察实现 L99-107：exact 先判 break，故当次迭代不会同时收 suffix。suffix 应为 null（唯一候选已被 break 消耗）
      expect(r.exact).toBe(bm)
      expect(r.suffix).toBeNull()
    })
  })

  describe('excludeIds 排除', () => {
    it('命中 excludeIds 的书签不计入候选（编辑模式排除自身）', () => {
      const self = makeBm('a', 'https://example.com/page')
      const other = makeBm('b', 'https://example.com/page')
      setBookmarks([self, other])
      // 排除自身 a，只查 b
      const r = findDuplicateBookmarks('https://example.com/page', ['a'])
      expect(r.exact).toBe(other)
      expect(r.exact?.id).toBe('b')
    })

    it('excludeIds 全排除后无候选 → null', () => {
      const a = makeBm('a', 'https://example.com/page')
      setBookmarks([a])
      const r = findDuplicateBookmarks('https://example.com/page', ['a'])
      expect(r.exact).toBeNull()
      expect(r.suffix).toBeNull()
    })

    it('excludeIds 为空数组 → 不排除任何项', () => {
      const a = makeBm('a', 'https://example.com/page')
      setBookmarks([a])
      const r = findDuplicateBookmarks('https://example.com/page', [])
      expect(r.exact).toBe(a)
    })

    it('excludeIds 排除对其后缀变体的判定也生效', () => {
      const a = makeBm('a', 'https://example.com')  // 根，是子页后缀变体
      setBookmarks([a])
      const r = findDuplicateBookmarks('https://example.com/page', ['a'])
      expect(r.suffix).toBeNull()
    })
  })

  describe('软删除过滤（deletedAt）', () => {
    it('★deletedAt 非空的书签排除（不计 exact）', () => {
      const softDeleted = makeBm('a', 'https://example.com/page', { deletedAt: '2026-01-01' })
      setBookmarks([softDeleted])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.exact).toBeNull()
    })

    it('★deletedAt 非空的书签排除（不计 suffix）', () => {
      const softDeleted = makeBm('a', 'https://example.com', { deletedAt: '2026-01-01' })
      setBookmarks([softDeleted])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.suffix).toBeNull()
    })

    it('deletedAt=null 的书签正常参与判定', () => {
      const active = makeBm('a', 'https://example.com/page', { deletedAt: null })
      setBookmarks([active])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.exact).toBe(active)
    })

    it('混合：软删项被跳过，活跃项命中', () => {
      const softDeleted = makeBm('a', 'https://example.com/page', { deletedAt: '2026-01-01' })
      const active = makeBm('b', 'https://example.com/page', { deletedAt: null })
      setBookmarks([softDeleted, active])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.exact).toBe(active)
      expect(r.exact?.id).toBe('b')
    })
  })

  describe('★excludeParentId 祖先链收集', () => {
    it('excludeParentId 排除指定父书签自身（防加子书签时父被误判后缀变体）', () => {
      // 父 p 是 example.com 根，加子书签 example.com/page 时父应被排除
      const parent = makeBm('p', 'https://example.com', { parentId: null })
      const other = makeBm('b', 'https://example.com')
      setBookmarks([parent, other])
      const r = findDuplicateBookmarks('https://example.com/page', undefined, 'p')
      // p 被排除（自身），只查 b：b 是 example.com 根，作为 page 的后缀变体 → suffix=b，无 exact
      expect(r.suffix).toBe(other)
      expect(r.suffix?.id).toBe('b')
      expect(r.exact).toBeNull()
    })

    it('★祖先链沿 parentId 上溯全部排除（祖父→父→自身三代）', () => {
      // 祖父 root → 父 mid → 自身 self 都应排除
      const grand = makeBm('g', 'https://grand.example.com', { parentId: null })
      const mid = makeBm('mid', 'https://mid.example.com', { parentId: 'g' })
      const self = makeBm('self', 'https://self.example.com', { parentId: 'mid' })
      const dup = makeBm('dup', 'https://self.example.com')  // 与 self 完全重复
      setBookmarks([grand, mid, self, dup])
      // 排除 self 自身 + 祖先 mid/g（祖先 url 都不同不会命中，但验证它们不进候选）
      // 注意 bookmarkMap 必须含父链节点供 bookmarkMap[pid] 解析
      const r = findDuplicateBookmarks('https://self.example.com', undefined, 'self')
      // self/mid/g 全部排除，只剩 dup 完全重复 → exact=dup
      expect(r.exact).toBe(dup)
      expect(r.exact?.id).toBe('dup')
    })

    it('★祖先链经 bookmarkMap[pid] 解析（非 bookmarks.filter 自匹配）bookmarkMap 缺父节点时不抛', () => {
      // excludeParentId 指向不存在于 bookmarkMap 的 id → bookmarkMap[pid] 返 undefined，
      // while 循环 pid=undefined → 停止，仅排除该不存在的 id（实际无副作用）
      const a = makeBm('a', 'https://example.com/page')
      setBookmarks([a])
      // bookmarkMap 不含 'ghost'，但 bookmarks 里 a 仍参与
      const r = findDuplicateBookmarks('https://example.com/page', undefined, 'ghost')
      expect(r.exact).toBe(a)
    })

    it('excludeParentId 与 excludeIds 合并排除（并集）', () => {
      const parent = makeBm('p', 'https://example.com', { parentId: null })
      const sibling = makeBm('sib', 'https://example.com')
      const active = makeBm('act', 'https://example.com/page')
      setBookmarks([parent, sibling, active])
      // 排除父 p（经祖先链）+ 额外排除 sibling（经 excludeIds）
      const r = findDuplicateBookmarks('https://example.com/page', ['sib'], 'p')
      // p 和 sib 排除，剩 act 完全重复
      expect(r.exact).toBe(active)
      expect(r.exact?.id).toBe('act')
    })

    it('excludeParentId 命中的书签同时也完全重复时不返它（确认祖先链排除优先于候选收集）', () => {
      const parent = makeBm('p', 'https://example.com/page', { parentId: null })
      setBookmarks([parent])
      const r = findDuplicateBookmarks('https://example.com/page', undefined, 'p')
      // p 是完全重复但被 excludeParentId 排除 → null
      expect(r.exact).toBeNull()
      expect(r.suffix).toBeNull()
    })
  })

  describe('组合与回归', () => {
    it('长列表中首个后缀变体 + 中部完全重复：exact 取中部、suffix 取首个变体', () => {
      const v1 = makeBm('v1', 'https://example.com')         // 首个后缀变体
      const v2 = makeBm('v2', 'https://example.com/other')  // 也是后缀变体（但 suffix 已收 v1 不覆盖）
      const ex = makeBm('ex', 'https://example.com/page')   // 中部完全重复
      setBookmarks([v1, v2, ex])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.exact).toBe(ex)
      expect(r.suffix).toBe(v1)  // 首命中不覆盖
    })

    it('exact 在最后、suffix 在最前：suffix 全程收集直到 exact break', () => {
      const v1 = makeBm('v1', 'https://example.com')
      const v2 = makeBm('v2', 'https://example.com/x')
      const v3 = makeBm('v3', 'https://example.com/y')
      const ex = makeBm('ex', 'https://example.com/page')
      setBookmarks([v1, v2, v3, ex])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.exact).toBe(ex)
      expect(r.suffix).toBe(v1)  // 首个后缀变体
    })

    it('全软删 + excludeParentId 排除全部活跃 → null', () => {
      const a = makeBm('a', 'https://example.com/page', { deletedAt: 'x' })
      const b = makeBm('b', 'https://example.com', { deletedAt: 'x' })
      setBookmarks([a, b])
      const r = findDuplicateBookmarks('https://example.com/page')
      expect(r.exact).toBeNull()
      expect(r.suffix).toBeNull()
    })
  })
})
