import { describe, it, expect, beforeEach, vi } from 'vitest'
import { batchTagBookmarks } from '../../lib/ai/siteActions.js'
import { buildUlinkSystemPrompt } from '../../lib/ai/mimoPrompt.js'
import { popUndoAction, clearUndoStack } from '../../lib/ai/siteUndoStack.js'
import { createAiAgentToolRunner } from '../../composables/domain/useAiChatAgent.js'
import { useAiActionCards } from '../../composables/domain/useAiActionCards.js'
import { ref } from 'vue'
import type { Bookmark, Category, CustomAttribute } from '../../types.js'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

describe('batchTagBookmarks & Bookmark Hierarchy Governance', () => {
  let mockDs: any
  let mockApp: any
  let mockUi: any

  beforeEach(() => {
    clearUndoStack()
    vi.clearAllMocks()

    const bms: Bookmark[] = [
      {
        id: 'bm-top-1',
        title: '抖音',
        url: 'https://douyin.com',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'cat-media',
        parentId: null,
        order: 1,
        useCount: 10,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-top-2',
        title: 'Baraag 主站',
        url: 'https://baraag.net',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'cat-art',
        parentId: null,
        order: 2,
        useCount: 5,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-sub-1',
        title: 'Baraag 账号 A',
        url: 'https://baraag.net/@userA',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'cat-art',
        parentId: 'bm-top-2',
        order: 3,
        useCount: 1,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 'bm-sub-2',
        title: 'Baraag 账号 B',
        url: 'https://baraag.net/@userB',
        username: '',
        password: '',
        notes: '',
        icon: '',
        categoryId: 'cat-art',
        parentId: 'bm-top-2',
        order: 4,
        useCount: 1,
        attributes: {},
        isExpanded: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]

    const customAttrs: CustomAttribute[] = [
      { id: 'attr-video', name: '视频', type: 'boolean' },
      { id: 'attr-art', name: '艺术', type: 'boolean' },
    ]

    mockDs = {
      bookmarks: bms,
      bookmarkMap: Object.fromEntries(bms.map((b) => [b.id, b])),
      customAttributes: customAttrs,
      attributeMap: Object.fromEntries(customAttrs.map((a) => [a.id, a])),
      categories: [
        { id: 'cat-media', name: '媒体娱乐' },
        { id: 'cat-art', name: '艺术创作' },
      ],
      updateBookmark: vi.fn((id: string, patch: Partial<Bookmark>) => {
        const idx = mockDs.bookmarks.findIndex((b: any) => b.id === id)
        if (idx >= 0) {
          mockDs.bookmarks[idx] = { ...mockDs.bookmarks[idx], ...patch }
          mockDs.bookmarkMap[id] = mockDs.bookmarks[idx]
        }
      }),
      addAttribute: vi.fn((attr: CustomAttribute) => {
        mockDs.customAttributes.push(attr)
        mockDs.attributeMap[attr.id] = attr
      }),
    }

    mockApp = {
      save: vi.fn(),
    }

    mockUi = {
      app: mockApp,
    }
  })

  describe('1. 严格区分顶级书签与从属子书签的 Prompt 构造', () => {
    it('Prompt 正确披露全量未打标宏观统计，且区分顶级独立站点与从属子书签', () => {
      const promptZh = buildUlinkSystemPrompt({
        categories: mockDs.categories,
        customAttributes: mockDs.customAttributes,
        isZh: true,
        contextSlice: {
          untaggedBookmarks: [
            { id: 'bm-top-1', title: '抖音', url: 'https://douyin.com', category: '媒体娱乐' },
            { id: 'bm-top-2', title: 'Baraag 主站', url: 'https://baraag.net', category: '艺术创作' },
          ],
          untaggedStats: {
            totalCount: 4,
            topLevelCount: 2,
            subCount: 2,
            subGroupSummary: '父站点「Baraag 主站」下挂 2 个子页面/子账号',
          },
        },
      })

      expect(promptZh).toContain('全库共有 4 个未打标书签（其中顶级独立书签 2 个，子书签 2 个')
      expect(promptZh).toContain('【待打标顶级独立站点】：[抖音')
      expect(promptZh).toContain('【从属子书签概况（挂载于父站点下，不与顶级站点混杂）】：父站点「Baraag 主站」下挂 2 个子页面/子账号')
      expect(promptZh).toContain('batch_tag_bookmarks')
    })

    it('英文模式下同样支持结构化分层统计与工具提示', () => {
      const promptEn = buildUlinkSystemPrompt({
        categories: mockDs.categories,
        customAttributes: mockDs.customAttributes,
        isZh: false,
        contextSlice: {
          untaggedBookmarks: [
            { id: 'bm-top-1', title: 'Douyin', url: 'https://douyin.com' },
          ],
          untaggedStats: {
            totalCount: 4,
            topLevelCount: 2,
            subCount: 2,
            subGroupSummary: 'Parent site "Baraag" has 2 child accounts',
          },
        },
      })

      expect(promptEn).toContain('Total untagged in vault: 4 (2 top-level independent sites, 2 child bookmarks')
      expect(promptEn).toContain('Child bookmarks (nested under parent sites, separated from top-level)')
      expect(promptEn).toContain('batch_tag_bookmarks')
    })
  })

  describe('2. batchTagBookmarks 批量打标与 Undo 撤销事务', () => {
    it('支持按 bookmarkId、URL、标准化 URL 或 Title 精准打标，并可完整撤销', async () => {
      const res = await batchTagBookmarks(
        [
          { bookmarkId: 'bm-top-1', tags: ['视频', '娱乐短视频'] },
          { url: 'https://baraag.net/', tags: ['艺术'] },
        ],
        { ds: mockDs, app: mockApp },
      )

      expect(res.success).toBe(true)
      expect(res.taggedCount).toBe(2)

      // 验证属性写入
      const douyin = mockDs.bookmarks.find((b: any) => b.id === 'bm-top-1')
      expect(douyin.attributes['attr-video']).toBe(true) // 复用已有 attr
      expect(Object.keys(douyin.attributes).length).toBe(2) // 增加了新生成的 '娱乐短视频' 属性

      // 验证新增属性注册
      const createdAttr = mockDs.customAttributes.find((a: any) => a.name === '娱乐短视频')
      expect(createdAttr).toBeDefined()

      const baraag = mockDs.bookmarks.find((b: any) => b.id === 'bm-top-2')
      expect(baraag.attributes['attr-art']).toBe(true)

      // 验证 Undo 事务栈入栈
      const undoAction = popUndoAction()
      expect(undoAction).not.toBeNull()
      expect(undoAction?.type).toBe('batch_tag_bookmarks')

      // 执行回滚
      const revertMsg = await undoAction?.revert()
      expect(revertMsg).toContain('已撤销 2 个书签的标签变更')

      // 验证回滚后书签属性复原为空
      const douyinReverted = mockDs.bookmarks.find((b: any) => b.id === 'bm-top-1')
      const baraagReverted = mockDs.bookmarks.find((b: any) => b.id === 'bm-top-2')
      expect(douyinReverted.attributes).toEqual({})
      expect(baraagReverted.attributes).toEqual({})
    })

    it('空列表或找不到书签时安全早退不报错', async () => {
      const res1 = await batchTagBookmarks([], { ds: mockDs, app: mockApp })
      expect(res1.success).toBe(false)
      expect(res1.taggedCount).toBe(0)

      const res2 = await batchTagBookmarks([{ url: 'https://non-existent.com', tags: ['标签'] }], { ds: mockDs, app: mockApp })
      expect(res2.success).toBe(false)
      expect(res2.taggedCount).toBe(0)
    })
  })

  describe('3. Agent 工具执行器调用 batch_tag_bookmarks', () => {
    it('createAiAgentToolRunner 成功调度 batch_tag_bookmarks 并挂载执行卡片', async () => {
      const runner = createAiAgentToolRunner({
        ds: mockDs,
        ui: mockUi,
        t: (k: string) => k,
        tN: (_k: string, n: number) => String(n),
      })

      const assistantTurn: any = { id: 'turn-1', role: 'assistant', steps: [] }
      const controller = new AbortController()

      const result = await runner(assistantTurn, controller, {
        name: 'batch_tag_bookmarks',
        arguments: {
          items: [
            { bookmarkId: 'bm-top-1', tags: ['视频'] },
          ],
        },
      })

      expect(result).toContain('已成功为 1 个书签写入标签')
      expect(assistantTurn.steps.length).toBeGreaterThan(0)
      expect(assistantTurn.actionCard).toBeDefined()
      expect(assistantTurn.actionCard.completed).toBe(true)
      expect(assistantTurn.actionCard.actionName).toBe('batch_tag_bookmarks')
    })
  })

  describe('4. Action Card 一键执行通道', () => {
    it('useAiActionCards 能够点击卡片触发批量打标并推入新对话轮次', async () => {
      const chatTurns = ref<any[]>([])
      const sessions = ref<any[]>([])
      const currentSessionId = ref('test-session')

      const { handleActionCardClick } = useAiActionCards({
        ds: mockDs,
        ui: mockUi,
        chatTurns,
        sessions,
        currentSessionId,
        t: (k: string) => k,
        tN: (_k: string, n: number) => String(n),
      })

      const card: any = {
        type: 'custom',
        actionName: 'batch_tag_bookmarks',
        title: '批量打标',
        buttonText: '执行',
        completed: false,
        payload: {
          items: [
            { bookmarkId: 'bm-top-1', tags: ['视频'] },
          ],
        },
      }

      await handleActionCardClick(card, { id: 't1', role: 'assistant' } as any)

      expect(card.completed).toBe(true)
      expect(chatTurns.value.length).toBe(1)
      expect(chatTurns.value[0].content).toContain('已成功为 1 个书签写入标签')
    })
  })
})
