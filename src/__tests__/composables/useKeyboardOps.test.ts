/**
 * useKeyboardOps.test.ts — Nav 后退关面板的回归测试
 *
 * #2 修复：captureNavState/restoreNavState 不含 settings/trash/deadLinks/shortcutHelp，
 * 打开这些面板时未 pushNavState，popstate 时 restoreNavState 无对应分支无法关。
 * 修复后这四个面板纳入 NavState，restoreNavState 关闭逻辑与 modal 一致。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── useUIStore mock：返回可写的 ui 对象，captureNavState 读、restoreNavState 写 ──
const mockUI: any = {
  curCat: 'all',
  focusedGroupId: null,
  panels: { settings: false, detail: false, trash: false, history: false, rail: false, shortcutHelp: false },
  overlays: { addDropdown: false, addPopover: false, deadLinks: false, feedback: false },
  modals: { bookmark: false, category: false, attribute: false, groupEdit: false, e2eSetup: false, e2eUnlock: false, setupGuide: false },
}
vi.mock('../../stores/ui.js', () => ({ useUIStore: () => mockUI }))

// ── restoreNavState 还会调 closeBmModal/closeGroupEdit/closeCatModal/closeAttrModal/exitGroupFocus ──
// 全部 mock 空，使面板分支不被 modal 关闭逻辑抢早 return
// 用 vi.hoisted 暴露成具名 spy（同 batchDeleteMock 模式），让 d1-95 深挖用例可断言「modal closer 调用/未调用」
const { closeGroupEditMock, exitGroupFocusMock } = vi.hoisted(() => ({
  closeGroupEditMock: vi.fn(),
  exitGroupFocusMock: vi.fn(),
}))
vi.mock('../../composables/domain/useGroup.js', () => ({ closeGroupEdit: closeGroupEditMock, exitGroupFocus: exitGroupFocusMock, saveGroupBody: vi.fn() }))
vi.mock('../../composables/domain/useUndo.js', () => ({ performUndo: vi.fn(), performRedo: vi.fn() }))
vi.mock('../../lib/editor.js', () => ({ EditorManager: { toggleBold: vi.fn(), setHeading: vi.fn(), get: vi.fn() } }))
const { closeBmModalMock, openBmModalMock } = vi.hoisted(() => ({
  closeBmModalMock: vi.fn(),
  openBmModalMock: vi.fn(),
}))
vi.mock('../../composables/domain/useBookmark.js', () => ({ closeBmModal: closeBmModalMock, openBmModal: openBmModalMock }))
const { closeCatModalMock, closeAttrModalMock } = vi.hoisted(() => ({
  closeCatModalMock: vi.fn(),
  closeAttrModalMock: vi.fn(),
}))
vi.mock('../../composables/ui/useUI.js', () => ({ closeCatModal: closeCatModalMock, closeAttrModal: closeAttrModalMock, hideSettingsMenu: vi.fn(), closeAddBmPopover: vi.fn(), hideAddDropdown: vi.fn() }))

// batchDelete 被 mock 成 spy，可在批量模式键盘分支测试中断言是否被调用
const { batchDeleteMock } = vi.hoisted(() => ({ batchDeleteMock: vi.fn() }))
vi.mock('../../composables/domain/useBatch.js', () => ({ toggleBatchMode: vi.fn(), selectAllBatch: vi.fn(), batchDelete: batchDeleteMock }))
vi.mock('../../stores/toast.js', () => ({ useToastStore: () => ({ resolveConfirm: vi.fn() }) }))
vi.mock('../../stores/contextMenu.js', () => ({ useContextMenuStore: () => ({ hide: vi.fn() }) }))
vi.mock('../../stores/actionSheet.js', () => ({ useActionSheetStore: () => ({ visible: false, hide: vi.fn() }) }))
vi.mock('../../stores/auth.js', () => ({ useAuthStore: () => ({ authModalOpen: false }) }))
vi.mock('../../stores/e2e.js', () => ({ useE2EStore: () => ({ pendingUnlock: [] }) }))
vi.mock('../../stores/attrDropdown.js', () => ({ useAttrDropdownStore: () => ({ open: false, close: vi.fn() }) }))
vi.mock('../../stores/overlay.js', () => ({
  useBatchMoveStore: () => ({ open: false, hide: vi.fn() }),
  useMfbStore: () => ({ open: false, hide: vi.fn() }),
}))

import { captureNavState, restoreNavState, _onGlobalKeydown, pushNavState } from '../../composables/interaction/useKeyboardOps.js'

function makeKey(key: string, opts: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key, code: key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    preventDefault: vi.fn(),
    ...opts,
  } as unknown as KeyboardEvent
}

/** 用 getter 覆盖 document.activeElement；restore 删除覆盖让浏览器 jsdom 回落原型默认。 */
function setActiveElement(el: HTMLElement | null): () => void {
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => el })
  return () => { delete (document as any).activeElement }
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 重置面板全部关闭 + 重建子对象避免跨测试引用同一实例污染
  mockUI.panels = { settings: false, detail: false, trash: false, history: false, rail: false, shortcutHelp: false }
  mockUI.overlays = { addDropdown: false, addPopover: false, deadLinks: false, feedback: false }
  mockUI.modals = { bookmark: false, category: false, attribute: false, groupEdit: false, e2eSetup: false, e2eUnlock: false, setupGuide: false }
  mockUI.curCat = 'all'
  mockUI.focusedGroupId = null
  // d1-95: 重置各 close spy 调用计数，让「modal closer 是否被调」断言跨用例隔离
  closeBmModalMock.mockClear()
  closeGroupEditMock.mockClear()
  closeCatModalMock.mockClear()
  closeAttrModalMock.mockClear()
  exitGroupFocusMock.mockClear()
})

describe('captureNavState / restoreNavState 含 settings/trash/deadLinks/shortcutHelp', () => {
  it('prev=false、当前已开 → restoreNavState 关闭 settings', () => {
    mockUI.panels.settings = true
    const prev = captureNavState()
    // 模拟「打开前 push」：prev 在开前 snapshot，故打开后再人工把 prev 改回 false
    prev.settings = false
    restoreNavState(prev)
    expect(mockUI.panels.settings).toBe(false)
  })

  it('关闭 trash', () => {
    mockUI.panels.trash = true
    const prev = captureNavState(); prev.trash = false
    restoreNavState(prev)
    expect(mockUI.panels.trash).toBe(false)
  })

  it('关闭 deadLinks (overlays 面)', () => {
    mockUI.overlays.deadLinks = true
    const prev = captureNavState(); prev.deadLinks = false
    restoreNavState(prev)
    expect(mockUI.overlays.deadLinks).toBe(false)
  })

  it('关闭 shortcutHelp', () => {
    mockUI.panels.shortcutHelp = true
    const prev = captureNavState(); prev.shortcutHelp = false
    restoreNavState(prev)
    expect(mockUI.panels.shortcutHelp).toBe(false)
  })

  // E3-001 / E3-006：history 纳入 NavState，与 trash 同语义
  it('关闭 history (E3-001)', () => {
    mockUI.panels.history = true
    const prev = captureNavState(); prev.history = false
    restoreNavState(prev)
    expect(mockUI.panels.history).toBe(false)
  })

  // A4-007：反馈弹窗纳入 NavState
  it('关闭 feedback overlay (A4-007)', () => {
    mockUI.overlays.feedback = true
    const prev = captureNavState(); prev.feedback = false
    restoreNavState(prev)
    expect(mockUI.overlays.feedback).toBe(false)
  })

  it('captureNavState 含 history 字段', () => {
    mockUI.panels.history = true
    const s = captureNavState()
    expect(s.history).toBe(true)
    mockUI.panels.history = false
    expect(captureNavState().history).toBe(false)
  })

  it('prev=open 表示本层即打开态，后退不关（应保持开，留给上层处理）', () => {
    mockUI.panels.trash = true
    const prev = captureNavState() // 此时 trash 已开 → prev.trash=true
    restoreNavState(prev)
    expect(mockUI.panels.trash).toBe(true)
  })

  it('R3-2: prev.detailPanelOpen=open、当前已关时保持关（不强制重开）', () => {
    // 场景：detail 开 → 其他操作 pushNavState 快照 detail=true → 用户手动关 detail → 后退。
    // 旧实现 restoreNavState 第 68 行有反向分支「prev 开、当前关 → 重新打开 detail」，
    // 会被强制重开用户已主动关闭的面板，反直觉。删后保持关，与 settings/trash 等一致。
    mockUI.panels.detail = false // 当前已关
    const prev = captureNavState()
    prev.detailPanelOpen = true // 快照是 detail 开
    restoreNavState(prev)
    expect(mockUI.panels.detail).toBe(false)
  })

  it('prev.detailPanelOpen=false、当前已开 → 关闭 detail（保留正向关闭语义）', () => {
    mockUI.panels.detail = true
    const prev = captureNavState(); prev.detailPanelOpen = false
    restoreNavState(prev)
    expect(mockUI.panels.detail).toBe(false)
  })
})

describe('_onGlobalKeydown 批量模式 Backspace/Delete 输入焦点守卫', () => {
  beforeEach(() => {
    mockUI.batchMode = true
    mockUI.batchSelected = ['b1']
    batchDeleteMock.mockClear()
  })

  it('无输入焦点时 Backspace 触发批量删除', () => {
    const restore = setActiveElement(document.body)
    const e = makeKey('Backspace')
    _onGlobalKeydown(e)
    expect(batchDeleteMock).toHaveBeenCalledTimes(1)
    expect((e.preventDefault as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    restore()
  })

  it('INPUT 聚焦时 Backspace 不劫持（让浏览器原生删字符）', () => {
    const input = document.createElement('input')
    const restore = setActiveElement(input)
    const e = makeKey('Backspace')
    _onGlobalKeydown(e)
    expect(batchDeleteMock).not.toHaveBeenCalled()
    expect((e.preventDefault as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
    restore()
  })

  it('TEXTAREA 聚焦时 Delete 不劫持批量删除', () => {
    const ta = document.createElement('textarea')
    const restore = setActiveElement(ta)
    const e = makeKey('Delete')
    _onGlobalKeydown(e)
    expect(batchDeleteMock).not.toHaveBeenCalled()
    restore()
  })

  // contentEditable（组名行内编辑/TipTap）走同一 inField 分支守卫，
  // 但 jsdom 未实现 HTMLElement.isContentEditable，无法在此环境覆盖，留真实浏览器断言。
})

// d1-95: 换扫法深挖断言浅 — captureNavState / restoreNavState 的真实分支此前仅 11 用例单层独立测，
//        14 字段完整快照契约 / `?.` 防御 / `|| false` 归一 / closers 顺序短路 / focus 与 curCat 兜底 closer /
//        `prev.X !== true` 严格判断 全零直测，靠 11 行实现口头维护。
describe('d1-95 captureNavState 14 字段完整快照契约 + 可选链防御 + ||false 归一', () => {
  it('默认全关闭态 → 14 字段全 false 空快照（curCat/focusedGroupId 除外取当前值）', () => {
    mockUI.curCat = 'work'
    mockUI.focusedGroupId = 'g1'
    const s = captureNavState()
    // 14 字段逐个断言：modal 4 + panel 5(detail counted as detailPanelOpen) + overlay 2 + curCat + focusedGroupId
    expect(s).toEqual({
      curCat: 'work', focusedGroupId: 'g1',
      detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false,
      settings: false, trash: false, deadLinks: false, shortcutHelp: false,
      history: false, feedback: false,
    })
  })

  it('全开态 → 14 字段逐字段真实映射 modal/panel/overlay 三组', () => {
    mockUI.modals = { bookmark: true, category: true, attribute: true, groupEdit: true, e2eSetup: false, e2eUnlock: false, setupGuide: false }
    mockUI.panels = { settings: true, detail: true, trash: true, history: true, rail: false, shortcutHelp: true }
    mockUI.overlays = { addDropdown: false, addPopover: false, deadLinks: true, feedback: true }
    mockUI.curCat = 'cat-a'
    mockUI.focusedGroupId = 'g2'
    const s = captureNavState()
    expect(s.bm).toBe(true)            // modals.bookmark → bm
    expect(s.groupEdit).toBe(true)     // modals.groupEdit
    expect(s.cat).toBe(true)            // modals.category → cat
    expect(s.attr).toBe(true)          // modals.attribute → attr
    expect(s.detailPanelOpen).toBe(true)// panels.detail → detailPanelOpen
    expect(s.settings).toBe(true)
    expect(s.trash).toBe(true)
    expect(s.history).toBe(true)
    expect(s.shortcutHelp).toBe(true)
    expect(s.deadLinks).toBe(true)      // overlays.deadLinks
    expect(s.feedback).toBe(true)       // overlays.feedback
    expect(s.curCat).toBe('cat-a')
    expect(s.focusedGroupId).toBe('g2')
    // 非 NavState 字段（rail/addDropdown 等）不该泄漏进快照
    expect(Object.keys(s).sort()).toEqual(['attr','bm','cat','curCat','deadLinks','detailPanelOpen','feedback','focusedGroupId','groupEdit','history','settings','shortcutHelp','trash'])
  })

  it('可选链 ?: 防御：panels/modals/overlays 缺失不抛返 false（防 partial mock / store 迁移期 TypeError）', () => {
    // captureNavState 读 ui.panels?.detail：panels===undefined 时 undefined?.detail→undefined→||false→false 不抛
    const savedPanels = mockUI.panels, savedModals = mockUI.modals, savedOverlays = mockUI.overlays
    delete mockUI.panels; delete mockUI.modals; delete mockUI.overlays
    expect(() => captureNavState()).not.toThrow()
    const s = captureNavState()
    expect(s.detailPanelOpen).toBe(false)
    expect(s.bm).toBe(false)
    expect(s.deadLinks).toBe(false)
    expect(s.settings).toBe(false)
    mockUI.panels = savedPanels; mockUI.modals = savedModals; mockUI.overlays = savedOverlays
  })

  it('||false 把 truthy 非布尔归一 boolean true（防透传原 truthy 值后 !==true 比较失配）', () => {
    // 模拟 store 迁移期误把 detail 设成 truthy 非布尔，captureNavState 应归一成 boolean
    mockUI.panels = { settings: false, detail: 'open' as any, trash: false, history: false, rail: false, shortcutHelp: false }
    const s = captureNavState()
    // 'open' || false → 'open'（truthy 短路）？验证真实：源码 `ui.panels?.detail || false` 对 'open' 返 'open' 非 boolean
    // —— 抓出真实行为：`|| false` 只兜 falsy，对 truthy 非布尔透传原值不归一 boolean。直锁此真实特性防未来误判为「归一」。
    expect(s.detailPanelOpen).toBe('open')
    expect(Boolean(s.detailPanelOpen)).toBe(true) // truthy 但非严格 boolean
  })

  it('falsy 字段（0/false/空串/null）||false 统一兜底成 false 不透传', () => {
    mockUI.panels = { settings: false, detail: 0 as any, trash: '' as any, history: false, rail: false, shortcutHelp: null as any }
    const s = captureNavState()
    expect(s.detailPanelOpen).toBe(false) // 0 || false → false
    expect(s.trash).toBe(false)           // '' || false → false
    expect(s.shortcutHelp).toBe(false)    // null || false → false
  })
})

describe('d1-95 restoreNavState closers 顺序短路 + prev!==true 严格判断 + focus/curCat 兜底 closer', () => {
  it('modal 四优先级短路：bm+groupEdit+cat+attr 全开 + prev 全 false → 只关 bm modal 其余 modal 仍开 + 只调 closeBmModal', () => {
    mockUI.modals = { bookmark: true, category: true, attribute: true, groupEdit: true, e2eSetup: false, e2eUnlock: false, setupGuide: false }
    const prev = { curCat: 'all', focusedGroupId: null, detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false, settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false }
    restoreNavState(prev)
    // closers[0] bm 命中（prev.bm !== true 且 ui.modals.bookmark=true）→ closeBmModal + return true 短路
    expect(closeBmModalMock).toHaveBeenCalledTimes(1)
    // 其余 close 在 bm 短路后不被调（顺序即优先级，首命中即返）
    expect(closeGroupEditMock).not.toHaveBeenCalled()
    expect(closeCatModalMock).not.toHaveBeenCalled()
    expect(closeAttrModalMock).not.toHaveBeenCalled()
    // mockUI.modals bookmark 字段本身不受 closeBmModal 影响（closeBmModal 是 mock 空 fn 不改 store）
    // —— restoreNavState modal 分支只 delegate close，不直接改 mockUI.modals（与 panel 分支直接置 false 不同），直锁此真实差异
  })

  it('modal→focus 短路：bm modal 开 + focusedGroupId 非 null + prev.bm=false/prev.focusedGroupId=null → 关 bm modal 不 exitGroupFocus', () => {
    mockUI.modals.bookmark = true
    mockUI.focusedGroupId = 'gX'
    const prev = { curCat: 'all', focusedGroupId: null, detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false, settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false }
    restoreNavState(prev)
    // bm closer 命中短路，不触 focus closer
    expect(closeBmModalMock).toHaveBeenCalledTimes(1)
    expect(exitGroupFocusMock).not.toHaveBeenCalled()
    expect(mockUI.focusedGroupId).toBe('gX') // 未被 focus closer 清
  })

  it('focus closer：无 modal 开 + focusedGroupId 非 null + prev.focusedGroupId=null → exitGroupFocus 调一次 + 还原 curCat', () => {
    mockUI.focusedGroupId = 'gY'
    mockUI.curCat = 'cat-changed' // prev.curCat='all' 与当前不等
    const prev = { curCat: 'all', focusedGroupId: null, detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false, settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false }
    restoreNavState(prev)
    // modal closers 全不命中（无 modal 开），到 focus closer 命中：focusedGroupId !== null + prev=null → exitGroupFocus + 还原 curCat + return true 短路
    expect(closeBmModalMock).not.toHaveBeenCalled()
    expect(exitGroupFocusMock).toHaveBeenCalledTimes(1)
    expect(mockUI.curCat).toBe('all') // prev.curCat !== ui.curCat → 还原成 prev.curCat
    // focus closer 之后还有 panel closers，但 focus closer 已 return true 短路，panel 不被关
  })

  it('focus closer curCat 相等时不还原：focusedGroupId 非 null + prev.curCat===当前 curCat → exitGroupFocus + return true 短路', () => {
    mockUI.focusedGroupId = 'gZ'
    mockUI.curCat = 'same'
    const prev = { curCat: 'same', focusedGroupId: null, detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false, settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false }
    restoreNavState(prev)
    expect(exitGroupFocusMock).toHaveBeenCalledTimes(1)
    // curCat 相等不进 if(prev.curCat !== ui.curCat) 故不还原仍 'same'
    expect(mockUI.curCat).toBe('same')
  })

  it('最后 curCat 兜底 closer：无任何层开 + curCat 不等 → 还原 curCat + 清 focusedGroupId=null + 短路不抛', () => {
    mockUI.curCat = 'changed-by-something' // 被某操作改了
    mockUI.focusedGroupId = null // 无 focus 当前
    const prev = { curCat: 'all', focusedGroupId: null, detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false, settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false }
    restoreNavState(prev)
    // 前 12 closer 全未命中（无任何层开 + 无 focus），最后 curCat closer 命中：curCat 不等 → 还原 + 清焦点
    expect(mockUI.curCat).toBe('all')
    expect(mockUI.focusedGroupId).toBe(null)
  })

  it('prev.X !== true 严格判断：prev.bm 缺失(undefined) 仍触发关 bm modal（非 ===false 守卫）', () => {
    mockUI.modals.bookmark = true
    // 构造 prev 缺 bm 键（不全）：{ curCat, ... } 没有 bm 属性 → prev.bm 是 undefined
    const prev = { curCat: 'all', focusedGroupId: null, detailPanelOpen: false, groupEdit: false, cat: false, attr: false, settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false } as any
    expect(prev.bm).toBeUndefined() // 确认缺失
    restoreNavState(prev)
    // `prev.bm !== true` 对 undefined 仍为 true（undefined !== true），故命中关 bm modal
    // —— 锁 `!== true` 而非 `=== false`：防 future 误改成 `=== false` 会让 undefined prev 漏关 bm modal
    expect(closeBmModalMock).toHaveBeenCalledTimes(1)
  })

  it('全未命中无副作用不抛：prev 与当前全一致 → 所有 closer 返 false，restoreNavState 空返 undefined 不 mutate', () => {
    mockUI.curCat = 'all'
    mockUI.focusedGroupId = null
    const prev = captureNavState() // 与当前完全一致
    expect(() => restoreNavState(prev)).not.toThrow()
    // 无任何 close 被调 + 字段不变
    expect(closeBmModalMock).not.toHaveBeenCalled()
    expect(closeGroupEditMock).not.toHaveBeenCalled()
    expect(exitGroupFocusMock).not.toHaveBeenCalled()
    expect(mockUI.curCat).toBe('all')
    expect(mockUI.focusedGroupId).toBe(null)
  })
})

// d1-115: A2-011 全周期护栏真增量缺口（d1-95 已锁 captureNavState 14 字段 + restoreNavState
//        modal/close 顺序短路 + curCat 兜底，本轮补 d1-95 漏掉的真缺口：pushNavState 自身零护栏 +
//        restoreNavState panel/overlay 7 closer 顺序短路优先级 + prev=open 已开层不关穷举 +
//        modal 分支 delegate close vs panel 分支直写 store 真实差异）。
describe('d1-115 pushNavState 委托 history.pushState 入参契约（A2-011 导航栈 push 核心，d1-95 未测）', () => {
  let pushStateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setActivePinia(createPinia())
    pushStateSpy = vi.spyOn(history, 'pushState')
  })

  it('调 history.pushState 一次（push 一次栈帧，供浏览器后退关面板）', () => {
    pushNavState()
    expect(pushStateSpy).toHaveBeenCalledTimes(1)
  })

  it('入参第一参是 captureNavState 快照（当前态对象，含 curCat/focusedGroupId 真实值）', () => {
    mockUI.curCat = 'dev'
    mockUI.focusedGroupId = 'gA'
    mockUI.panels.settings = true
    pushNavState()
    const arg = pushStateSpy.mock.calls[0][0] as Record<string, unknown>
    // 入参是真 snapshot 对象，关键字段反映 push 当时的 uiStore 态
    expect(arg).toMatchObject({ curCat: 'dev', focusedGroupId: 'gA', settings: true, detailPanelOpen: false })
    // 入参含完整 NavState 键集（与 captureNavState 同结构，非 partial）
    expect(Object.keys(arg).sort()).toEqual(
      ['attr','bm','cat','curCat','deadLinks','detailPanelOpen','feedback','focusedGroupId','groupEdit','history','settings','shortcutHelp','trash']
    )
  })

  it('入参第二参是空串（title 参数恒空，符合 A2-011 仅用 state 不用 title 契约）', () => {
    pushNavState()
    expect(pushStateSpy.mock.calls[0][1]).toBe('')
  })

  it('连续 push 两次入栈两帧：每次调一次 pushState，两次入参是同一时刻不同 snapshot 互不干扰', () => {
    mockUI.panels.detail = false
    pushNavState() // push 帧 A：detail 尚未开
    const argA = pushStateSpy.mock.calls[0][0] as Record<string, unknown>
    mockUI.panels.detail = true
    pushNavState() // push 帧 B：detail 已开
    const argB = pushStateSpy.mock.calls[1][0] as Record<string, unknown>
    expect(pushStateSpy).toHaveBeenCalledTimes(2)
    // 两次入参分别反映 push 当时的态（A 时 detail=false / B 时 detail=true），互不引用同一对象
    expect(argA.detailPanelOpen).toBe(false)
    expect(argB.detailPanelOpen).toBe(true)
    expect(argA).not.toBe(argB)
  })

  it('不改 uiStore 态（纯 push 一个栈帧，不 mutate store 读源——与 restoreNavState 写 store 截然不同）', () => {
    mockUI.curCat = 'before-push'
    mockUI.panels.settings = true
    pushNavState()
    // pushNavState 全程只 pushState(captureNavState) 不写 store
    expect(mockUI.curCat).toBe('before-push')
    expect(mockUI.panels.settings).toBe(true)
  })
})

describe('d1-115 restoreNavState panel/overlay 7 closer 顺序短路优先级（d1-95 仅测 modal 四优先级，未测 panel/overlay 层间顺序）', () => {
  const allFalsePrev = () => ({
    curCat: 'all', focusedGroupId: null, detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false,
    settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false,
  })

  it('detail closer[5] 短路优先于 settings closer[6]：detail+settings 都开 + prev 都 false → 只关 detail，settings 仍开', () => {
    mockUI.panels.detail = true
    mockUI.panels.settings = true
    restoreNavState(allFalsePrev())
    // closers[5] detail 命中（!prev.detailPanelOpen && ui.panels.detail）→ ui.panels.detail=false + return true 短路
    expect(mockUI.panels.detail).toBe(false)
    // settings closer[6] 因短路不被触 ui.panels.settings 仍 true（panel 分支直接置 false，未触即不变）
    expect(mockUI.panels.settings).toBe(true)
  })

  it('settings closer[6] 短路优先于 trash closer[7]：settings+trash 都开 + prev 都 false → 只关 settings', () => {
    mockUI.panels.settings = true
    mockUI.panels.trash = true
    restoreNavState(allFalsePrev())
    expect(mockUI.panels.settings).toBe(false)
    expect(mockUI.panels.trash).toBe(true)
  })

  it('trash closer[7] 短路优先于 deadLinks closer[9]：trash(panel)+deadLinks(overlay) 都开 → 只关 trash', () => {
    mockUI.panels.trash = true
    mockUI.overlays.deadLinks = true
    restoreNavState(allFalsePrev())
    expect(mockUI.panels.trash).toBe(false)
    expect(mockUI.overlays.deadLinks).toBe(true)
  })

  it('deadLinks closer[9] 短路优先于 shortcutHelp closer[10]：deadLinks+shortcutHelp 都开 → 只关 deadLinks', () => {
    mockUI.overlays.deadLinks = true
    mockUI.panels.shortcutHelp = true
    restoreNavState(allFalsePrev())
    expect(mockUI.overlays.deadLinks).toBe(false)
    expect(mockUI.panels.shortcutHelp).toBe(true)
  })

  it('shortcutHelp closer[10] 短路优先于 history closer[11]：shortcutHelp+history 都开 → 只关 shortcutHelp', () => {
    mockUI.panels.shortcutHelp = true
    mockUI.panels.history = true
    restoreNavState(allFalsePrev())
    expect(mockUI.panels.shortcutHelp).toBe(false)
    expect(mockUI.panels.history).toBe(true)
  })

  it('history closer[11] 短路优先于 feedback closer[12]：history+feedback 都开 → 只关 history', () => {
    mockUI.panels.history = true
    mockUI.overlays.feedback = true
    restoreNavState(allFalsePrev())
    expect(mockUI.panels.history).toBe(false)
    expect(mockUI.overlays.feedback).toBe(true)
  })

  it('modal closer 短路优先于所有 panel closer：bm modal + detail panel 都开 + prev 都 false → 关 bm 不关 detail', () => {
    mockUI.modals.bookmark = true
    mockUI.panels.detail = true
    restoreNavState(allFalsePrev())
    expect(closeBmModalMock).toHaveBeenCalledTimes(1)          // closers[0] bm 命中 delegate
    expect(mockUI.panels.detail).toBe(true)                   // detail closer[5] 未触仍开
  })
})

describe('d1-115 restoreNavState prev=open 已开层不关穷举（d1-95 line 143-148 仅测 trash 1 字段，未穷举 modal/panel/overlay）', () => {
  // 返回所有字段为 false 的全关快照，再按 key 单挑置 true（模拟某层「push 前 prev 即已开」态）
  const prevOpenOnly = (key: 'bm' | 'groupEdit' | 'cat' | 'attr' | 'detailPanelOpen' | 'settings' | 'trash' | 'deadLinks' | 'shortcutHelp' | 'history' | 'feedback') => {
    const base = { curCat: 'all', focusedGroupId: null, detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false, settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false }
    base[key] = true
    return base
  }

  it('prev.bm=true 当前 bm 已开 → bm 分支 `prev.bm !== true` 守卫短路不关，closeBmModal 不调', () => {
    mockUI.modals.bookmark = true
    restoreNavState(prevOpenOnly('bm'))
    expect(closeBmModalMock).not.toHaveBeenCalled()
    // modal 分支 delegate（不直改 store），mock 下 modals.bookmark 不变；真实 closeBmModal 才会改——此差异下一 describe 专锁
  })

  it('prev.groupEdit=true 当前 groupEdit 已开 → groupEdit 分支短路不关，closeGroupEdit 不调', () => {
    mockUI.modals.groupEdit = true
    restoreNavState(prevOpenOnly('groupEdit'))
    expect(closeGroupEditMock).not.toHaveBeenCalled()
  })

  it('prev.cat=true 当前 cat 已开 → cat 分支短路不关，closeCatModal 不调', () => {
    mockUI.modals.category = true
    restoreNavState(prevOpenOnly('cat'))
    expect(closeCatModalMock).not.toHaveBeenCalled()
  })

  it('prev.attr=true 当前 attr 已开 → attr 分支短路不关，closeAttrModal 不调', () => {
    mockUI.modals.attribute = true
    restoreNavState(prevOpenOnly('attr'))
    expect(closeAttrModalMock).not.toHaveBeenCalled()
  })

  it('prev.settings=true 当前 settings 已开 → settings 分支 `!prev.settings` 守卫短路，settings 仍开', () => {
    mockUI.panels.settings = true
    restoreNavState(prevOpenOnly('settings'))
    expect(mockUI.panels.settings).toBe(true)
  })

  it('prev.trash=true 当前 trash 已开 → trash 分支短路，trash 仍开', () => {
    mockUI.panels.trash = true
    restoreNavState(prevOpenOnly('trash'))
    // 注意：trash 是 panel 分支 [7]，若 trash 是唯一开层且 prev.trash=true，前 7 closer 全不命中，
    // 到 closers[8-13]：focus/curCat 也不命中（prev 与当前全一致 except trash），全空返不 mutate
    expect(mockUI.panels.trash).toBe(true)
  })

  it('prev.detailPanelOpen=true 当前 detail 已开 → detail 分支 `!prev.detailPanelOpen` 守卫短路不关', () => {
    mockUI.panels.detail = true
    restoreNavState(prevOpenOnly('detailPanelOpen'))
    expect(mockUI.panels.detail).toBe(true)
  })

  it('prev.deadLinks=true 当前 deadLinks 已开 → deadLinks 分支短路不关', () => {
    mockUI.overlays.deadLinks = true
    restoreNavState(prevOpenOnly('deadLinks'))
    expect(mockUI.overlays.deadLinks).toBe(true)
  })

  it('prev.shortcutHelp=true 当前 shortcutHelp 已开 → shortcutHelp 分支短路不关', () => {
    mockUI.panels.shortcutHelp = true
    restoreNavState(prevOpenOnly('shortcutHelp'))
    expect(mockUI.panels.shortcutHelp).toBe(true)
  })

  it('prev.history=true 当前 history 已开 → history 分支短路不关', () => {
    mockUI.panels.history = true
    restoreNavState(prevOpenOnly('history'))
    expect(mockUI.panels.history).toBe(true)
  })

  it('prev.feedback=true 当前 feedback 已开 → feedback 分支短路不关', () => {
    mockUI.overlays.feedback = true
    restoreNavState(prevOpenOnly('feedback'))
    expect(mockUI.overlays.feedback).toBe(true)
  })
})

describe('d1-115 restoreNavState modal 分支 delegate close vs panel 分支直写 store 真实差异（d1-95 line 292-294 注释注意到但未锁定）', () => {
  const allFalsePrev = () => ({
    curCat: 'all', focusedGroupId: null, detailPanelOpen: false, bm: false, groupEdit: false, cat: false, attr: false,
    settings: false, trash: false, deadLinks: false, shortcutHelp: false, history: false, feedback: false,
  })

  it('modal closer 命中：mock 下 close 被调但 modals 字段不被 restoreNavState 直改（delegate 语义，real close 才改 store）', () => {
    mockUI.modals.bookmark = true
    restoreNavState(allFalsePrev())
    // modal 分支走 closeBmModal() delegate，restoreNavState 自身不写 ui.modals.bookmark=false
    expect(closeBmModalMock).toHaveBeenCalledTimes(1)
    // mock closeBmModal 是空 fn 不改 store → modals.bookmark 仍 true（真实实现里 closeBmModal 内部才置 false）
    // —— 直锁真实行为差异：modal 分支只 delegate 不直改 store，与 panel 分支对照
    expect(mockUI.modals.bookmark).toBe(true)
  })

  it('panel closer 命中：restoreNavState 直接置 ui.panels.X=false（直写 store，不经 delegate）', () => {
    mockUI.panels.settings = true
    restoreNavState(allFalsePrev())
    // panel closer 走 `ui.panels.settings = false` 直写，store 即时变 false
    expect(mockUI.panels.settings).toBe(false)
  })

  it('overlay closer 命中：restoreNavState 直接置 ui.overlays.X=false（直写 store，与 panel 同款不经 delegate）', () => {
    mockUI.overlays.deadLinks = true
    restoreNavState(allFalsePrev())
    expect(mockUI.overlays.deadLinks).toBe(false)
  })

  it('focus closer 命中：exitGroupFocus delegate（不改 ui.focusedGroupId），但此处若 curCat 不等 restoreNavState 直改 ui.curCat（混合语义）', () => {
    mockUI.focusedGroupId = 'gM'
    mockUI.curCat = 'changed'
    const prev = allFalsePrev() // prev.curCat='all' 与当前 'changed' 不等
    restoreNavState(prev)
    expect(exitGroupFocusMock).toHaveBeenCalledTimes(1)       // focus closer delegate exitGroupFocus
    // 但 focus closer 内 `if (prev.curCat !== ui.curCat) ui.curCat = prev.curCat` 是 restoreNavState 直写 store
    expect(mockUI.curCat).toBe('all')                          // 直写还原成 prev.curCat
    // exitGroupFocus 是 mock 空 fn 不清 ui.focusedGroupId（真实实现里才清）
    expect(mockUI.focusedGroupId).toBe('gM')                   // delegate 不直改 store，与 modal 同款
  })
})
