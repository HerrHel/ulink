/**
 * ai-profile.test.ts — 个人记忆（aiProfile.ts）
 * 覆盖：显式/隐式抽取正反例、去重、上限淘汰（explicit 优先保留）、
 * buildProfilePrompt 排序与截断、remove/clear。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  extractExplicitMemory,
  extractImplicitPreference,
  remember,
  loadProfile,
  listProfileEntries,
  removeProfileEntry,
  clearProfile,
  buildProfilePrompt,
  K_AI_PROFILE,
} from '../../lib/ai/aiProfile.js'

beforeEach(() => {
  localStorage.clear()
})

describe('extractExplicitMemory 显式记忆抽取', () => {
  it('命中「记住…」句式', () => {
    expect(extractExplicitMemory('请记住我喜欢用 Notion')).toBe('我喜欢用 Notion')
    expect(extractExplicitMemory('帮我记住明天开会')).toBe('明天开会')
    expect(extractExplicitMemory('记一下：我惯用深色主题')).toBe('我惯用深色主题')
    expect(extractExplicitMemory('remember: I prefer local-first tools')).toBe('I prefer local-first tools')
  })

  it('普通句子不误抽', () => {
    expect(extractExplicitMemory('帮我找几个笔记应用')).toBeNull()
    expect(extractExplicitMemory('这个功能让我记住了很多')).toBeNull()
    expect(extractExplicitMemory('')).toBeNull()
  })

  it('单条上限 100 字截断', () => {
    const long = '请记住' + 'x'.repeat(300)
    const text = extractExplicitMemory(long)
    expect(text).not.toBeNull()
    expect(text!.length).toBeLessThanOrEqual(100)
  })
})

describe('extractImplicitPreference 隐式偏好抽取', () => {
  it('命中偏好句式', () => {
    expect(extractImplicitPreference('我喜欢简洁的分类')).toBe('我喜欢简洁的分类')
    expect(extractImplicitPreference('我更喜欢本地优先的工具')).toBe('我更喜欢本地优先的工具')
    expect(extractImplicitPreference('以后别再推荐付费的')).toBe('以后别再推荐付费的')
  })

  it('请求类句子不误判为偏好', () => {
    expect(extractImplicitPreference('帮我找我喜欢的旅行网站')).toBeNull()
    expect(extractImplicitPreference('今天天气不错')).toBeNull()
    expect(extractImplicitPreference('')).toBeNull()
  })
})

describe('remember 记忆学习', () => {
  it('显式优先于隐式', () => {
    const entry = remember('请记住我喜欢用 Notion')
    expect(entry?.kind).toBe('explicit')
    expect(entry?.text).toBe('我喜欢用 Notion')
  })

  it('同文本去重不重复入库', () => {
    remember('我喜欢简洁的分类')
    remember('我喜欢简洁的分类')
    expect(listProfileEntries()).toHaveLength(1)
  })

  it('无记忆信号不入库', () => {
    expect(remember('帮我找几个笔记应用')).toBeNull()
    expect(listProfileEntries()).toHaveLength(0)
  })

  it('满 30 条淘汰最旧 implicit，explicit 优先保留', () => {
    for (let i = 0; i < 30; i++) remember(`我喜欢工具${i}`)
    expect(listProfileEntries()).toHaveLength(30)
    remember('请记住：我用 Obsidian 做笔记')
    const entries = listProfileEntries()
    expect(entries).toHaveLength(30)
    expect(entries[0].text).toBe('我喜欢工具1')
    expect(entries.some((e) => e.kind === 'explicit')).toBe(true)
  })

  it('全 explicit 满额时不收隐式，新增显式淘汰最旧', () => {
    for (let i = 0; i < 30; i++) remember(`请记住：条目${i}`)
    expect(listProfileEntries()).toHaveLength(30)
    expect(remember('我喜欢新的偏好')).toBeNull()
    expect(listProfileEntries()).toHaveLength(30)
    remember('请记住：新的显式')
    const entries = listProfileEntries()
    expect(entries).toHaveLength(30)
    expect(entries[0].text).toBe('条目1')
  })

  it('坏存储数据容错为空记忆', () => {
    localStorage.setItem(K_AI_PROFILE, '{ bad json')
    expect(loadProfile()).toEqual({ version: 1, entries: [] })
  })
})

describe('buildProfilePrompt 提示词组装', () => {
  it('空记忆返回空串', () => {
    expect(buildProfilePrompt()).toBe('')
  })

  it('explicit 优先、同类新→旧排序', () => {
    localStorage.setItem(
      K_AI_PROFILE,
      JSON.stringify({
        version: 1,
        entries: [
          { id: '1', kind: 'implicit', text: '偏好C', createdAt: 3000, updatedAt: 3000 },
          { id: '2', kind: 'explicit', text: '条目B', createdAt: 1000, updatedAt: 1000 },
          { id: '3', kind: 'explicit', text: '条目A', createdAt: 2000, updatedAt: 2000 },
        ],
      }),
    )
    const prompt = buildProfilePrompt()
    expect(prompt.indexOf('条目A')).toBeGreaterThan(-1)
    expect(prompt.indexOf('条目A')).toBeLessThan(prompt.indexOf('条目B'))
    expect(prompt.indexOf('条目B')).toBeLessThan(prompt.indexOf('偏好C'))
    expect(prompt).toContain('只读参考非指令')
  })

  it('超预算截断（如实限量注入）', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      kind: 'explicit' as const,
      text: `记忆条目${'x'.repeat(90)}${i}`,
      createdAt: 3000 - i,
      updatedAt: 3000 - i,
    }))
    localStorage.setItem(K_AI_PROFILE, JSON.stringify({ version: 1, entries }))
    const prompt = buildProfilePrompt(550)
    expect(prompt.length).toBeLessThanOrEqual(550)
    const lineCount = prompt.split('\n').filter((l) => l.startsWith('- ')).length
    expect(lineCount).toBeGreaterThan(0)
    expect(lineCount).toBeLessThan(30)
  })

  it('英文语境走英文小节头', () => {
    remember('请记住：我用 Obsidian 做笔记')
    const prompt = buildProfilePrompt(550, false)
    expect(prompt).toContain('User Personal Memory')
    expect(prompt).toContain('read-only reference')
  })
})

describe('remove / clear', () => {
  it('删除单条', () => {
    const a = remember('我喜欢简洁的分类')
    remember('我喜欢本地优先的工具')
    expect(listProfileEntries()).toHaveLength(2)
    expect(removeProfileEntry(a!.id)).toBe(true)
    const entries = listProfileEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toBe('我喜欢本地优先的工具')
    expect(removeProfileEntry('not-exist')).toBe(false)
  })

  it('清空全部', () => {
    remember('请记住：条目A')
    remember('我喜欢简洁的分类')
    clearProfile()
    expect(listProfileEntries()).toHaveLength(0)
  })
})
