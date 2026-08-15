/**
 * attrDropdown-branches.test.ts — AttrDropdown overlay store 补测
 *
 * 锁既有 AttrDropdown.actions.test.ts(只调 toggle)未触达的 line 8 close() 整函数：
 *  open 默认 false / toggle 翻转 / close 复位 / toggle→close 链路 / setUnlocked-like 幂等
 * 补到 attrDropdown.ts 80%→100% Stmts / Func 66.66%→100% / Lines 80%→100%
 */
import { describe, it, expect } from 'vitest'
import { useAttrDropdownStore } from '../../stores/attrDropdown.js'

describe('AttrDropdownStore branches', () => {
  it('初始 open 应为 false', () => {
    const store = useAttrDropdownStore()
    expect(store.open).toBe(false)
  })

  it('close() 应将 open 复位为 false（line 8 整函数既有测零覆盖）', () => {
    const store = useAttrDropdownStore()
    store.toggle() // 先开
    expect(store.open).toBe(true)
    store.close()
    expect(store.open).toBe(false)
  })

  it('toggle() 应翻转 open 状态（true→false 往返）', () => {
    const store = useAttrDropdownStore()
    expect(store.open).toBe(false)
    store.toggle()
    expect(store.open).toBe(true)
    store.toggle()
    expect(store.open).toBe(false)
  })

  it('close() 在已关闭态应保持 false（幂等复位不副作用）', () => {
    const store = useAttrDropdownStore()
    store.close()
    expect(store.open).toBe(false)
    store.close() // 再次关
    expect(store.open).toBe(false)
  })
})
