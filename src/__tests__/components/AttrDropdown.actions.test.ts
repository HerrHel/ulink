/**
 * AttrDropdown — 用户可见路径护栏（精简版）
 *
 * 原文件 28 例随 r9-attributed-dropdown-actions-guard 补入,多数锁的是 setup 私有闭包时序
 * (onDocumentClick capture 顺序、500ms 长按时序、onRenameAttr 三态分流等实现细节)——
 * 任何合理重构都会批量红,且属性筛选/动作的用户可见行为已被 attrFilter.test.ts(锁三函数)
 * 间接覆盖。此精简版只留 7 例用户可见路径:渲染、查询过滤、点主区筛选生效、移动端弹
 * actionSheet 分流、改名生效、删除确认生效/取消不删(数据安全契约)。
 *
 * 删去:onDocumentClick capture 四分支、onTouch 时序、showAttrActions 缺失早退、
 * onRenameAttr 空/同/取消三态镜像、onAddAttr 三分支、onToggleExclude 转调、
 * onDeleteAttr 缺失早退、filteredAttrs 空态等私有编排/镜像断言。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useAttrDropdownStore } from '../../stores/attrDropdown.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { useDataStore } from '../../stores/data.js'

// ── 周边模块 mock ──
const showConfirmMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => vi.fn())
const toggleAttrFilterMock = vi.hoisted(() => vi.fn())
const isMobileHolder = vi.hoisted(() => ({ fn: (): boolean => false }))

vi.mock('../../lib/toast.js', () => ({ showConfirm: showConfirmMock, toast: toastMock }))
vi.mock('../../composables/domain/useAttrFilter.js', () => ({
  toggleAttrFilter: toggleAttrFilterMock,
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

/** runAction：重放 actionSheet 注入的 action 闭包 */
function runAction(a: { action: string | (() => void) }): Promise<void> | void {
  if (typeof a.action === 'function') return a.action()
  throw new Error('action not a function')
}

function seedAttr(ds: ReturnType<typeof useDataStore>, id: string, name: string) {
  ds.addAttribute({ id, name, type: 'boolean' as const } as any)
  return id
}

async function mountOpen() {
  const w = mount(AttrDropdown, { attachTo: document.body })
  const attrDrp = useAttrDropdownStore()
  attrDrp.toggle()
  await nextTick()
  return { w, attrDrp }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
  showConfirmMock.mockReset()
  toastMock.mockReset()
  toggleAttrFilterMock.mockReset()
  isMobileHolder.fn = () => false
  vi.spyOn(window, 'prompt').mockReturnValue(null)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('AttrDropdown 用户可见路径护栏', () => {
  it('打开后渲染已注册属性列表', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    seedAttr(ds, 'a2', '后端')
    const { w } = await mountOpen()
    const items = w.element.querySelectorAll('.attr-drop-item')
    expect(items.length).toBe(2)
    expect(items[0].textContent).toContain('前端')
    expect(items[1].textContent).toContain('后端')
    w.unmount()
  })

  it('查询过滤：输入「前」仅命中含「前」的属性', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    seedAttr(ds, 'a2', '后端')
    const { w } = await mountOpen()
    const input = w.element.querySelector('#attrSearchInput') as HTMLInputElement
    input.value = '前'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(w.element.querySelectorAll('.attr-drop-item').length).toBe(1)
    expect(w.element.querySelector('.attr-drop-item')?.textContent).toContain('前端')
    w.unmount()
  })

  it('点主区转调筛选：click .attr-drop-main → toggleAttrFilter(attrId)', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    ;(w.element.querySelector('.attr-drop-main') as HTMLElement).click()
    await nextTick()
    expect(toggleAttrFilterMock).toHaveBeenCalledTimes(1)
    expect(toggleAttrFilterMock).toHaveBeenCalledWith('a1')
    w.unmount()
  })

  it('移动端 contextmenu 弹 actionSheet 而非 contextMenu', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const ctx = useContextMenuStore()
    const sheet = useActionSheetStore()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await nextTick()
    expect(ctx.open).toBe(false)
    expect(sheet.visible).toBe(true)
    expect(sheet.items.map(i => i.label)).toEqual(['重命名', '删除属性'])
    w.unmount()
  })

  it('重命名成功：prompt 返新名 → attributeMap 更新为新名', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    ;(window.prompt as any).mockReturnValue('后端')
    runAction(useActionSheetStore().items[0])
    await nextTick()
    expect(ds.attributeMap['a1'].name).toBe('后端')
    w.unmount()
  })

  it('删除确认取消：showConfirm 返 false → 不删属性', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    showConfirmMock.mockResolvedValue(false)
    await runAction(useActionSheetStore().items[1])
    await nextTick()
    expect(showConfirmMock).toHaveBeenCalledWith('删除属性「前端」？')
    expect(ds.attributeMap['a1'].deletedAt).toBeFalsy()
    w.unmount()
  })

  it('删除确认生效：showConfirm 返 true → deleteAttribute 软删', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    showConfirmMock.mockResolvedValue(true)
    await runAction(useActionSheetStore().items[1])
    await nextTick()
    expect(showConfirmMock).toHaveBeenCalledWith('删除属性「前端」？')
    expect(ds.attributeMap['a1'].deletedAt).toBeTruthy()
    w.unmount()
  })
})
