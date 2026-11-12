/**
 * 会话一致性防御回归（审计 #16/#17/#18/#24）
 *
 * 四类问题的共同根因是「同一份数据在不同层/不同实例里各写一套规则」：
 *   #16 兜底文案两套键 → 同一会话在列表与顶栏显示不同名字
 *   #17 抽屉搜索对 localStorage 坏数据无类型防护 → 整列渲染中断
 *   #18 展开态键集合只增不删 → 随会话切换无限增长
 *   #24 跨实例落盘不看磁盘 → 复活已被另一实例删除的会话
 * 前两条有可断言的纯函数/文案产物，后两条是接线不变式，用去注释源码钉住。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchesSessionQuery } from '../lib/ai/sessionSearch.js'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const readCode = (p: string) =>
  read(p)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|\s)\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('会话搜索的类型防护（审计 #17）', () => {
  it('正常标题与正文可命中（大小写不敏感）', () => {
    const s = { title: 'Bookmark Cleanup', turns: [{ content: '整理标签' }] }
    expect(matchesSessionQuery(s, 'bookmark')).toBe(true)
    expect(matchesSessionQuery(s, '标签')).toBe(true)
    expect(matchesSessionQuery(s, '不存在')).toBe(false)
  })

  it('空查询视为全部命中（列表不过滤）', () => {
    expect(matchesSessionQuery({ title: '', turns: [] }, '   ')).toBe(true)
  })

  it('坏数据不抛错：title 是数字/对象、turns 非数组、turn 为 null', () => {
    const bad = [
      { title: 42, turns: [] },
      { title: { a: 1 }, turns: 'nope' },
      { title: null, turns: [null, { content: 123 }, { content: { x: 1 } }] },
      { turns: undefined },
      {},
    ]
    for (const s of bad) {
      expect(() => matchesSessionQuery(s, 'x')).not.toThrow()
      expect(matchesSessionQuery(s, 'x')).toBe(false)
    }
  })

  it('坏数据中仍有合法内容时照常命中', () => {
    const s = { title: 42, turns: [null, { content: 'deepseek 相关笔记' }] }
    expect(matchesSessionQuery(s, 'deepseek')).toBe(true)
  })
})

describe('兜底文案单一真源（审计 #16）', () => {
  it('会话列表标题回退到 ai.convUntitled，与顶栏同键', () => {
    expect(readCode('src/composables/ui/useChatDisplay.ts')).toContain("t('ai.convUntitled')")
    expect(readCode('src/composables/domain/useAiChatSessions.ts')).toContain("t('ai.convUntitled')")
    // 旧的第二套键已删除（保留它会再次漂移）
    expect(readCode('src/locales/parts/aiPro.ts')).not.toContain('sessionDefaultTitle')
    expect(readCode('src/composables/ui/useChatDisplay.ts')).not.toContain("t('ai.sessionDefaultTitle')")
  })
})

describe('展开态键回收（审计 #18）', () => {
  it('ChatStream 会删除已不在 turns 里的展开键', () => {
    const s = readCode('src/components/chat/ChatStream.vue')
    const idx = s.indexOf('const openSummaries')
    expect(idx).toBeGreaterThanOrEqual(0)
    const tail = s.slice(idx, idx + 1200)
    expect(tail).toContain('openSummaries')
    // 必须是「按当前 turns 集合回收」，而不是只清理单个键
    expect(tail).toMatch(/Object\.keys\(openSummaries\)/)
    expect(tail).toMatch(/delete openSummaries\[/)
  })
})

describe('跨实例落盘不复活已删会话（审计 #24）', () => {
  it('persistCurrentSession 先核对磁盘存在性，再 updateSession', () => {
    const s = readCode('src/composables/domain/useAiChatSessions.ts')
    const idx = s.indexOf('function persistCurrentSession')
    expect(idx).toBeGreaterThanOrEqual(0)
    const block = s.slice(idx, s.indexOf('function abortInFlight', idx))
    const diskCheck = block.indexOf('loadSessions().some')
    const update = block.indexOf('updateSession(')
    expect(diskCheck).toBeGreaterThanOrEqual(0)
    // 磁盘校验必须先于 updateSession：反过来就又会走「找不到则新增」复活
    expect(update).toBeGreaterThan(diskCheck)
  })

  it('卸载时中止在途请求（不只是持久化）', () => {
    const s = readCode('src/composables/domain/useAiChatSessions.ts')
    const idx = s.indexOf('onUnmounted(')
    expect(idx).toBeGreaterThanOrEqual(0)
    const block = s.slice(idx, idx + 600)
    expect(block).toContain('abortSlot.current.abort()')
  })
})
