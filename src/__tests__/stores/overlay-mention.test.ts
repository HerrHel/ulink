/**
 * overlay-mention.test.ts — overlay.ts 四覆层 Store 状态编排护栏
 *
 * 补 src/stores/overlay.ts 四个 defineStore 的直接护栏缺口。overlay.ts 是从 app.ts/ui.ts
 * 拆出的覆层状态 Store 集合（CLAUDE.md「覆盖层 Store」），每个覆层独立 Store。此前全测试目录
 * 零真实护栏断言（grep useMentionStore/useMfbStore/useBatchMoveStore/useSyncStatusStore 仅
 * batchMove.test/toggleBatchMode.test mock 掉当副作用桩避开，从不断言 store 状态编排）。
 *
 * 重点护栏：useMentionStore（mention 提及弹层状态编排核，被 useMention composable 消费）。
 * mentionStore 有 10 字段 ref（gid/query/idx/active/type/subMode/subIdx）+ 5 action
 * （open/hide/setQuery/setIdx/setType），useMention.ts 消费契约：
 * - open(gid)：设全套（gid+active=true+query=''+idx=0+subMode=false+subIdx=0）——子菜单/选中/查询全重置防上次残留
 * - hide()：清全套（active=false+gid=null+query=''+idx=0+subMode=false+subIdx=0）——彻底复位防泄漏到下次打开
 * - setQuery(q)：设 query + idx=0 重置选中（useMention.onInput L154 每次输入调 setQuery，idx 重置防 query 改变后 activeIdx 越界指向旧候选——核心安全相关，误选错书签/组）
 * - setIdx(i) / setType(t)：单字段 setter
 * - useMention 还直接赋值 mentionStore.gid=/active=/type= 绕 action 改 ref（setup store ref 可外部赋值），护栏同时也锁 ref 响应式外部赋值路径
 *
 * 其余三 store（batchMove/mfb/syncStatus）trivial show/hide 单 open ref——顺带护栏锁默认态 + show/hide 翻转 + 反复幂等（防 ref 漏清或反复 show 不退化）。
 *
 * 任一回归：mentionStore.open 漏 reset query 致上次查询残留；hide 漏清 subMode 致子菜单错位；
 * setQuery 漏 reset idx 致输入新 query 后仍高亮旧候选索引越界选错书签/组（用户可见 + 误操作风险）。
 *
 * 口径同 actionSheet.test.ts / contextMenu.test.ts：纯加测试零源文件改动——store action 全经 return 暴露。
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

  it('open(null) gid 可空（mention 初始化场景）', () => {
    const s = useMentionStore()
    s.open(null)
    expect(s.gid).toBeNull()
    expect(s.active).toBe(true)
    expect(s.query).toBe('')
  })

  it('open() 无参默认 gid=null', () => {
    const s = useMentionStore()
    s.open()
    expect(s.gid).toBeNull()
    expect(s.active).toBe(true)
  })

  it('从脏态再 open 切 gid：subMode/subIdx 重置防子菜单错位', () => {
    const s = useMentionStore()
    s.subMode = true
    s.subIdx = 7
    s.open('g2')
    expect(s.subMode).toBe(false)
    expect(s.subIdx).toBe(0)
  })
})

describe('useMentionStore.hide — 清全套复位', () => {
  it('hide 全套归零（active+gid+query+idx+subMode+subIdx）', () => {
    const s = useMentionStore()
    s.open('g1')
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
  })

  it('hide 也会清 type? —— 锁现有行为：hide 不改 type（type 保持上次值，独立于 active）', () => {
    const s = useMentionStore()
    s.open('g1')
    s.setType('group')
    s.hide()
    // type 不被 hide 清（仅 active/gid/query/idx/subMode/subIdx 复位，type 独立）
    expect(s.type).toBe('group')
    expect(s.active).toBe(false)
  })

  it('hide 在已隐藏态幂等（多次 hide 不抛不变态）', () => {
    const s = useMentionStore()
    s.open('g1')
    s.hide()
    expect(() => s.hide()).not.toThrow()
    expect(() => s.hide()).not.toThrow()
    expect(s.active).toBe(false)
    expect(s.gid).toBeNull()
  })

  it('open→hide→open 周期：第二 open 仍全套重置（不携带第一周期残留）', () => {
    const s = useMentionStore()
    s.open('g1')
    s.query = 'first'
    s.idx = 9
    s.hide()
    s.open('g2')
    expect(s.gid).toBe('g2')
    expect(s.query).toBe('')
    expect(s.idx).toBe(0)
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

  it('setQuery 同值仍重置 idx（不短路）', () => {
    const s = useMentionStore()
    s.query = 'x'
    s.idx = 4
    s.setQuery('x')  // 同值
    expect(s.query).toBe('x')
    expect(s.idx).toBe(0)  // 仍重置（避免依赖 short-circuit 抖动）
  })

  it('setQuery 空 query + idx 重置', () => {
    const s = useMentionStore()
    s.idx = 3
    s.setQuery('')
    expect(s.query).toBe('')
    expect(s.idx).toBe(0)
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

describe('useMentionStore.setIdx / setType — 单字段 setter', () => {
  it('setIdx 只改 idx', () => {
    const s = useMentionStore()
    s.open('g1')
    s.setIdx(2)
    expect(s.idx).toBe(2)
    expect(s.query).toBe('')  // 其他不动
    expect(s.active).toBe(true)
    expect(s.gid).toBe('g1')
    expect(s.subMode).toBe(false)  // not changed by setIdx
  })

  it('setType 切 group', () => {
    const s = useMentionStore()
    s.setType('group')
    expect(s.type).toBe('group')
  })

  it('setType 切 bm', () => {
    const s = useMentionStore()
    s.setType('group')
    s.setType('bm')
    expect(s.type).toBe('bm')
  })

  it('setType 不动其他字段', () => {
    const s = useMentionStore()
    s.open('g1')           // open 设全套：gid='g1' / idx=0 / active=true / query=''
    s.setType('group')
    expect(s.gid).toBe('g1')
    expect(s.idx).toBe(0)  // open 设 0，未被 setType 破坏
    expect(s.active).toBe(true)
    expect(s.query).toBe('')
  })
})

describe('useMentionStore — ref 外部直接赋值（useMention.ts 消费路径）', () => {
  it('useMention L135 直接 mentionStore.gid= 赋值生效（setup store ref 可外部改）', () => {
    const s = useMentionStore()
    s.gid = 'ext-set'
    expect(s.gid).toBe('ext-set')
  })

  it('useMention L137 直接 mentionStore.active= 赋值生效', () => {
    const s = useMentionStore()
    s.active = true
    expect(s.active).toBe(true)
  })

  it('直接赋值 type 与 setType 等效', () => {
    const s = useMentionStore()
    s.type = 'group'
    expect(s.type).toBe('group')
    s.type = 'bm'
    expect(s.type).toBe('bm')
  })
})

// ── 三 trivial show/hide store 顺带护栏 ──

describe('useBatchMoveStore', () => {
  it('默认 open=false', () => {
    const s = useBatchMoveStore()
    expect(s.open).toBe(false)
  })
  it('show 设 open=true', () => {
    const s = useBatchMoveStore()
    s.show()
    expect(s.open).toBe(true)
  })
  it('hide 设 open=false', () => {
    const s = useBatchMoveStore()
    s.show()
    s.hide()
    expect(s.open).toBe(false)
  })
  it('反复 show 不退化为其他值（幂等 true）', () => {
    const s = useBatchMoveStore()
    s.show(); s.show(); s.show()
    expect(s.open).toBe(true)
  })
  it('hide 在 false 态幂等', () => {
    const s = useBatchMoveStore()
    expect(() => s.hide()).not.toThrow()
    expect(s.open).toBe(false)
  })
})

describe('useMfbStore', () => {
  it('默认 open=false', () => {
    const s = useMfbStore()
    expect(s.open).toBe(false)
  })
  it('show/hide 翻转', () => {
    const s = useMfbStore()
    s.show()
    expect(s.open).toBe(true)
    s.hide()
    expect(s.open).toBe(false)
  })
  it('show→hide→show 周期幂等', () => {
    const s = useMfbStore()
    s.show(); s.hide(); s.show()
    expect(s.open).toBe(true)
  })
})

describe('useSyncStatusStore', () => {
  it('默认 open=false', () => {
    const s = useSyncStatusStore()
    expect(s.open).toBe(false)
  })
  it('show/hide 翻转', () => {
    const s = useSyncStatusStore()
    s.show()
    expect(s.open).toBe(true)
    s.hide()
    expect(s.open).toBe(false)
  })
  it('hide 幂等', () => {
    const s = useSyncStatusStore()
    s.hide(); s.hide()
    expect(s.open).toBe(false)
  })
})

describe('四 store 独立性（同 Pinia 实例不互相串扰）', () => {
  it('mentionStore.active 不影响 batchMove/mfb/syncStatus.open', () => {
    const m = useMentionStore()
    const bm = useBatchMoveStore()
    const mfb = useMfbStore()
    const sync = useSyncStatusStore()
    m.open('g1')
    expect(m.active).toBe(true)
    expect(bm.open).toBe(false)
    expect(mfb.open).toBe(false)
    expect(sync.open).toBe(false)
  })

  it('batchMove.show 不影响其他三 store', () => {
    const m = useMentionStore()
    const bm = useBatchMoveStore()
    const mfb = useMfbStore()
    const sync = useSyncStatusStore()
    bm.show()
    expect(bm.open).toBe(true)
    expect(m.active).toBe(false)
    expect(mfb.open).toBe(false)
    expect(sync.open).toBe(false)
  })
})
