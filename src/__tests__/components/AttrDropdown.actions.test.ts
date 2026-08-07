/**
 * AttrDropdown.setup 私有编排护栏测（chunk #22 r9-attributed-dropdown-actions-guard）
 *
 * 为什么这是真改善：AttrDropdown 是属性筛选/排除/新建/重命名/删除的下拉编排组件。setup 私有
 * function onToggleFilter(L57)/onToggleExclude(L61)/onAddAttr(L65)/onDocumentClick(L76, capture
 * document click 四分支早退)/onItemContext(L94 桌面 contextMenu vs 移动 actionSheet 二分)/
 * onTouchStart(L103 500ms 长按)/onTouchEnd(L112 fired 抑制 click + 清定时器)/onTouchMove(L118 取消)/
 * showAttrActions(L123 缺失早退 + 注入重命名/删除闭包)/onRenameAttr(L132 prompt 四分支)/
 * onDeleteAttr(L143 confirm 三分支) 全经模板 @click/@contextmenu/@touchstart 触发、无对外 export，
 * 全测试目录零直接断言。本测锁住这些不变量：误改 onDocumentClick capture order/contains 早退顺序、
 * 误回退 500ms 长按时序、移动端 contextmenu 应弹 actionSheet 而非 contextMenu、showAttrActions
 * 缺失属性早退、onRenameAttr 空名/同名/取消三态分流、onDeleteAttr confirm 取消不删——立即红灯。
 *
 * 模块级 _longPressTimer/_longPressFired/_touchStartId（L90-92）跨实例共享是真实隐患——本测用
 * fake timers + beforeEach clearAllTimers 隔离并如实捕获现状。
 *
 * 触发方式：袭 chunk #21 DeadLinksPopover 思路——setup 私有 function 无 export，但经模板事件挂监听。
 * mount 整 .vue 组件 → attrDrp.toggle() open=true → nextTick → 找 DOM 元素 click/contextmenu/
 * touchstart/End/Move 间接触发私有闭包。fake timers 控 500ms 长按时序；window.prompt 用
 * vi.spyOn 控重命名输入分支；showConfirm mockResolvedValue 控删除确认/取消两分支；
 * actionSheet.items 真版可读，从注入的 action fn 重放调 onRenameAttr/onDeleteAttr 闭包验契约。
 *
 * mock 策略：toast.js(showConfirm/toast) 整模块 mock——showConfirm 返 Promise 受控、toast 断言文案。
 * useAttrFilter.js(toggleAttrFilter/toggleAttrExclude/addAttrQuick) 整模块 mock 拦截断言调用契约
 * （三函数本身已有 attrFilter.test.ts 护栏，本测只验 AttrDropdown 转调边界）。persist.js 整模块
 * mock——saveData 返 Promise.resolve(true) 让 store.save() 经 app.ts Zod 校验走通不炸真 IDB，
 * passthrough 零落盘副作用。utils.js(isMobile) 用持有者控值范式袭 useLongPress.test.ts——
 * `isMobileHolder.fn = () => true/false` 每测控桌面/移动二分。app.js 保留真版（store.customAttributes/
 * attributeMap/save() 路径经 persist mock 走通）；data store 真版 pinia + seed customAttribute
 * 灌 attributeMap/customAttributes 供 filteredAttrs 渲染 + showAttrActions/onRenameAttr 命中。
 * actionSheet/contextMenu/attrDropdown store 真版（无 init 副作用）。
 *
 * mock 路径解析：组件在 src/components/overlays/ import `'../../stores/app.js'`→src/stores/app.js、
 * `'../../composables/domain/useAttrFilter.js'`→src/composables/domain/useAttrFilter.js、
 * `'../../lib/toast.js'`→src/lib/toast.js、`'../../utils.js'`→src/utils.js、
 * app.js 内部 import `'./persist.js'`→src/stores/persist.js。测试文件在 src/__tests__/components/
 * 必须写同相对路径 `'../../...'`→解析到同绝对路径（袭 DeadLinksPopover/useScrollHeader mock 路径
 * 血教训）。app.ts 真版 import persist 是 `'./persist.js'`（同目录），测试 mock persist 写
 * `'../../stores/persist.js'` 解析到同 src/stores/persist.js 才 match 生效。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useAttrDropdownStore } from '../../stores/attrDropdown.js'
import { useActionSheetStore } from '../../stores/actionSheet.js'
import { useContextMenuStore } from '../../stores/contextMenu.js'
import { useDataStore } from '../../stores/data.js'

// ── 周边模块 mock（AttrDropdown 不真跑 toast/useAttrFilter/persist/isMobile）──
const showConfirmMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => vi.fn())
const toggleAttrFilterMock = vi.hoisted(() => vi.fn())
const toggleAttrExcludeMock = vi.hoisted(() => vi.fn())
const addAttrQuickMock = vi.hoisted(() => vi.fn())
// isMobile 持有者控值范式（袭 useLongPress.test.ts）
const isMobileHolder = vi.hoisted(() => ({ fn: (): boolean => false }))

vi.mock('../../lib/toast.js', () => ({
  showConfirm: showConfirmMock,
  toast: toastMock,
}))

vi.mock('../../composables/domain/useAttrFilter.js', () => ({
  toggleAttrFilter: toggleAttrFilterMock,
  toggleAttrExclude: toggleAttrExcludeMock,
  addAttrQuick: addAttrQuickMock,
}))

// persist.js 整模块 mock：saveData passthrough 让 store.save() 经 app.ts 真 Zod 校验走通不炸真 IDB
vi.mock('../../stores/persist.js', () => ({
  saveData: () => Promise.resolve(true),
  saveToLocalStorage: vi.fn(),
  loadFromLocalStorage: vi.fn(),
  getStorageInfo: vi.fn(),
}))

vi.mock('../../utils.js', () => ({
  isMobile: () => isMobileHolder.fn(),
}))

import AttrDropdown from '../../components/overlays/AttrDropdown.vue'

/** 重放 actionSheet 注入的 action 闭包——ActionItem.action 是 `string | (() => void)` 联合，组件注入的必为函数，用类型守卫窄化 */
function runAction(a: { action: string | (() => void) }): Promise<void> | void {
  if (typeof a.action === 'function') return a.action()
  throw new Error('action not a function')
}

/** 灌一个自定义属性进真 dataStore（袭 DeadLinksPopover seedBm 范式，customAttribute 合法 schema） */
function seedAttr(ds: ReturnType<typeof useDataStore>, id: string, name: string) {
  ds.addAttribute({ id, name, type: 'boolean' as const } as any)
  return id
}

/** mount AttrDropdown 并打开：attrDrp.toggle() 设 open=true 后 nextTick 让 v-show=true 渲染列表 */
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
  toggleAttrExcludeMock.mockReset()
  addAttrQuickMock.mockReset()
  vi.clearAllTimers()
  isMobileHolder.fn = () => false // 默认桌面端
  // window.prompt spy 每测重置（默认返 null 表示取消）
  vi.spyOn(window, 'prompt').mockReturnValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('AttrDropdown.setup 私有编排护栏 (onToggleFilter/onToggleExclude/onAddAttr + onDocumentClick + onItemContext 二分 + 长按时序 + showAttrActions/onRenameAttr/onDeleteAttr)', () => {

  it('冒烟：mount 整 .vue 组件 + 打开后列表渲染 seed 的属性，无挂载异常', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    seedAttr(ds, 'a2', '后端')
    const { w } = await mountOpen()
    expect(w.element.querySelectorAll('.attr-drop-item').length).toBe(2)
    const items = w.element.querySelectorAll('.attr-drop-item')
    expect(items[0].textContent).toContain('前端')
    expect(items[1].textContent).toContain('后端')
    w.unmount()
  })

  // ── filteredAttrs 查询 ──

  it('filteredAttrs：query 过滤 customAttributes（小写 indexOf 命中），空查询全量', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    seedAttr(ds, 'a2', 'Frontend')
    const { w } = await mountOpen()
    // 全量 2 项
    expect(w.element.querySelectorAll('.attr-drop-item').length).toBe(2)
    // 输框 query 模糊匹配「前」→ 仅命中「前端」（indexOf 小写）
    const input = w.element.querySelector('#attrSearchInput') as HTMLInputElement
    input.value = '前'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(w.element.querySelectorAll('.attr-drop-item').length).toBe(1)
    expect(w.element.querySelector('.attr-drop-item')?.textContent).toContain('前端')
    w.unmount()
  })

  it('filteredAttrs：无匹配显示「无匹配属性」空态', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const input = w.element.querySelector('#attrSearchInput') as HTMLInputElement
    input.value = '不存在的属性'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(w.element.querySelectorAll('.attr-drop-item').length).toBe(0)
    expect(w.element.querySelector('.drop-empty')).not.toBeNull()
    expect(w.element.querySelector('.drop-empty')?.textContent).toContain('无匹配属性')
    w.unmount()
  })

  // ── onToggleFilter / onToggleExclude 转调契约 ──

  it('onToggleFilter：点 .attr-drop-main span 转调 toggleAttrFilter(attrId)', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const main = w.element.querySelector('.attr-drop-main') as HTMLElement
    main.click()
    await nextTick()
    expect(toggleAttrFilterMock).toHaveBeenCalledTimes(1)
    expect(toggleAttrFilterMock).toHaveBeenCalledWith('a1')
    w.unmount()
  })

  it('onToggleExclude：点 .attr-drop-exclude button 转调 toggleAttrExclude(attrId)', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const excludeBtn = w.element.querySelector('.attr-drop-exclude') as HTMLButtonElement
    excludeBtn.click()
    await nextTick()
    expect(toggleAttrExcludeMock).toHaveBeenCalledTimes(1)
    expect(toggleAttrExcludeMock).toHaveBeenCalledWith('a1')
    w.unmount()
  })

  // ── onAddAttr 三分支 ──

  it('onAddAttr 空名分支：query 为空时 return，不调 addAttrQuick 不 toast', async () => {
    const { w } = await mountOpen()
    const addBtn = w.element.querySelector('button[title="新建属性"]') as HTMLButtonElement
    addBtn.click()
    await nextTick()
    expect(addAttrQuickMock).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('onAddAttr 成功分支：addAttrQuick 返 true → toast(属性已添加) + query 清空', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    addAttrQuickMock.mockReturnValue(true)
    const input = w.element.querySelector('#attrSearchInput') as HTMLInputElement
    input.value = '新属性'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    ;(w.element.querySelector('button[title="新建属性"]') as HTMLButtonElement).click()
    await nextTick()
    expect(addAttrQuickMock).toHaveBeenCalledTimes(1)
    expect(addAttrQuickMock).toHaveBeenCalledWith('新属性')
    expect(toastMock).toHaveBeenCalledWith('属性已添加')
    expect(input.value).toBe('')
    w.unmount()
  })

  it('onAddAttr 已存在分支：addAttrQuick 返 false → toast(属性已存在, false) + query 保留', async () => {
    const { w } = await mountOpen()
    addAttrQuickMock.mockReturnValue(false)
    const input = w.element.querySelector('#attrSearchInput') as HTMLInputElement
    input.value = '重名'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    ;(w.element.querySelector('button[title="新建属性"]') as HTMLButtonElement).click()
    await nextTick()
    expect(addAttrQuickMock).toHaveBeenCalledWith('重名')
    expect(toastMock).toHaveBeenCalledWith('属性已存在', false)
    expect(input.value).toBe('重名')
    w.unmount()
  })

  // ── onDocumentClick capture 四分支（点 dropdown 内/点 toggleBtn/open=false/点外部→close）──

  it('onDocumentClick open=false 早退：attrDrp 未开时点外部不触发 close（守卫 !attrDrp.open 先于 contains）', async () => {
    const attrDrp = useAttrDropdownStore()
    const w = mount(AttrDropdown, { attachTo: document.body }) // 不 toggle，open=false
    await nextTick()
    expect(attrDrp.open).toBe(false)
    // 派原生 click 到 body（capture 阶段触发 onDocumentClick）
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    // close 不会把 open 从 false 翻成 true（守卫已 return）
    expect(attrDrp.open).toBe(false)
    w.unmount()
  })

  it('onDocumentClick 点 dropdown 内部不 close：contains(target) 早退', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w, attrDrp } = await mountOpen()
    expect(attrDrp.open).toBe(true)
    // 点 dropdown 内部（.attr-drop-main span）
    const main = w.element.querySelector('.attr-drop-main') as HTMLElement
    // 注意：组件根 .attr-dropdown 有 @click.stop，但 onDocumentClick 在 capture 阶段先于 @click.stop
    // 派原生 click 由 capture 阶段触发 onDocumentClick，contains 命中后 return
    main.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(attrDrp.open).toBe(true) // 未 close
    w.unmount()
  })

  it('onDocumentClick 点 toggleBtn(btnAttrFilter) 不 close：toggleBtn.contains(target) 早退', async () => {
    const { w, attrDrp } = await mountOpen()
    // 准备一个伪 btnAttrFilter 元素挂到 DOM 模拟 toggleBtn
    const btn = document.createElement('button')
    btn.id = 'btnAttrFilter'
    document.body.appendChild(btn)
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(attrDrp.open).toBe(true) // 未 close
    w.unmount()
  })

  it('onDocumentClick 点外部 → close：dropdown.contains/toggleBtn.contains 都不命中时 attrDrp.close()', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w, attrDrp } = await mountOpen()
    expect(attrDrp.open).toBe(true)
    // point external (body 直接区域非 dropdown 非 toggleBtn)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(attrDrp.open).toBe(false) // close
    w.unmount()
  })

  // ── onItemContext 桌面/移动二分 ──

  it('onItemContext 桌面端：isMobile=false → useContextMenuStore().show(e, "attr", attrId)', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => false
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    const ev = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 })
    item.dispatchEvent(ev)
    await nextTick()
    const ctx = useContextMenuStore()
    expect(ctx.open).toBe(true)
    expect(ctx.type).toBe('attr')
    expect(ctx.id).toBe('a1')
    expect(ctx.x).toBe(100)
    expect(ctx.y).toBe(200)
    w.unmount()
  })

  it('onItemContext 移动端：isMobile=true → showAttrActions(actionSheet) 而非 contextMenu', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const ctx = useContextMenuStore()
    const sheet = useActionSheetStore()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }))
    await nextTick()
    expect(ctx.open).toBe(false) // 移动端不弹 contextMenu
    expect(sheet.visible).toBe(true) // 弹 actionSheet
    expect(sheet.mode).toBe('actions')
    expect(sheet.items.map(i => i.label)).toEqual(['重命名', '删除属性'])
    expect(sheet.items[1].danger).toBe(true)
    w.unmount()
  })

  // ── onTouchStart/End 500ms 长按时序 ──

  it('onTouchStart → 500ms 未到不弹 sheet；到 500ms fired=true + showAttrActions(actionSheet)', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true // showAttrActions 走 actionSheet 分支不挑 isMobile，统一更稳
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [{}] as any }))
    // 499ms 未到
    vi.advanceTimersByTime(499)
    const sheet = useActionSheetStore()
    expect(sheet.visible).toBe(false)
    // 到 500ms
    vi.advanceTimersByTime(1)
    expect(sheet.visible).toBe(true)
    expect(sheet.items.map(i => i.label)).toEqual(['重命名', '删除属性'])
    w.unmount()
  })

  it('onTouchEnd：500ms 前抬手 clearTimeout → 不弹 sheet；fired=false 不 preventDefault', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [{}] as any }))
    vi.advanceTimersByTime(200)
    // 抬手
    const pev = new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] as any })
    const spyPreventDefault = vi.spyOn(pev, 'preventDefault')
    item.dispatchEvent(pev)
    vi.advanceTimersByTime(500) // 500ms 即便过了也不再触发
    const sheet = useActionSheetStore()
    expect(sheet.visible).toBe(false)
    expect(spyPreventDefault).not.toHaveBeenCalled() // fired=false 不 suppress
    w.unmount()
  })

  it('onTouchEnd：500ms 后抬手 fired=true → preventDefault + 清 fired', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [{}] as any }))
    vi.advanceTimersByTime(500)
    const sheet = useActionSheetStore()
    expect(sheet.visible).toBe(true)
    // 抬手（fired=true 应 preventDefault）
    const pev = new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] as any })
    const spyPreventDefault = vi.spyOn(pev, 'preventDefault')
    item.dispatchEvent(pev)
    expect(spyPreventDefault).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('onTouchMove：移动 > clearTimeout 取消长按，后续 500ms 不触发 sheet', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [{}] as any }))
    vi.advanceTimersByTime(300)
    item.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [{}] as any }))
    vi.advanceTimersByTime(500) // 即使再过 500ms
    const sheet = useActionSheetStore()
    expect(sheet.visible).toBe(false)
    w.unmount()
  })

  // ── showAttrActions / onDeleteAttr 缺失早退（attr 不在 attributeMap）──
  //
  // 现实语义：data.ts deleteAttribute 是软删（置 deletedAt，customAttributes 仍含带 deletedAt 的项、
  // _attrMap[id] 仍指向它），attributeMap getter 遍历 customAttributes 不过滤软删——故软删后
  // attributeMap[id] 仍命中、attr 非空，showAttrActions/onDeleteAttr 的 `if (!attr) return` 守卫不触发。
  // 测此守卫须构造 attributeMap[id] 真返 undefined 的悬空场景：seed 后触发 contextmenu 捕获 attrId
  // 闭包，再硬清空 customAttributes + _attrMap 模拟 attr 从 map 彻底消失（防御代码的可达路径）。

  it('showAttrActions 缺失早退：attrId 已不在 attributeMap 时不弹 actionSheet（防注入闭包引用悬空 attr）', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    expect(item).not.toBeNull()
    item.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [{}] as any }))
    // 触发后硬清空 customAttributes + _attrMap，让 500ms 闭包重放时 attributeMap['a1'] 返 undefined
    ;(ds as any).customAttributes = []
    ;(ds as any)._attrMap = {}
    await nextTick()
    vi.advanceTimersByTime(500)
    const sheet = useActionSheetStore()
    expect(sheet.visible).toBe(false) // attr 缺失早退，不弹 sheet
    w.unmount()
  })

  // ── showAttrActions 注入闭包重放 onRenameAttr/onDeleteAttr ──

  it('showAttrActions 注入重命名闭包：重放 item[0].action → onRenameAttr 入口', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    const sheet = useActionSheetStore()
    // 重放重命名闭包（onRenameAttr 读 store.attributeMap + window.prompt）
    ;(window.prompt as any).mockReturnValue('新名字')
    runAction(sheet.items[0])
    await nextTick()
    expect(ds.attributeMap['a1'].name).toBe('新名字')
    w.unmount()
  })

  it('showAttrActions 注入删除闭包：重放 item[1].action → onDeleteAttr confirm=true → deleteAttribute + save', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    const sheet = useActionSheetStore()
    showConfirmMock.mockResolvedValue(true)
    await runAction(sheet.items[1])
    await nextTick()
    expect(ds.attributeMap['a1'].deletedAt).toBeTruthy()
    w.unmount()
  })

  // ── onRenameAttr 四分支（prompt 取消/空名/同名/改名成功）──

  it('onRenameAttr 取消分支：window.prompt 返 null → 不 rename 不 save', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    ;(window.prompt as any).mockReturnValue(null)
    runAction(useActionSheetStore().items[0])
    await nextTick()
    expect(ds.attributeMap['a1'].name).toBe('前端') // 未改
    w.unmount()
  })

  it('onRenameAttr 空名分支：prompt 返 "  "（trim 空）→ 不 rename 不 save', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    ;(window.prompt as any).mockReturnValue('   ')
    runAction(useActionSheetStore().items[0])
    await nextTick()
    expect(ds.attributeMap['a1'].name).toBe('前端')
    w.unmount()
  })

  it('onRenameAttr 同名分支：prompt 返与原名相同 → 不 rename 不 save', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    ;(window.prompt as any).mockReturnValue('前端')
    runAction(useActionSheetStore().items[0])
    await nextTick()
    expect(ds.attributeMap['a1'].name).toBe('前端')
    w.unmount()
  })

  it('onRenameAttr 成功分支：prompt 返新名 → dataStore.renameAttribute + store.save()', async () => {
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

  // ── onDeleteAttr 三分支（attr 缺失/confirm 取消/confirm 确认）──

  it('onDeleteAttr 缺失早退：attrId 已不在 attributeMap 时不调 showConfirm 不删', async () => {
    const ds = useDataStore()
    seedAttr(ds, 'a1', '前端')
    const { w } = await mountOpen()
    isMobileHolder.fn = () => true
    // 先拿 items 闭包（attrId='a1' 已硬编码到 capture 时刻）
    const item = w.element.querySelector('.attr-drop-item') as HTMLElement
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    const sheet = useActionSheetStore()
    // 硬清空 customAttributes + _attrMap 模拟 attributeMap['a1'] 返 undefined 的悬空场景
    ;(ds as any).customAttributes = []
    ;(ds as any)._attrMap = {}
    await nextTick()
    await runAction(sheet.items[1])
    expect(showConfirmMock).not.toHaveBeenCalled() // attr 缺失早退，showConfirm 前已 return
    w.unmount()
  })

  it('onDeleteAttr 取消分支：showConfirm 返 false → 不 delete 不 save', async () => {
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
    expect(ds.attributeMap['a1'].deletedAt).toBeFalsy() // 未删
    w.unmount()
  })

  it('onDeleteAttr 确认分支：showConfirm 返 true → deleteAttribute + store.save()', async () => {
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
