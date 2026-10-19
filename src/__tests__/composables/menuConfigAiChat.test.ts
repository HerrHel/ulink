import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { ACTIONS } from '../../config/constants.js'
import {
  MENU_RULES,
  LONGPRESS_RULES,
  dispatchMenuAction,
  buildLongPressItems,
} from '../../lib/menuConfig.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

describe('menuConfig — 桌面右键菜单与移动端长按底栏直达 AI', () => {
  let ui: ReturnType<typeof useUIStore>
  let ds: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    ui = useUIStore()
    ds = useDataStore()
  })

  it('1. 规则声明：PC 右键与移动端长按规则均包含 AI_CHAT 动作', () => {
    expect(MENU_RULES.card.some((r) => r.action === ACTIONS.AI_CHAT)).toBe(true)
    expect(MENU_RULES.group.some((r) => r.action === ACTIONS.AI_CHAT)).toBe(true)

    expect(LONGPRESS_RULES.card.some((r) => r.action === ACTIONS.AI_CHAT)).toBe(true)
    expect(LONGPRESS_RULES.group.some((r) => r.action === ACTIONS.AI_CHAT)).toBe(true)
  })

  it('2. 长按构建：buildLongPressItems 为书签与笔记产出「询问 AI」菜单项', () => {
    const cardItems = buildLongPressItems('card', 'bm-test')
    expect(cardItems.some((item) => item.label === '询问 AI' || item.label.includes('AI'))).toBe(true)

    const groupItems = buildLongPressItems('group', 'sg-test')
    expect(groupItems.some((item) => item.label === '询问 AI' || item.label.includes('AI'))).toBe(true)
  })

  it('3. 书签直达 AI：dispatchMenuAction("card", AI_CHAT) 自动将书签附加到 AI 并呼起侧边栏', () => {
    const bm: Bookmark = {
      id: 'bm-ai-1',
      title: 'GitHub',
      url: 'https://github.com',
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
    }
    ds.addBookmark(bm)

    expect(ui.panels.detail).toBe(false)
    expect(ui.aiAttachedCards.length).toBe(0)

    dispatchMenuAction('card', ACTIONS.AI_CHAT, 'bm-ai-1')

    // 面板已展开
    expect(ui.panels.detail).toBe(true)
    // 附件卡片已自动装载进上下文
    expect(ui.aiAttachedCards).toEqual([{ type: 'bm', id: 'bm-ai-1' }])
  })

  it('4. 笔记直达 AI：dispatchMenuAction("group", AI_CHAT) 自动将笔记组附加到 AI 并呼起侧边栏', () => {
    const grp: SiblingGroup = {
      id: 'sg-ai-1',
      name: '架构规划',
      categoryId: 'cat-1',
      icon: '',
      order: 1,
      isExpanded: false,
      attributes: {},
      bookmarkIds: [],
      notes: '<p>规划草案</p>',
      updatedAt: 100,
      useCount: 0,
    }
    ds.addGroup(grp)

    dispatchMenuAction('group', ACTIONS.AI_CHAT, 'sg-ai-1')

    expect(ui.panels.detail).toBe(true)
    expect(ui.aiAttachedCards).toEqual([{ type: 'group', id: 'sg-ai-1' }])
  })
})
