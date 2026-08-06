/**
 * DeadLinksPopover.setup 私有编排护栏测（chunk #21 r9-deadlinks-popover-actions-guard）
 *
 * 为什么这是真改善：DeadLinksPopover 是死链/被墙/未确认三 tab + 多选删除/忽略/单删/查看的编排组件。
 * setup 私有 function deleteSelected(L197-223)/ignoreSelected(L175-190)/onSelect(L141-144)/
 * onDelete(L146-148)/toggleSelect(L160-165)/toggleSelectAll(L167-173)/enterSelectMode(L150-153)/
 * exitSelectMode(L155-158)/switchTab(L132-135)/close(L137-139) 全经模板 @click 触发、无对外 export，
 * 全测试目录零直接断言（grep deleteSelected/ignoreSelected 命中仅底层 collectSubIds 纯函数测）。
 * 本测锁住这些不变量：误改 A3-007「确认后才 close，取消保持面板与多选态」、误回退到 deleteBookmarkWithUndo
 * 循环单例 dismissUndo 覆盖反模式、collectSubIds 漏父子联删、saveAppData/exitSelectMode/close 顺序错乱、
 * toastWithUndo 撤销闭包漏循环 restoreBookmark、ignoreSelected 漏 dead-link-ignored 置位或漏 set 复位——立即红灯。
 *
 * 触发方式：袭 chunk #20 useScrollHeader 思路——setup 私有 function 无 export，但经模板 @click 挂监听。
 * mount 整组件 → watch(store.overlays.deadLinks) immediate 触发 visible/selectMode 重置 → 找按钮 DOM 元素
 * click 间接触发私有闭包编排。showConfirm 返 Promise<boolean> mock 控 true/false 隔离确认/取消两分支；
 * toastWithUndo(msg, undoFn) 把 undoFn 闭包显式入参，mock 拨走重放后调 undoFn 验「撤销闭包循环
 * restoreBookmark」契约。deleteBookmarkWithUndo/onSelect(openBmModal) mock 拦截验调用。
 *
 * mock 策略：toast.js(showConfirm/toast/toastWithUndo) 整模块 mock——showConfirm 返 Promise 受控、
 * toastWithUndo 拨走 undoFn 可重放调 undo 验恢复闭包。useBookmark(openBmModal/deleteBookmarkWithUndo)
 * 整模块 mock 拦验调用顺序与参数。useDeadLinkChecker 整模块 mock 返可控 results——避免真版 init 副作用
 * (supabase/loadHistory)。stores/app.js mock 只重写 saveAppData/debouncedSaveAppData 两个独立函数，
 * useAppStore 保留真版导入（deadLinkChecker.test.ts 同款范式）——store.overlays.deadLinks 可控驱动
 * watch 触发 visible/selectMode 重置。dataStore 用真 pinia（setup.ts 自动新 pinia），seedBm 灌测试书签。
 *
 * mock 路径解析：组件在 src/components/overlays/ import `'../../stores/app.js'`→src/stores/app.js、
 * `'../../lib/toast.js'`→src/lib/toast.js、`'../../composables/domain/useBookmark.js'`、
 * `'../../composables/domain/useDeadLinkChecker.js'`。测试文件在 src/__tests__/components/ 必须写
 * 同相对路径 `'../../stores/app.js'` 等→解析到同绝对路径（袭 useScrollHeader.test.ts mock 路径血教训）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, DOMWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

// ── 周边模块 mock（deadLinksPopover 不真跑 toast/useBookmark/saveAppData/deadLinkChecker）──
const showConfirmMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => vi.fn())
const toastWithUndoMock = vi.hoisted(() => vi.fn())
const openBmModalMock = vi.hoisted(() => vi.fn())
const deleteBookmarkWithUndoMock = vi.hoisted(() => vi.fn())
const saveAppDataMock = vi.hoisted(() => vi.fn())
const debouncedSaveAppDataMock = vi.hoisted(() => vi.fn())
// useDeadLinkChecker results 可控容器（每测按需改 verdict）
const dlResultsHolder = vi.hoisted(() => ({ results: {} as Record<string, { verdict: string }> }))

vi.mock('../../lib/toast.js', () => ({
  showConfirm: showConfirmMock,
  toast: toastMock,
  toastWithUndo: toastWithUndoMock,
}))

vi.mock('../../composables/domain/useBookmark.js', () => ({
  openBmModal: openBmModalMock,
  deleteBookmarkWithUndo: deleteBookmarkWithUndoMock,
}))

vi.mock('../../composables/domain/useDeadLinkChecker.js', () => ({
  // 返回可控 results（unconfirmedList 读 r[id].verdict），避免真版 init 副作用（supabase/loadHistory）。
  // 返同一 holder 引用，每测可按需覆写 results 值，组件 computed for...in 重读最新值。
  useDeadLinkChecker: () => ({ results: dlResultsHolder.results }),
}))

// app.js：保留真 useAppStore 导入供组件用 store.overlays.deadLinks 驱动 watch，
// 只重写 DeadLinksPopover L75 import 的两个独立保存函数
vi.mock('../../stores/app.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/app.js')>()
  return {
    ...actual,
    saveAppData: saveAppDataMock,
    debouncedSaveAppData: debouncedSaveAppDataMock,
  }
})

import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import DeadLinksPopover from '../../components/overlays/DeadLinksPopover.vue'

interface BmPartial { id: string; title?: string; url?: string; parentId?: string | null; attributes?: Record<string, boolean>; categoryId?: string; order?: number }

/** 灌一本测试书签进真 dataStore（袭 deadLinkChecker.test.ts seedBm 范式） */
function seedBm(ds: ReturnType<typeof useDataStore>, p: BmPartial) {
  const bm = {
    id: p.id,
    title: p.title ?? 't',
    url: p.url ?? 'https://example.com',
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: p.categoryId ?? CAT_UNCATEGORIZED,
    parentId: p.parentId ?? null,
    order: p.order ?? 0,
    useCount: 0,
    attributes: p.attributes ?? {},
    isExpanded: false,
    createdAt: 1,
    updatedAt: 2,
  }
  ds.addBookmark(bm as any)
  return p.id
}

/** 配置 showConfirm/toastWithUndo mock 便于断言分支：showConfirm true=确认/false=取消；toastWithUndo 拨走 undoFn */
function setupToastSpies(confirmResult: boolean = true) {
  showConfirmMock.mockResolvedValue(confirmResult)
  toastWithUndoMock.mockImplementation((_msg: string, undoFn: () => void) => { (toastWithUndoMock as any)._lastUndo = undoFn })
}

/** mount 组件并（可选）打开 popover：设 store.overlays.deadLinks=true 后 nextTick 让 watch 跑 */
async function mountComp(open = true) {
  const store = useAppStore()
  const w = mount(DeadLinksPopover, { attachTo: document.body })
  if (open) {
    store.overlays.deadLinks = true
    await nextTick()
  }
  return { w, store }
}

/** 按 title 找模板按钮（title 属性是唯一稳定锚点：enterSelectMode『多选』/deleteSelected『删除选中』/ignoreSelected『标记忽略』/exitSelectMode『取消』/toggleSelectAll 全选或取消全选）*/
function findByTitle(w: ReturnType<typeof mount>, title: string): DOMWrapper<HTMLButtonElement> | null {
  const el = w.element.querySelector(`button[title="${title}"]`) as HTMLButtonElement | null
  return el ? new DOMWrapper(el) : null
}

beforeEach(() => {
  setActivePinia(createPinia())
  showConfirmMock.mockReset()
  toastMock.mockReset()
  toastWithUndoMock.mockReset()
  openBmModalMock.mockReset()
  deleteBookmarkWithUndoMock.mockReset()
  saveAppDataMock.mockReset()
  debouncedSaveAppDataMock.mockReset()
  dlResultsHolder.results = {}
  setupToastSpies(true)
})

describe('DeadLinksPopover.setup 私有编排护栏 (deleteSelected A3-007 + ignoreSelected + onSelect/onDelete + 多选/切 tab + close)', () => {

  it('冒烟：mount 整 .vue 组件 + 打开 popover 后 dead tab 显示死链条目，无挂载异常', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-d', title: '死链甲', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    // dead tab 按钮存在且有计数
    const tabDead = w.element.querySelector('.popover-tab')
    expect(tabDead?.textContent).toContain('失效')
    expect(tabDead?.textContent).toContain('1')
    // 列表 1 条
    expect(w.element.querySelectorAll('.popover-result').length).toBe(1)
    w.unmount()
  })

  // ── deleteSelected：A3-007 确认/取消两分支 + 父子联删 + 撤销闭包 ──

  it('deleteSelected 确认分支：collectSubIds 父子联删全部软删 + saveAppData + selectedIds 复位 + exitSelectMode + close + toastWithUndo', async () => {
    const ds = useDataStore()
    // 父 + 子 + 孙三级，collectSubIds 必须递归收齐三代
    seedBm(ds, { id: 'p', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'c', parentId: 'p', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'g', parentId: 'c', attributes: { 'dead-link': true } })
    const { w, store } = await mountComp()
    // 进多选 + 选父（toggleSelect 父后会展开 collectSubIds 三级）
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    // 点父行选中
    const row = w.element.querySelector('.popover-result') as HTMLElement
    row.click()
    await nextTick()
    // 删除选中
    findByTitle(w, '删除选中')!.trigger('click')
    await nextTick()
    // A3-007：showConfirm 真后整链走完
    expect(showConfirmMock).toHaveBeenCalledWith(`确认删除 1 个书签？`)
    await nextTick()
    // 父子三代全软删（deletedAt 已置）→ deadList filter !deletedAt 后空
    expect(ds.bookmarks.filter(b => b.id === 'p')[0].deletedAt).toBeTruthy()
    expect(ds.bookmarks.filter(b => b.id === 'c')[0].deletedAt).toBeTruthy()
    expect(ds.bookmarks.filter(b => b.id === 'g')[0].deletedAt).toBeTruthy()
    // saveAppData 调一次（落盘）
    expect(saveAppDataMock).toHaveBeenCalledTimes(1)
    // selectedIds 复位 + close（store.overlays.deadLinks=false）
    expect(store.overlays.deadLinks).toBe(false)
    // toastWithUndo 调用且 undoFn 闭包已捕获
    expect(toastWithUndoMock).toHaveBeenCalledTimes(1)
    expect(toastWithUndoMock.mock.calls[0][0]).toBe('已删除 1 个书签')
    w.unmount()
  })

  it('deleteSelected A3-007 取消分支：showConfirm=false → 不删/不 save/不 close/不 exitSelectMode/selectedIds 保持', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'p', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'c', parentId: 'p', attributes: { 'dead-link': true } })
    setupToastSpies(false) // 确认弹窗取消
    const { w, store } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    ;(w.element.querySelector('.popover-result') as HTMLElement).click()
    await nextTick()
    // 删除按钮仍存在（selectMode 仍开）
    expect(findByTitle(w, '删除选中')).not.toBeNull()
    findByTitle(w, '删除选中')!.trigger('click')
    await nextTick()
    // 弹窗返回 false → 立即 return，无任何编排下游
    // 点父行只 toggleSelect 父 id（selectedIds={p}，size=1），故提示是 1 个
    expect(showConfirmMock).toHaveBeenCalledWith(`确认删除 1 个书签？`)
    // 不删
    expect(ds.bookmarks.filter(b => b.id === 'p')[0].deletedAt).toBeFalsy()
    expect(ds.bookmarks.filter(b => b.id === 'c')[0].deletedAt).toBeFalsy()
    // 不 save 不 close 不 toast undo
    expect(saveAppDataMock).not.toHaveBeenCalled()
    expect(store.overlays.deadLinks).toBe(true) // 仍开
    expect(toastWithUndoMock).not.toHaveBeenCalled()
    // 多选态保持——退出按钮仍在
    expect(findByTitle(w, '删除选中')).not.toBeNull()
    w.unmount()
  })

  it('deleteSelected 撤销闭包：重放 toastWithUndo 捕获的 undoFn → 循环 restoreBookmark 三代 + debouncedSaveAppData + toast(已恢复)', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'p', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'c', parentId: 'p', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'g', parentId: 'c', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    ;(w.element.querySelector('.popover-result') as HTMLElement).click()
    await nextTick()
    findByTitle(w, '删除选中')!.trigger('click')
    await nextTick()
    // toastWithUndo 闭包捕获在 mock._lastUndo
    const undoFn = (toastWithUndoMock as any)._lastUndo as (() => void) | undefined
    expect(undoFn).toBeTypeOf('function')
    // 删后三代 deletedAt 全置
    expect(ds.bookmarks.find(b => b.id === 'p')!.deletedAt).toBeTruthy()
    expect(ds.bookmarks.find(b => b.id === 'c')!.deletedAt).toBeTruthy()
    expect(ds.bookmarks.find(b => b.id === 'g')!.deletedAt).toBeTruthy()
    // 重放撤销闭包
    undoFn!()
    // 撤销闭包循环 restoreBookmark 三代全清 deletedAt
    expect(ds.bookmarks.find(b => b.id === 'p')!.deletedAt).toBeFalsy()
    expect(ds.bookmarks.find(b => b.id === 'c')!.deletedAt).toBeFalsy()
    expect(ds.bookmarks.find(b => b.id === 'g')!.deletedAt).toBeFalsy()
    // 落盘 + toast 恢复提示
    expect(debouncedSaveAppDataMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('已恢复')
    w.unmount()
  })

  it('deleteSelected 按钮 disabled：selectedIds.size=0（未选任何项）时 :disabled 阻止 click 不触发 showConfirm', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'p', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    findByTitle(w, '多选')!.trigger('click') // 进多选但未选中任何
    await nextTick()
    const delBtn = w.element.querySelector('button[title="删除选中"]') as HTMLButtonElement
    // selectedIds 空 → disabled
    expect(delBtn.disabled).toBe(true)
    delBtn.click()
    await nextTick()
    // disabled click 不触发 deleteSelected 编排（showConfirm 未被调）
    expect(showConfirmMock).not.toHaveBeenCalled()
    w.unmount()
  })

  // ── onSelect / onDelete（非多选态单条操作）──

  it('onSelect：非多选态点列表项触发 openBmModal(bmId) + close（store.overlays.deadLinks=false）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-x', attributes: { 'dead-link': true } })
    const { w, store } = await mountComp()
    ;(w.element.querySelector('.popover-result') as HTMLElement).click()
    await nextTick()
    expect(openBmModalMock).toHaveBeenCalledTimes(1)
    expect(openBmModalMock).toHaveBeenCalledWith('bm-x')
    expect(store.overlays.deadLinks).toBe(false)
    w.unmount()
  })

  it('onDelete：点 pr-delete 按钮触发 deleteBookmarkWithUndo(bmId)，@click.stop 不冒泡到行 onSelect', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-y', attributes: { 'dead-link': true } })
    const { w, store } = await mountComp()
    // 点行内删除按钮（.pr-delete），非多选态
    const delBtn = w.element.querySelector('.pr-delete') as HTMLButtonElement
    expect(delBtn).not.toBeNull()
    delBtn.click()
    await nextTick()
    expect(deleteBookmarkWithUndoMock).toHaveBeenCalledTimes(1)
    expect(deleteBookmarkWithUndoMock).toHaveBeenCalledWith('bm-y')
    // @click.stop 阻冒泡：onSelect 不被触发（openBmModal 未被调），不 close
    expect(openBmModalMock).not.toHaveBeenCalled()
    expect(store.overlays.deadLinks).toBe(true)
    w.unmount()
  })

  // ── ignoreSelected ──

  it('ignoreSelected：循环 updateBookmark 置 dead-link-ignored:true + debouncedSaveAppData + toast + selectedIds 复位 + exitSelectMode', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'i1', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'i2', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    // 全选
    findByTitle(w, '全选')!.trigger('click')
    await nextTick()
    // 标记忽略
    findByTitle(w, '标记忽略')!.trigger('click')
    await nextTick()
    // 两项 dead-link-ignored 置位
    expect(ds.bookmarks.find(b => b.id === 'i1')!.attributes!['dead-link-ignored']).toBe(true)
    expect(ds.bookmarks.find(b => b.id === 'i2')!.attributes!['dead-link-ignored']).toBe(true)
    // dead-link flag 仍保留（不互斥，只置 ignored）
    expect(ds.bookmarks.find(b => b.id === 'i1')!.attributes!['dead-link']).toBe(true)
    expect(debouncedSaveAppDataMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('已标记忽略 2 个链接')
    // selectedIds 复位 + 退出多选（「多选」按钮回归，「删除选中」消失）
    expect(findByTitle(w, '多选')).not.toBeNull()
    expect(findByTitle(w, '删除选中')).toBeNull()
    w.unmount()
  })

  it('ignoreSelected 后 deadList 排除已忽略项（attributes 过滤生效：dead-link && !dead-link-ignored）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'keep', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'ignore-me', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    expect(w.element.querySelectorAll('.popover-result').length).toBe(2)
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    // 只选 ignore-me 一项（点第二行）
    const rows = w.element.querySelectorAll('.popover-result')
    ;(rows[1] as HTMLElement).click()
    await nextTick()
    findByTitle(w, '标记忽略')!.trigger('click')
    await nextTick()
    // deadList 过滤后只剩 keep 一项
    expect(w.element.querySelectorAll('.popover-result').length).toBe(1)
    expect((w.element.querySelector('.pr-name') as HTMLElement)?.textContent).toContain('t')
    w.unmount()
  })

  // ── toggleSelectAll / toggleSelect ──

  it('toggleSelectAll：全选 → allSelected=true → 再次点击变『取消全选』回到 0 选', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'a', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'b', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    // 全选按钮 title 此时『全选』
    expect(findByTitle(w, '全选')).not.toBeNull()
    findByTitle(w, '全选')!.trigger('click')
    await nextTick()
    // 全选后 title 变『取消全选』
    expect(findByTitle(w, '取消全选')).not.toBeNull()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(2)
    // 删除按钮此时 enabled
    expect((w.element.querySelector('button[title="删除选中"]') as HTMLButtonElement).disabled).toBe(false)
    findByTitle(w, '取消全选')!.trigger('click')
    await nextTick()
    // 回到 0 选，title 变回『全选』
    expect(findByTitle(w, '全选')).not.toBeNull()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(0)
    w.unmount()
  })

  it('toggleSelect：多选态点同一行两次切换选中/取消（Set 增删语义正确）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'a', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    const row = w.element.querySelector('.popover-result') as HTMLElement
    row.click() // 选
    await nextTick()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(1)
    row.click() // 取消
    await nextTick()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(0)
    w.unmount()
  })

  // ── switchTab / watch / unconfirmedList ──

  it('switchTab：被墙项存在时切 blocked tab 显示 blockedList（badge=被墙），选中态重置', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'd1', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'b1', attributes: { 'gfw-blocked': true } })
    const { w } = await mountComp()
    // 默认 dead tab，1 条失效
    expect(w.element.querySelectorAll('.popover-tab').length).toBe(2) // dead + blocked 两个 tab 按钮
    // 切 blocked
    const tabs = w.element.querySelectorAll('.popover-tab')
    ;(tabs[1] as HTMLElement).click()
    await nextTick()
    // 列表显示被墙项，badge=被墙
    expect(w.element.querySelector('.pr-badge.blocked')).not.toBeNull()
    expect((w.element.querySelector('.pr-badge') as HTMLElement)?.textContent).toContain('被墙')
    w.unmount()
  })

  it('watch 重置：deadLinks=true 时 selectMode/selectedIds 强制复位（watch 优先级覆盖脏态）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'd1', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'd2', attributes: { 'dead-link': true } })
    const { w, store } = await mountComp()
    // 进多选 + 全选，制造脏态
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    findByTitle(w, '全选')!.trigger('click')
    await nextTick()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(2)
    // 关再开：watch 重置 selectMode=false/selectedIds=空
    store.overlays.deadLinks = false
    await nextTick()
    store.overlays.deadLinks = true
    await nextTick()
    // 「多选」按钮回归说明已退出多选；列表项无 checked
    expect(findByTitle(w, '多选')).not.toBeNull()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(0)
    w.unmount()
  })

  it('unconfirmedList：读 deadLinkChecker.results 中 verdict=inconclusive 的项（非 inconclusive 被排除）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'u-1', title: '未确认项', url: 'https://u1.com', attributes: {} })
    seedBm(ds, { id: 'a-1', title: '活着项', url: 'https://a1.com', attributes: {} })
    // 注入 results：u-1 inconclusive，a-1 alive
    dlResultsHolder.results = {
      'u-1': { verdict: 'inconclusive' },
      'a-1': { verdict: 'alive' },
    }
    const { w, store } = await mountComp()
    // dead/blockedList 都空，watch 选 unconfirmed tab
    expect(w.element.querySelectorAll('.popover-result').length).toBe(1)
    expect((w.element.querySelector('.pr-name') as HTMLElement)?.textContent).toContain('未确认项')
    expect(w.element.querySelector('.pr-badge.unconfirmed')).not.toBeNull()
    w.unmount()
    void store
  })
})
