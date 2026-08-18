/**
 * TrashPanel 回收站多选 — 用户可见路径护栏
 * 覆盖:4 类已删项渲染、勾选计数/高亮、全选/取消全选、批量恢复、
 * 批量永久删除(confirm 取消不删 = 数据安全契约)、脏 key(行内操作后计数降)、关闭重开重置。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'

// ── 周边模块 mock ──
const showConfirmMock = vi.hoisted(() => vi.fn())
const toastMock = vi.hoisted(() => vi.fn())

vi.mock('../../lib/toast.js', () => ({ showConfirm: showConfirmMock, toast: toastMock }))
// persist passthrough 让 appStore.save() 经 Zod 校验走通不炸真 IDB
vi.mock('../../stores/persist.js', () => ({
  saveData: () => Promise.resolve(true),
  saveToLocalStorage: vi.fn(),
  loadFromLocalStorage: vi.fn(),
  getStorageInfo: vi.fn(),
}))

import TrashPanel from '../../components/modals/TrashPanel.vue'

/** seeding:2 书签 + 2 组 + 1 分类 + 1 属性,全部软删进回收站 */
function seedTrash(ds: ReturnType<typeof useDataStore>) {
  ds.addBookmark({ id: 'b1', title: '书签一', url: 'https://a.com' } as any)
  ds.addBookmark({ id: 'b2', title: '书签二', url: 'https://b.com' } as any)
  ds.deleteBookmark('b1')
  ds.deleteBookmark('b2')
  ds.addGroup({ id: 'g1', name: '组一', bookmarkIds: [] } as any)
  ds.addGroup({ id: 'g2', name: '组二', bookmarkIds: [] } as any)
  ds.deleteGroup('g1')
  ds.deleteGroup('g2')
  ds.addCategory({ id: 'c1', name: '分类一' } as any)
  ds.deleteCategory('c1')
  ds.addAttribute({ id: 'a1', name: '属性一', type: 'boolean' } as any)
  ds.deleteAttribute('a1')
}

async function mountOpen() {
  const w = mount(TrashPanel, { props: { open: true }, attachTo: document.body })
  await nextTick()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  showConfirmMock.mockReset()
  toastMock.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('TrashPanel 多选', () => {
  it('渲染 4 类已删项,每行有 checkbox', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    const items = w.findAll('.trash-item')
    expect(items.length).toBe(6)
    expect(w.findAll('.trash-item-check').length).toBe(6)
    expect(w.findAll('.trash-section').length).toBe(4)
    // 批量条常驻(有回收站内容时),清空按钮可用;底部批量按钮初始禁用
    expect(w.find('.trash-batch').exists()).toBe(true)
    expect(w.find('.trash-batch-actions .btn').attributes('disabled')).toBeUndefined()
    expect(w.findAll('.modal-foot .btn').length).toBe(2)
    expect(w.findAll('.modal-foot .btn')[0].attributes('disabled')).toBeDefined()
    expect(w.findAll('.modal-foot .btn')[1].attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('勾选 1 项 → 计数「已选 1 项」+ 行高亮', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    await w.findAll('.trash-item-check')[0].trigger('change')
    await nextTick()
    expect(w.find('.trash-batch-count').text()).toContain('已选 1 项')
    expect(w.findAll('.trash-item')[0].classes()).toContain('trash-item-selected')
    expect(w.findAll('.trash-item')[1].classes()).not.toContain('trash-item-selected')
    w.unmount()
  })

  it('全选 → 全部 checked;再点 → 取消全选', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    const allChk = w.find('.trash-batch-all input[type="checkbox"]')
    await allChk.trigger('change')
    await nextTick()
    expect(w.find('.trash-batch-count').text()).toContain('已选 6 项')
    const checks = w.findAll('.trash-item-check').map(c => (c.element as HTMLInputElement).checked)
    expect(checks.every(Boolean)).toBe(true)
    // 再点取消全选
    await allChk.trigger('change')
    await nextTick()
    expect(w.find('.trash-batch-count').exists()).toBe(false)
    expect((allChk.element as HTMLInputElement).checked).toBe(false)
    w.unmount()
  })

  it('批量恢复:勾选 2 项 → 项离开回收站,toast/save 各一次且文案含数量', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const appStore = useAppStore()
    const saveSpy = vi.spyOn(appStore, 'save')
    const w = await mountOpen()
    await w.findAll('.trash-item-check')[0].trigger('change')
    await w.findAll('.trash-item-check')[1].trigger('change')
    await nextTick()
    await w.findAll('.modal-foot .btn')[0].trigger('click') // 底部「批量恢复」
    await nextTick()
    expect(ds.trashedBookmarks.length).toBe(0)
    expect(ds.bookmarks.filter(b => !b.deletedAt).length).toBe(2)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('已恢复 2 项')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(w.find('.trash-batch-count').exists()).toBe(false)
    w.unmount()
  })

  it('批量删除 confirm 取消 → 数据不变(数据安全契约)', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    await w.findAll('.trash-item-check')[0].trigger('change')
    await w.findAll('.trash-item-check')[2].trigger('change')
    await nextTick()
    showConfirmMock.mockResolvedValue(false)
    await w.findAll('.modal-foot .btn')[1].trigger('click') // 底部「批量删除」
    await nextTick()
    expect(showConfirmMock).toHaveBeenCalledWith('确定永久删除选中的 2 项？此操作无法恢复。')
    expect(ds.trashedBookmarks.length).toBe(2)
    expect(ds.trashedGroups.length).toBe(2)
    expect(ds.trashCount).toBe(6)
    expect(toastMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('批量删除 confirm 确认 → 项彻底消失(回收站与数据都无)', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const appStore = useAppStore()
    const saveSpy = vi.spyOn(appStore, 'save')
    const w = await mountOpen()
    await w.findAll('.trash-item-check')[0].trigger('change')
    await w.findAll('.trash-item-check')[2].trigger('change')
    await nextTick()
    showConfirmMock.mockResolvedValue(true)
    await w.findAll('.modal-foot .btn')[1].trigger('click') // 底部「批量删除」
    await nextTick()
    expect(ds.bookmarks.length).toBe(1) // 仅剩 b2
    expect(ds.siblingGroups.length).toBe(1) // 仅剩 g2
    expect(ds.trashCount).toBe(4)
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith('已永久删除 2 项')
    expect(saveSpy).toHaveBeenCalledTimes(1)
    w.unmount()
  })

  it('脏 key:选中 2 项后行内恢复 1 项 → 计数降为 1,批量恢复只恢复剩余 1 项', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    await w.findAll('.trash-item-check')[0].trigger('change')
    await w.findAll('.trash-item-check')[1].trigger('change')
    await nextTick()
    // 第 0 行(b1)行内「恢复」按钮
    await w.findAll('.trash-item')[0].findAll('button')[0].trigger('click')
    await nextTick()
    expect(w.find('.trash-batch-count').text()).toContain('已选 1 项')
    // 批量恢复剩余 1 项(b2)
    await w.findAll('.modal-foot .btn')[0].trigger('click')
    await nextTick()
    expect(ds.bookmarks.find(b => b.id === 'b2')?.deletedAt).toBeUndefined()
    expect(ds.trashedBookmarks.length).toBe(0)
    expect(toastMock).toHaveBeenLastCalledWith('已恢复 1 项')
    w.unmount()
  })

  it('关闭面板再打开 → 选中清零', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    await w.findAll('.trash-item-check')[0].trigger('change')
    await nextTick()
    expect(w.find('.trash-batch-count').exists()).toBe(true)
    await w.setProps({ open: false })
    await nextTick()
    await w.setProps({ open: true })
    await nextTick()
    expect(w.find('.trash-batch-count').exists()).toBe(false)
    expect((w.findAll('.trash-item-check')[0].element as HTMLInputElement).checked).toBe(false)
    w.unmount()
  })
})
