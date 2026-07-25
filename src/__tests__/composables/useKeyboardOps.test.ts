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
vi.mock('../../composables/domain/useGroup.js', () => ({ closeGroupEdit: vi.fn(), exitGroupFocus: vi.fn(), saveGroupBody: vi.fn() }))
vi.mock('../../composables/domain/useUndo.js', () => ({ performUndo: vi.fn(), performRedo: vi.fn() }))
vi.mock('../../lib/editor.js', () => ({ EditorManager: { toggleBold: vi.fn(), setHeading: vi.fn(), get: vi.fn() } }))
vi.mock('../../composables/domain/useBookmark.js', () => ({ closeBmModal: vi.fn(), openBmModal: vi.fn() }))
vi.mock('../../composables/ui/useUI.js', () => ({ closeCatModal: vi.fn(), closeAttrModal: vi.fn(), hideSettingsMenu: vi.fn(), closeAddBmPopover: vi.fn(), hideAddDropdown: vi.fn() }))

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
