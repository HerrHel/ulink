/**
 * B-7: password union 宽容解析
 * 锁定修复：单条坏 password 数据不再拖垮整条 bookmark safeParse
 */
import { describe, it, expect } from 'vitest'
import { BookmarkSchema, AppDataSchema } from '../../schemas.js'

const validBm = {
  id: 'b1',
  title: '测试',
  url: 'https://x.com',
  username: '',
  password: 'legacy-base64',
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

describe('BookmarkSchema password 宽容解析', () => {
  it('接受合法 string password', () => {
    const result = BookmarkSchema.safeParse(validBm)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.password).toBe('legacy-base64')
    }
  })

  it('接受合法 EncryptedPassword 对象', () => {
    const bm = { ...validBm, password: { encrypted: true, data: 'abc', iv: 'def', salt: 'ghi' } }
    const result = BookmarkSchema.safeParse(bm)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.password).toEqual({ encrypted: true, data: 'abc', iv: 'def', salt: 'ghi' })
    }
  })

  it('坏 password（如 number）降级为空字符串而非拒收整行', () => {
    const bm = { ...validBm, password: 12345 }
    const result = BookmarkSchema.safeParse(bm)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.password).toBe('')
    }
  })

  it('坏 password（如缺失字段）降级为空字符串', () => {
    const bm = { ...validBm, password: null }
    const result = BookmarkSchema.safeParse(bm)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.password).toBe('')
    }
  })

  it('坏 password（如畸形对象）降级为空字符串', () => {
    const bm = { ...validBm, password: { encrypted: 'not-true', data: 'abc' } }
    const result = BookmarkSchema.safeParse(bm)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.password).toBe('')
    }
  })
})

describe('AppDataSchema _masterCanary 宽容解析', () => {
  const validApp = {
    bookmarks: [validBm],
    siblingGroups: [],
    categories: [],
    customAttributes: [],
    _masterCanary: 'canary-string',
    _schemaVersion: 2,
  }

  it('接受合法 string canary', () => {
    const result = AppDataSchema.safeParse(validApp)
    expect(result.success).toBe(true)
  })

  it('接受合法 EncryptedPassword canary', () => {
    const app = { ...validApp, _masterCanary: { encrypted: true, data: 'x', iv: 'y', salt: 'z' } }
    const result = AppDataSchema.safeParse(app)
    expect(result.success).toBe(true)
  })

  it('坏 canary 降级为空字符串而非拒收整库', () => {
    const app = { ...validApp, _masterCanary: 99999 }
    const result = AppDataSchema.safeParse(app)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data._masterCanary).toBe('')
    }
  })
})
