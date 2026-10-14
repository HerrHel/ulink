import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadSessions,
  saveSessions,
  createNewSession,
  updateSession,
  deleteSessionById,
  clearAllSessions,
  extractSessionTitle,
  getCurrentSessionId,
  setCurrentSessionId,
} from '../lib/ai/chatSessions.js'

describe('chatSessions — AI 侧边栏多会话与历史管理', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('空缓存时 loadSessions 返回空数组', () => {
    expect(loadSessions()).toEqual([])
    expect(getCurrentSessionId()).toBeNull()
  })

  it('createNewSession 创建并成为当前会话', () => {
    const s = createNewSession('测试会话')
    expect(s.title).toBe('测试会话')
    expect(getCurrentSessionId()).toBe(s.id)
    const list = loadSessions()
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(s.id)

    // 测试手动 setCurrentSessionId 与 saveSessions
    setCurrentSessionId('custom_id')
    expect(getCurrentSessionId()).toBe('custom_id')
    saveSessions([{ ...s, title: '修改标题' }])
    expect(loadSessions()[0].title).toBe('修改标题')
  })

  it('updateSession 自动提取首句为标题', () => {
    const s = createNewSession()
    expect(s.title).toBe('新会话')

    updateSession(s.id, [
      { id: '1', role: 'user', content: '推荐几个好用的思维导图工具', timestamp: Date.now() },
      { id: '2', role: 'assistant', content: '找到以下工具', timestamp: Date.now() },
    ])

    const list = loadSessions()
    expect(list[0].title).toBe('推荐几个好用的思维导图工具')
    expect(list[0].turns.length).toBe(2)
  })

  it('deleteSessionById 删除并切换当前会话', () => {
    const s1 = createNewSession('会话1')
    const s2 = createNewSession('会话2')
    expect(getCurrentSessionId()).toBe(s2.id)

    deleteSessionById(s2.id)
    const list = loadSessions()
    expect(list.length).toBe(1)
    expect(list[0].id).toBe(s1.id)
    expect(getCurrentSessionId()).toBe(s1.id)
  })

  it('clearAllSessions 清空全部会话', () => {
    createNewSession('会话1')
    createNewSession('会话2')
    expect(loadSessions().length).toBe(2)

    clearAllSessions()
    expect(loadSessions().length).toBe(0)
    expect(getCurrentSessionId()).toBeNull()
  })

  it('extractSessionTitle 正确裁剪斜杠与长文本', () => {
    expect(extractSessionTitle('/help')).toBe('help')
    expect(extractSessionTitle('   一个非常非常非常非常非常非常非常非常非常长的标题需求')).toContain('…')
  })

  it('支持备份会话重新插入还原 (撤销删除场景)', () => {
    const s = createNewSession('待恢复会话')
    deleteSessionById(s.id)
    expect(loadSessions().length).toBe(0)

    const all = loadSessions()
    all.unshift(s)
    saveSessions(all)
    setCurrentSessionId(s.id)

    expect(loadSessions().length).toBe(1)
    expect(loadSessions()[0].title).toBe('待恢复会话')
    expect(getCurrentSessionId()).toBe(s.id)
  })

  it('ChatActionCard 支持 executing、completed 与 resultGid 状态保存与还原', () => {
    const s = createNewSession('行动卡测试')
    updateSession(s.id, [
      {
        id: 'turn-1',
        role: 'user',
        content: '/pack UI设计',
        timestamp: Date.now(),
      },
      {
        id: 'turn-2',
        role: 'assistant',
        content: '已甄选工具',
        timestamp: Date.now(),
        actionCard: {
          type: 'custom',
          title: '一键创建「UI设计 工作台」',
          buttonText: '立即创建',
          actionName: 'create_topic_workspace',
          executing: false,
          completed: true,
          resultGid: 'sg_123',
          resultCatId: 'cat_design',
        },
      },
    ])

    const loaded = loadSessions()
    expect(loaded[0].turns[1].actionCard?.completed).toBe(true)
    expect(loaded[0].turns[1].actionCard?.resultGid).toBe('sg_123')
    expect(loaded[0].turns[1].actionCard?.resultCatId).toBe('cat_design')
  })
})
