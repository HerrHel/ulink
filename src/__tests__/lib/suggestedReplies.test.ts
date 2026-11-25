/** AI 对话预判快捷回复：预置文案随界面语言，点击意图中英文都认 */
import { describe, it, expect, afterEach } from 'vitest'
import { presetReplies, classifyReply } from '../../lib/ai/suggestedReplies.js'
import { setLocale, loadLocale } from '../../i18n/index.js'

afterEach(() => setLocale('zh-CN'))

describe('presetReplies', () => {
  it('中文界面给中文胶囊', () => {
    setLocale('zh-CN')
    expect(presetReplies('sites')).toEqual(['全部一键加入收藏', '🇨🇳 只要国内免翻直连的', '还有其他同类吗？'])
    expect(presetReplies('note')).toEqual(['存为卡片笔记', '帮我找类似工具'])
  })

  it('英文界面全部是英文，不夹中文', async () => {
    setLocale('en-US')
    await loadLocale('en-US')
    for (const kind of ['sites', 'sitesShort', 'action', 'note'] as const) {
      for (const r of presetReplies(kind)) expect(r, kind).not.toMatch(/[一-鿿]/)
    }
  })
})

describe('classifyReply', () => {
  it('每个预置胶囊在两种语言下都判到正确动作', async () => {
    for (const loc of ['zh-CN', 'en-US'] as const) {
      setLocale(loc)
      await loadLocale(loc)
      const [saveAll, narrow, more] = presetReplies('sites')
      expect(classifyReply(saveAll), loc).toBe('saveAll')
      expect(classifyReply(narrow), loc).toBeNull()
      expect(classifyReply(more), loc).toBeNull()
      const [doIt, another, adjust] = presetReplies('action')
      expect(classifyReply(doIt), loc).toBe('confirm')
      expect(classifyReply(another), loc).toBeNull()
      expect(classifyReply(adjust), loc).toBeNull()
      const [saveNote, similar] = presetReplies('note')
      expect(classifyReply(saveNote), loc).toBe('saveAsNote')
      expect(classifyReply(similar), loc).toBeNull()
    }
  })

  it('模型自拟的胶囊按关键词认', () => {
    expect(classifyReply('好的，按方案A执行')).toBe('confirm')
    expect(classifyReply('Sounds good, go ahead with plan A')).toBe('confirm')
    expect(classifyReply('Save them all')).toBe('saveAll')
    expect(classifyReply('Save this as a note')).toBe('saveAsNote')
    expect(classifyReply('Any alternatives?')).toBeNull()
  })
})

describe('extractWorkspaceTopic：行动卡主题名', async () => {
  const { extractWorkspaceTopic } = await import('../../lib/ai/siteActions.js')
  it('英文去掉请求开场白、按词截断、首字母大写（不再出现「Find me a few fr」）', () => {
    expect(extractWorkspaceTopic('Find me a few free online drawing tools')).toBe('Free online drawing tools')
    expect(extractWorkspaceTopic('Can you recommend some good note-taking apps?')).toBe('Note-taking apps')
    expect(extractWorkspaceTopic('please suggest the best tools for learning Japanese grammar quickly'))
      .toBe('Tools for learning Japanese')
    expect(extractWorkspaceTopic('Photo editors')).toBe('Photo editors')
  })
  it('中文行为不变：去开场白截 16 字', () => {
    expect(extractWorkspaceTopic('帮我找几个免费的在线画图工具')).toBe('几个免费的在线画图工具')
    expect(extractWorkspaceTopic('推荐前端开发工具！')).toBe('前端开发工具')
  })
  it('只有开场白时返回空串，交给调用方回退', () => {
    expect(extractWorkspaceTopic('Find me some')).toBe('')
    expect(extractWorkspaceTopic('   ')).toBe('')
  })
})
