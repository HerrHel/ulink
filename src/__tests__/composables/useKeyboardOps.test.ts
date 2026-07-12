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
  overlays: { addDropdown: false, addPopover: false, deadLinks: false },
  modals: { bookmark: false, category: false, attribute: false, groupEdit: false, e2eSetup: false, e2eUnlock: false },
}
vi.mock('../../stores/ui.js', () => ({ useUIStore: () => mockUI }))

// ── restoreNavState 还会调 closeBmModal/closeGroupEdit/closeCatModal/closeAttrModal/exitGroupFocus ──
// 全部 mock 空，使面板分支不被 modal 关闭逻辑抢早 return
vi.mock('../../composables/domain/useGroup.js', () => ({ closeGroupEdit: vi.fn(), exitGroupFocus: vi.fn(), saveGroupBody: vi.fn() }))
vi.mock('../../composables/domain/useUndo.js', () => ({ performUndo: vi.fn(), performRedo: vi.fn() }))
vi.mock('../../lib/editor.js', () => ({ EditorManager: { toggleBold: vi.fn(), setHeading: vi.fn(), get: vi.fn() } }))
vi.mock('../../composables/domain/useBookmark.js', () => ({ closeBmModal: vi.fn(), openBmModal: vi.fn() }))
vi.mock('../../composables/ui/useUI.js', () => ({ closeCatModal: vi.fn(), closeAttrModal: vi.fn(), hideSettingsMenu: vi.fn(), closeAddBmPopover: vi.fn(), hideAddDropdown: vi.fn() }))
vi.mock('../../composables/domain/useBatch.js', () => ({ toggleBatchMode: vi.fn(), selectAllBatch: vi.fn(), batchDelete: vi.fn() }))
vi.mock('../../stores/toast.js', () => ({ useToastStore: () => ({ resolveConfirm: vi.fn() }) }))
vi.mock('../../stores/contextMenu.js', () => ({ useContextMenuStore: () => ({ hide: vi.fn() }) }))

import { captureNavState, restoreNavState } from '../../composables/interaction/useKeyboardOps.js'

beforeEach(() => {
  setActivePinia(createPinia())
  // 重置面板全部关闭 + 重建子对象避免跨测试引用同一实例污染
  mockUI.panels = { settings: false, detail: false, trash: false, history: false, rail: false, shortcutHelp: false }
  mockUI.overlays = { addDropdown: false, addPopover: false, deadLinks: false }
  mockUI.modals = { bookmark: false, category: false, attribute: false, groupEdit: false, e2eSetup: false, e2eUnlock: false }
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

  it('prev=open 表示本层即打开态，后退不关（应保持开，留给上层处理）', () => {
    mockUI.panels.trash = true
    const prev = captureNavState() // 此时 trash 已开 → prev.trash=true
    restoreNavState(prev)
    expect(mockUI.panels.trash).toBe(true)
  })
})
