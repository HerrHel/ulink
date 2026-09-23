/* eslint-disable vue/one-component-per-file */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { useShareStore } from '../stores/share.js'
import { useUIStore } from '../stores/ui.js'
import { useDataStore } from '../stores/data.js'
import { useCombinedList } from '../composables/useCombinedList.js'
import { detectShareRoute } from '../composables/domain/useDataShare.js'

if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

describe('验证分享链接书签展示与零跳版', () => {
  let ui: ReturnType<typeof useUIStore>
  let _ds: ReturnType<typeof useDataStore>
  let share: ReturnType<typeof useShareStore>
  let wrappers: VueWrapper[] = []

  beforeEach(() => {
    setActivePinia(createPinia())
    ui = useUIStore()
    _ds = useDataStore()
    share = useShareStore()
    wrappers = []
  })

  afterEach(() => {
    for (const w of wrappers) {
      try { w.unmount() } catch { /* ignore */ }
    }
    wrappers = []
    delete (window as any).__INITIAL_SHARE_DATA__
    share.exit()
  })

  it('场景 1：组分享 SSR 水合后正确展示组内书签且不出现「暂无书签」', async () => {
    const rawSsrData = {
      type: 'group',
      id: 'g_shared_1',
      data: {
        group: {
          id: 'g_shared_1',
          name: '共享组1',
          category_id: 'cat_1',
          icon: '',
          order: 0,
          is_expanded: false,
          attributes: {},
          bookmark_ids: ['b_1', 'b_2'],
          notes: '<p>组笔记内容</p>',
          use_count: 0,
          is_public: true,
          updated_at_num: Date.now(),
        },
        bookmarks: [
          {
            id: 'b_1',
            title: '书签1',
            url: 'https://example.com/1',
            notes: '',
            icon: '',
            category_id: 'cat_1',
            parent_id: null,
            order: 0,
            attributes: {},
            is_expanded: false,
            created_at_num: Date.now(),
            updated_at_num: Date.now(),
          },
          {
            id: 'b_2',
            title: '书签2',
            url: 'https://example.com/2',
            notes: '',
            icon: '',
            category_id: 'cat_1',
            parent_id: null,
            order: 1,
            attributes: {},
            is_expanded: false,
            created_at_num: Date.now(),
            updated_at_num: Date.now(),
          },
        ],
      },
    }

    ;(window as any).__INITIAL_SHARE_DATA__ = rawSsrData
    delete (window as any).location
    ;(window as any).location = new URL('https://ulink.ren/s/g_shared_1')

    const route = detectShareRoute()
    expect(route).toBe('g_shared_1')

    await share.enter(route!)

    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('focus')
    expect(combinedList.value.length).toBe(1)

    const CardGrid = (await import('../components/cards/CardGrid.vue')).default
    const gridWrapper = mount(CardGrid)
    wrappers.push(gridWrapper)

    const text = gridWrapper.text()
    expect(text).not.toContain('暂无书签')
    expect(text).toContain('共享组1')
    expect(text).toContain('书签1')
    expect(text).toContain('书签2')
    expect(gridWrapper.findAll('.bm').length).toBe(2)
  })

  it('场景 2：分类分享 SSR 水合后正确展示组卡与顶层书签且不出现「暂无书签」', async () => {
    const rawSsrData = {
      type: 'category',
      id: 'sid_cat_1',
      data: {
        category: {
          id: 'cat_1',
          name: '工具分类',
          icon: '',
          color: '',
        },
        groups: [
          {
            id: 'g_shared_1',
            name: '共享组1',
            category_id: 'cat_1',
            icon: '',
            order: 0,
            is_expanded: false,
            attributes: {},
            bookmark_ids: ['b_1'],
            notes: '',
            use_count: 0,
            is_public: true,
            updated_at_num: Date.now(),
          },
        ],
        bookmarks: [
          {
            id: 'b_1',
            title: '组内书签1',
            url: 'https://example.com/1',
            notes: '',
            icon: '',
            category_id: 'cat_1',
            parent_id: null,
            order: 0,
            attributes: {},
            is_expanded: false,
            created_at_num: Date.now(),
            updated_at_num: Date.now(),
          },
          {
            id: 'b_loose_1',
            title: '散落书签1',
            url: 'https://example.com/loose',
            notes: '',
            icon: '',
            category_id: 'cat_1',
            parent_id: null,
            order: 1,
            attributes: {},
            is_expanded: false,
            created_at_num: Date.now(),
            updated_at_num: Date.now(),
          },
        ],
      },
    }

    ;(window as any).__INITIAL_SHARE_DATA__ = rawSsrData
    delete (window as any).location
    ;(window as any).location = new URL('https://ulink.ren/s/c/sid_cat_1')

    const route = detectShareRoute()
    expect(route).toBe('cat:sid_cat_1')

    await share.enter(route!)

    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('share-category')
    expect(combinedList.value.length).toBe(3) // 1 组 + 2 顶层书签（b_1 与 b_loose_1）

    const CardGrid = (await import('../components/cards/CardGrid.vue')).default
    const gridWrapper = mount(CardGrid)
    wrappers.push(gridWrapper)

    const text = gridWrapper.text()
    expect(text).not.toContain('暂无书签')
    expect(text).toContain('共享组1')
    expect(text).toContain('散落书签1')
  })

  it('场景 3：真实 useAppLifecycle 启动下组分享态稳定无闪退', async () => {
    const rawSsrData = {
      type: 'group',
      id: 'g_shared_real',
      data: {
        group: {
          id: 'g_shared_real',
          name: '真实共享组',
          category_id: 'cat_real',
          icon: '',
          order: 0,
          is_expanded: false,
          attributes: {},
          bookmark_ids: ['b_real_1'],
          notes: '<p>笔记内容</p>',
          use_count: 0,
          is_public: true,
          updated_at_num: Date.now(),
        },
        bookmarks: [
          {
            id: 'b_real_1',
            title: '真实书签',
            url: 'https://real.com',
            notes: '',
            icon: '',
            category_id: 'cat_real',
            parent_id: null,
            order: 0,
            attributes: {},
            is_expanded: false,
            created_at_num: Date.now(),
            updated_at_num: Date.now(),
          },
        ],
      },
    }

    ;(window as any).__INITIAL_SHARE_DATA__ = rawSsrData
    delete (window as any).location
    ;(window as any).location = new URL('https://ulink.ren/s/g_shared_real')

    // 模拟首屏 setup 同步检测
    const initialRoute = detectShareRoute()
    if (initialRoute) {
      void share.enter(initialRoute)
    }

    const { onShareRoute, useAppLifecycle } = await import('../composables/useAppLifecycle.js')
    onShareRoute((gid: string) => { void share.enter(gid) })

    const TestApp = defineComponent({
      setup() {
        useAppLifecycle()
        return {}
      },
      template: '<div>test</div>',
    })

    const appWrapper = mount(TestApp)
    wrappers.push(appWrapper)
    await new Promise((r) => setTimeout(r, 100))

    expect(ui.shareMode).toEqual({ kind: 'group', id: 'g_shared_real' })
    expect(ui.focusedGroupId).toBe('g_shared_real')

    const CardGrid = (await import('../components/cards/CardGrid.vue')).default
    const gridWrapper = mount(CardGrid)
    wrappers.push(gridWrapper)

    const text = gridWrapper.text()
    expect(text).not.toContain('暂无书签')
    expect(text).toContain('真实共享组')
    expect(text).toContain('真实书签')
  })

  it('场景 4：分类分享在真实生命周期与历史本地状态下保持稳定且不被覆盖退出', async () => {
    // 模拟本地存储中留存有上一次会话的 curCat 和 focusedGroupId
    localStorage.setItem('lv_ui_state', JSON.stringify({
      curCat: 'stale_cat',
      focusedGroupId: 'stale_grp',
    }))

    const rawSsrData = {
      type: 'category',
      id: 'sid_real_cat',
      data: {
        category: {
          id: 'cat_real_1',
          name: '真实分类',
          icon: '',
          color: '',
        },
        groups: [
          {
            id: 'g_in_cat_1',
            name: '分类下的组1',
            category_id: 'cat_real_1',
            icon: '',
            order: 0,
            is_expanded: false,
            attributes: {},
            bookmark_ids: ['b_in_g_1'],
            notes: '',
            use_count: 0,
            is_public: true,
            updated_at_num: Date.now(),
          },
        ],
        bookmarks: [
          {
            id: 'b_in_g_1',
            title: '组内书签1',
            url: 'https://example.com/1',
            notes: '',
            icon: '',
            category_id: 'cat_real_1',
            parent_id: null,
            order: 0,
            attributes: {},
            is_expanded: false,
            created_at_num: Date.now(),
            updated_at_num: Date.now(),
          },
        ],
      },
    }

    ;(window as any).__INITIAL_SHARE_DATA__ = rawSsrData
    delete (window as any).location
    ;(window as any).location = new URL('https://ulink.ren/s/c/sid_real_cat')

    // 同步探测
    const initialRoute = detectShareRoute()
    if (initialRoute) {
      void share.enter(initialRoute)
    }

    const { onShareRoute, useAppLifecycle } = await import('../composables/useAppLifecycle.js')
    onShareRoute((gid: string) => { void share.enter(gid) })

    const TestApp = defineComponent({
      setup() {
        useAppLifecycle()
        return {}
      },
      template: '<div>test</div>',
    })

    const appWrapper = mount(TestApp)
    wrappers.push(appWrapper)
    await new Promise((r) => setTimeout(r, 100))

    // 验证：shareMode 依然保持 category 且不会被 stale_grp / stale_cat 污染或退出
    expect(ui.shareMode).toEqual({ kind: 'category', id: 'sid_real_cat' })
    expect(ui.curCat).toBe('cat_real_1')
    expect(ui.focusedGroupId).toBeNull()

    const { combinedList, mode } = useCombinedList()
    expect(mode.value).toBe('share-category')
    expect(combinedList.value.length).toBe(2) // 1 组 + 1 顶层书签

    const CardGrid = (await import('../components/cards/CardGrid.vue')).default
    const gridWrapper = mount(CardGrid)
    wrappers.push(gridWrapper)

    const text = gridWrapper.text()
    expect(text).not.toContain('暂无书签')
    expect(text).toContain('分类下的组1')
  })
})
