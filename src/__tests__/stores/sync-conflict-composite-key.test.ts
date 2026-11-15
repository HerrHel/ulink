/**
 * 冲突复合键：不同实体表复用同一个 id 时，两条冲突必须共存、能分别解决。
 *
 * 真实背景：种子数据里 category 'ai' 与 customAttribute 'ai' 同 id。
 * 旧实现 addConflict 按裸 id 覆盖，resolveConflict/removeConflict 也按裸 id，
 * 于是两表同时冲突时后者覆盖前者， UI 只显示一条，另一条永远无法处理。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSyncStore } from '../../stores/sync.js'
import { useDataStore } from '../../stores/data.js'
import { resolveConflict } from '../../composables/domain/useSyncConflict.js'
import type { SyncConflict } from '../../stores/sync.js'

const mk = (type: SyncConflict['type'], id: string, remoteName: string): SyncConflict => ({
  id,
  type,
  local: { name: '本地' },
  remote: { name: remoteName, updatedAt: 1000 },
})

beforeEach(() => setActivePinia(createPinia()))

describe('sync store 冲突复合键', () => {
  it('同 id 不同 type 的冲突共存，不再互相覆盖', () => {
    const s = useSyncStore()
    s.addConflict(mk('category', 'ai', 'R1'))
    s.addConflict(mk('attribute', 'ai', 'R2'))
    expect(s.conflicts).toHaveLength(2)
    expect(s.conflicts.map((c) => c.type)).toEqual(['category', 'attribute'])
  })

  it('同 type 同 id 仍是覆盖（同一次冲突刷新 remote）', () => {
    const s = useSyncStore()
    s.addConflict(mk('category', 'ai', 'R1'))
    s.addConflict(mk('category', 'ai', 'R2'))
    expect(s.conflicts).toHaveLength(1)
    expect((s.conflicts[0].remote as { name: string }).name).toBe('R2')
  })

  it('getConflict 传 type 时精确命中；裸 id 仍向后兼容（返回第一条）', () => {
    const s = useSyncStore()
    s.addConflict(mk('category', 'ai', 'R1'))
    s.addConflict(mk('attribute', 'ai', 'R2'))
    expect((s.getConflict('ai', 'attribute')?.remote as { name: string }).name).toBe('R2')
    expect((s.getConflict('attribute:ai')?.remote as { name: string }).name).toBe('R2')
    expect((s.getConflict('ai')?.remote as { name: string }).name).toBe('R1')
  })

  it('removeConflict 传 type 只删对应那条', () => {
    const s = useSyncStore()
    s.addConflict(mk('category', 'ai', 'R1'))
    s.addConflict(mk('attribute', 'ai', 'R2'))
    s.removeConflict('ai', 'category')
    expect(s.conflicts.map((c) => c.type)).toEqual(['attribute'])
  })
})

describe('resolveConflict 带 type 只解决目标那条', () => {
  it('解决 category 冲突后 attribute 冲突仍在', () => {
    const s = useSyncStore()
    const ds = useDataStore()
    ds.categories = [{ id: 'ai', name: '本地分类', icon: '', color: '', order: 0, updatedAt: 1 }] as never
    ds.customAttributes = [{ id: 'ai', name: '本地属性', type: 'text', updatedAt: 1 }] as never

    s.addConflict(mk('category', 'ai', '远端分类'))
    s.addConflict(mk('attribute', 'ai', '远端属性'))
    expect(s.conflicts).toHaveLength(2)

    resolveConflict('ai', true, 'category')

    expect(s.conflicts).toHaveLength(1)
    expect(s.conflicts[0].type).toBe('attribute')
    expect((s.conflicts[0].remote as { name: string }).name).toBe('远端属性')
  })
})
