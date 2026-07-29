import { describe, it, expect } from 'vitest'
import { _migrateTextNotes } from '../stores/migrations.js'
import { esc } from '../utils.js'
import { inlineCardHTML, groupRefCardHTML } from '../composables/useInlineCard.js'
import type { Bookmark, SiblingGroup } from '../types.js'

// D1-13：_migrateTextNotes 纯函数护栏（export 私有函数，纯加测试零逻辑改动同 D2-4 口径）
// 该函数把旧版纯文本笔记（markdown [label](id) + @mention）转成 HTML 内联卡片，
// 是旧盘升级时「组笔记展示」的唯一承载逻辑，且有副作用（push group.bookmarkIds）+
// 是 v-html 渲染前的 HTML 拼装入口（XSS 防线）。

function bm(id: string, title: string, url = 'https://example.com'): Bookmark {
  return { id, title, url, icon: '' } as Bookmark
}

function group(id: string, name: string, bookmarkIds: string[] = [], icon = ''): SiblingGroup {
  return { id, name, categoryId: 'uncategorized', bookmarkIds, attributes: {} } as unknown as SiblingGroup
}

describe('_migrateTextNotes', () => {
  it('[label](id) 命中书签 → 插入 inlineCardHTML 产物', () => {
    const target = bm('b1', 'GitHub', 'https://github.com')
    const g = group('g1', 'MyGroup')
    const html = _migrateTextNotes('See [GitHub](b1) here', [target], [g], g)
    expect(html).toContain(inlineCardHTML(target))
    // 周边纯文本仍按顺序保留
    expect(html).toContain('See ')
    expect(html).toContain(' here')
  })

  it('[label](id) 找不到书签 → esc 原始 markdown 串透传（不产 inlineCard）', () => {
    const g = group('g1', 'MyGroup')
    const html = _migrateTextNotes('Link [Ghost](nope)', [], [g], g)
    expect(html).not.toContain('group-inline-card')
    // 原始整段 markdown 经 esc 后透传
    expect(html).toBe(esc('Link [Ghost](nope)'))
  })

  it('[label](id) id 含非字母数字（如短横线 -）→ 正则不匹配，esc 透传整段（真实约束锁定）', () => {
    // 正则 ([a-zA-Z0-9]+) 不含短横线，故带 - 的 id（如 uuid）不被识别为内联卡
    const target = bm('a1b2-c3d4', 'HasDash')
    const g = group('g1', 'MyGroup')
    const html = _migrateTextNotes('Ref [HasDash](a1b2-c3d4)', [target], [g], g)
    expect(html).not.toContain('group-inline-card')
    expect(html).toBe(esc('Ref [HasDash](a1b2-c3d4)'))
  })

  it('@mention 命中其它组 → 插入 groupRefCardHTML 产物', () => {
    const other = group('g9', 'OtherGroup', ['x1', 'x2'])
    const g = group('g1', 'MyGroup')
    const html = _migrateTextNotes('See @OtherGroup now', [], [other, g], g)
    expect(html).toContain(groupRefCardHTML(other))
    expect(html).not.toContain('ref:g1') // 不引用自身
  })

  it('@mention 命中自身（同名且 id === group.id）→ 不自引用，esc 原文透传', () => {
    const g = group('g1', 'MyGroup')
    const html = _migrateTextNotes('Ref @MyGroup self', [], [g], g)
    expect(html).not.toContain('group-ref-card')
    expect(html).toContain(esc('@MyGroup'))
  })

  it('@mention 无匹配组 → esc 透传', () => {
    const g = group('g1', 'MyGroup')
    const html = _migrateTextNotes('Ping @Nobody here', [], [], g)
    expect(html).not.toContain('group-ref-card')
    expect(html).toContain(esc('@Nobody'))
  })

  it('多行 \\n → <br>', () => {
    const g = group('g1', 'MyGroup')
    const html = _migrateTextNotes('line1\nline2\nline3', [], [g], g)
    expect(html).toBe('line1<br>line2<br>line3')
  })

  it('混合拼装保持原文顺序（纯文本 + inlineCard + @mention 交错）', () => {
    const b = bm('b1', 'GitHub', 'https://github.com')
    const other = group('g9', 'Other', ['y1'])
    const g = group('g1', 'G')
    const html = _migrateTextNotes('pre [GH](b1) mid @Other end', [b], [other, g], g)
    const inline = inlineCardHTML(b)
    const ref = groupRefCardHTML(other)
    const idxInline = html.indexOf(inline)
    const idxRef = html.indexOf(ref)
    expect(idxInline).toBeGreaterThan(html.indexOf('pre '))
    expect(idxRef).toBeGreaterThan(idxInline)
    expect(html.indexOf(' mid ')).toBeLessThan(idxRef)
    // ' end' 紧贴 ref 产物之后（中间无填充），故 >= 而非严格 >
    expect(html.indexOf(' end')).toBeGreaterThanOrEqual(idxRef + ref.length)
  })

  it('同 id 重复 [label](id) 出现两次 → ids 去重，bookmarkIds 只 push 一次', () => {
    const b = bm('b1', 'GH')
    const g = group('g1', 'G') // 空 bookmarkIds
    const html = _migrateTextNotes('[a](b1) and [b](b1)', [b], [g], g)
    // 两次都产 inlineCard，但 bookmarkIds 副作用只 push 一次
    expect(html).toContain(inlineCardHTML(b))
    expect(g.bookmarkIds).toEqual(['b1'])
  })

  it('[label](id) 命中的 id 若不在 group.bookmarkIds → push 进去（副作用核心契约）', () => {
    const b = bm('b1', 'GH')
    const g = group('g1', 'G', ['existing']) // 已有无关 id
    _migrateTextNotes('Ref [GH](b1)', [b], [g], g)
    expect(g.bookmarkIds).toEqual(['existing', 'b1'])
  })

  it('已在 bookmarkIds 的 id → 不重复 push', () => {
    const b = bm('b1', 'GH')
    const g = group('g1', 'G', ['b1'])
    _migrateTextNotes('[GH](b1)', [b], [g], g)
    expect(g.bookmarkIds).toEqual(['b1'])
  })

  it('纯文本无任何匹配 → 原文经 esc 透传，无 <br>（单行）', () => {
    const g = group('g1', 'G')
    const html = _migrateTextNotes('just plain text', [], [g], g)
    expect(html).toBe('just plain text')
    expect(html).not.toContain('<br>')
  })

  it('XSS：纯文本段含 <script> → 整段经 esc 转义，产物中无未实体化 <script> 序列（v-html 拼装注入防线）', () => {
    // 纯文本笔记走 v-html 渲染（DetailPanel/GroupCard）。_migrateTextNotes 拼装前对每段原文走 esc()，
    // 故带 <script> 的旧文本在成为 HTML 前已实体化——这是注入防线前置点。
    const g = group('g1', 'G')
    const html = _migrateTextNotes('inject <script>alert(1)' , [], [g], g)
    expect(html).not.toContain('<script>')
    expect(html).toContain(esc('<script>alert(1)')) // <script>alert(1)
  })

  it('XSS：[label](id) 找不到书签时，整段 markdown 含杂质经 esc 透传（label 不入 HTML 原义）', () => {
    // 找不到 bookmark 的 [label](id) 走 esc(m2[0]) 把整段 "[<x>](bad)" 转义后透传，<> 实体化
    const g = group('g1', 'G')
    const html = _migrateTextNotes('see [<b>bold](nope) end', [], [g], g)
    expect(html).not.toContain('<b>bold')
    expect(html).toBe(esc('see [<b>bold](nope) end'))
  })

  it('inlineCardHTML 产物锚点: data-bm-id 与 group-inline-card class 存在（与 useInlineCard 契约对齐）', () => {
    const b = bm('bmId', 'T', 'https://x.com')
    const g = group('g1', 'G')
    const html = _migrateTextNotes('[T](bmId)', [b], [g], g)
    expect(html).toContain('class="group-inline-card"')
    expect(html).toContain('data-bm-id="bmId"')
  })
})
