/**
 * TrashPanel 回收站 — 补覆盖率锁定真实行为契约
 * 既有 TrashPanel.multiselect.test.ts 8 测覆盖渲染/勾选/全选/取消/批量恢复/批量删除 confirm 双路/脏 key/关闭重开。
 * 本文件补其未触达分支：单行行内「删除」(permanent) 确认+取消两路、toggle 取消分支(走 delete)、
 * batchRestore/batchPermanent 空选中早退、onEmptyTrash 清空回收站 confirm 确认+取消两路、
 * 无 title/无 name 渲染走 || 右侧兜底、空回收站渲染分支。
 * 桩骨架沿用 multiselect：真 Pinia + seedTrash + mock toast 模块 + persist passthrough。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'

// ── 周边模块 mock（与 multiselect.test.ts 同口径） ──
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

/** seeding:2 书签 + 2 组 + 1 分类 + 1 属性，全部软删进回收站 */
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

/** seeding 含无 title 书签 + 无 name 组（走模板 `||` 右侧兜底分支） */
function seedNoTitle(ds: ReturnType<typeof useDataStore>) {
  ds.addBookmark({ id: 'b3', title: '', url: 'https://noname.com' } as any)
  ds.deleteBookmark('b3')
  ds.addGroup({ id: 'g3', name: '', bookmarkIds: [] } as any)
  ds.deleteGroup('g3')
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

describe('TrashPanel 行内操作与边界契约', () => {
  it('单行「删除」confirm 取消 → 数据不变且无 toast（数据安全守门）', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    // 第 0 行(b1)行内「删除」按钮 = 该行 button 第 2 个（[0]恢复 [1]删除）
    showConfirmMock.mockResolvedValue(false)
    await w.findAll('.trash-item')[0].findAll('button')[1].trigger('click')
    await nextTick()
    expect(showConfirmMock).toHaveBeenCalledWith('确定永久删除？此操作无法恢复。')
    // 取消 → 不删、不存、不提示
    expect(ds.trashedBookmarks.length).toBe(2)
    expect(ds.bookmarks.length).toBe(2) // b1/b2 仍在（软删态算 bookmarks）
    expect(toastMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('单行「删除」confirm 确认 → 彻底删除该项 + save + toast「已永久删除」+ key 移出选中', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const appStore = useAppStore()
    const saveSpy = vi.spyOn(appStore, 'save')
    const w = await mountOpen()
    // 先勾选 b1（使其进 selected 集合，验证 permanent 内 selected.value.delete(k) 生效）
    await w.findAll('.trash-item-check')[0].trigger('change')
    await nextTick()
    expect(w.find('.trash-batch-count').text()).toContain('已选 1 项')
    showConfirmMock.mockResolvedValue(true)
    await w.findAll('.trash-item')[0].findAll('button')[1].trigger('click') // 行内「删除」
    await nextTick()
    // b1 彻底消失（bookmarks 与 trashed 双无）
    expect(ds.bookmarks.find(b => b.id === 'b1')).toBeUndefined()
    expect(ds.trashedBookmarks.find(b => b.id === 'b1')).toBeUndefined()
    expect(toastMock).toHaveBeenCalledWith('已永久删除')
    expect(saveSpy).toHaveBeenCalled()
    // 选中 b1 的 key 应被 permanent 清掉 → 计数归零
    expect(w.find('.trash-batch-count').exists()).toBe(false)
    w.unmount()
  })

  it('toggle 已选项 → 走 delete 分支移出选中（计数归零）', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    const chkB1 = w.findAll('.trash-item-check')[0]
    // 勾选 → add 分支
    await chkB1.trigger('change')
    await nextTick()
    expect(w.find('.trash-batch-count').text()).toContain('已选 1 项')
    expect((chkB1.element as HTMLInputElement).checked).toBe(true)
    // 再点同一项 → delete 分支，移出选中
    await chkB1.trigger('change')
    await nextTick()
    expect(w.find('.trash-batch-count').exists()).toBe(false)
    expect((chkB1.element as HTMLInputElement).checked).toBe(false)
    w.unmount()
  })

  it('batchRestore 空选中早退 → 不调 restore/save/toast', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const appStore = useAppStore()
    const saveSpy = vi.spyOn(appStore, 'save')
    const w = await mountOpen()
    // 批量按钮 disabled(selectedCount===0)，jsdom trigger 静默不触发 setupState —
    // 改经 setupState 直调覆盖空集早退分支（effectiveKeys 为空 → return）
    const s = w.vm.$ as any
    // 先确诊未选中（底部「批量恢复」禁用）
    expect(w.findAll('.modal-foot .btn')[0].attributes('disabled')).toBeDefined()
    // 直调 batchRestore 走 if(!items.length) return 早退
    ;(s.setupState as any).batchRestore()
    expect(ds.trashedBookmarks.length).toBe(2) // 不变
    expect(saveSpy).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('batchPermanent 空选中早退 → 不弹 confirm、不删、不 toast', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    expect(w.findAll('.modal-foot .btn')[1].attributes('disabled')).toBeDefined() // 底部「批量删除」禁用
    const s = w.vm.$ as any
    // effectiveKeys 为空 batchPermanent 走 if(!items.length) return，不 await showConfirm
    await (s.setupState as any).batchPermanent()
    expect(showConfirmMock).not.toHaveBeenCalled()
    expect(ds.trashCount).toBe(6)
    expect(toastMock).not.toHaveBeenCalled()
    w.unmount()
  })

  it('onEmptyTrash confirm 取消 → 不清空、不 save、不 emit close', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const appStore = useAppStore()
    const saveSpy = vi.spyOn(appStore, 'save')
    const w = await mountOpen()
    showConfirmMock.mockResolvedValue(false)
    await w.find('.trash-batch-actions .btn').trigger('click') // 批量条「清空回收站」按钮（无 disabled）
    await nextTick()
    expect(showConfirmMock).toHaveBeenCalledWith('确定清空回收站？所有内容将被永久删除，无法恢复。')
    expect(ds.trashCount).toBe(6) // 不变
    expect(saveSpy).not.toHaveBeenCalled()
    expect(toastMock).not.toHaveBeenCalled()
    // 未 emit close
    expect(w.emitted('close')).toBeFalsy()
    w.unmount()
  })

  it('onEmptyTrash confirm 确认 → emptyTrash 全清空 + save + toast「回收站已清空」+ emit close', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const appStore = useAppStore()
    const saveSpy = vi.spyOn(appStore, 'save')
    const w = await mountOpen()
    showConfirmMock.mockResolvedValue(true)
    await w.find('.trash-batch-actions .btn').trigger('click') // 批量条「清空回收站」
    await nextTick()
    expect(ds.trashCount).toBe(0)
    expect(ds.trashedBookmarks.length).toBe(0)
    expect(ds.trashedGroups.length).toBe(0)
    expect(toastMock).toHaveBeenCalledWith('回收站已清空')
    expect(saveSpy).toHaveBeenCalled()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('onEmptyTrash selected 残留随清空一起 clear', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const w = await mountOpen()
    // 先全选
    await w.find('.trash-batch-all input[type="checkbox"]').trigger('change')
    await nextTick()
    expect(w.find('.trash-batch-count').text()).toContain('已选 6 项')
    showConfirmMock.mockResolvedValue(true)
    await w.find('.trash-batch-actions .btn').trigger('click') // 批量条「清空回收站」
    await nextTick()
    // 清空后内容为 0，批量条不再渲染；选中集合内部已 clear（无 gui 可见但再 toggleAll 应得全选=空集）
    expect(ds.trashCount).toBe(0)
    expect(w.find('.trash-batch').exists()).toBe(false) // trashCount===0 不渲染批量条
    w.unmount()
  })
})

describe('TrashPanel 渲染兜底与空态', () => {
  it('回收到站为空 → 渲染「回收站为空」，无批量条无清空按钮', async () => {
    // 不 seed，回收站空（store 在 TrashPanel setup 内自取）
    const w = await mountOpen()
    expect(w.find('.trash-empty').text()).toContain('回收站为空')
    expect(w.find('.trash-batch').exists()).toBe(false)
    expect(w.find('.btn-danger').exists()).toBe(false) // modal-foot 仅 trashCount>0 渲染
    expect(w.findAll('.trash-item').length).toBe(0)
    w.unmount()
  })

  it('无 title 书签走 b.title || b.url 兜底显示 url；无 name 组走 g.name || 未命名', async () => {
    const ds = useDataStore()
    seedNoTitle(ds)
    const w = await mountOpen()
    const items = w.findAll('.trash-item')
    expect(items.length).toBe(2) // 1 书签 + 1 组
    // 书签 b3 无 title → 显示 url
    expect(items[0].find('.trash-item-name').text()).toContain('https://noname.com')
    // 组 g3 无 name → 显示「未命名」
    expect(items[1].find('.trash-item-name').text()).toContain('未命名')
    w.unmount()
  })

  it('分类行内「恢复」→ restoreCategory + save + toast「已恢复」', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const appStore = useAppStore()
    const saveSpy = vi.spyOn(appStore, 'save')
    const w = await mountOpen()
    // 4 个 section:书签(2 行)/组(2 行)/分类(1 行)/属性(1 行)。分类行 = 第 5 个 .trash-item(index 4)
    await w.findAll('.trash-item')[4].findAll('button')[0].trigger('click') // 行内「恢复」
    await nextTick()
    expect(ds.trashedCategories.length).toBe(0)
    expect(ds.categories.find(c => c.id === 'c1')?.deletedAt).toBeUndefined()
    expect(toastMock).toHaveBeenCalledWith('已恢复')
    expect(saveSpy).toHaveBeenCalled()
    w.unmount()
  })

  it('属性行内「删除」confirm 确认 → permanentDeleteAttribute + save + toast「已永久删除」', async () => {
    const ds = useDataStore()
    seedTrash(ds)
    const appStore = useAppStore()
    const saveSpy = vi.spyOn(appStore, 'save')
    const w = await mountOpen()
    // 属性行 = 最后一个 .trash-item（index 5）
    showConfirmMock.mockResolvedValue(true)
    await w.findAll('.trash-item')[5].findAll('button')[1].trigger('click') // 行内「删除」
    await nextTick()
    expect(ds.customAttributes.find(a => a.id === 'a1')).toBeUndefined()
    expect(ds.trashedAttributes.length).toBe(0)
    expect(toastMock).toHaveBeenCalledWith('已永久删除')
    expect(saveSpy).toHaveBeenCalled()
    w.unmount()
  })
})
