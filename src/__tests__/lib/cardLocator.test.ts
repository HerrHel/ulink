import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { locateAndHighlightCard } from '../../lib/ai/cardLocator.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

describe('cardLocator — 双向卡片高亮定位引擎', () => {
  let ui: ReturnType<typeof useUIStore>
  let ds: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    ui = useUIStore()
    ds = useDataStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('1. 定位书签：目标书签不存在或已删除时返回对应错误原因', async () => {
    const resNotFound = await locateAndHighlightCard({ id: 'non-existent' })
    expect(resNotFound.success).toBe(false)
    expect(resNotFound.reason).toBe('not_found')

    const deletedBm: Bookmark = {
      id: 'bm-del',
      title: '已删除书签',
      url: 'https://deleted.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'cat-1',
      parentId: null,
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 100,
      updatedAt: 100,
      deletedAt: 200,
    }
    ds.addBookmark(deletedBm)

    const resDel = await locateAndHighlightCard({ id: 'bm-del' })
    expect(resDel.success).toBe(false)
    expect(resDel.reason).toBe('deleted')
  })

  it('2. 跨分类自适应与组聚焦退出：定位跨分类书签时自动切换分类，并解除不相关的组聚焦', async () => {
    const bm: Bookmark = {
      id: 'bm-target',
      title: '目标书签',
      url: 'https://target.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'cat-design',
      parentId: null,
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 100,
      updatedAt: 100,
    }
    ds.addBookmark(bm)

    // 创建 DOM 容器
    const cardEl = document.createElement('div')
    cardEl.className = 'card'
    cardEl.setAttribute('data-id', 'bm-target')
    cardEl.scrollIntoView = vi.fn()
    document.body.appendChild(cardEl)

    ui.curCat = 'cat-dev'
    ui.focusedGroupId = 'some-other-group'

    const res = await locateAndHighlightCard({ id: 'bm-target', type: 'bookmark' })
    expect(res.success).toBe(true)
    // 自动切换至目标分类
    expect(ui.curCat).toBe('cat-design')
    // 自动解除组聚焦
    expect(ui.focusedGroupId).toBeNull()
    // scrollIntoView 被调用
    expect(cardEl.scrollIntoView).toHaveBeenCalled()
    // 脉冲呼吸动画 class 被添加
    expect(cardEl.classList.contains('card-locate-pulse')).toBe(true)

    // 定时器到期后脉冲 class 移除
    vi.advanceTimersByTime(2100)
    expect(cardEl.classList.contains('card-locate-pulse')).toBe(false)
  })

  it('3. 移动端视野腾出：移动端定位时自动收起 DetailPanel 抽屉', async () => {
    const grp: SiblingGroup = {
      id: 'sg-note',
      name: '架构笔记',
      categoryId: 'cat-dev',
      icon: '',
      order: 1,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>笔记内容</p>',
      updatedAt: 100,
      useCount: 0,
    }
    ds.addGroup(grp)

    const grpEl = document.createElement('div')
    grpEl.className = 'card group-card'
    grpEl.setAttribute('data-group-id', 'sg-note')
    grpEl.scrollIntoView = vi.fn()
    document.body.appendChild(grpEl)

    ui.setMobile(true)
    ui.panels.detail = true

    const res = await locateAndHighlightCard({ id: 'group:sg-note', collapseDetailOnMobile: true })
    expect(res.success).toBe(true)
    expect(res.targetType).toBe('group')
    expect(ui.panels.detail).toBe(false)
    expect(grpEl.scrollIntoView).toHaveBeenCalled()
    expect(grpEl.classList.contains('card-locate-pulse')).toBe(true)
  })

  it('4. 组内书签定位：若目标书签处于某个笔记组内且初始不在顶层 DOM，自动聚焦该笔记组以展开', async () => {
    const parentGroup: SiblingGroup = {
      id: 'sg-parent',
      name: '收藏组合',
      categoryId: 'cat-all',
      icon: '',
      order: 1,
      isExpanded: false,
      attributes: {},
      bookmarkIds: ['bm-nested'],
      notes: '<p>嵌套书签</p>',
      updatedAt: 100,
      useCount: 0,
    }
    ds.addGroup(parentGroup)

    const bm: Bookmark = {
      id: 'bm-nested',
      title: '嵌套书签',
      url: 'https://nested.com',
      username: '',
      password: '',
      notes: '',
      icon: '',
      categoryId: 'cat-all',
      parentId: null,
      order: 1,
      useCount: 0,
      attributes: {},
      isExpanded: false,
      createdAt: 100,
      updatedAt: 100,
    }
    ds.addBookmark(bm)

    // 初始 DOM 中没有 bmEl，但在聚焦组后 DOM 挂载
    const bmEl = document.createElement('div')
    bmEl.className = 'card'
    bmEl.setAttribute('data-id', 'bm-nested')
    bmEl.scrollIntoView = vi.fn()

    ui.$subscribe((_, state) => {
      if (state.focusedGroupId === 'sg-parent' && !bmEl.parentNode) {
        document.body.appendChild(bmEl)
      }
    })

    const locatePromise = locateAndHighlightCard({ id: 'bm-nested' })
    await vi.advanceTimersByTimeAsync(200)
    const res = await locatePromise
    expect(res.success).toBe(true)
    expect(ui.focusedGroupId).toBe('sg-parent')
  })
})
