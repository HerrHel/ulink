import { describe, it, expect } from 'vitest'
import { getDragHintText, type DragHintPayload } from '../lib/dragHint.js'

function el(tag: string, className = '', attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

const bm: DragHintPayload = { type: 'bm', id: 'b1' }
const bmInGroup: DragHintPayload = { type: 'bm', id: 'b1', srcGid: 'g1' }
const group: DragHintPayload = { type: 'group', id: 'group:g1' }
const groupOther: DragHintPayload = { type: 'group', id: 'group:g2' }
const detail: DragHintPayload = { type: 'detail', id: 'b1', srcGid: '__DET__' }

describe('getDragHintText', () => {
  it('payload 为空返回空串', () => {
    expect(getDragHintText(el('div', 'card'), null)).toBe('')
  })

  it('group-body：书签→内联卡片；组→组引用；自身组空', () => {
    const body = el('div', 'group-body', { 'data-gid': 'g1' })
    expect(getDragHintText(body, bm)).toBe('嵌入为内联卡片')
    expect(getDragHintText(body, groupOther)).toBe('嵌入为笔记引用')
    expect(getDragHintText(body, group)).toBe('')
  })

  it('group-card-head：组交换 / 书签排序到组', () => {
    const head = el('div', 'group-card-head')
    expect(getDragHintText(head, group)).toBe('交换笔记位置')
    expect(getDragHintText(head, bm)).toBe('将书签排序到此笔记')
  })

  it('审计 R24：type:detail 拖到 group-body / group-card-head / group-card 均不提示组操作（drop 端拒绝）', () => {
    const body = el('div', 'group-body', { 'data-gid': 'g1' })
    expect(getDragHintText(body, detail)).toBe('')
    const head = el('div', 'group-card-head')
    expect(getDragHintText(head, detail)).toBe('')
    const card = el('div', 'group-card', { 'data-group-id': 'g1' })
    expect(getDragHintText(card, detail)).toBe('')
  })

  it('审计 R24：type:detail 拖到 detail-card-wrap / detailPanel 仍提示合法操作（面板内重排/加入面板）', () => {
    expect(getDragHintText(el('div', 'detail-card-wrap'), detail)).toBe('移到此位置')
    const panel = el('div', '', { id: 'detailPanel' })
    const child = el('div')
    panel.appendChild(child)
    document.body.appendChild(panel)
    expect(getDragHintText(child, detail)).toBe('由 AI 读取此卡片')
    panel.remove()
  })

  it('detail-card-wrap / detailPanel / rail-item', () => {
    expect(getDragHintText(el('div', 'detail-card-wrap'), bm)).toBe('移到此位置')
    const panel = el('div', '', { id: 'detailPanel' })
    const child = el('div')
    panel.appendChild(child)
    document.body.appendChild(panel)
    expect(getDragHintText(child, bm)).toBe('由 AI 读取书签')
    panel.remove()
    expect(getDragHintText(el('div', 'rail-item'), bm)).toBe('移动到分类')
  })

  it('group-card：移动书签 / 嵌入组 / 自身空', () => {
    const card = el('div', 'group-card', { 'data-group-id': 'g1' })
    expect(getDragHintText(card, bm)).toBe('移动书签到笔记')
    expect(getDragHintText(card, groupOther)).toBe('嵌入为笔记引用')
    expect(getDragHintText(card, group)).toBe('')
    expect(getDragHintText(card, { type: 'cat', id: 'c1' })).toBe('')
  })

  it('普通 card：有 srcGid→移出组；否则交换排序', () => {
    const card = el('div', 'card')
    expect(getDragHintText(card, bm)).toBe('交换排序')
    expect(getDragHintText(card, bmInGroup)).toBe('移出笔记')
  })

  it('cardGrid 空白 + srcGid → 移出组', () => {
    const grid = el('div', '', { id: 'cardGrid' })
    const blank = el('div')
    grid.appendChild(blank)
    document.body.appendChild(grid)
    expect(getDragHintText(blank, bmInGroup)).toBe('移出笔记')
    expect(getDragHintText(blank, bm)).toBe('')
    grid.remove()
  })

  it('无关目标返回空串', () => {
    expect(getDragHintText(el('div', 'random'), bm)).toBe('')
  })
  it('Bug A：group 拖到自身 group-card-head 返回空串', () => {
    const gc = el('div', 'group-card', { 'data-group-id': 'g1' })
    const head = el('div', 'group-card-head')
    gc.appendChild(head)
    document.body.appendChild(gc)
    // 自身组头部：无提示
    expect(getDragHintText(head, group)).toBe('')
    // 其他组头部：正常提示
    expect(getDragHintText(head, groupOther)).toBe('交换笔记位置')
    gc.remove()
  })

  it('Bug B：bm 从 g1 拖到 g1 自身 group-card 返回空串', () => {
    const card = el('div', 'group-card', { 'data-group-id': 'g1' })
    // 书签从 g1 拖回 g1：无提示
    expect(getDragHintText(card, bmInGroup)).toBe('')
    // 书签从其他地方拖入 g1：正常提示
    expect(getDragHintText(card, bm)).toBe('移动书签到笔记')
  })

  it('Bug C：cat 拖到自身 rail-item 返回空串', () => {
    const item = el('div', 'rail-item', { 'data-cat-id': 'c1' })
    const cat: DragHintPayload = { type: 'cat', id: 'c1' }
    const catOther: DragHintPayload = { type: 'cat', id: 'c2' }
    // 自身：无提示
    expect(getDragHintText(item, cat)).toBe('')
    // 其他分类：正常提示
    expect(getDragHintText(item, catOther)).toBe('调整分类顺序')
  })
})
