/**
 * schemas 容量护栏单测——超长字段截断（bound 而非 reject）
 *
 * 锁定两层契约：
 * 1. 截断语义：超上限字段被切到上限，恰在上限/以下的原样（防 .max() 回归——
 *    .max() 在保存路径 safeParse 失败会整包跳过写盘，见 schemas.ts boundedString 注释）；
 * 2. 语义不变：title/url/name 仍是无 catch 的 z.string()（缺失/非字符串照旧硬拒，
 *    不因新增 transform 弱化损坏检测），notes/icon 仍 catch 兜底。
 */
import { describe, it, expect } from 'vitest'
import {
  BookmarkSchema, SiblingGroupSchema, CategorySchema, CustomAttributeSchema, AppDataSchema,
} from '../schemas.js'

const NOTES_MAX = 131_072
const TITLE_MAX = 500
const URL_MAX = 4096
const NAME_MAX = 200
const ICON_MAX = 8_192

describe('schemas 容量护栏：超长截断', () => {
  // title/url 是无 catch 的必填字段，夹具必须带全（缺失硬拒语义另有专测）
  const bmBase = { id: 'b1', title: 't', url: 'https://x.example' }

  it('bookmark notes 超长 → 截断到 128KB；恰在上限原样', () => {
    const over = BookmarkSchema.parse({ ...bmBase, notes: 'x'.repeat(NOTES_MAX + 100) })
    expect(over.notes.length).toBe(NOTES_MAX)
    const exact = BookmarkSchema.parse({ ...bmBase, notes: 'y'.repeat(NOTES_MAX) })
    expect(exact.notes.length).toBe(NOTES_MAX)
  })

  it('bookmark title/url 截断；缺失仍硬拒（无 catch 语义不弱化）', () => {
    const over = BookmarkSchema.parse({ id: 'b1', title: 't'.repeat(TITLE_MAX + 1), url: 'h'.repeat(URL_MAX + 1) })
    expect(over.title.length).toBe(TITLE_MAX)
    expect(over.url.length).toBe(URL_MAX)
    expect(() => BookmarkSchema.parse({ id: 'b1' })).toThrow()
  })

  it('group name/notes 截断', () => {
    const g = SiblingGroupSchema.parse({
      id: 'g1', name: 'n'.repeat(NAME_MAX + 50), notes: 'z'.repeat(NOTES_MAX + 50),
    })
    expect(g.name.length).toBe(NAME_MAX)
    expect(g.notes.length).toBe(NOTES_MAX)
  })

  it('icon 超长截断到 8KB（favicon SVG data URL ~350 字符不受影响）', () => {
    const b = BookmarkSchema.parse({ ...bmBase, icon: 'data:image/svg+xml;utf8,' + 'a'.repeat(ICON_MAX) })
    expect(b.icon.length).toBe(ICON_MAX)
    const normal = BookmarkSchema.parse({ ...bmBase, icon: 'https://example.com/favicon.ico' })
    expect(normal.icon).toBe('https://example.com/favicon.ico')
  })

  it('category/attribute name 截断', () => {
    expect(CategorySchema.parse({ id: 'c1', name: 'n'.repeat(NAME_MAX + 1) }).name.length).toBe(NAME_MAX)
    expect(CustomAttributeSchema.parse({ id: 'a1', name: 'n'.repeat(NAME_MAX + 1), type: 'boolean' }).name.length).toBe(NAME_MAX)
  })

  it('save 链路：AppDataSchema 解析产出已截断（app.ts saveAppData safeParse 契约）', () => {
    const big = 'q'.repeat(NOTES_MAX + 999)
    const parsed = AppDataSchema.parse({
      bookmarks: [{ ...bmBase, notes: big }],
      siblingGroups: [], categories: [], customAttributes: [],
    })
    expect(parsed.bookmarks[0]!.notes.length).toBe(NOTES_MAX)
  })

  it("notes 非字符串仍走 catch('')（catch 语义不因 transform 改变）", () => {
    const b = BookmarkSchema.parse({ ...bmBase, notes: 12345 })
    expect(b.notes).toBe('')
  })
})
