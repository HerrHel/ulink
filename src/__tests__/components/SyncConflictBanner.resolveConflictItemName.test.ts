import { describe, it, expect } from 'vitest'
import { resolveConflictItemName } from '../../components/overlays/resolveConflictItemName.js'
import type { SyncConflict } from '../../stores/sync.js'

// 造 minimal SyncConflict 辅助——local/remote 在类型上是 unknown，由测试入参决定真实形状
function mkConflict(
  id: string,
  type: 'bookmark' | 'group' | 'category' | 'attribute',
  local: unknown,
): SyncConflict {
  return { id, type, local, remote: undefined }
}

const emptyMaps = {
  bookmarkMap: {},
  groupMap: {},
  categoryMap: {},
  attributeMap: {},
}

describe('resolveConflictItemName — 同步冲突横幅冲突项展示名四级联优先级', () => {
  describe('bookmark 分支', () => {
    it('map 命中有 title → 用 store 当前名（最高优先级）', () => {
      const maps = { ...emptyMaps, bookmarkMap: { 'bm-1': { title: 'store 名' } } }
      const c = mkConflict('bm-1', 'bookmark', { title: '快照名' })
      expect(resolveConflictItemName(c, maps)).toBe('store 名')
    })
    it('map 未命中 → 回退 local 快照 title', () => {
      const c = mkConflict('bm-1', 'bookmark', { title: '快照名' })
      expect(resolveConflictItemName(c, emptyMaps)).toBe('快照名')
    })
    it('map 命中但无 title 字段（可选 title 缺失）→ 回退 local 快照名再回退 id（命中但字段缺亦走下一级，非硬用空串）', () => {
      const maps = { ...emptyMaps, bookmarkMap: { 'bm-1': {} } }
      const c = mkConflict('bm-1', 'bookmark', { title: '快照名' })
      expect(resolveConflictItemName(c, maps)).toBe('快照名')
    })
    it('map 命中无 title + local 无 title → 回退 c.id 兜底不丢展示', () => {
      const maps = { ...emptyMaps, bookmarkMap: { 'bm-1': {} } }
      const c = mkConflict('bm-1', 'bookmark', {})
      expect(resolveConflictItemName(c, maps)).toBe('bm-1')
    })
    it('map 命中 title 为空串 falsy → 走下一级（空串 title 不被采用，回退 local 非空名）', () => {
      const maps = { ...emptyMaps, bookmarkMap: { 'bm-1': { title: '' } } }
      const c = mkConflict('bm-1', 'bookmark', { title: '快照名' })
      expect(resolveConflictItemName(c, maps)).toBe('快照名')
    })
    it('全无（map 未命中 + local 无 title + 无 id 边界）→ 回退空 c.id', () => {
      const c = mkConflict('', 'bookmark', {})
      expect(resolveConflictItemName(c, emptyMaps)).toBe('')
    })
  })

  describe('group 分支', () => {
    it('map 命中有 name → 用 store 当前名', () => {
      const maps = { ...emptyMaps, groupMap: { 'g-1': { name: '组 store 名' } } }
      const c = mkConflict('g-1', 'group', { name: '组快照名' })
      expect(resolveConflictItemName(c, maps)).toBe('组 store 名')
    })
    it('map 未命中 → 回退 local 快照 name', () => {
      const c = mkConflict('g-1', 'group', { name: '组快照名' })
      expect(resolveConflictItemName(c, emptyMaps)).toBe('组快照名')
    })
    it('map 未命中 + local 无 name → 回退 c.id', () => {
      const c = mkConflict('g-1', 'group', {})
      expect(resolveConflictItemName(c, emptyMaps)).toBe('g-1')
    })
  })

  describe('category 分支', () => {
    it('map 命中有 name → 用 store 当前名', () => {
      const maps = { ...emptyMaps, categoryMap: { 'cat-1': { name: '分类 store 名' } } }
      const c = mkConflict('cat-1', 'category', { name: '分类快照名' })
      expect(resolveConflictItemName(c, maps)).toBe('分类 store 名')
    })
    it('map 未命中 → 回退 local 快照 name', () => {
      const c = mkConflict('cat-1', 'category', { name: '分类快照名' })
      expect(resolveConflictItemName(c, emptyMaps)).toBe('分类快照名')
    })
    it('map 未命中 + local 无 name → 回退 c.id', () => {
      const c = mkConflict('cat-1', 'category', {})
      expect(resolveConflictItemName(c, emptyMaps)).toBe('cat-1')
    })
  })

  describe('attribute 分支（implicit else——非 bookmark/group/category 落此分支）', () => {
    it('map 命中有 name → 用 store 当前名', () => {
      const maps = { ...emptyMaps, attributeMap: { 'attr-1': { name: '属性 store 名' } } }
      const c = mkConflict('attr-1', 'attribute', { name: '属性快照名' })
      expect(resolveConflictItemName(c, maps)).toBe('属性 store 名')
    })
    it('map 未命中 → 回退 local 快照 name', () => {
      const c = mkConflict('attr-1', 'attribute', { name: '属性快照名' })
      expect(resolveConflictItemName(c, emptyMaps)).toBe('属性快照名')
    })
    it('map 未命中 + local 无 name → 回退 c.id', () => {
      const c = mkConflict('attr-1', 'attribute', {})
      expect(resolveConflictItemName(c, emptyMaps)).toBe('attr-1')
    })
  })

  describe('跨分支类型路由正确性——四联合类型各查各自 map 不串台', () => {
    it('bookmark 查 bookmarkMap（同 id 在 groupMap/categoryMap/attributeMap 都有也只用 bookmarkMap）', () => {
      const maps = {
        bookmarkMap: { 'x-1': { title: 'bm 标题' } },
        groupMap: { 'x-1': { name: '误串组名' } },
        categoryMap: { 'x-1': { name: '误串分类名' } },
        attributeMap: { 'x-1': { name: '误串属性名' } },
      }
      const c = mkConflict('x-1', 'bookmark', { title: '快照' })
      expect(resolveConflictItemName(c, maps)).toBe('bm 标题')
    })
    it('group 查 groupMap 不误查 bookmarkMap 的 title 字段', () => {
      const maps = {
        bookmarkMap: { 'x-1': { title: 'bookmark 误串' } },
        groupMap: { 'x-1': { name: '组真名' } },
        categoryMap: {},
        attributeMap: {},
      }
      const c = mkConflict('x-1', 'group', {})
      expect(resolveConflictItemName(c, maps)).toBe('组真名')
    })
    it('category 查 categoryMap 不误查 groupMap', () => {
      const maps = {
        bookmarkMap: {},
        groupMap: { 'x-1': { name: 'group 误串' } },
        categoryMap: { 'x-1': { name: '分类真名' } },
        attributeMap: {},
      }
      const c = mkConflict('x-1', 'category', {})
      expect(resolveConflictItemName(c, maps)).toBe('分类真名')
    })
    it('attribute 查 attributeMap 不误查 categoryMap', () => {
      const maps = {
        bookmarkMap: {},
        groupMap: {},
        categoryMap: { 'x-1': { name: 'category 误串' } },
        attributeMap: { 'x-1': { name: '属性真名' } },
      }
      const c = mkConflict('x-1', 'attribute', {})
      expect(resolveConflictItemName(c, maps)).toBe('属性真名')
    })
  })

  describe('local 快照字段类型与 cast 行为（c.local as Record<string,unknown> 不挡运行时）', () => {
    it('local 为 null 时 d?. 报错被 ?. 短路——map 未命中回退 id（null local 不抛 TypeError）', () => {
      const c = mkConflict('bm-1', 'bookmark', null)
      expect(resolveConflictItemName(c, emptyMaps)).toBe('bm-1')
    })
    it('local 为 undefined 时同样 ?. 短路回退 id', () => {
      const c = mkConflict('bm-1', 'bookmark', undefined)
      expect(resolveConflictItemName(c, emptyMaps)).toBe('bm-1')
    })
    it('local 是非对象基本类型（如数字字符串 "快照值"）——as Record cast 不挡运行时，对基本类型读属性为 undefined，回退 id', () => {
      // 注意：'快照值'['title'] === undefined，故回退 id；直接锁真实 cast 行为防改 cast 为强校验
      const c = mkConflict('bm-1', 'bookmark', '快照值')
      expect(resolveConflictItemName(c, emptyMaps)).toBe('bm-1')
    })
  })

  describe('返回恒 string 类型 + 纯函数无副作用', () => {
    it('返回恒为 string 类型（各分支与回退都返 string）', () => {
      const c1 = mkConflict('bm-1', 'bookmark', { title: 'x' })
      const c2 = mkConflict('g-1', 'group', {})
      const c3 = mkConflict('', 'attribute', {})
      const maps = { ...emptyMaps, bookmarkMap: { 'bm-1': { title: 't' } } }
      expect(typeof resolveConflictItemName(c1, maps)).toBe('string')
      expect(typeof resolveConflictItemName(c2, emptyMaps)).toBe('string')
      expect(typeof resolveConflictItemName(c3, emptyMaps)).toBe('string')
    })
    it('多次调用同入参结果恒定（纯函数无内部状态泄漏）', () => {
      const c = mkConflict('bm-1', 'bookmark', { title: '稳定名' })
      const r1 = resolveConflictItemName(c, emptyMaps)
      const r2 = resolveConflictItemName(c, emptyMaps)
      expect(r1).toBe(r2)
      expect(r1).toBe('稳定名')
    })
    it('不 mutate 入参 maps（bookmarkMap 键集与代表性值调用后不变）', () => {
      const maps = { ...emptyMaps, bookmarkMap: { 'bm-1': { title: '原名' } } }
      const snapshotKeys = Object.keys(maps.bookmarkMap)
      const snapshotTitle = maps.bookmarkMap['bm-1']!.title
      const c = mkConflict('bm-1', 'bookmark', { title: 'local' })
      resolveConflictItemName(c, maps)
      expect(Object.keys(maps.bookmarkMap)).toEqual(snapshotKeys)
      expect(maps.bookmarkMap['bm-1']!.title).toBe(snapshotTitle)
    })
  })
})
