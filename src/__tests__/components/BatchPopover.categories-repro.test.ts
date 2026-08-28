/**
 * repro: 多选模式「添加到」按钮无法识别到最新的分类
 *
 * 验证 BatchPopover 打开状态下，新建分类（addNewCategory 走 store.addCategory）
 * 是否实时出现在弹层分类列表中。链路：
 *   BatchPopover.categories = computed(useAppStore().selectableCategories)
 *   → useDataStore().selectableCategories (Pinia getter, state.categories 响应式)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { useBatchMoveStore } from '../../stores/overlay.js'
import { addNewCategory } from '../../utils.js'

// persist passthrough：让 store.save() 走通 Zod 校验而不真写 IDB
vi.mock('../../stores/persist.js', () => ({
  saveData: () => Promise.resolve(true),
  saveToLocalStorage: vi.fn(),
  loadFromLocalStorage: vi.fn(),
  loadFromIDB: vi.fn(async () => null),
  getStorageInfo: vi.fn(),
}))

import BatchPopover from '../../components/overlays/BatchPopover.vue'

function seedCategory(ds: ReturnType<typeof useDataStore>, id: string, name: string, order: number) {
  ds.addCategory({ id, name, icon: 'star', color: '#2563eb', order } as any)
}

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('BatchPopover 分类列表实时性（repro: 最新分类无法识别）', () => {
  it('弹层打开前已存在的分类能渲染', async () => {
    const ds = useDataStore()
    seedCategory(ds, 'c1', '工作', 0)
    seedCategory(ds, 'c2', '学习', 1)

    const w = mount(BatchPopover, { attachTo: document.body })
    useBatchMoveStore().show()
    await nextTick()

    const items = w.findAll('.bmp-item')
    const names = items.map(i => i.text()).filter(t => !t.includes('私密空间'))
    expect(names).toEqual(expect.arrayContaining(['工作', '学习']))
    w.unmount()
  })

  it('弹层打开期间新建分类 → 列表应实时出现新分类（selectableCategories 响应式）', async () => {
    const ds = useDataStore()
    seedCategory(ds, 'c1', '工作', 0)
    const store = useAppStore()

    const w = mount(BatchPopover, { attachTo: document.body })
    useBatchMoveStore().show()
    await nextTick()

    // 打开时只有「工作」
    let names = w.findAll('.bmp-item').map(i => i.text()).filter(t => !t.includes('私密空间'))
    expect(names).toEqual(expect.arrayContaining(['工作']))
    expect(names).not.toEqual(expect.arrayContaining(['最新分类']))

    // 通过与 BatchPopover.onAddNewCat 相同的入口创建新分类
    const cat = addNewCategory('最新分类', store)
    expect(cat).not.toBeNull()
    await nextTick()

    names = w.findAll('.bmp-item').map(i => i.text()).filter(t => !t.includes('私密空间'))
    expect(names).toEqual(expect.arrayContaining(['工作', '最新分类']))
    w.unmount()
  })

  it('弹层打开期间用弹层自带输入框新建 → 分类应出现在列表中', async () => {
    const ds = useDataStore()
    seedCategory(ds, 'c1', '工作', 0)

    const w = mount(BatchPopover, { attachTo: document.body })
    useBatchMoveStore().show()
    await nextTick()

    const input = w.find('.bmp-new-input')
    await input.setValue('测试分类')
    await w.find('.bmp-new-btn').trigger('click')

    // onAddNewCat 会立即 batchMoveToCat + hide，所以验证直接读 store 数据
    const store = useAppStore()
    expect(store.selectableCategories.map(c => c.name)).toEqual(expect.arrayContaining(['工作', '测试分类']))
    w.unmount()
  })

  it('FIX(repro): 打开弹层时列表滚动到底部——最新分类（order 最大排末尾）不被折叠区裁掉', async () => {
    const ds = useDataStore()
    for (let i = 0; i < 10; i++) seedCategory(ds, 'c' + i, '分类' + i, i)
    const fakeList = { scrollTop: 0, scrollHeight: 500 }
    const spy = vi.spyOn(document, 'getElementById').mockImplementation((id: string) => {
      if (id === 'batchMoveList') return fakeList as unknown as HTMLElement
      if (id === 'batchMovePopover') return { contains: () => false } as unknown as HTMLElement
      return null
    })

    const w = mount(BatchPopover, { attachTo: document.body })
    useBatchMoveStore().show()
    // 等 watch open → _scrollNewestIntoView 的 nextTick
    await nextTick()
    await nextTick()

    expect(fakeList.scrollTop).toBe(500)
    w.unmount()
    spy.mockRestore()
  })
})
