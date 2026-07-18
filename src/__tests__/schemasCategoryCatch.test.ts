/**
 * D2-003 / D2-004：Category icon/color .catch；order 字符串 coerce；attributes strip
 */
import { describe, it, expect } from 'vitest'
import { CategorySchema, BookmarkSchema, AppDataSchema } from '../schemas.js'

const validBm = {
  id: 'b1',
  title: '测试',
  url: 'https://x.com',
  username: '',
  password: '',
  notes: '',
  icon: '',
  categoryId: 'cat1',
  parentId: null,
  order: 0,
  useCount: 0,
  attributes: {},
  isExpanded: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

describe('D2-003 CategorySchema icon/color catch', () => {
  it('缺 color 仍成功并降为空串', () => {
    const r = CategorySchema.safeParse({ id: 'c1', name: '开发', icon: 'star' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.icon).toBe('star')
      expect(r.data.color).toBe('')
    }
  })

  it('color/icon 为 null 时降为空串', () => {
    const r = CategorySchema.safeParse({ id: 'c1', name: '开发', icon: null, color: null })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.icon).toBe('')
      expect(r.data.color).toBe('')
    }
  })

  it('单条坏分类不拖垮 AppDataSchema', () => {
    const app = {
      bookmarks: [validBm],
      siblingGroups: [],
      categories: [{ id: 'c1', name: '无 color', icon: 'star' }],
      customAttributes: [],
    }
    const r = AppDataSchema.safeParse(app)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.categories[0].color).toBe('')
      expect(r.data.bookmarks).toHaveLength(1)
    }
  })
})

describe('D2-004 order coerce / attributes strip', () => {
  it('order 字符串 "10" 恢复为 number 10', () => {
    const r = BookmarkSchema.safeParse({ ...validBm, order: '10' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.order).toBe(10)
  })

  it('attributes 单键非法不整表清空', () => {
    const r = BookmarkSchema.safeParse({
      ...validBm,
      attributes: { good: true, bad: 'yes', also: false },
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.attributes).toEqual({ good: true, also: false })
    }
  })
})
