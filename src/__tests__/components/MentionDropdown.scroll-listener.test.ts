/**
 * 真 bug 复现：MentionDropdown scroll 监听泄漏——卸载时按 id 重查 #panelContent
 *
 * 原实现 onMounted 用 `getElementById('panelContent').addEventListener('scroll', ...)`
 * 注册，onUnmounted 又 `getElementById('panelContent').removeEventListener(...)` 卸载。
 * 若挂载与卸载之间 #panelContent 被 DOM 重建（聚焦态分支切、容器 key 变化），
 * 卸载时重查拿到新元素或 null，挂载时绑在「旧元素」上的 scroll 监听无人移除，
 * 泄漏到死元素上继续触发读 window.getSelection() 的位置更新。
 *
 * 修复：onMounted 缓存拿到的元素引用到 _scrollEl，onUnmounted 用同一引用解绑。
 * 此测锁定「旧元素上的 scroll 监听确实被移除」这一新行为，mock 掉 useMention
 * 整条依赖链（本测只验证监听生命周期配对，不测 mention 编排）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// mock useMention 整模块：模板渲染需 isVisible/candidates/activeIdx/activeSubIdx/
// mentionType/pos，交互需 selectBookmark/selectGroupRef/onTrigger/onInput/onKeydown。
// 给空实现即可——本测只验证 scroll 监听生命周期，不触发 mention 编排逻辑。
vi.mock('../../composables/domain/useMention.js', () => ({
  useMention: () => ({
    isVisible: { value: false },
    candidates: { value: [] },
    activeIdx: { value: 0 },
    activeSubIdx: { value: 0 },
    mentionType: { value: 'bookmark' },
    pos: { value: { x: 0, y: 0 } },
    selectBookmark: vi.fn(),
    selectGroupRef: vi.fn(),
    onTrigger: vi.fn(),
    onInput: vi.fn(),
    onKeydown: vi.fn(),
  }),
}))

// mock icons + utils 纯展示，避免拉真实 utils 依赖
vi.mock('../../config/icons.js', () => ({ I: { note: '<svg/>' } }))
vi.mock('../../utils.js', () => ({ favicon: () => '', domain: () => '' }))

import MentionDropdown from '../../components/overlays/MentionDropdown.vue'

describe('MentionDropdown scroll 监听生命周期——卸载时按缓存引用解绑（防泄漏）', () => {
  beforeEach(() => {
    // 每测提供一个 #panelContent 在 DOM 中
    document.body.innerHTML = '<div id="panelContent"></div>'
  })

  it('onMounted 缓存元素引用，unmount 时对同一引用 removeEventListener（基础配对）', async () => {
    const panel = document.getElementById('panelContent') as HTMLElement
    const removeSpy = vi.spyOn(panel, 'removeEventListener')
    const wrapper = mount(MentionDropdown)
    await nextTick()
    // 卸载
    wrapper.unmount()
    // 旧元素上的 scroll 监听一定被移除过
    const scrollUnbind = removeSpy.mock.calls.find(c => c[0] === 'scroll')
    expect(scrollUnbind).toBeTruthy()
    expect(scrollUnbind![1]).toBeTypeOf('function')
  })

  it('★真 bug 复现：卸载前 #panelContent 被替换重建，旧元素上的 scroll 监听仍被移除', async () => {
    // 旧实现：卸载重查 getElementById 拿到新元素，对旧元素的 removeEventListener 永不执行 → 泄漏。
    // 新实现：onMounted 缓存旧引用，卸载用同一引用解绑，旧元素监听被正确移除。
    const oldPanel = document.getElementById('panelContent') as HTMLElement
    const oldRemoveSpy = vi.spyOn(oldPanel, 'removeEventListener')
    const oldAddSpy = vi.spyOn(oldPanel, 'addEventListener')

    const wrapper = mount(MentionDropdown)
    await nextTick()
    // 挂载时绑在旧元素
    const oldAdd = oldAddSpy.mock.calls.find(c => c[0] === 'scroll')
    expect(oldAdd).toBeTruthy() // 确认旧元素被绑了 scroll

    // 模拟 panelContent 重建：旧元素从 DOM 摘除，新元素顶上同 id
    oldPanel.id = '' // 旧元素不再占用 panelContent id
    const newPanel = document.createElement('div')
    newPanel.id = 'panelContent'
    document.body.appendChild(newPanel)
    const newRemoveSpy = vi.spyOn(newPanel, 'removeEventListener')

    // 卸载——此刻 getElementById('panelContent') 返回的是 newPanel，不是 oldPanel
    wrapper.unmount()

    // 旧元素上的 scroll 监听必须被移除（修复后用缓存引用而非重查）
    const oldScrollUnbind = oldRemoveSpy.mock.calls.find(c => c[0] === 'scroll')
    expect(oldScrollUnbind).toBeTruthy()
    // 新元素不该被无端解绑（它从未被绑过）——排除「重查到新元素误解绑新元素」的反作用
    const newScrollUnbind = newRemoveSpy.mock.calls.find(c => c[0] === 'scroll')
    expect(newScrollUnbind).toBeFalsy()
  })
})
