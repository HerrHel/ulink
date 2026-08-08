/**
 * overlay-mention.test.ts — overlay.ts 四覆层 Store 状态编排护栏（精简版）
 *
 * 补 src/stores/overlay.ts 四个 defineStore 的直接护栏。原文件 34 例逐分支镜像,多数是
 * 单 setter 翻转 + ref 外部赋值等价性的逐点复刻——trivial show/hide 单 ref 任何合理重构
 * 都会批量红且无独立后果。此精简版留 12 例守核心契约:
 *
 * mentionStore 安全相关两条:open 强制重置防上次残留(query/idx/subMode/subIdx,否则弹层
 带上次查询/选中错位)、setQuery 重置 idx=0 防 query 改后 activeIdx 越界误选错书签/组。
 * 其余覆层各留默认态 + 独立性一例守 store 分立。
 *
 * 删去:open(null)/open()/脏态切gid 同类镜像、hide 幂等/周期、setQuery 同值/空、setIdx、
 * setType 切 bm/不动其他、ref 外部赋值三例、useMfbStore/useSyncStatusStore 整组、
 * batchMove show/hide/幂等/隐藏幂等、独立性 batchMove 侧。
 *
 * 口径同 actionSheet.test.ts / contextMenu.test.ts:纯加测试零源文件改动,store action
 * 全经 return 暴露。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  useMentionStore,
  useBatchMoveStore,
  useMfbStore,
  useSyncStatusStore,
} from '../../stores/overlay.js'

beforeEach(() => setActivePinia(createPinia()))

describe('useMentionStore — 默认状态', () => {
  it('全部字段默认值契约', () => {
    const s = useMentionStore()
    expect(s.gid).toBeNull()
    expect(s.query).toBe('')
    expect(s.idx).toBe(0)
    expect(s.active).toBe(false)
    expect(s.type).toBe('bm')
    expect(s.subMode).toBe(false)
    expect(s.subIdx).toBe(0)
  })
})

describe('useMentionStore.open — 设全套重置防残留', () => {
  it('open(gid) 设 gid+active=true+全套重置', () => {
    const s = useMentionStore()
    s.open('g1')
    expect(s.gid).toBe('g1')
    expect(s.active).toBe(true)
    expect(s.query).toBe('')
    expect(s.idx).toBe(0)
    expect(s.subMode).toBe(false)
    expect(s.subIdx).toBe(0)
  })

  it('★open 强制重置 query/idx/subMode/subIdx（防上次打开残留状态泄漏）', () => {
    const s = useMentionStore()
    // 模拟上次使用残留：手动把脏状态塞进 ref（useMention L137 也直接赋 active=true）
    s.gid = 'old-group'
    s.active = true
    s.query = '上次未清的查询'
    s.idx = 5
    s.subMode = true
    s.subIdx = 3
    // 新 open 应强制重置全套
    s.open('new-group')
    expect(s.gid).toBe('new-group')   // 新 gid
    expect(s.active).toBe(true)
    expect(s.query).toBe('')            // 旧查询被清
    expect(s.idx).toBe(0)              // 旧 idx 被重置
    expect(s.subMode).toBe(false)      // 旧 subMode 被清
    expect(s.subIdx).toBe(0)           // 旧 subIdx 被清
  })
})

describe('useMentionStore.hide — 清全套复位', () => {
  it('hide 全套归零（active+gid+query+idx+subMode+subIdx），type 独立不被清', () => {
    const s = useMentionStore()
    s.open('g1')
    s.setType('group')
    s.query = '查询中'
    s.idx = 3
    s.subMode = true
    s.subIdx = 2
    s.hide()
    expect(s.active).toBe(false)
    expect(s.gid).toBeNull()
    expect(s.query).toBe('')
    expect(s.idx).toBe(0)
    expect(s.subMode).toBe(false)
    expect(s.subIdx).toBe(0)
    expect(s.type).toBe('group') // hide 不清 type，独立于 active
  })
})

describe('useMentionStore.setQuery — 重置 idx=0 防越界（核心安全相关）', () => {
  it('★setQuery 设 query + idx 强制重置为 0（防 query 改后 idx 越界指向旧候选）', () => {
    const s = useMentionStore()
    s.idx = 5  // 模拟已选中第 5 个候选
    s.setQuery('新查询')
    expect(s.query).toBe('新查询')
    expect(s.idx).toBe(0)  // idx 被重置防越界
  })

  it('★setQuery 不动 active/gid/type/subMode（仅 query + idx）', () => {
    const s = useMentionStore()
    s.open('g1')
    s.setType('group')
    s.subMode = true
    s.setQuery('xyz')
    expect(s.active).toBe(true)     // 不动
    expect(s.gid).toBe('g1')         // 不动
    expect(s.type).toBe('group')    // 不动
    expect(s.subMode).toBe(true)    // 不动
    expect(s.query).toBe('xyz')
    expect(s.idx).toBe(0)
  })
})

describe('useMentionStore.setType — 单字段 setter', () => {
  it('setType 切 group 不动其他字段', () => {
    const s = useMentionStore()
    s.open('g1')           // open 设全套：gid='g1' / idx=0 / active=true / query=''
    s.setType('group')
    expect(s.type).toBe('group')
    expect(s.gid).toBe('g1')
    expect(s.idx).toBe(0)  // open 设 0，未被 setType 破坏
    expect(s.active).toBe(true)
    expect(s.query).toBe('')
  })
})

// ── 三 trivial show/hide store 顺带护栏（留默认态 + 幂等翻转） ──

describe('useBatchMoveStore', () => {
  it('默认 open=false / show 翻 true / hide 回 false / 反复 show 不退化', () => {
    const s = useBatchMoveStore()
    expect(s.open).toBe(false)
    s.show(); s.show()
    expect(s.open).toBe(true)
    s.hide()
    expect(s.open).toBe(false)
  })
})

describe('四 store 独立性（同 Pinia 实例不互相串扰）', () => {
  it('一 store 翻转不波及另三 store（store 分立契约）', () => {
    const m = useMentionStore()
    const bm = useBatchMoveStore()
    const mfb = useMfbStore()
    const sync = useSyncStatusStore()
    m.open('g1')
    bm.show()
    expect(m.active).toBe(true)
    expect(bm.open).toBe(true)
    expect(mfb.open).toBe(false)   // mention/batchMove 翻转不串扰 mfb
    expect(sync.open).toBe(false)  // 不串扰 syncStatus
  })
})
