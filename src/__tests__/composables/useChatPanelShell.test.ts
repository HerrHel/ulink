/**
 * useChatPanelShell 单测：DetailPanel 面板壳层抽取后的回归锁
 * 覆盖：isOpen 跟随 ui.panels.detail、isMobileDevice 跟随 isMobile、
 * 会话菜单「点击外部关闭」（含 .chat-top-title-wrap 内豁免与卸载后监听清理）、
 * closeEntirePanel、attachedCardsList 命中与标题回退、toggleFloatingHud 翻转与持久化、
 * note 写回三入口与卡片定位（断言 mock 被调用防假绿）。
 * toggle 断言采用「翻转」通用写法：isFloatingHud 存量 bug 修复前后均成立。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const _m = vi.hoisted(() => ({
  isMobileFn: (): boolean => false,
  appendSpy: vi.fn(),
  replaceSpy: vi.fn(),
  createSpy: vi.fn(),
  locateSpy: vi.fn(),
}))

vi.mock('../../utils.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../utils.js')>()
  return { ...mod, isMobile: () => _m.isMobileFn() }
})
vi.mock('../../lib/ai/noteWriteback.js', () => ({
  appendAiContentToGroup: (...a: unknown[]) => _m.appendSpy(...a),
  replaceAiContentToGroup: (...a: unknown[]) => _m.replaceSpy(...a),
  createNoteFromAiContent: (...a: unknown[]) => _m.createSpy(...a),
}))
vi.mock('../../lib/ai/cardLocator.js', () => ({
  locateAndHighlightCard: (...a: unknown[]) => _m.locateSpy(...a),
}))

import { useChatPanelShell } from '../../composables/ui/useChatPanelShell.js'
import { useI18n } from '../../i18n/index.js'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'

type Api = ReturnType<typeof useChatPanelShell>

/** 在组件 setup 中调用 composable（document 监听需组件生命周期，onMounted 才注册） */
function mountShell(): { api: Api; unmount: () => void } {
  let api!: Api
  const Comp = defineComponent({
    setup() {
      api = useChatPanelShell()
      return () => h('div')
    },
  })
  const wrapper = mount(Comp)
  return { api, unmount: () => wrapper.unmount() }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  _m.isMobileFn = () => false
  _m.createSpy.mockReturnValue({ success: true, groupId: 'g-new' })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('useChatPanelShell 面板状态', () => {
  it('isOpen 跟随 ui.panels.detail', () => {
    const ui = useUIStore()
    const { api } = mountShell()
    expect(api.isOpen.value).toBe(ui.panels.detail)
    ui.panels.detail = true
    expect(api.isOpen.value).toBe(true)
    ui.panels.detail = false
    expect(api.isOpen.value).toBe(false)
  })

  it('isMobileDevice 跟随 isMobile()', () => {
    _m.isMobileFn = () => true
    expect(mountShell().api.isMobileDevice.value).toBe(true)
    _m.isMobileFn = () => false
    expect(mountShell().api.isMobileDevice.value).toBe(false)
  })

  it('closeEntirePanel 关闭详情面板', () => {
    const ui = useUIStore()
    const { api } = mountShell()
    ui.panels.detail = true
    api.closeEntirePanel()
    expect(ui.panels.detail).toBe(false)
  })

  it('isInputFocused 初始 false 可切换', () => {
    const { api } = mountShell()
    expect(api.isInputFocused.value).toBe(false)
    api.isInputFocused.value = true
    expect(api.isInputFocused.value).toBe(true)
  })
})

describe('useChatPanelShell 会话菜单点击外部关闭', () => {
  it('点击 .chat-top-title-wrap 之外收起菜单，之内不收起', () => {
    const { api } = mountShell()
    const wrap = document.createElement('div')
    wrap.className = 'chat-top-title-wrap'
    const inner = document.createElement('span')
    wrap.appendChild(inner)
    document.body.appendChild(wrap)

    // 标题区内点击：不收起
    api.isSessionMenuOpen.value = true
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(api.isSessionMenuOpen.value).toBe(true)

    // 标题区外点击（body）：收起
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(api.isSessionMenuOpen.value).toBe(false)

    document.body.removeChild(wrap)
  })

  it('菜单未展开时点击不改变状态；卸载后监听被移除', () => {
    const { api, unmount } = mountShell()
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(api.isSessionMenuOpen.value).toBe(false)

    // 卸载后点击不再收起（监听已清理）
    api.isSessionMenuOpen.value = true
    unmount()
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(api.isSessionMenuOpen.value).toBe(true)
  })
})

describe('useChatPanelShell attachedCardsList', () => {
  it('group/bookmark 命中映射 title/url；缺数据回退 i18n 文案', () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ds.$patch({
      bookmarks: [
        { id: 'b1', title: 'B1', url: 'https://b1.com' },
        { id: 'b2', title: '', url: 'https://b2.com' },
      ] as never[],
      siblingGroups: [{ id: 'g1', name: 'G1' }] as never[],
    })
    ui.attachCardToAi('bm', 'b1')
    ui.attachCardToAi('group', 'g1')
    ui.attachCardToAi('bm', 'b2')
    ui.attachCardToAi('group', 'ghost')
    ui.attachCardToAi('bm', 'ghost')

    const { t } = useI18n()
    const { api } = mountShell()
    const list = api.attachedCardsList.value
    expect(list).toHaveLength(5)
    expect(list[0]).toEqual({ type: 'bm', id: 'b1', title: 'B1', url: 'https://b1.com' })
    expect(list[1]).toEqual({ type: 'group', id: 'g1', title: 'G1', url: '' })
    // 无标题书签 → 回退到 url
    expect(list[2]).toEqual({ type: 'bm', id: 'b2', title: 'https://b2.com', url: 'https://b2.com' })
    // 不存在的组/书签 → 回退 i18n 占位文案（与 t() 直接对照，防假绿）
    expect(list[3]).toEqual({ type: 'group', id: 'ghost', title: t('cards.note'), url: '' })
    expect(list[4]).toEqual({ type: 'bm', id: 'ghost', title: t('cards.bookmark'), url: '' })
    expect(t('cards.note')).not.toBe('ghost')
    expect(t('cards.bookmark')).not.toBe('ghost')
  })
})

describe('useChatPanelShell toggleFloatingHud', () => {
  it('翻转状态并持久化到 localStorage（修复前后通用断言）', () => {
    const { api } = mountShell()
    const before = !!api.isFloatingHud.value
    api.toggleFloatingHud()
    expect(!!api.isFloatingHud.value).toBe(!before)
    expect(localStorage.getItem('ulink_ai_floating_hud')).toBe(String(!!api.isFloatingHud.value))

    const mid = !!api.isFloatingHud.value
    api.toggleFloatingHud()
    expect(!!api.isFloatingHud.value).toBe(!mid)
    expect(localStorage.getItem('ulink_ai_floating_hud')).toBe(String(!!api.isFloatingHud.value))
  })
})

describe('useChatPanelShell note 写回与卡片定位', () => {
  it('handleAppendToNote / handleReplaceNote 透传参数', () => {
    const { api } = mountShell()
    api.handleAppendToNote('g1', 'append-text')
    expect(_m.appendSpy).toHaveBeenCalledTimes(1)
    expect(_m.appendSpy).toHaveBeenCalledWith('g1', 'append-text')

    api.handleReplaceNote('g2', 'replace-text')
    expect(_m.replaceSpy).toHaveBeenCalledTimes(1)
    expect(_m.replaceSpy).toHaveBeenCalledWith('g2', 'replace-text')
  })

  it('handleSaveAsNewNote 成功后定位新笔记；失败不定位', () => {
    const { api } = mountShell()
    api.handleSaveAsNewNote('content')
    expect(_m.createSpy).toHaveBeenCalledWith({ aiText: 'content' })
    expect(_m.locateSpy).toHaveBeenCalledWith({ id: 'g-new', type: 'group' })

    _m.createSpy.mockReturnValue({ success: false, error: 'Empty content' })
    _m.locateSpy.mockClear()
    api.handleSaveAsNewNote('content')
    expect(_m.locateSpy).not.toHaveBeenCalled()

    // 成功但无 groupId 也不定位
    _m.createSpy.mockReturnValue({ success: true })
    api.handleSaveAsNewNote('content')
    expect(_m.locateSpy).not.toHaveBeenCalled()
  })

  it('handleLocateCard 带 collapseDetailOnMobile: true', () => {
    const { api } = mountShell()
    api.handleLocateCard('b9', 'bookmark')
    expect(_m.locateSpy).toHaveBeenCalledWith({ id: 'b9', type: 'bookmark', collapseDetailOnMobile: true })
    api.handleLocateCard('g9', 'group')
    expect(_m.locateSpy).toHaveBeenCalledWith({ id: 'g9', type: 'group', collapseDetailOnMobile: true })
  })
})
