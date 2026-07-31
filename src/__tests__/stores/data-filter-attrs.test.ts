import { describe, it, expect } from 'vitest'
import { _filterAttrs } from '../../stores/data.js'

// D1-15：data.ts:65 `_filterAttrs` 是 Pinia store filteredBookmarks/filteredGroups
// 两大核心 getter 的底层属性过滤实现（line 169/190 分别 _filterAttrs(bm, ui) /
// _filterAttrs(groups, ui)）。仅补测试锁定现有过滤行为契约，不动逻辑
//（data.ts 排序/过滤核硬约束 —— 不借优化之名改）。
// 行为契约来源（按实现 data.ts:65-69 逐分支锁定）：
//   1. 对 activeAttrs 每个 aid 做 `i.attributes[aid]` 保留（链式 AND：须全部命中）
//   2. 对 excludedAttrs 每个 aid 做 `!i.attributes[aid]` 排除（链式 AND-NOT：命中任一即排除）
//   3. active 先于 excluded：先 AND 缩集，再 AND-NOT 缩集，两者交集生效
//   4. 属性键不存在（undefined，falsy）→ active 把它排除、excluded 把它保留
//      （ui.ts:267 注释警告的"属性键不存在视 false"语义）
//   5. 空数组 active=[]/excluded=[] 透传原数组不滤
//   6. filter 每次返回新数组，不 mutate 传入的 items 数组

type Item = { id: string; attributes: Record<string, boolean> }

// 辅助：从 items 数组提取 id 序列，便于断言过滤后保留集
const idsOf = (arr: Item[]): string[] => arr.map((x) => x.id)

// 构造测试 item：给定 id 与 attributes 子集（未列出的键视为 undefined 不存在）
const mk = (id: string, attrs: string[]): Item => {
  const attributes: Record<string, boolean> = {}
  for (const a of attrs) attributes[a] = true
  return { id, attributes }
}

describe('_filterAttrs 属性过滤核护栏', () => {
  it('空 active + 空 excluded 透传原数组（不过滤、保持顺序与全部项）', () => {
    const items: Item[] = [mk('a', ['x']), mk('b', []), mk('c', ['y'])]
    const out = _filterAttrs(items, { activeAttrs: [], excludedAttrs: [] })
    expect(idsOf(out)).toEqual(['a', 'b', 'c'])
  })

  it('单 activeAttr：仅保留有该属性的项（AND 单条件）', () => {
    const items: Item[] = [mk('a', ['x']), mk('b', ['y']), mk('c', ['x', 'y'])]
    const out = _filterAttrs(items, { activeAttrs: ['x'], excludedAttrs: [] })
    expect(idsOf(out)).toEqual(['a', 'c'])
  })

  it('多 activeAttrs 链式 AND：须同时拥有全部列出属性', () => {
    const items: Item[] = [
      mk('both', ['x', 'y']),
      mk('onlyX', ['x']),
      mk('onlyY', ['y']),
      mk('neither', []),
    ]
    const out = _filterAttrs(items, { activeAttrs: ['x', 'y'], excludedAttrs: [] })
    // 必须 x 且 y 同时为 true → 仅 both 留下
    expect(idsOf(out)).toEqual(['both'])
  })

  it('单 excludedAttr：排除有该属性的项（AND-NOT 单条件）', () => {
    const items: Item[] = [mk('a', ['x']), mk('b', ['y']), mk('c', ['x', 'y'])]
    const out = _filterAttrs(items, { activeAttrs: [], excludedAttrs: ['x'] })
    // 有 x 的项被排除 → 仅 b（只有 y，无 x）留下
    expect(idsOf(out)).toEqual(['b'])
  })

  it('多 excludedAttrs 链式 AND-NOT：命中任一即被排除', () => {
    const items: Item[] = [
      mk('hasX', ['x']),
      mk('hasY', ['y']),
      mk('both', ['x', 'y']),
      mk('clean', []),
    ]
    const out = _filterAttrs(items, { activeAttrs: [], excludedAttrs: ['x', 'y'] })
    // 有 x 或 有 y 的均排除 → 仅 clean 留下
    expect(idsOf(out)).toEqual(['clean'])
  })

  it('active + excluded 同时：先 AND 缩集再 AND-NOT 缩集（交集生效）', () => {
    const items: Item[] = [
      mk('xy', ['x', 'y']),
      mk('xz', ['x', 'z']),
      mk('x', ['x']),
      mk('yz', ['y', 'z']),
    ]
    // active=['x'] → 先留有 x 的项：xy, xz, x
    // excluded=['y'] → 再排除其中 有 y 的：xy 被排除 → 剩 xz, x
    const out = _filterAttrs(items, { activeAttrs: ['x'], excludedAttrs: ['y'] })
    expect(idsOf(out)).toEqual(['xz', 'x'])
  })

  it('属性键不存在视 undefined(falsy)：active 把缺失项排除', () => {
    const items: Item[] = [mk('has', ['x']), mk('missing', [])]
    // missing.attributes['x'] === undefined（falsy）→ 被 active 排除
    const out = _filterAttrs(items, { activeAttrs: ['x'], excludedAttrs: [] })
    expect(idsOf(out)).toEqual(['has'])
  })

  it('属性键不存在视 undefined(falsy)：excluded 把缺失项保留', () => {
    const items: Item[] = [mk('has', ['x']), mk('missing', [])]
    // missing.attributes['x'] === undefined → !undefined === true → 保留
    const out = _filterAttrs(items, { activeAttrs: [], excludedAttrs: ['x'] })
    expect(idsOf(out)).toEqual(['missing'])
  })

  it('同一 aid 同时在 active 和 excluded：excluded 先于最终生效排除（active 留下的再被 excluded 排掉）', () => {
    const items: Item[] = [mk('a', ['x']), mk('b', ['x']), mk('c', [])]
    // active=['x'] → 留 a, b；excluded=['x'] → 再排除有 x 的 → a,b 全排 → 空
    // 这锁定"同一属性同时被选/被排除"的边界：excluded 在后会清空 active 集
    const out = _filterAttrs(items, { activeAttrs: ['x'], excludedAttrs: ['x'] })
    expect(idsOf(out)).toEqual([])
  })

  it('不 mutate 输入数组：原 items 引用与内容不变', () => {
    const items: Item[] = [mk('a', ['x']), mk('b', ['y'])]
    const original = [...items]
    const out = _filterAttrs(items, { activeAttrs: ['x'], excludedAttrs: [] })
    // 源数组本身未被原地改写（filter 返回新数组）
    expect(items).toEqual(original)
    expect(items).not.toBe(out)
  })

  it('空数组不抛、返回空数组', () => {
    const items: Item[] = []
    const out = _filterAttrs(items, { activeAttrs: ['x', 'y'], excludedAttrs: ['z'] })
    expect(out).toEqual([])
  })

  it('excludedAttrs 含 activeAttrs 之外的属性（不影响 active 已缩的集）', () => {
    const items: Item[] = [
      mk('a', ['x', 'z']),
      mk('b', ['x']),
      mk('c', ['x', 'z']),
    ]
    // active=['x'] → 留 a,b,c；excluded=['z']（非 active 属性）→ 排除有 z 的 →剩 b
    const out = _filterAttrs(items, { activeAttrs: ['x'], excludedAttrs: ['z'] })
    expect(idsOf(out)).toEqual(['b'])
  })
})
