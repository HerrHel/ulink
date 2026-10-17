/**
 * toggleDetailPanel 护栏（D1-84 / Option 2 AI 侧边栏与暂存搁架解耦）
 *
 * 来源 useUI.ts:
 *   export function toggleDetailPanel() {
 *     const ui = useUIStore()
 *     if (!ui.panels.detail) pushNavState()
 *     ui.panels.detail = !ui.panels.detail
 *   }
 *
 * 护栏锁定核心特性：
 *  1. A2-011 pushNavState 顺序敏感——仅「当前关、即将打开」时 push（让浏览器后退关闭面板）；
 *     「当前开、即将关闭」时不 push。
 *  2. 纯净 AI 侧边栏开合：仅切换 panels.detail，不篡改/不清空用户在底部暂存搁架内的 detailCards。
 *  3. 多次往返 toggle 状态翻转可靠。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'

const pushNavStateMock = vi.fn()
vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: (...args: unknown[]) => pushNavStateMock(...args),
}))

import { toggleDetailPanel } from '../../composables/ui/useUI.js'

beforeEach(() => {
  setActivePinia(createPinia())
  pushNavStateMock.mockReset()
})

describe('toggleDetailPanel — AI 助手侧边栏开/关 + A2-011 导航栈 push 顺序敏感护栏', () => {
  it('A：当前关 → pushNavState 调一次 + panels.detail 置 true', () => {
    const ui = useUIStore()
    ui.panels.detail = false

    toggleDetailPanel()

    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.panels.detail).toBe(true)
  })

  it('B：当前开 → pushNavState 不调 + panels.detail 置 false', () => {
    const ui = useUIStore()
    ui.panels.detail = true

    toggleDetailPanel()

    expect(pushNavStateMock).not.toHaveBeenCalled()
    expect(ui.panels.detail).toBe(false)
  })

  it('C：解耦保障：toggleDetailPanel 绝不清空 detailCards（保护底部暂存搁架内容）', () => {
    const ui = useUIStore()
    ui.panels.detail = false
    ui.detailCards.push('b1', 'b2')

    toggleDetailPanel()

    expect(ui.panels.detail).toBe(true)
    expect(ui.detailCards).toEqual(['b1', 'b2'])

    toggleDetailPanel()

    expect(ui.panels.detail).toBe(false)
    expect(ui.detailCards).toEqual(['b1', 'b2'])
  })

  it('D：A2-011 push 顺序敏感对照——关时 push / 开时不 push', () => {
    const ui = useUIStore()
    ui.panels.detail = false

    // 关 → 开（push 1 次）
    toggleDetailPanel()
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)

    // 开 → 关（不 push）
    toggleDetailPanel()
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)
    expect(ui.panels.detail).toBe(false)
  })

  it('E：连续 toggle 往返——关→开→关→开 两次 opening 各 push 一次', () => {
    const ui = useUIStore()
    ui.panels.detail = false

    toggleDetailPanel() // 关→开
    expect(ui.panels.detail).toBe(true)
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)

    toggleDetailPanel() // 开→关
    expect(ui.panels.detail).toBe(false)
    expect(pushNavStateMock).toHaveBeenCalledTimes(1)

    toggleDetailPanel() // 关→开
    expect(ui.panels.detail).toBe(true)
    expect(pushNavStateMock).toHaveBeenCalledTimes(2)
  })
})
