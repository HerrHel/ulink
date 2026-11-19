import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { bmForm } from '../../composables/domain/useBookmark.js'
import * as bookmarkDomain from '../../composables/domain/useBookmark.js'
import BookmarkModal from '../../components/modals/BookmarkModal.vue'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn().mockResolvedValue(true),
}))

describe('BookmarkModal 光标聚焦与滚动位置', () => {
  beforeEach(() => {
    Object.assign(bmForm, {
      isOpen: false,
      isEdit: false,
      addToGroupMode: false,
      parentId: null,
      url: '',
      title: '',
      username: '',
      password: '',
      notes: '',
      icon: '',
      iconDark: '',
      attributes: {},
    })
  })

  afterEach(() => {
    Object.assign(bmForm, {
      isOpen: false,
      isEdit: false,
      addToGroupMode: false,
      parentId: null,
      url: '',
      title: '',
      attributes: {},
    })
  })

  it('新建书签时打开：光标聚焦在「网址」输入框，且防滚动防跳跃', async () => {
    bmForm.isOpen = true
    bmForm.isEdit = false

    const wrapper = mount(BookmarkModal, {
      attachTo: document.body,
    })

    const urlInput = wrapper.find<HTMLInputElement>('#bmUrl').element
    const focusSpy = vi.spyOn(urlInput, 'focus')

    await nextTick()
    await flushPromises()

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })

    const modalBody = wrapper.find('.modal-body').element
    expect(modalBody.scrollTop).toBe(0)

    wrapper.unmount()
  })

  it('编辑书签时打开：光标优先聚焦在「网站名称」输入框', async () => {
    bmForm.isOpen = true
    bmForm.isEdit = true
    bmForm.url = 'https://example.com'
    bmForm.title = 'Example Site'

    const wrapper = mount(BookmarkModal, {
      attachTo: document.body,
    })

    const titleInput = wrapper.find<HTMLInputElement>('#bmTitle').element
    const focusSpy = vi.spyOn(titleInput, 'focus')

    await nextTick()
    await flushPromises()

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })

    const modalBody = wrapper.find('.modal-body').element
    expect(modalBody.scrollTop).toBe(0)

    wrapper.unmount()
  })

  it('在网址输入框按下 Enter：触发保存', async () => {
    bmForm.isOpen = true
    bmForm.isEdit = false
    bmForm.url = 'https://example.com'

    const saveSpy = vi.spyOn(bookmarkDomain, 'saveBm').mockResolvedValue(undefined as never)

    const wrapper = mount(BookmarkModal, {
      attachTo: document.body,
    })
    await nextTick()

    const urlInput = wrapper.find('#bmUrl')
    await urlInput.trigger('keydown.enter')
    await flushPromises()

    expect(saveSpy).toHaveBeenCalled()

    saveSpy.mockRestore()
    wrapper.unmount()
  })

  it('在名称输入框按下 Enter：触发保存', async () => {
    bmForm.isOpen = true
    bmForm.isEdit = false
    bmForm.url = 'https://example.com'
    bmForm.title = 'My Example'

    const saveSpy = vi.spyOn(bookmarkDomain, 'saveBm').mockResolvedValue(undefined as never)

    const wrapper = mount(BookmarkModal, {
      attachTo: document.body,
    })
    await nextTick()

    const titleInput = wrapper.find('#bmTitle')
    await titleInput.trigger('keydown.enter')
    await flushPromises()

    expect(saveSpy).toHaveBeenCalled()

    saveSpy.mockRestore()
    wrapper.unmount()
  })

  it('新建书签默认仅显示网址、名称、分类，其余收进「更多」折叠区域', async () => {
    bmForm.isOpen = true
    bmForm.isEdit = false

    const wrapper = mount(BookmarkModal, {
      attachTo: document.body,
    })
    await nextTick()

    // 默认展示基础字段
    expect(wrapper.find('#bmUrl').isVisible()).toBe(true)
    expect(wrapper.find('#bmTitle').isVisible()).toBe(true)
    expect(wrapper.find('#bmCategoryId').isVisible()).toBe(true)

    // 「更多」折叠区域默认隐藏
    const moreFields = wrapper.find('[data-testid="lv-bm-more-fields"]')
    expect(moreFields.isVisible()).toBe(false)

    // 点击「更多」按钮展开
    const toggleBtn = wrapper.find('[data-testid="lv-bm-more-toggle"]')
    await toggleBtn.trigger('click')
    await nextTick()

    expect(moreFields.isVisible()).toBe(true)
    expect(wrapper.find('#bmNotes').isVisible()).toBe(true)
    expect(wrapper.find('#bmIcon').isVisible()).toBe(true)

    wrapper.unmount()
  })

  it('编辑已有书签且包含备注等字段时，「更多」区域自动展开', async () => {
    bmForm.isOpen = true
    bmForm.isEdit = true
    bmForm.url = 'https://example.com'
    bmForm.title = 'Example'
    bmForm.notes = '这是一个已有备注'

    const wrapper = mount(BookmarkModal, {
      attachTo: document.body,
    })
    await nextTick()

    const moreFields = wrapper.find('[data-testid="lv-bm-more-fields"]')
    expect(moreFields.isVisible()).toBe(true)

    wrapper.unmount()
  })
})
