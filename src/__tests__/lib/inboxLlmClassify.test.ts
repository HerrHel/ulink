import { classifyWithLlm, parseLlmClassifyReply } from '../../lib/ai/inboxLlmClassify.js'
import { createInboxZeroDraftDiff, applyDraftDiff } from '../../lib/ai/draftDiff.js'
import { popUndoAction, clearUndoStack } from '../../lib/ai/siteUndoStack.js'
import type { Category } from '../../types.js'

const askMock = vi.hoisted(() => vi.fn())
const enabledMock = vi.hoisted(() => vi.fn(() => true))
vi.mock('../../lib/ai/mimoClient.js', () => ({
  askMiMoRaw: askMock,
  getMiMoConfig: () => ({ enabled: enabledMock() }),
}))

const cats = [
  { id: 'c-mail', name: '邮箱' },
  { id: 'c-nas', name: 'NAS' },
] as Category[]

describe('inboxLlmClassify — 大模型兜底归类', () => {
  beforeEach(() => {
    askMock.mockReset()
    enabledMock.mockReturnValue(true)
  })

  it('只发标题与主机名，不发路径/参数；私有地址只发标题', async () => {
    askMock.mockResolvedValue('[]')
    await classifyWithLlm(
      [
        { id: 'a', title: 'Outlook', url: 'https://www.outlook.com/mail/inbox?token=SECRET' },
        { id: 'b', title: '群晖', url: 'http://192.168.1.10:5000/webman' },
      ],
      cats,
    )
    const user = askMock.mock.calls[0][0][1].content as string
    expect(user).toContain('Outlook (outlook.com)')
    expect(user).not.toContain('SECRET')
    expect(user).not.toContain('/mail')
    expect(user).not.toContain('192.168')
    expect(user).toContain('2. 群晖')
  })

  it('只接受现有分类名（忽略大小写），新造分类与越界编号被丢弃', async () => {
    askMock.mockResolvedValue('好的：[{"i":1,"c":"邮箱"},{"i":2,"c":"nas"},{"i":3,"c":"新分类"},{"i":9,"c":"邮箱"}]')
    const res = await classifyWithLlm(
      [
        { id: 'a', title: 'Gmail', url: 'https://mail.google.com' },
        { id: 'b', title: '群晖', url: 'http://192.168.1.10' },
        { id: 'c', title: '未知站点', url: 'https://x.example' },
      ],
      cats,
    )
    expect([...res.assignments]).toEqual([['a', 'c-mail'], ['b', 'c-nas']])
    expect(res.sentCount).toBe(3)
    expect(res.error).toBeUndefined()
  })

  it('AI 未开启时不发请求并返回 disabled', async () => {
    enabledMock.mockReturnValue(false)
    const res = await classifyWithLlm([{ id: 'a', title: 'x' }], cats)
    expect(askMock).not.toHaveBeenCalled()
    expect(res.error).toBe('disabled')
  })

  it('请求失败 fail-open：返回空结果与错误原因', async () => {
    askMock.mockRejectedValue(new Error('额度已用完'))
    const res = await classifyWithLlm([{ id: 'a', title: 'x' }], cats)
    expect(res.assignments.size).toBe(0)
    expect(res.error).toBe('额度已用完')
  })

  it('parseLlmClassifyReply 容错破损 JSON 与前后干扰方括号', () => {
    expect(parseLlmClassifyReply('not json')).toEqual([])
    expect(parseLlmClassifyReply('[{"i":1,"c":"A"},{"i":"x","c":"B"}]')).toEqual([{ i: 1, c: 'A' }])
    expect(parseLlmClassifyReply('[说明] 结果如下：[{"i":1,"c":"[Dev]"},{"i":2,"c":"NAS"}]\n注：[1] 已匹配')).toEqual([
      { i: 1, c: '[Dev]' },
      { i: 2, c: 'NAS' },
    ])
  })
})

describe('draftDiff — 笔记组归类项应用与撤销', () => {
  it('未命名笔记组的草稿标题回退「未命名笔记」，不误显「未分类」', () => {
    const group = { id: 'g-unnamed', name: '', categoryId: 'uncategorized', bookmarkIds: [] } as any
    const payload = createInboxZeroDraftDiff({
      assignableClusters: [],
      relations: [],
      groupMoves: [{ group, categoryId: 'c-mail', categoryName: '邮箱' }],
    })
    expect(payload.items[0].title).toBe('未命名笔记')
    expect(payload.items[0].before?.categoryName).toBe('未分类')
  })

  it('diff-gmove 项改组分类，撤销恢复原分类', async () => {
    clearUndoStack()
    const group = { id: 'g1', name: '笔记', categoryId: 'uncategorized', bookmarkIds: [] } as any
    const ds: any = {
      bookmarkMap: {},
      groupMap: { g1: group },
      siblingGroups: [group],
      updateGroup: vi.fn((id: string, ch: any) => Object.assign(group, ch)),
    }
    const app: any = { save: vi.fn() }
    const payload = createInboxZeroDraftDiff({
      assignableClusters: [],
      relations: [],
      groupMoves: [{ group, categoryId: 'c-mail', categoryName: '邮箱' }],
    })
    expect(payload.items[0]).toMatchObject({ id: 'diff-gmove-g1', itemType: 'group', changeType: 'modify' })
    const res = await applyDraftDiff(payload, { ds, app })
    expect(res.appliedCount).toBe(1)
    expect(group.categoryId).toBe('c-mail')

    const action = popUndoAction()
    expect(action).not.toBeNull()
    await action!.revert()
    expect(group.categoryId).toBe('uncategorized')
  })
})
