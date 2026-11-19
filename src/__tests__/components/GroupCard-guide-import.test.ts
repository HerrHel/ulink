/**
 * 上手指南卡片的「导入书签」入口：欢迎弹窗移除后，新手的导入入口移到上手指南卡片头部。
 * 锁住：只在 sg_welcome 上出现；点击触发隐藏的 #importFile 选择文件；批量模式与分享只读态不显示。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import GroupCard from '../../components/cards/GroupCard.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import type { SiblingGroup } from '../../types.js'

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

function makeGroup(id: string): SiblingGroup {
  return {
    id, name: '上手指南', categoryId: 'c1', icon: '', order: 0, isExpanded: false,
    attributes: {}, bookmarkIds: [], notes: '<p>hi</p>', updatedAt: 1000, useCount: 0,
  }
}

async function mountCard(id: string) {
  const group = makeGroup(id)
  useDataStore().siblingGroups = [group]
  const wrapper = mount(GroupCard, { props: { group } })
  await flushPromises()
  return wrapper
}

afterEach(() => { document.body.innerHTML = '' })

describe('上手指南卡片「导入书签」', () => {
  it('上手指南显示按钮，点击打开导入文件选择', async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'importFile'
    document.body.appendChild(input)
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})

    const wrapper = await mountCard('sg_welcome')
    const btn = wrapper.find('[data-testid="lv-guide-import"]')
    expect(btn.text()).toBe('导入书签')
    await btn.trigger('click')
    expect(click).toHaveBeenCalledTimes(1)
    expect(input.accept).toBe('.json,.html,.htm,.csv')
    wrapper.unmount()
  })

  it('其他笔记不显示', async () => {
    const wrapper = await mountCard('sg_other')
    expect(wrapper.find('[data-testid="lv-guide-import"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('批量模式不显示', async () => {
    useUIStore().batchMode = true
    const wrapper = await mountCard('sg_welcome')
    expect(wrapper.find('[data-testid="lv-guide-import"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('处于特定分类且标签名与该分类相同时，tagNames 中隐藏该标签', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    ui.batchMode = false
    ds.categories = [
      { id: 'cat_ai', name: 'AI', icon: '', color: '' },
      { id: 'cat_dev', name: '开发', icon: '', color: '' },
    ] as any
    ds.customAttributes = [
      { id: 'attr_ai', name: 'AI', type: 'boolean' },
      { id: 'attr_notes', name: '常用笔记', type: 'boolean' },
    ] as any
    ;(ds as any)._syncMaps()

    const group: SiblingGroup = {
      id: 'g_test',
      name: 'AI 笔记组',
      categoryId: 'cat_ai',
      icon: '',
      order: 0,
      isExpanded: false,
      attributes: { attr_ai: true, attr_notes: true },
      bookmarkIds: [],
      notes: '<p>content</p>',
      updatedAt: 1000,
      useCount: 0,
    }
    ds.siblingGroups = [group]

    // 1. 全部视图下（ui.curCat = 'all'），全部标签均显示
    ui.curCat = 'all'
    const wrapper = mount(GroupCard, { props: { group } })
    await flushPromises()
    expect((wrapper.vm as any).tagNames).toEqual(['AI', '常用笔记'])

    // 2. 切换到 AI 分类下，同名标签 'AI' 隐藏
    ui.curCat = 'cat_ai'
    await wrapper.vm.$nextTick()
    expect((wrapper.vm as any).tagNames).toEqual(['常用笔记'])

    // 3. 切换到 开发 分类下，'AI' 标签恢复显示
    ui.curCat = 'cat_dev'
    await wrapper.vm.$nextTick()
    expect((wrapper.vm as any).tagNames).toEqual(['AI', '常用笔记'])

    wrapper.unmount()
  })
})
