import { describe, it, expect } from 'vitest'
import { typeLabel } from '../../components/overlays/typeLabel.js'

/**
 * SyncConflictBanner.typeLabel 护栏：同步冲突横幅分类徽章文案承载逻辑。
 * 真纯函数（仅依赖入参），抽自 SyncConflictBanner.vue script setup 内联函数（逐字保留）。
 * 锁定 SyncConflict['type'] 四联合类型 → 中文标签映射 + 未知 type fallback 透传语义。
 */
describe('typeLabel — 同步冲突徽章文案', () => {
  it('bookmark → 书签', () => {
    expect(typeLabel('bookmark')).toBe('书签')
  })

  it('group → 组', () => {
    expect(typeLabel('group')).toBe('组')
  })

  it('category → 分类', () => {
    expect(typeLabel('category')).toBe('分类')
  })

  it('attribute → 属性', () => {
    expect(typeLabel('attribute')).toBe('属性')
  })

  it('四联合类型逐一命中 map，均返回非空中文标签且互不相同', () => {
    const types = ['bookmark', 'group', 'category', 'attribute'] as const
    const labels = types.map((t) => typeLabel(t))
    // 全非空中文 string
    labels.forEach((l) => {
      expect(typeof l).toBe('string')
      expect(l.length).toBeGreaterThan(0)
    })
    // 互不相同（防映射表漂移致两 type 同标签）
    expect(new Set(labels).size).toBe(types.length)
  })

  it('未知 type 透传原值（fallback `|| type`）', () => {
    // 联合类型 TS 层已知四值，运行时若远端/脏数据带来未知 string 仍透传不抛
    expect(typeLabel('unknown' as 'bookmark')).toBe('unknown')
  })

  it('空字符串 type 透传空串（空串在 map 无命中，`|| ""` 兜底仍空串）', () => {
    expect(typeLabel('' as 'bookmark')).toBe('')
  })

  it('未知 type 含中文/特殊字符仍原样透传', () => {
    expect(typeLabel('customType' as 'bookmark')).toBe('customType')
    expect(typeLabel('自定义' as 'bookmark')).toBe('自定义')
  })

  it('纯函数无副作用：相同入参多次调用结果一致', () => {
    expect(typeLabel('bookmark')).toBe('书签')
    expect(typeLabel('bookmark')).toBe('书签')
    expect(typeLabel('group')).toBe('组')
  })

  it('返回恒为 string 类型（防未来误改返 undefined/对象）', () => {
    expect(typeof typeLabel('bookmark')).toBe('string')
    expect(typeof typeLabel('ghost' as 'bookmark')).toBe('string')
  })

  it('map 仅含四键，无多余键漂移（防未来误加 type 映射破坏联合类型穷尽性）', () => {
    // 四联合类型全命中各自的中文标签，无任一 type 落到另一 type 的标签
    expect(typeLabel('bookmark')).toBe('书签')
    expect(typeLabel('group')).toBe('组')
    expect(typeLabel('category')).toBe('分类')
    expect(typeLabel('attribute')).toBe('属性')
  })
})
