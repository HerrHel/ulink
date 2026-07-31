import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ---- d1-71 closeAddBmPopover 护栏（沿用 d1-64~d1-70 已验证的 vi.mock 闭包 mock 范本）----
// closeAddBmPopover 直接写 ui.overlays.addPopover=false + ui.addToGid=null，故 uiStore 必须是
// 稳定引用对象（`useUIStore: vi.fn(()=>mockUI)` 每次返同一对象，状态在调用间可见可断言），
// 同 d1-69 toggleGroupFocus / d1-70 exitGroupFocus 的 mockUI 口径。
// 它是 useGroup.ts 里"逐函数深度法续挖"候选（pointer#1 明点「零护栏可领」薄包装）——
// 现有覆盖仅 useKeyboardOps.test.ts:27 把 closeAddBmPopover 整体 vi.mock 成 vi.fn() 桩跳过内部逻辑，
// 间接覆盖为零，本护栏直锁其"关 add 弹窗时 overlay=false + addToGid=null 双状态原子重置"契约。

// 稳定 mockUI 承载 closeAddBmPopover 直接读写的 ui 状态字段（overlays.addPopover + addToGid）
// 及"不触碰"断言需保留的兄弟 overlay 字段（addDropdown/deadLinks/feedback）与模式字段（batchMode）。
const mockUI = {
  overlays: {
    addPopover: false as boolean,
    addDropdown: false as boolean,
    deadLinks: false as boolean,
    feedback: false as boolean,
  },
  addToGid: null as string | null,
  // 不被 closeAddBmPopover 触碰的字段（断言"无副作用外溢"用）
  batchMode: false,
  searchQuery: '',
  focusedGroupId: null as string | null,
}

vi.mock('../../stores/ui.js', () => ({
  useUIStore: vi.fn(() => mockUI),
}))

// closeAddBmPopover 不依赖 data store / EditorManager / toast / app persist，但这些是 useGroup.ts
// 模块顶层 import 链上的依赖，需 stub 以防模块加载期副作用（同 d1-69 范本最小桩集）。
vi.mock('../../stores/data.js', () => ({
  useDataStore: vi.fn(() => ({ groupMap: {}, updateGroup: vi.fn() })),
}))

vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('../../lib/editor.js', () => ({
  EditorManager: {
    get: vi.fn(() => null),
    insertAtCoords: vi.fn(),
    deleteNode: vi.fn(),
    silentSetContent: vi.fn(),
    getContentHTML: vi.fn(() => null),
  },
}))

vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: vi.fn(),
}))

import { closeAddBmPopover } from '../../composables/domain/useGroup.js'
import { saveAppData } from '../../stores/app.js'

describe('d1-71 closeAddBmPopover — 关 add 弹窗 overlay+addToGid 双状态原子重置护栏', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    // 复位 mockUI 至干净态
    mockUI.overlays.addPopover = false
    mockUI.overlays.addDropdown = false
    mockUI.overlays.deadLinks = false
    mockUI.overlays.feedback = false
    mockUI.addToGid = null
    mockUI.batchMode = false
    mockUI.searchQuery = ''
    mockUI.focusedGroupId = null
    vi.clearAllMocks()
  })

  it('A. 正路径：addPopover=true + addToGid=组id → 两状态原子重置 false/null', () => {
    mockUI.overlays.addPopover = true
    mockUI.addToGid = 'grp-target'
    closeAddBmPopover()
    expect(mockUI.overlays.addPopover).toBe(false)
    expect(mockUI.addToGid).toBe(null)
  })

  it('B. 无参恒关：函数无入参，无 skip 守卫——即使本就 false/null 仍归一赋值（幂等基线）', () => {
    mockUI.overlays.addPopover = false
    mockUI.addToGid = null
    closeAddBmPopover()
    expect(mockUI.overlays.addPopover).toBe(false)
    expect(mockUI.addToGid).toBe(null)
  })

  it('C. addToGid 有值但 overlay 本就 false：仍清 addToGid=null（证 addToGid 清除与 overlay 状态独立，非仅关 overlay 时才清）', () => {
    mockUI.overlays.addPopover = false
    mockUI.addToGid = 'grp-stale'
    closeAddBmPopover()
    expect(mockUI.addToGid).toBe(null)
    // overlay 维持 false
    expect(mockUI.overlays.addPopover).toBe(false)
  })

  it('D. overlay=true 但 addToGid 本就 null：仍设 addPopover=false（证 overlay 关闭与 addToGid 状态独立）', () => {
    mockUI.overlays.addPopover = true
    mockUI.addToGid = null
    closeAddBmPopover()
    expect(mockUI.overlays.addPopover).toBe(false)
    expect(mockUI.addToGid).toBe(null)
  })

  it('E. addToGid 为空串（falsy 但非 null）→ 恒置 null：直锁 `ui.addToGid = null` 字面赋值，非依赖原值 truthy 判定', () => {
    mockUI.addToGid = ''
    closeAddBmPopover()
    expect(mockUI.addToGid).toBe(null)
  })

  it('F. 只动 addPopover 一个 overlay 子键，不波及兄弟 overlay（addDropdown/deadLinks/feedback 维持原值）', () => {
    // 兄弟 overlay 设为 true 模拟"其他弹层开着"场景
    mockUI.overlays.addPopover = true
    mockUI.overlays.addDropdown = true
    mockUI.overlays.deadLinks = true
    mockUI.overlays.feedback = true
    mockUI.addToGid = 'grp-x'
    closeAddBmPopover()
    expect(mockUI.overlays.addPopover).toBe(false)
    // 三个兄弟 overlay 不被误关
    expect(mockUI.overlays.addDropdown).toBe(true)
    expect(mockUI.overlays.deadLinks).toBe(true)
    expect(mockUI.overlays.feedback).toBe(true)
  })

  it('G. 纯 UI 状态切换无持久化副作用：saveAppData 不被调（与 saveGroupBody/toggleGroupFocus 对照核心区分）', () => {
    mockUI.overlays.addPopover = true
    mockUI.addToGid = 'grp-persist-check'
    closeAddBmPopover()
    expect(saveAppData).not.toHaveBeenCalled()
  })

  it('H. 不触碰模式/搜索/焦点状态外溢：batchMode/searchQuery/focusedGroupId 维持原值', () => {
    mockUI.overlays.addPopover = true
    mockUI.addToGid = 'grp-spill-check'
    mockUI.batchMode = true
    mockUI.searchQuery = 'abc'
    mockUI.focusedGroupId = 'grp-focus'
    closeAddBmPopover()
    expect(mockUI.batchMode).toBe(true)
    expect(mockUI.searchQuery).toBe('abc')
    expect(mockUI.focusedGroupId).toBe('grp-focus')
  })

  it('I. 连续两次调用幂等：状态恒 false/null，无副作用外溢或重置累积', () => {
    mockUI.overlays.addPopover = true
    mockUI.addToGid = 'grp-idempotent'
    closeAddBmPopover()
    closeAddBmPopover()
    expect(mockUI.overlays.addPopover).toBe(false)
    expect(mockUI.addToGid).toBe(null)
    expect(saveAppData).not.toHaveBeenCalled()
  })
})
