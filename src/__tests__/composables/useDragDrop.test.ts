/**
 * useDragDrop.test.ts — 桌面拖拽 pin 不变量护栏 (D1-28)
 *
 * 护栏对象：useDragDrop.ts 的两个模块级私有 helper（已 export 供测试 import）：
 *   - `_samePinStatus(a, b)`：桌面拖拽"置顶项不与非置顶项交叉排序"pin 不变量唯一入口，
 *     纯读 dataStore 的 bookmarkMap/groupMap 的 pinnedAt，返回两 id 置顶态是否一致。
 *   - `_swapAndMarkDirty(a, b)`：swapOrder + _markDirty + （若有 _customCardOrder）双索引
 *     交换并 saveUIState。pin 不一致 return false 不交换（R25/A1-003 同源分支，第七轮已修
 *     _customCardOrder 同步但护栏无锁）。
 *
 * 守则口径：本测试**仅锁现有行为契约零逻辑改动**。拖拽核硬约束"默认不碰"，但补测试锁
 * pin 不变量契约与 D1-14 _sortItems / D1-15 _filterAttrs 同口径（data 核硬约束"不借优化
 * 之名改"，纯加测试锁契约不在禁止之列）。useDragDrop.ts 此前无对应 .test.ts，这两个 pin
 * 守卫函数此前零直接单测——回归会让"置顶项被拉进普通列表 / 普通项被顶进 pinned 区"
 * 用户可见数据错乱且无任何护栏断言。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── 可控 dataStore mock：_samePinStatus 读 bookmarkMap/groupMap 的 pinnedAt，
//    _swapAndMarkDirty 读 _customCardOrder + 调 _markDirty ──
let mockBookmarkMap: Record<string, { pinnedAt?: number }>
let mockGroupMap: Record<string, { pinnedAt?: number }>
let mockCustomCardOrder: { id: string }[] | null
const markDirtyMock = vi.fn()
vi.mock('../../stores/data.js', () => ({
  useDataStore: () => ({
    get bookmarkMap() { return mockBookmarkMap },
    get groupMap() { return mockGroupMap },
    get _customCardOrder() { return mockCustomCardOrder },
    set _customCardOrder(v) { mockCustomCardOrder = v },
    _markDirty: markDirtyMock,
  }),
}))

// ── uiStore saveUIState 监控（_swapAndMarkDirty 在交换 _customCardOrder 后调） ──
const saveUIStateMock = vi.fn()
vi.mock('../../stores/ui.js', () => ({
  useUIStore: () => ({ saveUIState: saveUIStateMock }),
}))

// 其余 useDragDrop 顶层 import 的副作用模块全部空 mock，使 import 不触真实链路
vi.mock('../../config/constants.js', () => ({
  PAYLOAD_KEY: 'lv/drag', DRAG_SRC_DETAIL: '__detail__', CAT_ALL: 'all', CAT_UNCATEGORIZED: 'uncategorized',
}))
// utils.js 不 mock：swapOrder 是真实纯函数（已测，直接改 a/b.order），且 useDragDrop
// 顶层 import 链经 useInlineCard/useGroup 还 import 了 isMobile 等——保留真实 utils 最稳。
vi.mock('../../lib/toast.js', () => ({ toast: { show: vi.fn(), confirm: vi.fn() } }))
vi.mock('../domain/useGroup.js', () => ({
  saveGroupBody: vi.fn(), syncGroupBookmarks: vi.fn(), addToGroupDirect: vi.fn(),
  addGroupRefToGroup: vi.fn(), removeFromSrcGroup: vi.fn(),
}))
vi.mock('../useInlineCard.js', () => ({ inlineCardHTML: vi.fn(), groupRefCardHTML: vi.fn() }))
vi.mock('../ui/useUI.js', () => ({ openDetail: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))
vi.mock('../../lib/editor.js', () => ({ EditorManager: {} }))
vi.mock('../../lib/dragHint.js', () => ({ getDragHintText: vi.fn() }))

import { _samePinStatus, _swapAndMarkDirty } from '../../composables/interaction/useDragDrop.js'

function resetStores() {
  mockBookmarkMap = {}
  mockGroupMap = {}
  mockCustomCardOrder = null
  markDirtyMock.mockClear()
  saveUIStateMock.mockClear()
}

describe('_samePinStatus (D1-28) — 桌面拖拽 pin 不变量四象限', () => {
  beforeEach(resetStores)

  it('两 id 均无 pinnedAt（bookmarkMap/groupMap 都不命中）→ 都未置顶 → true', () => {
    expect(_samePinStatus({ id: 'a' }, { id: 'b' })).toBe(true)
  })

  it('a 置顶、b 不置顶（bookmarkMap 命中）→ false', () => {
    mockBookmarkMap = { a: { pinnedAt: 1700 } }
    expect(_samePinStatus({ id: 'a' }, { id: 'b' })).toBe(false)
  })

  it('b 置顶、a 不置顶 → false（另一方向）', () => {
    mockBookmarkMap = { b: { pinnedAt: 1700 } }
    expect(_samePinStatus({ id: 'a' }, { id: 'b' })).toBe(false)
  })

  it('a/b 都置顶（bookmarkMap）→ true', () => {
    mockBookmarkMap = { a: { pinnedAt: 1700 }, b: { pinnedAt: 1800 } }
    expect(_samePinStatus({ id: 'a' }, { id: 'b' })).toBe(true)
  })

  it('a 在 bookmarkMap 置顶、b 在 groupMap 置顶 → 两侧命中不同 map 但均置顶 → true', () => {
    mockBookmarkMap = { a: { pinnedAt: 1700 } }
    mockGroupMap = { b: { pinnedAt: 1800 } }
    expect(_samePinStatus({ id: 'a' }, { id: 'b' })).toBe(true)
  })

  it('pinnedAt=0（falsy）不算置顶；a pinnedAt=0 b 无 → 都不置顶 → true（边界：0 不等同置顶）', () => {
    mockBookmarkMap = { a: { pinnedAt: 0 } }
    expect(_samePinStatus({ id: 'a' }, { id: 'b' })).toBe(true)
  })

  it('map 命中但 pinnedAt=undefined（实体存在未置顶）→ 不算置顶 → 与未置顶另一项 true', () => {
    mockBookmarkMap = { a: { } } // 无 pinnedAt 键
    expect(_samePinStatus({ id: 'a' }, { id: 'b' })).toBe(true)
  })

  it('id 前缀优先 bookmarkMap：a 既在 bookmarkMap 又在 groupMap 时取 bookmarkMap 的 pinnedAt', () => {
    // bookmarkMap 置顶、groupMap 未置顶 → || 短路取 bookmarkMap truthy → 置顶；b 未置顶 → false
    mockBookmarkMap = { a: { pinnedAt: 1700 } }
    mockGroupMap = { a: { } }
    expect(_samePinStatus({ id: 'a' }, { id: 'b' })).toBe(false)
  })
})

describe('_swapAndMarkDirty (D1-28) — pin 守卫 + swap + customCardOrder 同步', () => {
  beforeEach(resetStores)

  it('pin 一致（都不置顶）：swap order + 调 _markDirty(a,b) + return true', () => {
    const a = { id: 'a', order: 1 }
    const b = { id: 'b', order: 2 }
    const r = _swapAndMarkDirty(a, b)
    expect(r).toBe(true)
    expect(a.order).toBe(2)
    expect(b.order).toBe(1)
    expect(markDirtyMock).toHaveBeenCalledTimes(1)
    expect(markDirtyMock).toHaveBeenCalledWith('a', 'b')
  })

  it('pin 拒绝（a 置顶 b 不置顶）：return false + 不 swapOrder（order 不变）+ 不调 _markDirty', () => {
    mockBookmarkMap = { a: { pinnedAt: 1700 } }
    const a = { id: 'a', order: 1 }
    const b = { id: 'b', order: 2 }
    const r = _swapAndMarkDirty(a, b)
    expect(r).toBe(false)
    expect(a.order).toBe(1) // 未被 swap
    expect(b.order).toBe(2)
    expect(markDirtyMock).not.toHaveBeenCalled()
  })

  it('pin 拒绝另一方向（b 置顶 a 不置顶）：同样 return false 不交换', () => {
    mockBookmarkMap = { b: { pinnedAt: 1700 } }
    const a = { id: 'a', order: 1 }
    const b = { id: 'b', order: 2 }
    expect(_swapAndMarkDirty(a, b)).toBe(false)
    expect(a.order).toBe(1)
    expect(b.order).toBe(2)
    expect(markDirtyMock).not.toHaveBeenCalled()
  })

  it('存在 _customCardOrder 含 a/b：交换 _customCardOrder 中两 id 位置 + saveUIState 被调 + return true', () => {
    mockCustomCardOrder = [
      { id: 'x' }, { id: 'a' }, { id: 'y' }, { id: 'b' }, { id: 'z' },
    ]
    const a = { id: 'a', order: 1 }
    const b = { id: 'b', order: 2 }
    const r = _swapAndMarkDirty(a, b)
    expect(r).toBe(true)
    // _customCardOrder 中 a/b 互换：原本 a 在 idx1、b 在 idx3 → 交换后 b 在 idx1、a 在 idx3
    expect(mockCustomCardOrder!.map((e) => e.id)).toEqual(['x', 'b', 'y', 'a', 'z'])
    expect(saveUIStateMock).toHaveBeenCalledTimes(1)
    expect(markDirtyMock).toHaveBeenCalledWith('a', 'b')
  })

  it('R25/A1-003：_customCardOrder 同步与 sortMode 无关（不读 sortMode，存在即同步）', () => {
    // 不论 store mock 是否暴露 sortMode，只要 _customCardOrder 存在就同步交换
    mockCustomCardOrder = [{ id: 'a' }, { id: 'b' }]
    const a = { id: 'a', order: 5 }
    const b = { id: 'b', order: 6 }
    expect(_swapAndMarkDirty(a, b)).toBe(true)
    expect(mockCustomCardOrder!.map((e) => e.id)).toEqual(['b', 'a'])
    expect(saveUIStateMock).toHaveBeenCalledTimes(1)
  })

  it('_customCardOrder 为 null：仍 swap+markDirty return true，不抛、saveUIState 不调', () => {
    mockCustomCardOrder = null
    const a = { id: 'a', order: 1 }
    const b = { id: 'b', order: 2 }
    const r = _swapAndMarkDirty(a, b)
    expect(r).toBe(true)
    expect(a.order).toBe(2)
    expect(b.order).toBe(1)
    expect(markDirtyMock).toHaveBeenCalledWith('a', 'b')
    expect(saveUIStateMock).not.toHaveBeenCalled()
  })

  it('_customCardOrder 存在但只含 a 不含 b：找不到 b 索引不交换 + saveUIState 不调，但 order 已 swap + markDirty 已调（落单边界）', () => {
    mockCustomCardOrder = [{ id: 'x' }, { id: 'a' }, { id: 'y' }]
    const a = { id: 'a', order: 1 }
    const b = { id: 'b', order: 2 }
    const r = _swapAndMarkDirty(a, b)
    expect(r).toBe(true)
    // _customCardOrder 顺序未变（未找到 b 索引）
    expect(mockCustomCardOrder!.map((e) => e.id)).toEqual(['x', 'a', 'y'])
    expect(saveUIStateMock).not.toHaveBeenCalled()
    // 但 order 已 swap 且 markDirty 已调
    expect(a.order).toBe(2)
    expect(markDirtyMock).toHaveBeenCalledWith('a', 'b')
  })

  it('两 id order 相等：swapOrder 内 +1 防 0 差（锁 utils 行为），return true', () => {
    mockCustomCardOrder = null
    const a = { id: 'a', order: 7 }
    const b = { id: 'b', order: 7 }
    const r = _swapAndMarkDirty(a, b)
    expect(r).toBe(true)
    // swapOrder：相等先 b+1=8 再 swap → a=8, b=7
    expect(a.order).toBe(8)
    expect(b.order).toBe(7)
    expect(markDirtyMock).toHaveBeenCalledWith('a', 'b')
  })
})
