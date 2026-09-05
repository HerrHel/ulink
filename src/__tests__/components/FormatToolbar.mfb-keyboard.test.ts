/**
 * FormatToolbar 移动端浮动格式栏（.mfb）× 虚拟键盘开合契约
 *
 * 回归背景：.mfb 显隐原只由编辑器 focusin/focusout 驱动（GroupEditor → mfbStore）。
 * Android 返回键 / iOS 键盘「完成」收起键盘时 contenteditable 仍持焦点、不触发 blur
 * → open 恒 true；visualViewport 监听把 kbBottom 归 0，工具栏降到页面底部常驻不收，
 * 退出聚焦组也不消失，只有刷新才清掉。
 *
 * 契约（updateViewport 键盘开合状态机 + gid watch）：
 *  1. 键盘收起（vv.height 恢复 ≈ innerHeight）→ mfb 必收，无论编辑器是否仍持焦点
 *  2. 聚焦组 gid → null → mfb 必收（不依赖 blur；键盘开、焦点滞留编辑器的最坏场景）
 *  3. 初始 show、键盘从未弹起：不得误收（无 开→关 边沿）
 *  4. 键盘重新弹起且焦点仍在 .group-body 内（收键盘后再点文本，无新 focusin）→ 重浮
 *  5. 键盘弹起但焦点在编辑器外（搜索框等）→ 不得误浮
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const hoist = vi.hoisted(() => ({
  isMobileFlag: { on: true },
}))

vi.mock('../../utils.js', () => ({ isMobile: () => hoist.isMobileFlag.on }))

vi.mock('../../stores/app.js', async () => {
  const { reactive } = await import('vue')
  const appState = reactive({ focusedGroupId: null as string | null })
  return { useAppStore: () => appState, __appState: appState }
})

vi.mock('../../stores/ui.js', async () => {
  const { reactive } = await import('vue')
  const uiState = reactive({ isMobile: true, shareMode: false })
  return { useUIStore: () => uiState, __uiState: uiState }
})

vi.mock('../../lib/editor.js', () => ({
  EditorManager: { get: () => null, register: vi.fn(), unregister: vi.fn() },
}))
vi.mock('../../composables/domain/useGroup.js', () => ({ saveGroupBody: vi.fn() }))
vi.mock('../../composables/domain/useImageUpload.js', () => ({ uploadAndInsertImages: vi.fn() }))
vi.mock('../../composables/ui/useEditorFormat.js', async () => {
  const { reactive, ref } = await import('vue')
  const fmt = reactive({ bold: false, underline: false, h1: false, h2: false, h3: false, ol: false, ul: false, task: false, color: '' })
  return {
    PALETTE: [{ hex: '#000000', name: '黑' }],
    useEditorFormat: () => ({ fmt, colorOpen: ref(false), syncFmt: vi.fn(), fmtToggle: vi.fn(), applyColor: vi.fn() }),
  }
})
vi.mock('../../components/editor/ColorPalette.vue', () => ({ default: { render: () => null } }))

const { __appState } = (await import('../../stores/app.js')) as unknown as {
  __appState: { focusedGroupId: string | null }
}
const { __uiState } = (await import('../../stores/ui.js')) as unknown as {
  __uiState: { isMobile: boolean; shareMode: boolean }
}

/** visualViewport 桩：真实 EventTarget，height/offsetTop 可控 */
const vvStub = Object.assign(new EventTarget(), { height: 768, offsetTop: 0 })

/** rAF 同步立即执行回调（jsdom 真 rAF 异步与 useFakeTimers 不配） */
function stubRafSync() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

async function mountToolbar() {
  const { default: FormatToolbar } = await import('../../components/editor/FormatToolbar.vue')
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(FormatToolbar, { global: { plugins: [pinia] } })
}

function setKeyboard(open: boolean) {
  vvStub.height = open ? window.innerHeight - 300 : window.innerHeight
  vvStub.dispatchEvent(new Event('resize'))
}

async function openBar() {
  const { useMfbStore } = await import('../../stores/overlay.js')
  const mfb = useMfbStore()
  mfb.show()
  return mfb
}

function barVisible(wrapper: VueWrapper) {
  return wrapper.find('.mfb').classes().includes('visible')
}

function focusInGroupBody() {
  document.body.innerHTML = '<div class="group-body"><div contenteditable tabindex="0"></div></div>'
  const el = document.querySelector('.group-body [contenteditable]') as HTMLElement
  el.focus()
  return el
}

describe('FormatToolbar .mfb × 虚拟键盘开合', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    stubRafSync()
    ;(window as unknown as { visualViewport: EventTarget }).visualViewport = vvStub
    vvStub.height = window.innerHeight
    vvStub.offsetTop = 0
    __appState.focusedGroupId = 'g1'
    __uiState.isMobile = true
    __uiState.shareMode = false
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    delete (window as unknown as { visualViewport?: EventTarget }).visualViewport
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('1. 键盘收起 → mfb 必收（编辑器仍持焦点、无 blur 的 Android 返回键 / iOS「完成」场景）', async () => {
    wrapper = await mountToolbar()
    const mfb = await openBar()
    expect(barVisible(wrapper)).toBe(true)
    setKeyboard(true)
    await wrapper.vm.$nextTick()
    expect(barVisible(wrapper)).toBe(true) // 键盘弹起，浮在键盘上方
    setKeyboard(false) // 收起键盘：contenteditable 不 blur（无 focusout）
    await wrapper.vm.$nextTick()
    expect(mfb.open).toBe(false)
    expect(barVisible(wrapper)).toBe(false)
  })

  it('2. 聚焦组 gid → null → mfb 必收（不依赖 blur；键盘开 + 焦点滞留编辑器）', async () => {
    wrapper = await mountToolbar()
    const mfb = await openBar()
    setKeyboard(true)
    focusInGroupBody()
    expect(barVisible(wrapper)).toBe(true)
    __appState.focusedGroupId = null
    await wrapper.vm.$nextTick()
    expect(mfb.open).toBe(false)
    expect(barVisible(wrapper)).toBe(false)
  })

  it('3. 初始 show、键盘从未弹起：不得误收（无 开→关 边沿）', async () => {
    wrapper = await mountToolbar()
    await openBar()
    expect(barVisible(wrapper)).toBe(true)
    vi.advanceTimersByTime(400) // show() 的 300ms 兜底 updateViewport 落在键盘关闭态
    expect(barVisible(wrapper)).toBe(true)
  })

  it('4. 键盘重新弹起且焦点仍在 .group-body 内（无新 focusin）→ 重浮', async () => {
    wrapper = await mountToolbar()
    const mfb = await openBar()
    setKeyboard(true)
    focusInGroupBody()
    setKeyboard(false) // 收键盘 → 收栏（契约 1），焦点未离开编辑器
    expect(mfb.open).toBe(false)
    setKeyboard(true) // 再点文本：键盘重新弹起，但不会有新 focusin
    expect(mfb.open).toBe(true)
    expect(barVisible(wrapper)).toBe(true)
  })

  it('5. 键盘弹起但焦点在编辑器外（搜索框等）→ 不得误浮', async () => {
    wrapper = await mountToolbar()
    const mfb = await openBar()
    setKeyboard(true)
    setKeyboard(false)
    expect(mfb.open).toBe(false)
    document.body.innerHTML = '<input id="search" />'
    ;(document.getElementById('search') as HTMLElement).focus()
    setKeyboard(true)
    await wrapper.vm.$nextTick()
    expect(mfb.open).toBe(false)
    expect(barVisible(wrapper)).toBe(false)
  })
})
