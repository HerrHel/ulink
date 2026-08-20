/**
 * menuConfig.ts — 右键/长按菜单统一配置契约
 *
 * 锁：MENU_RULES/MENU_ITEMS 结构（card 首项为 COPY_URL 替代 VISIT）、
 * dispatchMenuAction 转发、buildLongPressItems 条件项/动态文案/私密空间过滤。
 * 桩：真实 Pinia（data/ui store），vi.mock 替换 domain composables 与 utils.copyToClipboard。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

const mocks = vi.hoisted(() => ({
  visit: vi.fn(),
  openBmModal: vi.fn(),
  deleteBookmarkWithUndo: vi.fn(),
  openDetail: vi.fn(),
  deleteCategory: vi.fn(),
  deleteAttribute: vi.fn(),
  openCatModal: vi.fn(),
  editGroup: vi.fn(),
  deleteGroup: vi.fn(),
  removeBmFromGroup: vi.fn(),
  createGroup: vi.fn(),
  toggleGroupFocus: vi.fn(),
  shareGroup: vi.fn(),
  moveBookmarksToVault: vi.fn(),
  moveGroupsToVault: vi.fn(),
  moveCategoryToVault: vi.fn(),
  toggleBatchMode: vi.fn(),
  pushNavState: vi.fn(),
  copyToClipboard: vi.fn(),
  addSub: vi.fn(),
}))

vi.mock('../../composables/domain/useBookmark.js', () => ({
  visit: mocks.visit,
  openBmModal: mocks.openBmModal,
  deleteBookmarkWithUndo: mocks.deleteBookmarkWithUndo,
  addSub: mocks.addSub,
}))
vi.mock('../../composables/ui/useUI.js', () => ({
  openDetail: mocks.openDetail,
  deleteCategory: mocks.deleteCategory,
  deleteAttribute: mocks.deleteAttribute,
  openCatModal: mocks.openCatModal,
}))
vi.mock('../../composables/domain/useGroup.js', () => ({
  editGroup: mocks.editGroup,
  deleteGroup: mocks.deleteGroup,
  removeBmFromGroup: mocks.removeBmFromGroup,
  createGroup: mocks.createGroup,
  toggleGroupFocus: mocks.toggleGroupFocus,
}))
vi.mock('../../composables/domain/useDataShare.js', () => ({
  shareGroup: mocks.shareGroup,
}))
vi.mock('../../composables/domain/useSpaceMove.js', () => ({
  useSpaceMove: () => ({
    moveBookmarksToVault: mocks.moveBookmarksToVault,
    moveGroupsToVault: mocks.moveGroupsToVault,
    moveCategoryToVault: mocks.moveCategoryToVault,
  }),
}))
vi.mock('../../composables/domain/useBatch.js', () => ({
  toggleBatchMode: mocks.toggleBatchMode,
}))
vi.mock('../../composables/interaction/useKeyboardOps.js', () => ({
  pushNavState: mocks.pushNavState,
}))
vi.mock('../../utils.js', async (importOriginal) => {
  // 保留真实纯函数（isMobile/domain 等被依赖链真实使用），仅覆盖 copyToClipboard 精确断言
  const actual = await importOriginal() as any
  return { ...actual, copyToClipboard: mocks.copyToClipboard }
})

import { MENU_ITEMS, MENU_RULES, LONGPRESS_RULES, dispatchMenuAction, buildLongPressItems } from '../../lib/menuConfig.js'
import { ACTIONS } from '../../config/constants.js'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'

let ds: ReturnType<typeof useDataStore>
let ui: ReturnType<typeof useUIStore>

function seed() {
  ds = useDataStore()
  ds.bookmarks = [{
    id: 'b1', title: 'GitHub', url: 'https://github.com', username: 'u', password: '',
    notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0,
    useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1, deletedAt: null,
  } as any]
  ds.siblingGroups = [{
    id: 'g1', name: 'G', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0,
    isExpanded: false, attributes: {}, bookmarkIds: [], notes: '<p>n</p>',
    updatedAt: 1, useCount: 0, isPublic: false,
  } as any]
  ;(ds as any)._syncMaps()
  ui = useUIStore()
  ui.curSpace = 'main'
  ui.layoutMode = 'grid'
  ui.batchMode = false
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  seed()
})

describe('menuConfig — 规则结构', () => {
  it('card 右键首项为 COPY_URL（打开网站→复制网址），文案正确', () => {
    expect(MENU_RULES.card[0].action).toBe(ACTIONS.COPY_URL)
    expect(MENU_RULES.card.some(e => e.action === ACTIONS.VISIT)).toBe(false)
    expect(MENU_ITEMS[ACTIONS.COPY_URL].label).toBe('复制网址')
  })

  it('sub/group-card 的 VISIT 保持「查看详情」语义（openDetail）', () => {
    const sub = MENU_RULES.sub.find(e => e.action === ACTIONS.VISIT)
    const gc = MENU_RULES['group-card'].find(e => e.action === ACTIONS.VISIT)
    expect(sub?.label).toBe('查看详情')
    expect(gc?.label).toBe('查看详情')
  })

  it('group 右键含 SHARE_GROUP/HISTORY 且 DELETE 标记删除组', () => {
    expect(MENU_RULES.group.some(e => e.action === ACTIONS.SHARE_GROUP)).toBe(true)
    expect(MENU_RULES.group.some(e => e.action === ACTIONS.HISTORY)).toBe(true)
    expect(MENU_RULES.group.find(e => e.action === ACTIONS.DELETE)?.label).toBe('删除组')
  })

  it('长按 card 子集含 EXPAND（条件项）+ COPY_URL，无 HISTORY/MULTI_SELECT', () => {
    const actions = LONGPRESS_RULES.card.map(e => e.action)
    expect(actions).toContain(ACTIONS.EXPAND)
    expect(actions).toContain(ACTIONS.COPY_URL)
    expect(actions).not.toContain(ACTIONS.HISTORY)
    expect(actions).not.toContain(ACTIONS.MULTI_SELECT)
  })

  it('card 右键含 ADD_SUB、group 右键含 ADD_TO_GROUP（替代原 foot 按钮）', () => {
    expect(MENU_RULES.card.some(e => e.action === ACTIONS.ADD_SUB)).toBe(true)
    expect(MENU_RULES.group.some(e => e.action === ACTIONS.ADD_TO_GROUP)).toBe(true)
    expect(MENU_ITEMS[ACTIONS.ADD_SUB].label).toBe('添加子网站')
    expect(MENU_ITEMS[ACTIONS.ADD_TO_GROUP].label).toBe('添加书签或组')
  })
})

describe('menuConfig — dispatchMenuAction 转发', () => {
  it('card COPY_URL → copyToClipboard(url, 网址)', () => {
    dispatchMenuAction('card', ACTIONS.COPY_URL, 'b1')
    expect(mocks.copyToClipboard).toHaveBeenCalledWith('https://github.com', '网址')
  })

  it('card 无 url 的 COPY_URL 不复制', () => {
    ds.bookmarks[0].url = ''
    dispatchMenuAction('card', ACTIONS.COPY_URL, 'b1')
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
  })

  it('card 转发：EDIT/DELETE/PIN/MOVE_TO_CAT/DETAIL/HISTORY/MULTI_SELECT', () => {
    dispatchMenuAction('card', ACTIONS.EDIT, 'b1')
    expect(mocks.openBmModal).toHaveBeenCalledWith('b1')
    dispatchMenuAction('card', ACTIONS.DELETE, 'b1')
    expect(mocks.deleteBookmarkWithUndo).toHaveBeenCalledWith('b1')
    dispatchMenuAction('card', ACTIONS.PIN, 'b1')
    expect(ds.bookmarks[0].pinnedAt).toBeTruthy()
    dispatchMenuAction('card', ACTIONS.MOVE_TO_CAT, 'b1')
    dispatchMenuAction('card', ACTIONS.DETAIL, 'b1')
    expect(mocks.openDetail).toHaveBeenCalledWith('b1')
    dispatchMenuAction('card', ACTIONS.HISTORY, 'b1')
    expect(mocks.pushNavState).toHaveBeenCalled()
    expect(ui.panels.history).toBe(true)
    dispatchMenuAction('card', ACTIONS.MULTI_SELECT, 'b1')
    expect(mocks.toggleBatchMode).toHaveBeenCalled()
    expect(ui.batchSelected).toContain('b1')
  })

  it('card MOVE_TO_SPACE → moveBookmarksToVault([id])', () => {
    dispatchMenuAction('card', ACTIONS.MOVE_TO_SPACE, 'b1')
    expect(mocks.moveBookmarksToVault).toHaveBeenCalledWith(['b1'])
  })

  it('card ADD_SUB：顶层书签 → addSub(id)；子书签被守卫', () => {
    dispatchMenuAction('card', ACTIONS.ADD_SUB, 'b1')
    expect(mocks.addSub).toHaveBeenCalledWith('b1')
    mocks.addSub.mockClear()
    ds.bookmarks[0].parentId = 'p1'
    dispatchMenuAction('card', ACTIONS.ADD_SUB, 'b1')
    expect(mocks.addSub).not.toHaveBeenCalled()
  })

  it('group ADD_TO_GROUP → 打开添加 Popover（addToGid + overlays.addPopover）', () => {
    dispatchMenuAction('group', ACTIONS.ADD_TO_GROUP, 'g1')
    expect(ui.addToGid).toBe('g1')
    expect(ui.overlays.addPopover).toBe(true)
  })

  it('group 转发：EDIT/DELETE/PIN/SHARE_GROUP/FOCUS/DETAIL', () => {
    dispatchMenuAction('group', ACTIONS.EDIT, 'g1')
    expect(mocks.editGroup).toHaveBeenCalledWith('g1')
    dispatchMenuAction('group', ACTIONS.DELETE, 'g1')
    expect(mocks.deleteGroup).toHaveBeenCalledWith('g1')
    dispatchMenuAction('group', ACTIONS.SHARE_GROUP, 'g1')
    expect(mocks.shareGroup).toHaveBeenCalledWith('g1')
    dispatchMenuAction('group', ACTIONS.FOCUS, 'g1')
    expect(mocks.toggleGroupFocus).toHaveBeenCalledWith('g1')
    dispatchMenuAction('group', ACTIONS.DETAIL, 'g1')
    expect(mocks.openDetail).toHaveBeenCalledWith('group:g1')
  })

  it('sub VISIT → openDetail（查看详情语义）', () => {
    dispatchMenuAction('sub', ACTIONS.VISIT, 'b1')
    expect(mocks.openDetail).toHaveBeenCalledWith('b1')
  })
})

describe('menuConfig — buildLongPressItems', () => {
  it('list 布局 + 有账户的书签：EXPAND 显示且动态文案展开/收起', () => {
    ui.layoutMode = 'list'
    let items = buildLongPressItems('card', 'b1')
    expect(items[0].label).toBe('展开')
    ui.expandedIds = ['b1']
    items = buildLongPressItems('card', 'b1')
    expect(items[0].label).toBe('收起')
  })

  it('非 list 布局：EXPAND 条件项被过滤', () => {
    ui.layoutMode = 'grid'
    const items = buildLongPressItems('card', 'b1')
    expect(items.some(i => i.label === '展开' || i.label === '收起')).toBe(false)
    expect(items.map(i => i.label)).not.toContain('展开')
  })

  it('子书签：ADD_SUB 条件项被过滤（长按菜单）', () => {
    ds.bookmarks[0].parentId = 'p1'
    const items = buildLongPressItems('card', 'b1')
    expect(items.map(i => i.label)).not.toContain('添加子网站')
  })

  it('顶层书签：长按菜单含 添加子网站 且 action 走 dispatch', () => {
    const items = buildLongPressItems('card', 'b1')
    const sub = items.find(i => i.label === '添加子网站')
    expect(sub).toBeTruthy()
    sub?.action()
    expect(mocks.addSub).toHaveBeenCalledWith('b1')
  })

  it('置顶动态文案：已置顶 → 取消置顶', () => {
    ds.bookmarks[0].pinnedAt = 1
    const items = buildLongPressItems('card', 'b1')
    expect(items.find(i => i.label === '取消置顶')).toBeTruthy()
    expect(items.some(i => i.label === '置顶')).toBe(false)
  })

  it('私密空间（vault）：MOVE_TO_SPACE 被过滤', () => {
    ui.curSpace = 'vault'
    const items = buildLongPressItems('card', 'b1')
    expect(items.some(i => i.label === '设为私密')).toBe(false)
  })

  it('main 空间：MOVE_TO_SPACE 保留且 action 走 dispatch', () => {
    ui.curSpace = 'main'
    const items = buildLongPressItems('card', 'b1')
    const st = items.find(i => i.label === '设为私密')
    expect(st).toBeTruthy()
    st?.action()
    expect(mocks.moveBookmarksToVault).toHaveBeenCalledWith(['b1'])
  })

  it('组长按：含 聚焦编辑/分享组/删除组，EXPAND 依笔记条件', () => {
    ui.layoutMode = 'list'
    const items = buildLongPressItems('group', 'g1')
    const labels = items.map(i => i.label)
    expect(labels).toContain('聚焦编辑')
    expect(labels).toContain('分享组')
    expect(labels).toContain('删除组')
    expect(labels[0]).toBe('展开')
    const del = items.find(i => i.label === '删除组')
    expect(del?.danger).toBe(true)
  })

  it('组无笔记：EXPAND 条件项被过滤', () => {
    ui.layoutMode = 'list'
    ds.siblingGroups[0].notes = ''
    const items = buildLongPressItems('group', 'g1')
    expect(items.map(i => i.label)).not.toContain('展开')
  })
})
