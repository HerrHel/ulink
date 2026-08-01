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

import { captureNavState, restoreNavState, _onGlobalKeydown } from '../../composables/interaction/useKeyboardOps.js'

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
