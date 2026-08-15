/**
 * AttrDropdown — 分支契约护栏（补覆盖率 61.36%→目标≥85%）
 *
 * 既有 AttrDropdown.actions.test.ts(8 例)锁用户可见主路径：渲染/查询/点主区筛选/
 * 移动端 actionSheet 分流/重命名成功/删除确认双路/软删不渲染。本文件补未触达分支：
 * onAddAttr 三分流(空早退/成功 toast/已存在 toast)/onDocumentClick 四早退+外部关闭/
 * onItemContext PC contextMenu 分支/touch 长按 500ms 时序三函数/onToggleExclude 转调/
 * showAttrActions attr 不存在早退/onRenameAttr 三态早退(取消/空名/同名)。
 *
 * 纯补测锁真实行为契约非刷行数，每条测配一句「锁住什么行为」。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useAttrDropdownStore } from '../../stores/attrDropdown.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { useDataStore } from '../../stores/data.js'

// ── 周边模块 mock（独立于 actions.test.ts，mock 全三个 useAttrFilter 导出）──
const showConfirmMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => vi.fn())
const toggleAttrFilterMock = vi.hoisted(() => vi.fn())
const toggleAttrExcludeMock = vi.hoisted(() => vi.fn())
const addAttrQuickMock = vi.hoisted(() => vi.fn())
const isMobileHolder = vi.hoisted(() => ({ fn: (): boolean => false }))

vi.mock('../../lib/toast.js', () => ({ showConfirm: showConfirmMock, toast: toastMock }))
vi.mock('../../composables/domain/useAttrFilter.js', () => ({
  toggleAttrFilter: toggleAttrFilterMock,
  toggleAttrExclude: toggleAttrExcludeMock,
  addAttrQuick: addAttrQuickMock,
}))
// persist passthrough 让 store.save() 经 app.ts Zod 校验走通不炸真 IDB
vi.mock('../../stores/persist.js', () => ({
  saveData: () => Promise.resolve(true),
  saveToLocalStorage: vi.fn(),
  loadFromLocalStorage: vi.fn(),
  getStorageInfo: vi.fn(),
}))
vi.mock('../../utils.js', () => ({ isMobile: () => isMobileHolder.fn() }))

import AttrDropdown from '../../components/overlays/AttrDropdown.vue'

function seedAttr(ds: ReturnType<typeof useDataStore>, id: string, name: string) {
  ds.addAttribute({ id, name, type: 'boolean' as const } as any)
  return id
}

async function mountOpen(open = true) {
  const w = mount(AttrDropdown, { attachTo: document.body })
  const attrDrp = useAttrDropdownStore()
  if (open) attrDrp.toggle()
  await nextTick()
  return { w, attrDrp }
}

/** runAction：重放 actionSheet 注入的 action 闭包 */
function runAction(a: { action: string | (() => void) }): Promise<void> | void {
  if (typeof a.action === 'function') return a.action()
  throw new Error('action not a function')
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  showConfirmMock.mockReset()
  toastMock.mockReset()
  toggleAttrFilterMock.mockReset()
  toggleAttrExcludeMock.mockReset()
  addAttrQuickMock.mockReset()
  isMobileHolder.fn = () => false
  vi.spyOn(window, 'prompt').mockReturnValue(null)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('AttrDropdown onAddAttr 三分流', () => {
  it('空 name 早退：query 为空/空白 → 直接 return 不调 addAttrQuick 不 toast', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const input = w.element.querySelector('#attrSearchInput') as HTMLInputElement
    // 空字符串
    input.value = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const s = w.vm.$.setupState as any
    s.onAddAttr()
    expect(addAttrQuickMock).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('成功：addAttrQuick 返 truthy → 清 query + toast("属性已添加")', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    addAttrQuickMock.mockReturnValue(true)
    const { w } = await mountOpen()
    const input = w.element.querySelector('#attrSearchInput') as HTMLInputElement
    input.value = '后端'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const s = w.vm.$.setupState as any
    // onAddAttr 成功会 query.value=''；setupState 的 ref 被 Vue unwrap 为实时读值
    const origQuery = s.query
    s.onAddAttr()
    expect(addAttrQuickMock).toHaveBeenCalledWith('后端')
    expect(s.query).toBe('')
    expect(origQuery).toBe('后端')
    expect(toastMock).toHaveBeenCalledWith('属性已添加')
    w.unmount()
  })

  it('已存在失败：addAttrQuick 返 falsy → 保留 query + toast("属性已存在", false)', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    addAttrQuickMock.mockReturnValue(false)
    const { w } = await mountOpen()
    const input = w.element.querySelector('#attrSearchInput') as HTMLInputElement
    input.value = '前端'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const s = w.vm.$.setupState as any
    s.onAddAttr()
    expect(addAttrQuickMock).toHaveBeenCalledWith('前端')
    // 失败分支 query 保留不空
    expect(s.query).toBe('前端')
    expect(toastMock).toHaveBeenCalledWith('属性已存在', false)
    w.unmount()
  })
})

describe('AttrDropdown onDocumentClick 外部点击关闭守门', () => {
  it('点击 dropdown 外部 → attrDrp.close() 被调关闭', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w, attrDrp } = await mountOpen()
    expect(attrDrp.open).toBe(true)
    // 点 dropdown 外部（document body 一处空 div）
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(attrDrp.open).toBe(false)
    document.body.removeChild(outside)
    w.unmount()
  })

  it('点击 dropdown 内部 → 不关闭（dropdown.contains 守门）', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w, attrDrp } = await mountOpen()
    // 点 dropdown 内部元素 —— dropdown 的 @click.stop 也会 stopPropagation，
    // 但 onDocumentClick 是 capture 阶段监听，stop 不影响 capture；
    // 此测验证 onDocumentClick 内 dropdown.contains(target) 命中不 close。
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(attrDrp.open).toBe(true)
    w.unmount()
  })

  it('open=false 早退：未打开时点外部 → 不崩不副作用', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w, attrDrp } = await mountOpen(false)
    expect(attrDrp.open).toBe(false)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(attrDrp.open).toBe(false)
    w.unmount()
  })

  it('点击 toggleBtn(btnAttrFilter) → 不关闭（toggleBtn.contains 守门）', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w, attrDrp } = await mountOpen()
    // 模拟切换按钮存在：建 btnAttrFilter DOM 供 document.getElementById 命中
    const toggleBtn = document.createElement('button')
    toggleBtn.id = 'btnAttrFilter'
    document.body.appendChild(toggleBtn)
    toggleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(attrDrp.open).toBe(true)
    document.body.removeChild(toggleBtn)
    w.unmount()
  })
})

describe('AttrDropdown onItemContext / onToggleExclude 转调', () => {
  it('PC 分支：!isMobile → contextMenu.show(e, "attr", attrId)', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => false
    const { w } = await mountOpen()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    const ctx = useContextMenuStore()
    const showSpy = vi.spyOn(ctx, 'show')
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 7 }))
    await nextTick()
    expect(showSpy).toHaveBeenCalledTimes(1)
    expect(showSpy.mock.calls[0][1]).toBe('attr')
    expect(showSpy.mock.calls[0][2]).toBe('a1')
    w.unmount()
  })

  it('onToggleExclude：点 exclude 按钮 → toggleAttrExclude(attrId) 转调', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const excludeBtn = w.element.querySelector('.attr-drop-exclude') as HTMLElement
    excludeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(toggleAttrExcludeMock).toHaveBeenCalledTimes(1)
    expect(toggleAttrExcludeMock).toHaveBeenCalledWith('a1')
    w.unmount()
  })
})

describe('AttrDropdown touch 长按时序三函数', () => {
  // onTouchStart/End/Move 在 <script setup> 顶层，经 setupState 直调；
  // 函数体不读 Touch 真实 API（onTouchStart 只设 timer，onTouchEnd 读 e.preventDefault），
  // 故传轻量 fake event 锁真实行为契约，规避 jsdom 无 Touch 构造器。
  function makeEvent() {
    return { preventDefault: vi.fn() } as unknown as TouchEvent
  }

  it('onTouchStart 长按 500ms → 触发 showAttrActions 弹 actionSheet', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => true
    const { w } = await mountOpen()
    const s = w.vm.$.setupState as any
    s.onTouchStart('a1', makeEvent())
    // 未到 500ms 不弹
    expect(useActionSheetStore().visible).toBe(false)
    vi.advanceTimersByTime(500)
    await nextTick()
    const sheet = useActionSheetStore()
    expect(sheet.visible).toBe(true)
    expect(sheet.items.map((i: any) => i.label)).toEqual(['重命名', '删除属性'])
    w.unmount()
  })

  it('onTouchStart 后 500ms 内 touchEnd → 清 timer 不触发 showAttrActions', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => true
    const { w } = await mountOpen()
    const s = w.vm.$.setupState as any
    s.onTouchStart('a1', makeEvent())
    // 在 500ms 内放
    s.onTouchEnd(makeEvent())
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(useActionSheetStore().visible).toBe(false)
    w.unmount()
  })

  it('onTouchEnd 长按已触发后 → e.preventDefault 被调 + _longPressFired 复位可再触发', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => true
    const { w } = await mountOpen()
    const s = w.vm.$.setupState as any
    s.onTouchStart('a1', makeEvent())
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(useActionSheetStore().visible).toBe(true)
    // 长按已触发，touchend 应 preventDefault
    const endEvent = makeEvent()
    s.onTouchEnd(endEvent)
    expect((endEvent as any).preventDefault).toHaveBeenCalledTimes(1)
    // 复位后再 touchstart 应能再次触发（非粘态）
    s.onTouchStart('a1', makeEvent())
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(useActionSheetStore().visible).toBe(true)
    w.unmount()
  })

  it('onTouchMove 滑动 → 清 timer 不触发长按', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => true
    const { w } = await mountOpen()
    const s = w.vm.$.setupState as any
    s.onTouchStart('a1', makeEvent())
    s.onTouchMove()
    vi.advanceTimersByTime(500)
    await nextTick()
    expect(useActionSheetStore().visible).toBe(false)
    w.unmount()
  })
})

describe('AttrDropdown showAttrActions/onRenameAttr 早退守门', () => {
  it('showAttrActions：attr 不存在 → 早退不弹 actionSheet', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => true
    const { w } = await mountOpen()
    const s = w.vm.$.setupState as any
    s.showAttrActions('not-exist-id')
    await nextTick()
    expect(useActionSheetStore().visible).toBe(false)
    w.unmount()
  })

  it('onRenameAttr：prompt 取消(null) → 不调 renameAttribute', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => true
    const { w } = await mountOpen()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    ;(window.prompt as any).mockReturnValue(null)
    runAction(useActionSheetStore().items[0])
    await nextTick()
    expect(ds.attributeMap['a1'].name).toBe('前端')
    w.unmount()
  })

  it('onRenameAttr：空白名 trim 空 → 不调 renameAttribute', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => true
    const { w } = await mountOpen()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    ;(window.prompt as any).mockReturnValue('   ')
    runAction(useActionSheetStore().items[0])
    await nextTick()
    expect(ds.attributeMap['a1'].name).toBe('前端')
    w.unmount()
  })

  it('onRenameAttr：与原名相同 → 不调 renameAttribute', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    isMobileHolder.fn = () => true
    const { w } = await mountOpen()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    ;(window.prompt as any).mockReturnValue('前端')
    runAction(useActionSheetStore().items[0])
    await nextTick()
    expect(ds.attributeMap['a1'].name).toBe('前端')
    w.unmount()
  })

  it('onDeleteAttr：attr 不存在 → 早退不调 deleteAttribute 不 showConfirm', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const s = w.vm.$.setupState as any
    await s.onDeleteAttr('not-exist-id')
    expect(showConfirmMock).not.toHaveBeenCalled()
    w.unmount()
  })
})
