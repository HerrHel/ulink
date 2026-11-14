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
  K_AI_SESSIONS,
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
    // 默认标题留空（展示侧走 i18n 默认标题），不再是硬编码中文
    expect(s.title).toBe('')

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

  it('ChatActionCard 支持 selectedCandidateUrls 暂存与持久化', () => {
    const s = createNewSession('微操测试')
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
          title: '一键创建',
          buttonText: '立即创建',
          actionName: 'create_topic_workspace',
          selectedCandidateUrls: ['https://figma.com', 'https://penpot.app'],
        },
      },
    ])

    const loaded = loadSessions()
    expect(loaded[0].turns[1].actionCard?.selectedCandidateUrls).toEqual([
      'https://figma.com',
      'https://penpot.app',
    ])
  })
})

/**
 * #34 回归：saveSessions 落盘脱敏完整性 + 媒体 dataUrl 一律不落盘。
 * 旧实现注释称「全部文本字段统一脱敏」，但 sendSummary / candidates / attachedCards /
 * title / actionCard.payload 未过 redactSensitivePatterns；attachedFiles.dataUrl
 * ≤32768 字符的小图明文 base64 也会落盘。
 */
describe('#34 saveSessions 落盘脱敏完整性与媒体 dataUrl 不落盘', () => {
  const SK = 'sk-abcdefghij1234567890' // 命中 SK_KEY_RE → [REDACTED_API_KEY]
  const KV = 'password: supersecret123' // 命中 KV_SECRET_RE → [REDACTED]

  function rawPersisted(): string {
    return localStorage.getItem(K_AI_SESSIONS) || ''
  }

  function makeSession(): any {
    const turn = {
      id: 't1', role: 'assistant', content: '正文', timestamp: 1,
      sendSummary: { focusedGroup: { name: `工作台 ${SK}`, shown: 1, total: 1 }, toolsSchemaChars: 10 },
      candidates: [{ title: `候选 ${SK}`, url: 'https://a.example', notes: `备注 ${KV}` }],
      attachedCards: [{ type: 'bm', id: 'b1', title: `附件卡 ${SK}`, url: 'https://b.example' }],
      actionCard: {
        type: 'custom', title: '执行卡', buttonText: '执行', actionName: 'do_it',
        payload: { token: SK, nested: { credential: KV } },
        selectedCandidateUrls: ['https://figma.com'],
      },
      attachedFiles: [
        // 小图（≤32768 字符）：旧实现会明文落盘，修复后一律不落盘
        { name: 'small.png', type: 'image/png', size: 10, dataUrl: 'data:image/png;base64,AAAA', textContent: `附件正文 ${SK}` },
        { name: 'big.png', type: 'image/png', size: 10, dataUrl: 'data:image/png;base64,' + 'B'.repeat(40000), textContent: '' },
      ],
    }
    return { id: 's1', title: `会话标题 ${SK}`, createdAt: 1, updatedAt: 1, turns: [turn] }
  }

  it('sendSummary/candidates/attachedCards/title/actionCard.payload 全部脱敏（落盘无密钥明文）', () => {
    saveSessions([makeSession()])
    const raw = rawPersisted()

    expect(raw).not.toContain(SK)
    expect(raw).not.toContain('supersecret123')
    expect(raw).toContain('[REDACTED')
  })

  it('媒体 dataUrl 一律不落盘（小图也不持久化），textContent 仍脱敏', () => {
    saveSessions([makeSession()])
    const raw = rawPersisted()

    expect(raw).not.toContain('data:image/png;base64')
    const loaded = loadSessions()
    expect(loaded[0].turns[0].attachedFiles?.[0].dataUrl).toBeUndefined()
    expect(loaded[0].turns[0].attachedFiles?.[1].dataUrl).toBeUndefined()
    expect(loaded[0].turns[0].attachedFiles?.[0].textContent).not.toContain(SK)
  })

  it('loadSessions 读取兼容：缺 dataUrl 降级、结构与字段完整保留', () => {
    saveSessions([makeSession()])
    const loaded = loadSessions()

    expect(loaded).toHaveLength(1)
    const t = loaded[0].turns[0]
    expect(t.actionCard?.selectedCandidateUrls).toEqual(['https://figma.com'])
    expect(t.actionCard?.payload).toBeDefined()
    expect(t.candidates?.[0].url).toBe('https://a.example') // 非敏感 URL 原样保留
    expect(t.attachedCards?.[0].id).toBe('b1')
    // 脱敏后 payload 仍是原结构（键保留、值替换为脱敏文本）
    expect((t.actionCard?.payload as any)?.nested?.credential).toContain('[REDACTED')
  })
})
