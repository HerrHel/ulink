/** CardGrid 空状态：筛选无结果只提示无匹配；真的没有内容时直接给新建与导入入口 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'

const openBmModal = vi.fn()
vi.mock('../../composables/domain/useBookmark.js', async (orig) => ({
  ...(await orig<object>()),
  openBmModal: () => openBmModal(),
}))

import CardGrid from '../../components/cards/CardGrid.vue'

describe('CardGrid 空状态', () => {
  beforeEach(() => {
    openBmModal.mockClear()
    const ds = useDataStore()
    ds.bookmarks = []
    ds.siblingGroups = []
  })

  it('无内容：显示新建与导入按钮，点新建打开书签弹窗，点导入触发文件选择', async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'importFile'
    const click = vi.spyOn(input, 'click').mockImplementation(() => {})
    document.body.appendChild(input)

    const w = mount(CardGrid)
    await nextTick()
    expect(w.find('[data-testid="lv-empty"]').exists()).toBe(true)
    await w.find('[data-testid="lv-empty-add"]').trigger('click')
    expect(openBmModal).toHaveBeenCalledTimes(1)
    await w.find('[data-testid="lv-empty-import"]').trigger('click')
    expect(click).toHaveBeenCalledTimes(1)
    expect(input.accept).toBe('.json,.html,.htm,.csv')

    w.unmount()
    input.remove()
  })

  it('搜索无结果：只显示无匹配，不出现新建/导入按钮', async () => {
    useUIStore().searchQuery = 'zzz'
    const w = mount(CardGrid)
    await nextTick()
    expect(w.find('[data-testid="lv-empty-filtered"]').exists()).toBe(true)
    expect(w.find('[data-testid="lv-empty-add"]').exists()).toBe(false)
    w.unmount()
  })

  it('分享只读态：空列表不给新建/导入', async () => {
    ;(useUIStore() as unknown as { shareMode: unknown }).shareMode = { id: 'x' }
    const w = mount(CardGrid)
    await nextTick()
    expect(w.find('[data-testid="lv-empty"]').exists()).toBe(true)
    expect(w.find('.empty-actions').exists()).toBe(false)
    w.unmount()
  })
})
