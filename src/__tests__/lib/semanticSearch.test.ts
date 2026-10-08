import { describe, it, expect } from 'vitest'
import { searchSemanticBookmarks } from '../../lib/ai/semanticSearch.js'
import type { Bookmark, SiblingGroup } from '../../types.js'

function makeBm(partial: Partial<Bookmark> & { id: string; title: string; url: string }): Bookmark {
  return {
    notes: '',
    username: '',
    password: '',
    icon: '',
    categoryId: 'uncategorized',
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

function makeGrp(partial: Partial<SiblingGroup> & { id: string; name: string }): SiblingGroup {
  return {
    categoryId: 'uncategorized',
    icon: '',
    order: 0,
    isExpanded: false,
    attributes: {},
    bookmarkIds: [],
    notes: '',
    updatedAt: 0,
    useCount: 0,
    ...partial,
  }
}

describe('semanticSearch — 本地自然语言意图与语义检索引擎', () => {
  const dummyBookmarks: Bookmark[] = [
    makeBm({
      id: 'bm-excalidraw',
      title: 'Excalidraw',
      url: 'https://excalidraw.com',
      notes: '手绘风格在线虚拟白板与流程图绘制工具',
    }),
    makeBm({
      id: 'bm-civitai',
      title: 'Civitai',
      url: 'https://civitai.com',
      notes: '开源模型与 LoRA 分享社区，文生图提示词',
    }),
    makeBm({
      id: 'bm-pinia',
      title: 'Pinia 官方文档',
      url: 'https://pinia.vuejs.org',
      notes: 'Vue.js 的下一代直观状态管理库',
    }),
    makeBm({
      id: 'bm-cursor',
      title: 'Cursor AI',
      url: 'https://cursor.com',
      notes: '集成 AI 的下一代代码编辑器 IDE',
    }),
    makeBm({
      id: 'bm-bilibili',
      title: '哔哩哔哩 (B站)',
      url: 'https://bilibili.com',
      notes: '国内知名弹幕视频网站',
    }),
  ]

  const dummyGroups: SiblingGroup[] = [
    makeGrp({
      id: 'grp-diagrams',
      name: '系统架构与流程图集合',
      bookmarkIds: ['bm-excalidraw'],
      notes: '<p>整理好用的思维导图与架构画图工具</p>',
    }),
    makeGrp({
      id: 'grp-frontend',
      name: '前端工程化与状态管理',
      bookmarkIds: ['bm-pinia'],
      notes: '<p>React/Vue 状态流转与单页应用技术栈</p>',
    }),
  ]

  it('意图搜索：输入“找做流程图的”能召回 Excalidraw 及相关组', () => {
    const results = searchSemanticBookmarks('找做流程图的', dummyBookmarks, dummyGroups)
    expect(results.length).toBeGreaterThan(0)
    const ids = results.map(r => r.id)
    expect(ids).toContain('bm-excalidraw')
    expect(ids).toContain('grp-diagrams')

    const excalidrawMatch = results.find(r => r.id === 'bm-excalidraw')!
    expect(excalidrawMatch.score).toBeGreaterThan(50)
    expect(excalidrawMatch.reason).toContain('流程图')
  })

  it('意图搜索：输入“AI生图”能召回 Civitai', () => {
    const results = searchSemanticBookmarks('AI生图工具', dummyBookmarks, dummyGroups)
    expect(results.length).toBeGreaterThan(0)
    const civitaiMatch = results.find(r => r.id === 'bm-civitai')
    expect(civitaiMatch).toBeDefined()
    expect(civitaiMatch?.reason).toContain('AI 图像')
  })

  it('意图搜索：输入“前端状态管理”能召回 Pinia 与前端笔记组', () => {
    const results = searchSemanticBookmarks('前端状态管理', dummyBookmarks, dummyGroups)
    expect(results.length).toBeGreaterThan(0)
    const piniaMatch = results.find(r => r.id === 'bm-pinia')
    expect(piniaMatch).toBeDefined()
    const groupMatch = results.find(r => r.id === 'grp-frontend')
    expect(groupMatch).toBeDefined()
  })

  it('意图搜索：输入“写代码的AI”能召回 Cursor', () => {
    const results = searchSemanticBookmarks('写代码的AI', dummyBookmarks, dummyGroups)
    expect(results.length).toBeGreaterThan(0)
    const cursorMatch = results.find(r => r.id === 'bm-cursor')
    expect(cursorMatch).toBeDefined()
  })

  it('英文相关术语检索：输入“whiteboard”或“diagram”能召回 Excalidraw', () => {
    const results = searchSemanticBookmarks('whiteboard', dummyBookmarks, dummyGroups)
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.id === 'bm-excalidraw')).toBe(true)
  })

  it('边界测试：空输入、过短输入、无匹配安全返回空数组', () => {
    expect(searchSemanticBookmarks('', dummyBookmarks, dummyGroups)).toEqual([])
    expect(searchSemanticBookmarks('a', dummyBookmarks, dummyGroups)).toEqual([])
    expect(searchSemanticBookmarks('完全毫无关联的奇怪生僻词汇xyz789', dummyBookmarks, dummyGroups)).toEqual([])
  })

  it('过滤已软删除的书签与笔记组', () => {
    const deletedBm: Bookmark = {
      ...dummyBookmarks[0],
      id: 'bm-deleted',
      deletedAt: 12345,
    }
    const results = searchSemanticBookmarks('流程图', [deletedBm], [])
    expect(results.find(r => r.id === 'bm-deleted')).toBeUndefined()
  })
})
