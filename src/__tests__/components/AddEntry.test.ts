/**
 * 新建入口：「+」一步打开新建弹窗（与 Ctrl+N 一致）；弹窗标题即「新建书签 / 新建笔记」切换。
 * 锁住：① 「+」不再弹菜单；② 普通新建可切到笔记（手机端无右键，这是笔记的可见入口），
 * 新建后直接进入该笔记编辑，已填书签内容时先确认；③ 命令面板「新建笔记」走同一入口；
 * ④ 编辑 / 子书签 / 加入笔记三种模式不显示切换，标题保持原样。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { showConfirm } from '../../lib/toast.js'
import { bmForm } from '../../composables/domain/useBookmark.js'
import FilterBar from '../../components/shell/FilterBar.vue'
import BookmarkModal from '../../components/modals/BookmarkModal.vue'
import CommandPalette from '../../components/overlays/CommandPalette.vue'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn().mockResolvedValue(true),
}))

function openPlainCreate() {
  Object.assign(bmForm, { isOpen: true, isEdit: false, addToGroupMode: false, parentId: null })
}

afterEach(() => {
  Object.assign(bmForm, { isOpen: false, isEdit: false, addToGroupMode: false, parentId: null, url: '', title: '' })
  vi.mocked(showConfirm).mockClear()
})

describe('「+」新建入口', () => {
  it('点「+」直接发出 add-bookmark，页面上没有下拉菜单', async () => {
    const wrapper = mount(FilterBar)
    await wrapper.find('[data-testid="lv-add"]').trigger('click')
    expect(wrapper.emitted('add-bookmark')).toHaveLength(1)
    expect(wrapper.find('.add-dropdown').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('新建弹窗：书签 / 笔记切换', () => {
  it('普通新建显示切换，当前为「新建书签」', async () => {
    openPlainCreate()
    const wrapper = mount(BookmarkModal)
    await nextTick()
    const tabs = wrapper.findAll('.bm-type-tab')
    expect(tabs.map(b => b.text())).toEqual(['新建书签', '新建笔记'])
    expect(tabs[0].attributes('aria-pressed')).toBe('true')
    expect(tabs[1].attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('切到「新建笔记」（未填内容）：不确认，关闭弹窗、新建笔记并直接进入编辑', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const before = ds.siblingGroups.length
    openPlainCreate()
    const wrapper = mount(BookmarkModal)
    await nextTick()
    await wrapper.find('[data-testid="lv-bm-type-note"]').trigger('click')
    await flushPromises()
    expect(showConfirm).not.toHaveBeenCalled()
    expect(bmForm.isOpen).toBe(false)
    expect(ds.siblingGroups.length).toBe(before + 1)
    expect(ui.focusedGroupId).toBe(ds.siblingGroups[ds.siblingGroups.length - 1].id)
    wrapper.unmount()
  })

  it('已填内容时切换先确认：取消则留在书签弹窗、不新建', async () => {
    vi.mocked(showConfirm).mockResolvedValueOnce(false)
    const ds = useDataStore()
    const before = ds.siblingGroups.length
    openPlainCreate()
    bmForm.url = 'github.com'
    const wrapper = mount(BookmarkModal)
    await nextTick()
    await wrapper.find('[data-testid="lv-bm-type-note"]').trigger('click')
    await flushPromises()
    expect(showConfirm).toHaveBeenCalledTimes(1)
    expect(bmForm.isOpen).toBe(true)
    expect(bmForm.url).toBe('github.com')
    expect(ds.siblingGroups.length).toBe(before)
    wrapper.unmount()
  })

  it('已填内容时切换先确认：确定则放弃书签草稿、新建笔记', async () => {
    vi.mocked(showConfirm).mockResolvedValueOnce(true)
    const ds = useDataStore()
    const before = ds.siblingGroups.length
    openPlainCreate()
    bmForm.title = '草稿标题'
    const wrapper = mount(BookmarkModal)
    await nextTick()
    await wrapper.find('[data-testid="lv-bm-type-note"]').trigger('click')
    await flushPromises()
    expect(showConfirm).toHaveBeenCalledTimes(1)
    expect(bmForm.isOpen).toBe(false)
    expect(ds.siblingGroups.length).toBe(before + 1)
    wrapper.unmount()
  })

  it('命令面板「新建笔记」：真的新建并进入编辑（此前只打开编辑弹窗、保存时因无 id 静默失败）', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const before = ds.siblingGroups.length
    const wrapper = mount(CommandPalette, { attachTo: document.body })
    ;(wrapper.vm as unknown as { open: () => void }).open()
    await nextTick()
    const item = wrapper.findAll('.cmd-item').find(el => el.text().includes('新建笔记'))
    expect(item).toBeTruthy()
    await item!.trigger('click')
    await flushPromises()
    expect(ds.siblingGroups.length).toBe(before + 1)
    expect(ui.focusedGroupId).toBe(ds.siblingGroups[ds.siblingGroups.length - 1].id)
    expect(ui.modals.groupEdit).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['编辑书签', { isEdit: true }],
    ['添加子书签', { parentId: 'bm_parent' }],
    ['加入笔记', { addToGroupMode: true }],
  ])('%s 模式不显示切换', async (_name, patch) => {
    openPlainCreate()
    Object.assign(bmForm, patch)
    const wrapper = mount(BookmarkModal)
    await nextTick()
    expect(wrapper.find('.bm-type-tabs').exists()).toBe(false)
    expect(wrapper.find('.modal-head h2').text()).not.toBe('')
    wrapper.unmount()
  })
})
