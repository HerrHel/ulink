import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUndoStore } from '../../stores/undo.js'
import type { UndoSnapshot } from '../../stores/undo.js'
import { useDataStore } from '../../stores/data.js'

/**
 * d1-114 — useUndoStore `cleanStale` 孤儿栈清理编排护栏 + `canUndo`/`canRedo` getter
 * truthy 契约护栏。
 *
 * `cleanStale`（src/stores/undo.ts:55）被 src/stores/app.ts:188 「每 10 次保存触发一次」
 * `useUndoStore().cleanStale()` 调用，是 undo 栈随组删除/迁移后回收的内存清理动作：它遍历
 * `stacks`，对 `useDataStore().groupMap` 里不存在的 gid（孤儿栈——组已被删但仍占栈/timer）调
 * `clearStack`（clearTimeout + delete stack）。回归会让孤儿栈与孤儿 timer 永久驻留致内存泄漏
 * （每 10 次保存清一次的清理失效），且孤儿 timer 到期回调对已删组执行 continueUndo 致异常。
 *
 * `canUndo`/`canRedo` getter 是 undo/redo 按钮置灰逻辑的唯一承载（返 `boolean`），此前仅在
 * useUndo composable 编排用例间接经 store 实例读取，store getter 自身对 undefined gid / 空
 * 栈 / 有栈 truthy 路径无直接断言。误删 `!!()` 守卫改返 `s && s.undo` 会让「undefined→false、
 * []→truthy」返 `[]`/`undefined`（非 boolean），污染 UI 置灰判断（v-if/disabled 绑定）。
 *
 * 纯加测试零生产源文件改动：cleanStale（action）与 canUndo/canRedo（getter）已可直接经 store
 * 实例调用，不改任何源文件。延续 d1-89 deleteCategory / d1-84 toggleDetailPanel「store
 * action 编排护栏」同源口径 + d1-32 data.ts getter 行为契约护栏口径。
 */

// 工厂：构造一个最小合法 UndoSnapshot（pushedAt 默认 0 = 最老）
function snap(over: Partial<UndoSnapshot> = {}): UndoSnapshot {
  return { notes: '', bookmarkIds: [], pushedAt: 0, ...over }
}

describe('useUndoStore cleanStale 孤儿栈清理护栏（d1-114）', () => {
  let undo: ReturnType<typeof useUndoStore>
  let data: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    data = useDataStore()
    undo = useUndoStore()
  })

  it('空 stacks 态调 cleanStale 不抛（for-in 对 {} 零迭代早 return）', () => {
    expect(() => undo.cleanStale()).not.toThrow()
    expect(Object.keys(undo.stacks).length).toBe(0)
  })

  it('★ 孤儿 gid（groupMap 不存在）被 cleanStale 清除——干净孤儿栈回归', () => {
    undo.ensureStack('g_orphan')
    undo.stacks['g_orphan'].undo.push(snap({ notes: 'orphan1' }))
    // data.siblingGroups 为空 → groupMap['g_orphan'] 为 undefined → 孤儿
    undo.cleanStale()
    expect(undo.stacks['g_orphan']).toBeUndefined()
    expect(Object.keys(undo.stacks).length).toBe(0)
  })

  it('★ 存活 gid（在 groupMap 中）cleanStale 后栈保留不动', () => {
    data.siblingGroups = [{ id: 'g_alive', name: 'Alive', categoryId: 'cat1', order: 0, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 0, useCount: 0, isPublic: false } as any]
    undo.ensureStack('g_alive')
    undo.stacks['g_alive'].undo.push(snap({ notes: 'alive1' }))
    undo.ensureStack('g_orphan')
    undo.stacks['g_orphan'].undo.push(snap({ notes: 'orphan1' }))
    undo.cleanStale()
    expect(undo.stacks['g_alive']).toBeDefined()
    expect(undo.stacks['g_alive'].undo.length).toBe(1)
    expect(undo.stacks['g_orphan']).toBeUndefined()
  })

  it('多孤儿并行清理——遍历全部 stacks 一次性清完，存活保留', () => {
    data.siblingGroups = [{ id: 'g1', name: 'G1', categoryId: 'c1', order: 0, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 0, useCount: 0, isPublic: false } as any]
    undo.ensureStack('g1')         // alive
    undo.ensureStack('g2')         // orphan
    undo.ensureStack('g3')         // orphan
    undo.stacks['g2'].undo.push(snap())
    undo.stacks['g3'].redo.push(snap())
    undo.cleanStale()
    expect(undo.stacks['g1']).toBeDefined()
    expect(undo.stacks['g2']).toBeUndefined()
    expect(undo.stacks['g3']).toBeUndefined()
    expect(Object.keys(undo.stacks).length).toBe(1)
  })

  it('★ 孤儿栈带 live timer：cleanStale→clearStack 真调 clearTimeout 回收 timer entry', () => {
    // clearStack 内 `if (this.timers[gid]) { clearTimeout(this.timers[gid]); delete this.timers[gid] }`
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    undo.ensureStack('g_orphan')
    undo.stacks['g_orphan'].undo.push(snap())
    undo.timers['g_orphan'] = setTimeout(() => {}, 100000) as any
    expect(undo.timers['g_orphan']).toBeDefined()
    undo.cleanStale()
    // 孤儿栈与 timer 都被清
    expect(undo.stacks['g_orphan']).toBeUndefined()
    expect(undo.timers['g_orphan']).toBeUndefined()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('存活 gid 带 timer：cleanStale 不误清存活组的 timer（仅清孤儿 timer）', () => {
    data.siblingGroups = [{ id: 'g_alive', name: 'A', categoryId: 'c1', order: 0, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 0, useCount: 0, isPublic: false } as any]
    undo.ensureStack('g_alive')
    undo.stacks['g_alive'].undo.push(snap())
    const t = setTimeout(() => {}, 100000) as any
    undo.timers['g_alive'] = t
    undo.cleanStale()
    expect(undo.stacks['g_alive']).toBeDefined()
    // Pinia state 深度 reactive proxy 包装 timer 对象致外部原始引用 t 与 proxy 后
    // timers['g_alive'] 不再 .toBe 严格相等——改断 key 存在 truthy（timer 不被 cleanStale 碰）
    expect(undo.timers['g_alive']).toBeTruthy()
    clearTimeout(t) // 测试自行清理防泄漏
  })

  it('★ 孤儿无 timer entry：cleanStale 走 clearStack 但 clearTimeout 分支不触发（防误判 timer key 必存在）', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    undo.ensureStack('g_orphan')
    undo.stacks['g_orphan'].undo.push(snap())
    // 不预置 timers['g_orphan'] → clearStack 内 `if (this.timers[gid])` falsy 短路不调 clearTimeout
    undo.cleanStale()
    expect(undo.stacks['g_orphan']).toBeUndefined()
    expect(clearSpy).not.toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('全部存活：cleanStale 幂等，多次调用不删任何存活栈', () => {
    data.siblingGroups = [
      { id: 'g1', name: 'G1', categoryId: 'c1', order: 0, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 0, useCount: 0, isPublic: false } as any,
      { id: 'g2', name: 'G2', categoryId: 'c1', order: 1, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 0, useCount: 0, isPublic: false } as any,
    ]
    undo.ensureStack('g1'); undo.ensureStack('g2')
    undo.stacks['g1'].undo.push(snap()); undo.stacks['g2'].redo.push(snap())
    undo.cleanStale()
    undo.cleanStale()
    expect(Object.keys(undo.stacks).length).toBe(2)
    expect(undo.stacks['g1'].undo.length).toBe(1)
    expect(undo.stacks['g2'].redo.length).toBe(1)
  })

  it('ensureStack 幂等：对已存在 gid 再调不重置已有 undo/redo 内容', () => {
    undo.ensureStack('g1')
    undo.stacks['g1'].undo.push(snap({ notes: 'kept' }))
    const before = undo.stacks['g1']
    undo.ensureStack('g1') // 不应重置既有栈
    expect(undo.stacks['g1']).toBe(before)
    expect(undo.stacks['g1'].undo.length).toBe(1)
    expect(undo.stacks['g1'].undo[0].notes).toBe('kept')
  })

  it('ensureStack 对新 gid 建 {undo:[],redo:[]} 双空栈', () => {
    undo.ensureStack('g_new')
    expect(undo.stacks['g_new']).toBeDefined()
    expect(undo.stacks['g_new'].undo).toEqual([])
    expect(undo.stacks['g_new'].redo).toEqual([])
  })

  it('clearStack 删除栈与 timer entry 双清——gid 调后 stacks[tgid] 与 timers[tgid] 均 undefined', () => {
    undo.ensureStack('g1')
    undo.stacks['g1'].undo.push(snap())
    undo.timers['g1'] = setTimeout(() => {}, 100000) as any
    undo.clearStack('g1')
    expect(undo.stacks['g1']).toBeUndefined()
    expect(undo.timers['g1']).toBeUndefined()
  })

  it('clearStack 对无 timer 的 gid 不抛（if 分支 falsy 短路）', () => {
    undo.ensureStack('g1')
    undo.stacks['g1'].undo.push(snap())
    expect(() => undo.clearStack('g1')).not.toThrow()
    expect(undo.stacks['g1']).toBeUndefined()
  })

  it('clearStack 对不存在的 gid 安全不抛（delete on missing key no-op）', () => {
    expect(() => undo.clearStack('nonexistent')).not.toThrow()
  })
})

describe('useUndoStore canUndo/canRedo getter truthy 契约护栏（d1-114）', () => {
  let undo: ReturnType<typeof useUndoStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    useDataStore() // 共享 pinia，undo store 顶层 import useDataStore 需解析
    undo = useUndoStore()
  })

  describe('canUndo', () => {
    it('★ undefined gid（栈不存在）返 boolean false（非空数组[]/非 undefined）', () => {
      const r = undo.canUndo('absent')
      expect(typeof r).toBe('boolean')
      expect(r).toBe(false)
    })

    it('★ 空栈（undo 长度 0）返 boolean false', () => {
      undo.ensureStack('g1')
      const r = undo.canUndo('g1')
      expect(typeof r).toBe('boolean')
      expect(r).toBe(false)
    })

    it('有 undo 项（长度>=1）返 boolean true', () => {
      undo.ensureStack('g1')
      undo.stacks['g1'].undo.push(snap())
      expect(undo.canUndo('g1')).toBe(true)
      expect(typeof undo.canUndo('g1')).toBe('boolean')
    })

    it('★ 多 undo 项 truthy 稳定——push 后恒 true 不随长度变化退化', () => {
      undo.ensureStack('g1')
      undo.stacks['g1'].undo.push(snap()); undo.stacks['g1'].undo.push(snap())
      expect(undo.canUndo('g1')).toBe(true)
    })

    it('undo 项被清空后 canUndo 回 false（与 clearStack 协同语义）', () => {
      undo.ensureStack('g1')
      undo.stacks['g1'].undo.push(snap())
      expect(undo.canUndo('g1')).toBe(true)
      undo.clearStack('g1')
      expect(undo.canUndo('g1')).toBe(false)
    })
  })

  describe('canRedo', () => {
    it('★ undefined gid（栈不存在）返 boolean false（非 undefined/非空数组）', () => {
      const r = undo.canRedo('absent')
      expect(typeof r).toBe('boolean')
      expect(r).toBe(false)
    })

    it('★ 空栈（redo 长度 0）返 boolean false', () => {
      undo.ensureStack('g1')
      expect(undo.canRedo('g1')).toBe(false)
      expect(typeof undo.canRedo('g1')).toBe('boolean')
    })

    it('有 redo 项（长度>=1）返 boolean true', () => {
      undo.ensureStack('g1')
      undo.stacks['g1'].redo.push(snap())
      expect(undo.canRedo('g1')).toBe(true)
    })

    it('★ any truthy 数组判定——`!!(s && s.redo && s.redo.length > 0)` 三段短路：s 缺/s.redo 缺/length=0 均 false', () => {
      undo.ensureStack('g1')
      // stacks['g1'] 存在但 redo 为空 → false（length 守卫）
      expect(undo.canRedo('g1')).toBe(false)
      undo.stacks['g1'].redo.push(snap())
      // 三段全 truthy → true
      expect(undo.canRedo('g1')).toBe(true)
    })
  })

  describe('canUndo / canRedo 互不耦合', () => {
    it('有 undo 无 redo：canUndo=true 且 canRedo=false（互不影响）', () => {
      undo.ensureStack('g1')
      undo.stacks['g1'].undo.push(snap())
      expect(undo.canUndo('g1')).toBe(true)
      expect(undo.canRedo('g1')).toBe(false)
    })

    it('有 redo 无 undo：canRedo=true 且 canUndo=false（互不影响）', () => {
      undo.ensureStack('g1')
      undo.stacks['g1'].redo.push(snap())
      expect(undo.canUndo('g1')).toBe(false)
      expect(undo.canRedo('g1')).toBe(true)
    })
  })
})
