import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reactive, defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const mockUI = reactive({
  shareMode: false,
  batchMode: false,
  activeView: 'bookmarks',
  isMobile: false,
  ctxCard: null as any,
  ctxGid: null as any,
  setMobile: vi.fn(),
})

vi.mock('../../stores/ui.js', () => ({
  useUIStore: () => mockUI,
}))

vi.mock('../../stores/e2e.js', () => ({
  useE2EStore: () => ({ isUnlocked: false, resetLockTimer: vi.fn() }),
}))

vi.mock('../../stores/vault.js', () => ({
  useVaultStore: () => ({ isVaultUnlocked: false, resetLockTimer: vi.fn() }),
}))

vi.mock('../../stores/attrDropdown.js', () => ({
  useAttrDropdownStore: () => ({ isOpen: false, close: vi.fn() }),
}))

vi.mock('../../stores/overlay.js', () => ({
  useMentionStore: () => ({ isOpen: false, close: vi.fn() }),
}))

vi.mock('../../composables/ui/useUI.js', () => ({
  hideAddDropdown: vi.fn(),
}))

vi.mock('../../utils.js', () => ({
  isMobile: () => mockUI.isMobile,
}))

import { useGlobalEvents } from '../../composables/useGlobalEvents.js'

describe('useGlobalEvents — contextmenu 右键菜单分流测试', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    mockUI.shareMode = false
    mockUI.batchMode = false
    mockUI.activeView = 'bookmarks'
    mockUI.isMobile = false
    mockUI.ctxCard = null
    mockUI.ctxGid = null

    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  function createTestHarness(onShowCtxMenu: (e: MouseEvent, type: string, id: string) => void) {
    const Comp = defineComponent({
      setup() {
        useGlobalEvents({ onShowCtxMenu })
        return () => h('div', { class: 'test-harness' })
      },
    })
    return mount(Comp, { attachTo: container })
  }

  it('书签视图下在 #panelContent 空白处右键，应触发 grid-empty 菜单并阻止原生行为', () => {
    mockUI.activeView = 'bookmarks'
    const onShowCtxMenu = vi.fn()
    const wrapper = createTestHarness(onShowCtxMenu)

    const panel = document.createElement('div')
    panel.id = 'panelContent'
    const emptyArea = document.createElement('div')
    emptyArea.className = 'panel-blank'
    panel.appendChild(emptyArea)
    container.appendChild(panel)

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })
    emptyArea.dispatchEvent(event)

    expect(onShowCtxMenu).toHaveBeenCalledWith(expect.anything(), 'grid-empty', '')
    expect(event.defaultPrevented).toBe(true)

    wrapper.unmount()
  })

  it('AI 工作台视图下在 #panelContent 内右键，应直接放行原生右键菜单且不触发 grid-empty', () => {
    mockUI.activeView = 'ai'
    const onShowCtxMenu = vi.fn()
    const wrapper = createTestHarness(onShowCtxMenu)

    const panel = document.createElement('div')
    panel.id = 'panelContent'
    const aiWorkspace = document.createElement('div')
    aiWorkspace.className = 'ai-workspace'
    const chatStream = document.createElement('div')
    chatStream.className = 'chat-stream'
    aiWorkspace.appendChild(chatStream)
    panel.appendChild(aiWorkspace)
    container.appendChild(panel)

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })
    chatStream.dispatchEvent(event)

    // 不调用 onShowCtxMenu，不阻止默认行为
    expect(onShowCtxMenu).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)

    wrapper.unmount()
  })

  it('任何视图下点击在 .chat-stream / .chat-panel-shell 等聊天元素时，均放行原生菜单', () => {
    mockUI.activeView = 'bookmarks' // 即使处于书签视图（如侧边抽屉打开 AI 聊天）
    const onShowCtxMenu = vi.fn()
    const wrapper = createTestHarness(onShowCtxMenu)

    const chatShell = document.createElement('div')
    chatShell.className = 'chat-panel-shell'
    const msg = document.createElement('div')
    msg.className = 'user-msg'
    chatShell.appendChild(msg)
    container.appendChild(chatShell)

    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })
    msg.dispatchEvent(event)

    expect(onShowCtxMenu).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)

    wrapper.unmount()
  })
})
