/**
 * #9 回归：破坏性写工具白名单与「用户显式确认」门槛。
 * 注入到 RAG / 网页正文 / 附件全文里的指令可诱使模型直接调用 manage_bookmarks(delete/move)、
 * manage_settings(empty_trash/export_data)、merge_duplicates(confirm:true) 等写工具；模型
 * 参数里的 confirm:true 不算用户确认。未确认一律拒绝执行、只生成待确认卡片；经
 * confirmDestructiveTool() 登记一次性许可后才放行。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const executeManageBookmarks = vi.hoisted(() => vi.fn())
const executeManageSettings = vi.hoisted(() => vi.fn())
const mergeDuplicateBookmarks = vi.hoisted(() => vi.fn())

vi.mock('../../lib/ai/universalAgent.js', () => ({
  executeManageCategories: vi.fn(),
  executeManageTags: vi.fn(),
  executeManageBookmarks,
  executeManageWorkspaces: vi.fn(),
  executeManageSettings,
}))
vi.mock('../../lib/ai/siteActions.js', () => ({ mergeDuplicateBookmarks }))
vi.mock('../../lib/ai/siteCommander.js', () => ({
  dispatchSiteCommand: vi.fn(),
  batchTagBookmarks: vi.fn(),
}))

import {
  createAiAgentToolRunner,
  isDestructiveToolCall,
  confirmDestructiveTool,
  executeConfirmedDestructiveTool,
  resetDestructiveConfirmations,
} from '../../composables/domain/useAiChatAgent.js'
import { DYNAMIC_NOT_EXECUTED_PREFIX } from '../../lib/ai/toolResult.js'

function makeRunner() {
  return createAiAgentToolRunner({
    ds: {} as any,
    ui: {} as any,
    t: ((k: string) => k) as any,
    tN: ((_k: string, n: number) => String(n)) as any,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetDestructiveConfirmations()
  executeManageBookmarks.mockResolvedValue({
    success: true, message: '已删除书签', data: { id: 'b1', title: 't', url: 'u' },
  })
  executeManageSettings.mockResolvedValue({ success: true, message: '已清空回收站' })
  mergeDuplicateBookmarks.mockResolvedValue({ message: '已合并 2 个重复副本' })
})

describe('#9 isDestructiveToolCall 白名单', () => {
  it('破坏性动作命中白名单', () => {
    expect(isDestructiveToolCall({ name: 'manage_settings', arguments: { action: 'empty_trash' } })).toBe(true)
    expect(isDestructiveToolCall({ name: 'manage_settings', arguments: { action: 'export_data' } })).toBe(true)
    expect(isDestructiveToolCall({ name: 'manage_bookmarks', arguments: { action: 'delete' } })).toBe(true)
    expect(isDestructiveToolCall({ name: 'manage_bookmarks', arguments: { action: 'move' } })).toBe(true)
    expect(isDestructiveToolCall({ name: 'merge_duplicates', arguments: { confirm: true } })).toBe(true)
    expect(isDestructiveToolCall({ name: 'export_data' })).toBe(true)
  })

  it('非破坏性动作不拦（不删工具、不影响普通问答）', () => {
    expect(isDestructiveToolCall({ name: 'manage_settings', arguments: { action: 'toggle_theme' } })).toBe(false)
    expect(isDestructiveToolCall({ name: 'manage_bookmarks', arguments: { action: 'add' } })).toBe(false)
    expect(isDestructiveToolCall({ name: 'manage_bookmarks', arguments: { action: 'update' } })).toBe(false)
    expect(isDestructiveToolCall({ name: 'merge_duplicates', arguments: { confirm: false } })).toBe(false)
    expect(isDestructiveToolCall({ name: 'merge_duplicates' })).toBe(false)
    expect(isDestructiveToolCall({ name: 'audit_vault' })).toBe(false)
  })
})

describe('#9 runAgentToolCall 破坏性门槛', () => {
  it('manage_bookmarks delete 未确认 → 拒绝执行、生成待确认卡片、底层 execute 不被调用', async () => {
    const runner = makeRunner()
    const turn: any = { id: 't1', role: 'assistant', steps: [] }
    const res = await runner(turn, new AbortController(), {
      name: 'manage_bookmarks', arguments: { action: 'delete', target: 'x' },
    })
    expect(executeManageBookmarks).not.toHaveBeenCalled()
    expect(res).toContain('未执行')
    expect(res).toContain('proposed')
    expect(turn.actionCard?.actionName).toBe('confirm_destructive_tool')
    expect(turn.actionCard?.payload?.toolCall?.name).toBe('manage_bookmarks')
  })

  it('manage_settings empty_trash 未确认 → 拒绝执行', async () => {
    const runner = makeRunner()
    const turn: any = { id: 't1', role: 'assistant', steps: [] }
    const res = await runner(turn, new AbortController(), {
      name: 'manage_settings', arguments: { action: 'empty_trash' },
    })
    expect(executeManageSettings).not.toHaveBeenCalled()
    expect(res).toContain('未执行')
    expect(turn.actionCard?.actionName).toBe('confirm_destructive_tool')
  })

  it('merge_duplicates confirm:true（模型参数伪造确认）未经用户确认 → 不合并', async () => {
    const runner = makeRunner()
    const turn: any = { id: 't1', role: 'assistant', steps: [] }
    const res = await runner(turn, new AbortController(), {
      name: 'merge_duplicates', arguments: { confirm: true },
    })
    expect(mergeDuplicateBookmarks).not.toHaveBeenCalled()
    expect(res).toContain('未执行')
  })

  it('confirmDestructiveTool 登记许可后同一调用放行，且许可一次性消费', async () => {
    const call = { name: 'manage_bookmarks', arguments: { action: 'delete', target: 'x' } }
    confirmDestructiveTool(call)
    const runner = makeRunner()
    const turn: any = { id: 't1', role: 'assistant', steps: [] }
    const res = await runner(turn, new AbortController(), call)
    expect(executeManageBookmarks).toHaveBeenCalledTimes(1)
    expect(res).toBe('已删除书签')
    // 一次性：未再次确认的同签名调用重新被拒绝
    const res2 = await runner(turn, new AbortController(), call)
    expect(executeManageBookmarks).toHaveBeenCalledTimes(1)
    expect(res2).toContain('未执行')
  })
})

describe('#9 确认即执行（executeConfirmedDestructiveTool）', () => {
  const ctx = () => ({
    ds: {} as any,
    ui: {} as any,
    t: ((k: string) => k) as any,
    tN: ((_k: string, n: number) => String(n)) as any,
  })

  it('用户点确认后直接执行同一调用，无需重发指令', async () => {
    const turn: any = { id: 't-confirm', role: 'assistant', content: '', steps: [] }
    const res = await executeConfirmedDestructiveTool(
      { name: 'manage_bookmarks', arguments: { action: 'delete', target: 'x' } },
      ctx(),
      turn,
    )
    expect(executeManageBookmarks).toHaveBeenCalledTimes(1)
    expect(res).toBe('已删除书签')
    // 执行痕迹回写到同一回合，UI 才能像模型自行执行一样展示
    expect(turn.steps).toHaveLength(1)
    expect(turn.actionCard?.actionName).toBe('manage_bookmarks')
  })

  it('清空回收站确认后真的执行', async () => {
    const turn: any = { id: 't2', role: 'assistant', content: '', steps: [] }
    const res = await executeConfirmedDestructiveTool(
      { name: 'manage_settings', arguments: { action: 'empty_trash' } },
      ctx(),
      turn,
    )
    expect(executeManageSettings).toHaveBeenCalledTimes(1)
    expect(res).toBe('已清空回收站')
  })

  it('执行失败返回「未执行：」前缀文本，调用方据此提示失败并保留卡片可点', async () => {
    executeManageBookmarks.mockResolvedValue({ success: false, message: '目标不存在' })
    const turn: any = { id: 't3', role: 'assistant', content: '', steps: [] }
    const res = await executeConfirmedDestructiveTool(
      { name: 'manage_bookmarks', arguments: { action: 'delete', target: 'gone' } },
      ctx(),
      turn,
    )
    expect(res.startsWith(DYNAMIC_NOT_EXECUTED_PREFIX)).toBe(true)
    expect(res).toContain('目标不存在')
  })

  it('许可只消费一次：确认执行一次后，同签名再调 runner 仍被拒', async () => {
    const call = { name: 'merge_duplicates', arguments: { confirm: true } }
    const turn: any = { id: 't4', role: 'assistant', content: '', steps: [] }
    await executeConfirmedDestructiveTool(call, ctx(), turn)
    expect(mergeDuplicateBookmarks).toHaveBeenCalledTimes(1)
    const again = await makeRunner()({ id: 't5', role: 'assistant' } as any, new AbortController(), call)
    expect(mergeDuplicateBookmarks).toHaveBeenCalledTimes(1)
    expect(again).toContain('未执行')
  })
})
