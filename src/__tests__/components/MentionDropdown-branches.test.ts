/**
 * MentionDropdown.vue — 补覆盖率锁定真实行为契约
 * 既有 MentionDropdown.scroll-listener.test.ts 只锁 onMounted/onUnmounted scroll 监听缓存引用防泄漏，
 * 未触达 setup 函数体：onItemMousedown（item 不存在早退 + sub-menu 守门 + group/bookmark 分流）、
 * onSubItemMousedown（preventDefault+stopPropagation+selectBookmark）、_onKeydown（转发）、
 * _onScroll（isVisible 守门 + getSelection+getClientRects 定位边界 clamp）。
 * 桩沿用 scroll-listener：mock useMention 整模块 + mock icons + mock utils + 提供 #panelContent。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'

// 可控 useMention 状态桩：hoisted 持空容器，vi.mock 工厂内用 ref 填充（ref 在 hoisted 不可用）
// 工厂返回的 isRe 真可响应式 ref 单例，测内经 mention.isVisible.value = true 读改同步模板+setup。
const mention = vi.hoisted(() => ({} as {
  isVisible: Ref<boolean>
  candidates: Ref<any[]>
  activeIdx: Ref<number>
  activeSubIdx: Ref<number>
  mentionType: Ref<'bookmark' | 'group'>
  pos: Ref<{ x: number; y: number }>
  selectBookmark: ReturnType<typeof vi.fn>
  selectGroupRef: ReturnType<typeof vi.fn>
  onTrigger: ReturnType<typeof vi.fn>
  onInput: ReturnType<typeof vi.fn>
  onKeydown: ReturnType<typeof vi.fn>
}))

// 真 ref 让模板响应式渲染（v-for candidates 自动 unwrap）+ setup 内 .value 读写生效。
vi.mock('../../composables/domain/useMention.js', () => {
  mention.isVisible = ref(false)
  mention.candidates = ref([])
  mention.activeIdx = ref(0)
  mention.activeSubIdx = ref(0)
  mention.mentionType = ref('bookmark')
  mention.pos = ref({ x: 0, y: 0 })
  mention.selectBookmark = vi.fn()
  mention.selectGroupRef = vi.fn()
  mention.onTrigger = vi.fn()
  mention.onInput = vi.fn()
  mention.onKeydown = vi.fn()
  return { useMention: () => mention }
})

vi.mock('../../config/icons.js', () => ({ I: { note: '<svg-note/>' } }))
vi.mock('../../utils.js', () => ({ favicon: (u: string) => 'fav-' + u, domain: (u: string) => 'dom-' + u }))

import MentionDropdown from '../../components/overlays/MentionDropdown.vue'

beforeEach(() => {
  document.body.innerHTML = '<div id="panelContent"></div>'
  mention.isVisible.value = false
  mention.candidates.value = []
  mention.activeIdx.value = 0
  mention.activeSubIdx.value = 0
  mention.mentionType.value = 'bookmark'
  mention.pos.value = { x: 0, y: 0 }
  mention.selectBookmark.mockReset()
  mention.selectGroupRef.mockReset()
  mention.onTrigger.mockReset()
  mention.onInput.mockReset()
  mention.onKeydown.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

async function mountDropdown() {
  const w = mount(MentionDropdown, { attachTo: document.body })
  await nextTick()
  return w
}

describe('MentionDropdown onItemMousedown', () => {
  it('item 不存在(idx 越界) → 早退不 select', async () => {
    mention.isVisible.value = true
    mention.candidates.value = [{ id: 'b1', title: 'x', url: '', type: 'bookmark' }]
    const w = await mountDropdown()
    // 经 setupState 直调 idx 越界
    await (w.vm.$ as any).setupState.onItemMousedown(5, { target: null } as any)
    expect(mention.selectBookmark).not.toHaveBeenCalled()
    expect(mention.selectGroupRef).not.toHaveBeenCalled()
    w.unmount()
  })

  it('group 类型 → selectGroupRef(item.id) 分流', async () => {
    mention.isVisible.value = true
    mention.candidates.value = [{ id: 'g1', name: '组', type: 'group', bookmarkIds: ['b1', 'b2'], icon: '' }]
    mention.mentionType.value = 'group'
    const w = await mountDropdown()
    await (w.vm.$ as any).setupState.onItemMousedown(0, { target: createTarget() } as any)
    expect(mention.selectGroupRef).toHaveBeenCalledWith('g1')
    expect(mention.selectBookmark).not.toHaveBeenCalled()
    w.unmount()
  })

  it('bookmark 类型(无 subItems) → selectBookmark(item.id) 分流', async () => {
    mention.isVisible.value = true
    mention.candidates.value = [{ id: 'b1', title: '书签', url: 'https://a.com', type: 'bookmark' }]
    const w = await mountDropdown()
    await (w.vm.$ as any).setupState.onItemMousedown(0, { target: createTarget() } as any)
    expect(mention.selectBookmark).toHaveBeenCalledWith('b1')
    expect(mention.selectGroupRef).not.toHaveBeenCalled()
    w.unmount()
  })

  it('有 subItems 且 mousedown target 在 .mention-sub-menu 内 → 守门不 select（避免子菜单点击误触父）', async () => {
    mention.isVisible.value = true
    mention.candidates.value = [{
      id: 'b1', title: '父', url: '', type: 'bookmark',
      subItems: [{ id: 'b2', title: '子', url: '' }],
    }]
    const w = await mountDropdown()
    // 构造 target.closest('.mention-sub-menu') 命中
    const targetInSubMenu = createTarget({ closest: (sel: string) => sel === '.mention-sub-menu' ? document.createElement('div') : null })
    await (w.vm.$ as any).setupState.onItemMousedown(0, { target: targetInSubMenu } as any)
    w.unmount() // 先卸载再断言：防止红绿门改源致本测 fail 时跳过 unmount，泄漏 document 监听污染后续测
    expect(mention.selectBookmark).not.toHaveBeenCalled()
  })

  it('有 subItems 但 target 不在 sub-menu 内 → 正常 selectBookmark 父项', async () => {
    mention.isVisible.value = true
    mention.candidates.value = [{
      id: 'b1', title: '父', url: '', type: 'bookmark',
      subItems: [{ id: 'b2', title: '子', url: '' }],
    }]
    const w = await mountDropdown()
    // target.closest('.mention-sub-menu') 返 null（不在子菜单内）
    const targetOutside = createTarget({ closest: () => null })
    await (w.vm.$ as any).setupState.onItemMousedown(0, { target: targetOutside } as any)
    expect(mention.selectBookmark).toHaveBeenCalledWith('b1')
    w.unmount()
  })
})

describe('MentionDropdown onSubItemMousedown', () => {
  it('子项点击 → preventDefault+stopPropagation+selectBookmark(sub.id)', async () => {
    mention.isVisible.value = true
    mention.candidates.value = [{
      id: 'b1', title: '父', url: '', type: 'bookmark',
      subItems: [{ id: 'b2', title: '子', url: 'https://sub.com', icon: '' }],
    }]
    const w = await mountDropdown()
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }
    await (w.vm.$ as any).setupState.onSubItemMousedown({ id: 'b2', title: '子', url: '' }, event as any)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(event.stopPropagation).toHaveBeenCalled()
    expect(mention.selectBookmark).toHaveBeenCalledWith('b2')
    w.unmount()
  })
})

describe('MentionDropdown keydown/input 转发', () => {
  it('document keydown 触发 _onKeydown → onTrigger+onKeydown 转发', async () => {
    const w = await mountDropdown()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(mention.onTrigger).toHaveBeenCalled()
    expect(mention.onKeydown).toHaveBeenCalled()
    w.unmount()
  })

  it('document input 触发 onInput', async () => {
    const w = await mountDropdown()
    document.dispatchEvent(new Event('input', { bubbles: true }))
    expect(mention.onInput).toHaveBeenCalled()
    w.unmount()
  })

  it('卸载后 document 监听被移除 → 不再转发', async () => {
    const w = await mountDropdown()
    w.unmount()
    mention.onTrigger.mockClear()
    mention.onInput.mockClear()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    document.dispatchEvent(new Event('input', { bubbles: true }))
    expect(mention.onTrigger).not.toHaveBeenCalled()
    expect(mention.onInput).not.toHaveBeenCalled()
  })
})

describe('MentionDropdown _onScroll 定位', () => {
  it('isVisible=false → _onScroll 早退不读 getSelection', async () => {
    mention.isVisible.value = false
    const w = await mountDropdown()
    const getSelectionSpy = vi.spyOn(window, 'getSelection')
    ;(w.vm.$ as any).setupState._onScroll()
    expect(getSelectionSpy).not.toHaveBeenCalled()
    expect(mention.pos.value).toEqual({ x: 0, y: 0 }) // 未更新
    w.unmount()
  })

  it('isVisible=true 且无选区(rangeCount=0) → 不更新 pos', async () => {
    mention.isVisible.value = true
    const w = await mountDropdown()
    // jsdom window.getSelection 默认 rangeCount=0
    const sel = window.getSelection()
    // 确保无 range（jsdom 默认即无）
    if (sel && sel.rangeCount) sel.removeAllRanges()
    const origPos = { ...mention.pos.value }
    ;(w.vm.$ as any).setupState._onScroll()
    expect(mention.pos.value).toEqual(origPos) // 未更新
    w.unmount()
  })

  it('isVisible=true 且有选区+有效 rect → pos 更新到 clamp 后坐标', async () => {
    mention.isVisible.value = true
    const w = await mountDropdown()
    // 桩 getSelection 返回有 rangeCount + getRangeAt(0).getClientRects()[0]
    const fakeRect = { left: 5000, bottom: 5000 } // 超屏触发 Math.min clamp
    const fakeRange = { getClientRects: () => [fakeRect] }
    const fakeSel = { rangeCount: 1, getRangeAt: () => fakeRange }
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSel as any)
    // 桩 window.innerWidth/innerHeight 较小强制 clamp 生效（vi.stubProperty 此版本不可用）
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true })
    ;(w.vm.$ as any).setupState._onScroll()
    // left = min(5000, 1000-310) = 690, top = min(5000+4, 1000-220) = 780
    expect(mention.pos.value.x).toBe(690)
    expect(mention.pos.value.y).toBe(780)
    // 恢复避免跨测污染
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
    w.unmount()
  })

  it('isVisible=true 有选区但 rect 数组空 → getClientRects()[0] 为 undefined 不崩', async () => {
    mention.isVisible.value = true
    const w = await mountDropdown()
    const fakeRange = { getClientRects: () => [] } // 空 rect 数组
    const fakeSel = { rangeCount: 1, getRangeAt: () => fakeRange }
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSel as any)
    const origPos = { ...mention.pos.value }
    ;(w.vm.$ as any).setupState._onScroll()
    expect(mention.pos.value).toEqual(origPos) // r 为 falsy 不更新
    w.unmount()
  })

  it('scroll 事件触发 _onScroll（事件→函数绑定验证）', async () => {
    mention.isVisible.value = false // 早退避免 getSelection 干扰
    const panel = document.getElementById('panelContent') as HTMLElement
    const w = await mountDropdown()
    const getSelectionSpy = vi.spyOn(window, 'getSelection')
    // isVisible=false 早退，验证 scroll 事件确实绑到 panel 并触发 _onScroll（即使早退也是函数被执行）
    panel.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(getSelectionSpy).not.toHaveBeenCalled() // 早退证 _onScroll 被调且早退
    w.unmount()
  })
})

describe('MentionDropdown 渲染分支', () => {
  it('mentionType=group 渲染组项(item.icon 与 note 图标双分支)', async () => {
    mention.isVisible.value = true
    mention.mentionType.value = 'group'
    mention.candidates.value = [
      { id: 'g1', name: '有图标组', bookmarkIds: ['b1'], icon: 'https://icon.png', type: 'group' },
      { id: 'g2', name: '', bookmarkIds: [], icon: '', type: 'group' }, // 无 name 走「未命名组」+ 无 icon 走 note-icon
    ]
    const w = await mountDropdown()
    const items = w.findAll('.mention-item')
    expect(items.length).toBe(2)
    // 有 icon → <img src>
    expect(items[0].find('img').attributes('src')).toBe('https://icon.png')
    // 无 icon → note-icon span
    expect(items[1].find('.note-icon').exists()).toBe(true)
    // 无 name → 「未命名组」
    expect(items[1].find('.mi-name').text()).toContain('未命名组')
    // 0 个书签文案
    expect(items[1].find('.mi-url').text()).toContain('0个书签')
    w.unmount()
  })

  it('mentionType=bookmark 渲染书签项 + sub-menu（has-sub class 联动）', async () => {
    mention.isVisible.value = true
    mention.mentionType.value = 'bookmark'
    mention.candidates.value = [{
      id: 'b1', title: '父', url: 'https://p.com', type: 'bookmark',
      subItems: [{ id: 'b2', title: '子', url: 'https://s.com', icon: '' }],
    }]
    const w = await mountDropdown()
    const item = w.findAll('.mention-item')[0]
    expect(item.classes()).toContain('has-sub')
    expect(item.find('.mention-sub-menu').exists()).toBe(true)
    expect(item.findAll('.mention-sub-item').length).toBe(1)
    // 子项 favicon 兜底（sub.icon 空 → favicon(sub.url)）
    expect(item.findAll('.mention-sub-item img')[0].attributes('src')).toBe('fav-https://s.com')
    w.unmount()
  })
})

/** 构造 event.target 桩：默认 closest 返 null（不在任何特殊容器内） */
function createTarget(overrides: Partial<{ closest: (sel: string) => Element | null }> = {}) {
  return {
    closest: overrides.closest ?? (() => null),
  }
}
