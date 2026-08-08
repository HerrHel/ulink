/**
 * DeadLinksPopover.setup 私有编排护栏测（精简版）
 *
 * 为什么这是真改善：DeadLinksPopover 是死链/被墙/未确认三 tab + 多选删除/忽略/单删/查看的编排组件。
 * setup 私有 function 全经模板 @click 触发、无对外 export,全测试目录零直接断言。本测锁住真契约:
 * A3-007「确认后才 close,取消保持面板与多选态」双分支、collectSubIds 父子联删、
 * toastWithUndo 撤销闭包循环 restoreBookmark、ignoreSelected 置 dead-link-ignored + deadList 排除、
 * switchTab 被墙分流、watch 重置 selectMode/selectedIds、unconfirmedList 读 verdict=inconclusive。
 *
 * 原文件 15 例,删去:deleteSelected disabled(selectedIds 空边界)、onSelect 非多选(被冒烟覆盖)、
 * onDelete @click.stop(.stop 边界)、toggleSelect 单行两次切换(Set 增删语义,被 toggleSelectAll 覆盖)。
 *
 * 触发.mount 整组件 → store.overlays.deadLinks 驱动 watch 触发 visible/selectMode 重置 → 点按钮 DOM
 * 间接触发私有闭包。showConfirm 返 Promise 受控 true/false 隔离确认/取消两分支;toastWithUndo(msg,undoFn)
 * 把 undoFn 闭包显式入参,mock 拨走重放后调 undoFn 验「撤销闭包循环 restoreBookmark」契约。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, DOMWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

const showConfirmMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => vi.fn())
const toastWithUndoMock = vi.hoisted(() => vi.fn())
const openBmModalMock = vi.hoisted(() => vi.fn())
const deleteBookmarkWithUndoMock = vi.hoisted(() => vi.fn())
const saveAppDataMock = vi.hoisted(() => vi.fn())
const debouncedSaveAppDataMock = vi.hoisted(() => vi.fn())
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
  // 返同一 holder 引用,每测可按需覆写 results 值,组件 computed for...in 重读最新值
  useDeadLinkChecker: () => ({ results: dlResultsHolder.results }),
}))
vi.mock('../../stores/app.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../stores/app.js')>()
  return { ...actual, saveAppData: saveAppDataMock, debouncedSaveAppData: debouncedSaveAppDataMock }
})

import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import DeadLinksPopover from '../../components/overlays/DeadLinksPopover.vue'

interface BmPartial { id: string; title?: string; url?: string; parentId?: string | null; attributes?: Record<string, boolean>; categoryId?: string; order?: number }

function seedBm(ds: ReturnType<typeof useDataStore>, p: BmPartial) {
  ds.addBookmark({
    id: p.id, title: p.title ?? 't', url: p.url ?? 'https://example.com', username: '', password: '',
    notes: '', icon: '', categoryId: p.categoryId ?? CAT_UNCATEGORIZED, parentId: p.parentId ?? null,
    order: p.order ?? 0, useCount: 0, attributes: p.attributes ?? {}, isExpanded: false,
    createdAt: 1, updatedAt: 2,
  } as any)
  return p.id
}

/** 配置 showConfirm/toastWithUndo mock:confirm true=确认/false=取消;toastWithUndo 拨走 undoFn */
function setupToastSpies(confirmResult: boolean = true) {
  showConfirmMock.mockResolvedValue(confirmResult)
  toastWithUndoMock.mockImplementation((_msg: string, undoFn: () => void) => { (toastWithUndoMock as any)._lastUndo = undoFn })
}

async function mountComp(open = true) {
  const store = useAppStore()
  const w = mount(DeadLinksPopover, { attachTo: document.body })
  if (open) { store.overlays.deadLinks = true; await nextTick() }
  return { w, store }
}

/** 按 title 找模板按钮(title 是稳定锚点) */
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

describe('DeadLinksPopover.setup 私有编排护栏', () => {

  it('冒烟:mount + 打开 popover 后 dead tab 显示死链条目', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-d', title: '死链甲', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    const tabDead = w.element.querySelector('.popover-tab')
    expect(tabDead?.textContent).toContain('失效')
    expect(tabDead?.textContent).toContain('1')
    expect(w.element.querySelectorAll('.popover-result').length).toBe(1)
    w.unmount()
  })

  it('deleteSelected 确认分支:collectSubIds 父子三代联删 + saveAppData + close + toastWithUndo', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'p', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'c', parentId: 'p', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'g', parentId: 'c', attributes: { 'dead-link': true } })
    const { w, store } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    ;(w.element.querySelector('.popover-result') as HTMLElement).click()
    await nextTick()
    findByTitle(w, '删除选中')!.trigger('click')
    await nextTick()
    expect(showConfirmMock).toHaveBeenCalledWith(`确认删除 1 个书签？`)
    await nextTick()
    // 父子三代全软删
    expect(ds.bookmarks.filter(b => b.id === 'p')[0].deletedAt).toBeTruthy()
    expect(ds.bookmarks.filter(b => b.id === 'c')[0].deletedAt).toBeTruthy()
    expect(ds.bookmarks.filter(b => b.id === 'g')[0].deletedAt).toBeTruthy()
    expect(saveAppDataMock).toHaveBeenCalledTimes(1)
    expect(store.overlays.deadLinks).toBe(false)
    expect(toastWithUndoMock).toHaveBeenCalledTimes(1)
    expect(toastWithUndoMock.mock.calls[0][0]).toBe('已删除 1 个书签')
    w.unmount()
  })

  it('deleteSelected A3-007 取消分支:showConfirm=false → 不删/不 save/不 close/不 toast/多选态保持', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'p', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'c', parentId: 'p', attributes: { 'dead-link': true } })
    setupToastSpies(false) // 确认弹窗取消
    const { w, store } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    ;(w.element.querySelector('.popover-result') as HTMLElement).click()
    await nextTick()
    findByTitle(w, '删除选中')!.trigger('click')
    await nextTick()
    expect(showConfirmMock).toHaveBeenCalledWith(`确认删除 1 个书签？`)
    // 不删不存不关
    expect(ds.bookmarks.filter(b => b.id === 'p')[0].deletedAt).toBeFalsy()
    expect(saveAppDataMock).not.toHaveBeenCalled()
    expect(store.overlays.deadLinks).toBe(true)
    expect(toastWithUndoMock).not.toHaveBeenCalled()
    // 多选态保持——删除按钮仍在
    expect(findByTitle(w, '删除选中')).not.toBeNull()
    w.unmount()
  })

  it('deleteSelected 撤销闭包:重放 toastWithUndo 捕获的 undoFn → 循环 restoreBookmark 三代 + debouncedSaveAppData + toast(已恢复)', async () => {
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
    const undoFn = (toastWithUndoMock as any)._lastUndo as (() => void) | undefined
    expect(undoFn).toBeTypeOf('function')
    expect(ds.bookmarks.find(b => b.id === 'p')!.deletedAt).toBeTruthy()
    undoFn!() // 重放撤销闭包
    // 撤销闭包循环 restoreBookmark 三代全清 deletedAt
    expect(ds.bookmarks.find(b => b.id === 'p')!.deletedAt).toBeFalsy()
    expect(ds.bookmarks.find(b => b.id === 'c')!.deletedAt).toBeFalsy()
    expect(ds.bookmarks.find(b => b.id === 'g')!.deletedAt).toBeFalsy()
    expect(debouncedSaveAppDataMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('已恢复')
    w.unmount()
  })

  it('ignoreSelected:全选后置 dead-link-ignored:true + debouncedSaveAppData + toast + selectedIds 复位 + deadList 排除已忽略', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'keep', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'ignore-me', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    expect(w.element.querySelectorAll('.popover-result').length).toBe(2)
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    // 只选 ignore-me（第二行）
    const rows = w.element.querySelectorAll('.popover-result')
    ;(rows[1] as HTMLElement).click()
    await nextTick()
    findByTitle(w, '标记忽略')!.trigger('click')
    await nextTick()
    expect(ds.bookmarks.find(b => b.id === 'ignore-me')!.attributes!['dead-link-ignored']).toBe(true)
    // dead-link flag 仍保留（不互斥,只置 ignored）
    expect(ds.bookmarks.find(b => b.id === 'ignore-me')!.attributes!['dead-link']).toBe(true)
    expect(debouncedSaveAppDataMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('已标记忽略 1 个链接')
    // deadList 过滤后只剩 keep 一项
    expect(w.element.querySelectorAll('.popover-result').length).toBe(1)
    // selectedIds 复位 + 退出多选
    expect(findByTitle(w, '多选')).not.toBeNull()
    expect(findByTitle(w, '删除选中')).toBeNull()
    w.unmount()
  })

  it('toggleSelectAll:全选→取消全选回到 0 选 + 删除按钮 enabled/disabled 跟随', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'a', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'b', attributes: { 'dead-link': true } })
    const { w } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    expect(findByTitle(w, '全选')).not.toBeNull()
    findByTitle(w, '全选')!.trigger('click')
    await nextTick()
    expect(findByTitle(w, '取消全选')).not.toBeNull()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(2)
    expect((w.element.querySelector('button[title="删除选中"]') as HTMLButtonElement).disabled).toBe(false)
    findByTitle(w, '取消全选')!.trigger('click')
    await nextTick()
    expect(findByTitle(w, '全选')).not.toBeNull()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(0)
    w.unmount()
  })

  it('switchTab:被墙项存在时切 blocked tab 显示 blockedList badge=被墙', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'd1', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'b1', attributes: { 'gfw-blocked': true } })
    const { w } = await mountComp()
    expect(w.element.querySelectorAll('.popover-tab').length).toBe(2)
    const tabs = w.element.querySelectorAll('.popover-tab')
    ;(tabs[1] as HTMLElement).click()
    await nextTick()
    expect(w.element.querySelector('.pr-badge.blocked')).not.toBeNull()
    expect((w.element.querySelector('.pr-badge') as HTMLElement)?.textContent).toContain('被墙')
    w.unmount()
  })

  it('watch 重置:close→open 后 selectMode/selectedIds 强制复位（watch 覆盖脏态）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'd1', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'd2', attributes: { 'dead-link': true } })
    const { w, store } = await mountComp()
    findByTitle(w, '多选')!.trigger('click')
    await nextTick()
    findByTitle(w, '全选')!.trigger('click')
    await nextTick()
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(2)
    store.overlays.deadLinks = false
    await nextTick()
    store.overlays.deadLinks = true
    await nextTick()
    expect(findByTitle(w, '多选')).not.toBeNull() // 「多选」按钮回归说明已退出多选
    expect(w.element.querySelectorAll('.pr-checkbox.checked').length).toBe(0)
    w.unmount()
  })

  it('unconfirmedList:读 deadLinkChecker.results 中 verdict=inconclusive 的项（非 inconclusive 被排除）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'u-1', title: '未确认项', url: 'https://u1.com', attributes: {} })
    seedBm(ds, { id: 'a-1', title: '活着项', url: 'https://a1.com', attributes: {} })
    dlResultsHolder.results = {
      'u-1': { verdict: 'inconclusive' },
      'a-1': { verdict: 'alive' },
    }
    const { w } = await mountComp()
    expect(w.element.querySelectorAll('.popover-result').length).toBe(1)
    expect((w.element.querySelector('.pr-name') as HTMLElement)?.textContent).toContain('未确认项')
    expect(w.element.querySelector('.pr-badge.unconfirmed')).not.toBeNull()
    w.unmount()
  })
})
