import { describe, it, expect, beforeEach } from 'vitest'
import {
  renameSession,
  saveSessions,
  loadSessions,
  K_AI_SESSIONS,
  type AiChatSession,
  type ChatTurn,
} from '../../lib/ai/chatSessions.js'

function turn(role: 'user' | 'assistant', content: string): ChatTurn {
  return { id: role + content, role, content, timestamp: 0 }
}

function session(id: string, title: string, turns: ChatTurn[], updatedAt: number): AiChatSession {
  return { id, title, turns, createdAt: 1, updatedAt }
}

beforeEach(() => {
  localStorage.removeItem(K_AI_SESSIONS)
  localStorage.removeItem('lv_ai_cur_session_v1')
})

describe('renameSession — 会话标题就地重命名', () => {
  it('写入自定义标题并落盘', () => {
    saveSessions([
      session('s1', '旧标题', [turn('user', '帮我找 bug')], 100),
    ])
    const list = renameSession('s1', '  季度复盘  ')
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('季度复盘')
    expect(loadSessions()[0].title).toBe('季度复盘')
  })

  it('压缩连续空白并截断到 60 字', () => {
    saveSessions([session('s1', '', [turn('user', 'hi')], 100)])
    const long = 'A'.repeat(80)
    expect(renameSession('s1', `  多  空格  ${long}`)[0].title).toBe(`多 空格 ${'A'.repeat(55)}`)
  })

  it('空标题 = 交还自动命名：由首条提问重新提炼', () => {
    saveSessions([session('s1', '我起的名字', [turn('user', '帮我为书签补打标签')], 100)])
    expect(renameSession('s1', '')[0].title).toBe('帮我为书签补打标签')
  })

  it('没有可用提问时清空标题（展示侧回落到默认标题）', () => {
    saveSessions([session('s1', '我起的名字', [], 100)])
    expect(renameSession('s1', '   ')[0].title).toBe('')
  })

  it('空标题优先用调用方传入的内存首问，避免磁盘已截断/已脱敏的数据', () => {
    const turns: ChatTurn[] = [turn('user', '真正的第一条提问')]
    for (let i = 1; i <= 40; i++) turns.push(turn('user', `第${i + 1}条提问内容`))
    saveSessions([session('s1', '自定义', turns, 100)])
    expect(renameSession('s1', '', '真正的第一条提问')[0].title).toBe('真正的第一条提问')
    // 不传 fallbackQuery 时仍回落到磁盘副本（保留旧调用兼容）
    expect(renameSession('s1', '')[0].title).not.toBe('真正的第一条提问')
  })

  it('自动命名与自定义标题都按码点截断，不产生孤立代理项', () => {
    saveSessions([session('s1', '', [turn('user', 'hi')], 100)])
    const title = renameSession('s1', '😀'.repeat(70))[0].title
    expect(Array.from(title)).toHaveLength(60)
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('改名不动 updatedAt，历史列表不会因此重排', () => {
    saveSessions([
      session('old', '旧的', [turn('user', 'a')], 100),
      session('new', '新的', [turn('user', 'b')], 200),
    ])
    const list = renameSession('old', '改过的旧的')
    expect(list.map((s) => s.id)).toEqual(['new', 'old'])
    expect(list.find((s) => s.id === 'old')!.updatedAt).toBe(100)
  })

  it('未知会话 id 原样返回，不新建脏数据', () => {
    saveSessions([session('s1', '原标题', [turn('user', 'x')], 100)])
    const list = renameSession('nope', '标题')
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('原标题')
  })
})
