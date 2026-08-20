/**
 * BookmarkCard.vue setup 函数体补测（补覆盖率第二轮，闭环 46.01%→目标 ≥85%）。
 *
 * 既有两测只锁搜索高亮渲染（highlight + search-highlight-regression），未触达 setup
 * 纯逻辑函数（onCardClick 分流 / onCardKeydown / copyUser / copyPw / onTogglePw /
 * editNotes / toggleSelect / decodePassword / filterByTagName / 各转发）。
 *
 * 锁真实行为契约（成功/失败/密文守门/分流/转发），非刷行数。
 *
 * 桩：真实 Pinia + data/ui/e2e store（seed 数据 + _syncMaps），vi.mock 替换
 * domain composables（useBookmark/useAttrFilter/useUI.openDetail）、lib/toast、
 * lib/preview、interaction/listCardKeyboard、domain/useDeadLinkChecker、ui/useInlineEdit、
 * ui/usePasswordVisibility、crypto.decryptPasswordWithKey。utils 走真实（domain/displayText/
 * favicon/stripEntranceAnim/getTagNames 纯函数），copyToClipboard 经真实 utils 但 toast 被
 * mock 捕获降级。ResizeObserver polyfill（沿用 search-highlight-regression 测）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// jsdom 无 ResizeObserver；useCardOverflow 模块级单例挂载时 new ResizeObserver
if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// ===== vi.mock 必在 import 组件前 =====
const mocks = vi.hoisted(() => {
  return {
    decrypt: vi.fn(),
    toast: vi.fn(),
    openBmModal: vi.fn(),
    deleteBookmarkWithUndo: vi.fn(),
    addSub: vi.fn(),
    openBookmark: vi.fn(),
    openDetail: vi.fn(),
    toggleAttrFilter: vi.fn(),
    bookmarkPreview: vi.fn(),
    handleListCardKeydown: vi.fn(),
    startEditing: vi.fn(),
    isUnconfirmed: vi.fn(),
    // 注意：源码解构 `const { isVisible, toggle } = usePasswordVisibility()` 后
    //   模板/逻辑以 `isVisible(bookmark.id)` 函数调用使用——故 isVisible 必须是 fn。
    isVisible: vi.fn(() => false),
    toggle: vi.fn(),
    copyToClipboard: vi.fn(),
    isMobile: vi.fn(() => false),
  }
})

vi.mock('../../crypto.js', async (importOriginal) => {
  // 保留真实 isThreePartCipher（utils.displayText/domain 依赖它判定密文兜底）
  // 仅覆盖 decryptPasswordWithKey 使 decodePassword 可控
  const actual = await importOriginal() as any
  return {
    ...actual,
    decryptPasswordWithKey: mocks.decrypt,
  }
})
vi.mock('../../utils.js', async (importOriginal) => {
  // 保留真实纯函数（domain/displayText/favicon/stripEntranceAnim/getTagNames/isMobile），
  // 仅覆盖 copyToClipboard 为 mock fn 使 copyUser/copyPw 复制路径可精确断言（避开 jsdom
  // execCommand 真实副作用走失败 toast 不可控分支）
  const actual = await importOriginal() as any
  return {
    ...actual,
    copyToClipboard: mocks.copyToClipboard,
    // isMobile 真实实现模块顶层 matchMedia 求值一次（jsdom 常无 matchMedia→恒 false），
    // 覆盖为 mock fn 使 onCardClick 移动端分支可测
    isMobile: mocks.isMobile,
  }
})
vi.mock('../../lib/toast.js', () => ({
  toast: mocks.toast,
}))
vi.mock('../../composables/domain/useBookmark.js', () => ({
  openBmModal: mocks.openBmModal,
  deleteBookmarkWithUndo: mocks.deleteBookmarkWithUndo,
  addSub: mocks.addSub,
  openBookmark: mocks.openBookmark,
}))
vi.mock('../../composables/ui/useUI.js', () => ({
  openDetail: mocks.openDetail,
}))
vi.mock('../../composables/domain/useAttrFilter.js', () => ({
  toggleAttrFilter: mocks.toggleAttrFilter,
}))
vi.mock('../../lib/preview.js', () => ({
  bookmarkPreview: mocks.bookmarkPreview,
}))
vi.mock('../../composables/interaction/listCardKeyboard.js', () => ({
  handleListCardKeydown: mocks.handleListCardKeydown,
  // 同文件其余导出桩空（本文件只 mount 卡片本身不消费它们，防它处真实 import 崩）
  listCardsInGrid: () => [],
  focusAdjacentListCard: () => false,
  focusEdgeListCard: () => false,
  resolveListCardKey: () => ({ type: 'none' }),
}))
vi.mock('../../composables/ui/useInlineEdit.js', () => ({
  useInlineEdit: () => ({ startEditing: mocks.startEditing }),
}))
vi.mock('../../composables/domain/useDeadLinkChecker.js', () => ({
  useDeadLinkChecker: () => ({ isUnconfirmed: mocks.isUnconfirmed, getResult: () => null, isDead: () => false, isBlocked: () => false } as any),
}))
vi.mock('../../composables/ui/usePasswordVisibility.js', () => ({
  usePasswordVisibility: () => ({ isVisible: mocks.isVisible, toggle: mocks.toggle }),
  // 模块级单例的测试钩子桩（BookmarkCard 未直接用）
  __testReset: () => {},
}))

import BookmarkCard from '../../components/cards/BookmarkCard.vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useE2EStore } from '../../stores/e2e.js'
import type { Bookmark } from '../../types.js'

// ---- bookmark fixture ----
function makeBm(over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'b1',
    title: 'Hello Vue Site',
    url: 'https://vue.test',
    icon: '',
    username: '',
    password: '',
    notes: '',
    categoryId: 'c1',
    parentId: null,
    order: 1,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1,
    updatedAt: 100,
    deletedAt: null,
    ...over,
  } as Bookmark
}

let ds: ReturnType<typeof useDataStore>
let ui: ReturnType<typeof useUIStore>
let e2e: ReturnType<typeof useE2EStore>

beforeEach(() => {
  vi.clearAllMocks()
  mocks.decrypt.mockReset()
  mocks.isVisible.mockClear()

  ds = useDataStore()
  ds.bookmarks = [makeBm()]
  ds.categories = [{ id: 'c1', name: 'C', icon: '', color: '' }] as any
  ds.customAttributes = []
  ;(ds as any)._syncMaps()

  ui = useUIStore()
  ui.searchQuery = ''
  ui.layoutMode = 'grid'
  ui.batchMode = false
  ui.batchSelected = []

  e2e = useE2EStore()
})

/** mount 工具：默认 bookmark=b1，可覆盖 props/store 状态 */
function mountCard(opts: { bm?: Partial<Bookmark>; props?: Record<string, unknown> } = {}) {
  const bm = makeBm(opts.bm ?? {})
  if (opts.bm) {
    ds.bookmarks = [bm]
    ;(ds as any)._syncMaps()
  }
  return mount(BookmarkCard, { props: { bookmark: bm, ...opts.props } })
}

describe('BookmarkCard — decodePassword / watch 密码解密契约', () => {
  it('解锁态 E2E 启用+未解锁：decode 早退置空，不调 decrypt', async () => {
    e2e.isE2EEnabled = true
    ;(e2e as any).isUnlocked = false
    mocks.decrypt.mockResolvedValue('decrypted')
    mountCard() // mount 触发 onMounted decode
    await flushPromises()
    expect(mocks.decrypt).not.toHaveBeenCalled()
    // onMounted decode 后 decodedPw 置空（锁定态 decode 早退，不调 decrypt）
  })

  it('正常态 E2E 未启用：调 decrypt（password + cryptoKey）填充密码', async () => {
    e2e.isE2EEnabled = false
    ;(e2e as any).isUnlocked = false
    ;(e2e as any).cryptoKey = null
    mocks.decrypt.mockResolvedValue('plain-pw')
    const w = mountCard({ bm: { password: 'base64pw' } })
    await flushPromises()
    expect(mocks.decrypt).toHaveBeenCalledWith('base64pw', null)
    // decodedPw 经 copyPw 验：复制成功路径调 copyToClipboard(decodedPw,'密码')
    await w.vm.copyPw()
    await flushPromises()
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('plain-pw', '密码')
  })

  it('watch(bookmark.password) 变化触发 decodePassword 重算', async () => {
    e2e.isE2EEnabled = false
    mocks.decrypt.mockResolvedValue('pw1')
    const w = mountCard({ bm: { password: 'pw0' } })
    await flushPromises()
    mocks.decrypt.mockClear()
    await w.setProps({ bookmark: makeBm({ password: 'pw2' }) })
    await flushPromises()
    expect(mocks.decrypt).toHaveBeenCalledWith('pw2', null)
  })

  it('watch(e2e.isUnlocked) 解锁后触发 decodePassword', async () => {
    e2e.isE2EEnabled = true
    ;(e2e as any).isUnlocked = false
    mocks.decrypt.mockResolvedValue('')
    mountCard({ bm: { password: { encrypted: true } as any } })
    await flushPromises()
    mocks.decrypt.mockClear()
    ;(e2e as any).isUnlocked = true
    mocks.decrypt.mockResolvedValue('unlocked-pw')
    await flushPromises()
    expect(mocks.decrypt).toHaveBeenCalled()
  })
})

// 辅助：构造 closest 模拟元素 event。element.closest(sel) jsdom 真实可用——
// 给 e.target 设真实 DOM 元素并通过 class/data 属性驱动 closest 命中/落空。
function makeTarget(innerHtml = '', classes = ''): HTMLElement {
  const el = document.createElement('div')
  if (classes) el.className = classes
  el.innerHTML = innerHtml
  return el
}

// 三段密文 fixture：满足 isThreePartCipher（crypto.ts:53）严格长度+base64 校验
// salt 长度 44 / iv 长度 16 / data ≥24，全 A-Za-z0-9+/ 字符（合法 base64）
function makeThreePartCipher(): string {
  return 'S'.repeat(44) + '.' + 'I'.repeat(16) + '.' + 'D'.repeat(32)
}

describe('BookmarkCard — onOpenClick 打开链接分流契约', () => {
  it('batchMode 下 onOpenClick 走 toggleSelect 不 visit', async () => {
    ui.batchMode = true
    const w = mountCard()
    await w.vm.onOpenClick()
    // toggleSelect 调用：从空选中推入 b1
    expect((ui.batchSelected as string[]).includes('b1')).toBe(true)
    expect(mocks.openBookmark).not.toHaveBeenCalled()
  })

  it('非 batchMode 下 onOpenClick 走 visit → openBookmark(bookmark)', async () => {
    ui.batchMode = false
    const w = mountCard()
    await w.vm.onOpenClick()
    expect(mocks.openBookmark).toHaveBeenCalledTimes(1)
    expect((mocks.openBookmark.mock.calls[0] as any[])[0].id).toBe('b1')
  })
})

describe('BookmarkCard — onCardClick 分流契约', () => {
  it('batchMode 走 toggleSelect', async () => {
    ui.batchMode = true
    const w = mountCard()
    await w.vm.onCardClick({ target: makeTarget() } as any)
    expect((ui.batchSelected as string[]).includes('b1')).toBe(true)
    expect(mocks.openBookmark).not.toHaveBeenCalled()
    expect(mocks.openDetail).not.toHaveBeenCalled()
  })

  it('mini-grid 布局走 visit（openBookmark）', async () => {
    ui.layoutMode = 'mini-grid'
    const w = mountCard()
    await w.vm.onCardClick({ target: makeTarget() } as any)
    expect(mocks.openBookmark).toHaveBeenCalledTimes(1)
    expect(mocks.openDetail).not.toHaveBeenCalled()
  })

  it('非 list 非 mini-grid（grid）布局早退：不 visit 不 detail', async () => {
    ui.layoutMode = 'grid'
    const w = mountCard()
    await w.vm.onCardClick({ target: makeTarget() } as any)
    expect(mocks.openBookmark).not.toHaveBeenCalled()
    expect(mocks.openDetail).not.toHaveBeenCalled()
  })

  it('list 布局点交互区（命中 LIST_INTERACTIVE_SEL）早退：不副作用', async () => {
    ui.layoutMode = 'list'
    const target = makeTarget('', 'btn-xs')
    const w = mountCard()
    await w.vm.onCardClick({ target } as any)
    expect(mocks.openBookmark).not.toHaveBeenCalled()
    expect(mocks.openDetail).not.toHaveBeenCalled()
  })

  it('list 布局非交互区点空白走 visit（主操作，PC/移动端一致）', async () => {
    ui.layoutMode = 'list'
    const w = mountCard()
    await w.vm.onCardClick({ target: makeTarget() } as any)
    expect(mocks.openBookmark).toHaveBeenCalledTimes(1)
    expect(mocks.openDetail).not.toHaveBeenCalled()
  })

  it('list 布局展开态点空白走 toggleExpand（收起，纯 UI 态零数据写）', async () => {
    ui.layoutMode = 'list'
    // 展开态现由 ui.expandedIds 决定（已从数据字段迁移）
    ui.expandedIds = ['b1']
    const w = mountCard()
    const updateSpy = vi.spyOn(ds, 'updateBookmark').mockImplementation(() => ({} as any))
    await w.vm.onCardClick({ target: makeTarget() } as any)
    expect(ui.expandedIds.includes('b1')).toBe(false)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(mocks.openDetail).not.toHaveBeenCalled()
    expect(mocks.openBookmark).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })

  it('list 布局未展开点空白走 visit（主操作，不再弹详情面板）', async () => {
    ui.layoutMode = 'list'
    const w = mountCard()
    await w.vm.onCardClick({ target: makeTarget() } as any)
    expect(mocks.openBookmark).toHaveBeenCalledTimes(1)
    expect(mocks.openDetail).not.toHaveBeenCalled()
  })
})

describe('BookmarkCard — onCardKeydown 分流契约', () => {
  it('非 listKeyboardNav（grid）早退：不调 handleListCardKeydown 不副作用', async () => {
    ui.layoutMode = 'grid'
    const w = mountCard()
    const e = new KeyboardEvent('keydown', { key: 'Enter' })
    await w.vm.onCardKeydown(e)
    expect(mocks.handleListCardKeydown).not.toHaveBeenCalled()
  })

  it('action=primary → visit（openBookmark）', async () => {
    ui.layoutMode = 'list'
    mocks.isMobile.mockReturnValue(false)
    ui.batchMode = false
    mocks.handleListCardKeydown.mockReturnValue({ type: 'primary' })
    const w = mountCard()
    const e = new KeyboardEvent('keydown', { key: 'Enter' })
    await w.vm.onCardKeydown(e)
    expect(mocks.openBookmark).toHaveBeenCalledTimes(1)
    expect(mocks.openDetail).not.toHaveBeenCalled()
  })

  it('action=detail → openDetail', async () => {
    ui.layoutMode = 'list'
    mocks.isMobile.mockReturnValue(false)
    mocks.handleListCardKeydown.mockReturnValue({ type: 'detail' })
    const w = mountCard()
    await w.vm.onCardKeydown(new KeyboardEvent('keydown', { key: ' ' }))
    expect(mocks.openDetail).toHaveBeenCalledWith('b1')
    expect(mocks.openBookmark).not.toHaveBeenCalled()
  })

  it('action=expand/collapse/toggleExpand → toggleExpand（纯 UI 态翻转 expandedIds）', async () => {
    ui.layoutMode = 'list'
    mocks.isMobile.mockReturnValue(false)
    mocks.handleListCardKeydown.mockReturnValue({ type: 'expand' })
    const w = mountCard()
    const updateSpy = vi.spyOn(ds, 'updateBookmark').mockImplementation(() => ({} as any))
    await w.vm.onCardKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(ui.expandedIds.includes('b1')).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })

  it('action=none → 不 visit 不 detail 不 toggleExpand', async () => {
    ui.layoutMode = 'list'
    mocks.isMobile.mockReturnValue(false)
    mocks.handleListCardKeydown.mockReturnValue({ type: 'none' })
    const w = mountCard()
    await w.vm.onCardKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(mocks.openBookmark).not.toHaveBeenCalled()
    expect(mocks.openDetail).not.toHaveBeenCalled()
  })
})

describe('BookmarkCard — copyUser 账户复制契约', () => {
  it('username 为空：直接 copyToClipboard("", "账户")', async () => {
    const w = mountCard({ bm: { username: '' } })
    await w.vm.copyUser()
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('', '账户')
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('username 为密文（displayText 返空）：toast 守门不复制', async () => {
    // 三段密文（满足 isThreePartCipher 严格长度+base64）displayText 兜底返空 → !displayText(v) 真
    const cipher = makeThreePartCipher()
    const w = mountCard({ bm: { username: cipher } })
    await flushPromises()
    await w.vm.copyUser()
    expect(mocks.toast).toHaveBeenCalledWith('该字段已加密，请先解锁主密码', false)
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
  })

  it('username 明文：copyToClipboard(username, "账户")', async () => {
    const w = mountCard({ bm: { username: 'myuser' } })
    await w.vm.copyUser()
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('myuser', '账户')
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})

describe('BookmarkCard — copyPw 密码复制契约', () => {
  it('E2E 启用+未解锁：toast 守门不复制', async () => {
    e2e.isE2EEnabled = true
    ;(e2e as any).isUnlocked = false
    mocks.decrypt.mockResolvedValue('plain')
    const w = mountCard()
    await w.vm.copyPw()
    expect(mocks.toast).toHaveBeenCalledWith('请先解锁主密码', false)
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
  })

  it('(decodedPw 为空)非 E2E 锁定但解密返空：toast 守门不复制', async () => {
    e2e.isE2EEnabled = false
    mocks.decrypt.mockResolvedValue('')
    const w = mountCard()
    await w.vm.copyPw()
    expect(mocks.toast).toHaveBeenCalledWith('密码未解锁，无法复制', false)
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
  })

  it('decodedPw 非空：copyToClipboard(decodedPw, "密码")', async () => {
    e2e.isE2EEnabled = false
    mocks.decrypt.mockResolvedValue('plain-pw')
    const w = mountCard()
    await flushPromises() // 等 onMounted decodePassword 完成，decodedPw 填 plain-pw
    await w.vm.copyPw()
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('plain-pw', '密码')
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})

describe('BookmarkCard — onTogglePw 显示/隐藏密码契约', () => {
  it('E2E 启用+未解锁：toast 守门不 toggle', async () => {
    e2e.isE2EEnabled = true
    ;(e2e as any).isUnlocked = false
    const w = mountCard()
    await w.vm.onTogglePw()
    expect(mocks.toast).toHaveBeenCalledWith('请先解锁主密码', false)
    expect(mocks.toggle).not.toHaveBeenCalled()
  })

  it('非锁定：toggle(bookmark.id) 转发', async () => {
    e2e.isE2EEnabled = false
    const w = mountCard()
    await w.vm.onTogglePw()
    expect(mocks.toggle).toHaveBeenCalledWith('b1')
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})

describe('BookmarkCard — editNotes 内联编辑契约', () => {
  it('notes 为密文（displayText 返空）：toast 守门不 startEditing', async () => {
    const cipher = makeThreePartCipher()
    const w = mountCard({ bm: { notes: cipher } })
    await flushPromises()
    await w.vm.editNotes({ currentTarget: makeTarget() } as any)
    expect(mocks.toast).toHaveBeenCalledWith('该字段已加密，请先解锁主密码', false)
    expect(mocks.startEditing).not.toHaveBeenCalled()
  })

  it('notes 正常：调 startEditing 且 onSave 回调对"变化"走 updateBookmark+save+toast', async () => {
    mocks.startEditing.mockImplementation((el: HTMLElement, val: string, opts: any) => {
      // 模拟用户保存了与原备注不同的值
      opts.onSave.call(null, 'new-notes')
    })
    const w = mountCard({ bm: { notes: 'old-notes' } })
    const updateSpy = vi.spyOn(ds, 'updateBookmark').mockImplementation(() => ({} as any))
    await w.vm.editNotes({ currentTarget: makeTarget() } as any)
    expect(mocks.startEditing).toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledWith('b1', { notes: 'new-notes' })
    expect(mocks.toast).toHaveBeenCalledWith('备注已更新')
    updateSpy.mockRestore()
  })

  it('notes 无变化：onSave 不调 updateBookmark 不 toast', async () => {
    mocks.startEditing.mockImplementation((_el: HTMLElement, _val: string, opts: any) => {
      // 与原备注相同
      opts.onSave.call(null, 'same-notes')
    })
    const w = mountCard({ bm: { notes: 'same-notes' } })
    const updateSpy = vi.spyOn(ds, 'updateBookmark').mockImplementation(() => ({} as any))
    await w.vm.editNotes({ currentTarget: makeTarget() } as any)
    expect(updateSpy).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })
})

describe('BookmarkCard — toggleSelect 批量选择契约', () => {
  it('未选中：push 入 batchSelected', async () => {
    ui.batchSelected = []
    const w = mountCard()
    await w.vm.toggleSelect()
    expect(ui.batchSelected).toEqual(['b1'])
  })

  it('已选中：splice 移出', async () => {
    ui.batchSelected = ['b1', 'b2']
    const w = mountCard()
    await w.vm.toggleSelect()
    expect(ui.batchSelected).toEqual(['b2'])
  })
})

describe('BookmarkCard — filterByTagName 标签筛选契约', () => {
  it('attr 存在：toggleAttrFilter(attr.id) 转发', async () => {
    ds.customAttributes = [{ id: 'attr1', name: 'tag1', type: 'boolean' }] as any
    // attributeByName getter 读 state.customAttributes 构建 name→attr map，无需 _syncMaps
    const w = mountCard({ bm: { attributes: { attr1: true } } })
    await w.vm.filterByTagName('tag1')
    expect(mocks.toggleAttrFilter).toHaveBeenCalledWith('attr1')
  })

  it('attr 不存在：不副作用', async () => {
    ds.customAttributes = []
    const w = mountCard()
    await w.vm.filterByTagName('no-such-tag')
    expect(mocks.toggleAttrFilter).not.toHaveBeenCalled()
  })
})

describe('BookmarkCard — 转发函数契约', () => {
  it('visit → openBookmark(bookmark)', async () => {
    const w = mountCard()
    await w.vm.visit()
    expect((mocks.openBookmark.mock.calls[0] as any[])[0].id).toBe('b1')
  })

  it('edit → openBmModal(bookmark.id)', async () => {
    const w = mountCard()
    await w.vm.edit()
    expect(mocks.openBmModal).toHaveBeenCalledWith('b1')
  })

  it('del → deleteBookmarkWithUndo(bookmark.id)', async () => {
    const w = mountCard()
    await w.vm.del()
    expect(mocks.deleteBookmarkWithUndo).toHaveBeenCalledWith('b1')
  })

  it('doAddSub → addSub(bookmark.id) （仅非 parentId 卡有按钮）', async () => {
    const w = mountCard({ bm: { parentId: null } })
    await w.vm.doAddSub()
    expect(mocks.addSub).toHaveBeenCalledWith('b1')
  })

  it('doOpenDetail(bmId) → openDetail(bmId)', async () => {
    const w = mountCard()
    await w.vm.doOpenDetail('sub1')
    expect(mocks.openDetail).toHaveBeenCalledWith('sub1')
  })

  it('visitSub(sub) → openBookmark(sub)', async () => {
    const w = mountCard()
    const sub = makeBm({ id: 'sub1', title: 'Sub' })
    await w.vm.visitSub(sub)
    expect((mocks.openBookmark.mock.calls[0] as any[])[0]).toBe(sub)
  })

  it('openMenu → openDetail(bookmark.id)', async () => {
    const w = mountCard()
    await w.vm.openMenu()
    expect(mocks.openDetail).toHaveBeenCalledWith('b1')
  })

  it('toggleExpand → 纯 UI 态翻转 expandedIds，零数据写（不 updateBookmark 不落盘）', async () => {
    const w = mountCard()
    const updateSpy = vi.spyOn(ds, 'updateBookmark').mockImplementation(() => ({} as any))
    await w.vm.toggleExpand()
    expect(ui.expandedIds.includes('b1')).toBe(true)
    expect(updateSpy).not.toHaveBeenCalled()
    updateSpy.mockRestore()
  })
})

