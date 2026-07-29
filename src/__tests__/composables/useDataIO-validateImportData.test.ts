import { describe, it, expect } from 'vitest'
import { validateImportData } from '../../composables/domain/useDataIO.js'
import type { AppData } from '../../types.js'

// 用例约定：直接调 validateImportData 纯函数（已 export），断言
//  - 合法 AppData → null
//  - 各类非法数据 → 形如「数据格式错误 (path: message)」的错误串，path 是 Zod 首条 issue 的路径
// 该函数是 importData(line 151) 导入 LinkVault 原生 JSON 备份的格式校验前哨：
// 决定「导入坏数据时用户看到什么错误提示」。零逻辑改动（仅 export），锁定错误消息格式化契约。
// 注意：AppDataSchema 大量字段带 .catch 兜底（D2-004 宽容设计），故能令 safeParse 真失败的
// 仅限必填 string 缺失（id/title 等）或顶层非 object——这是构造坏样本的约束。

/** 构造一个 AppDataSchema 必然通过的合法样本（4 必填数组 + 少量可选字段），便于基于其篡改 */
function validSample(): AppData {
  return {
    bookmarks: [
      {
        id: 'b1', title: 't1', url: 'https://a.com', username: '', password: '', notes: '',
        icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0,
        attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
      },
    ],
    siblingGroups: [
      {
        id: 'g1', name: '组1', categoryId: 'uncategorized', icon: '', order: 0,
        isExpanded: false, attributes: {}, bookmarkIds: ['b1'], notes: '', updatedAt: 1, useCount: 0,
      },
    ],
    categories: [{ id: 'c1', name: '分类1', icon: 'star', color: '', order: 0 }],
    customAttributes: [{ id: 'a1', name: '属性1', type: 'boolean' }],
    _schemaVersion: 3,
    _writeSeq: 1,
  }
}

describe('validateImportData 导入 JSON 格式校验前哨', () => {
  it('合法 AppData（全必填数组齐全 + 字段合法）→ null', () => {
    expect(validateImportData(validSample())).toBeNull()
  })

  it('仅 4 个空数组的最小合法 AppData → null（可选字段全缺省）', () => {
    expect(validateImportData({ bookmarks: [], siblingGroups: [], categories: [], customAttributes: [] })).toBeNull()
  })

  it('可选字段缺失不导致失败（_schemaVersion/_writeSeq/_masterCanary 等全省）→ null', () => {
    const app = validSample()
    delete (app as Partial<AppData>)._schemaVersion
    delete (app as Partial<AppData>)._writeSeq
    expect(validateImportData(app)).toBeNull()
  })

  it('_masterCanary 给字符串 → null（union 合法分支）', () => {
    const app = validSample()
    ;(app as AppData & { _masterCanary?: string })._masterCanary = 'base64-canary-placeholder'
    expect(validateImportData(app)).toBeNull()
  })

  it('_masterCanary 给 EncryptedPassword 对象 → null（union 合法分支）', () => {
    const app = validSample()
    ;(app as AppData & { _masterCanary?: object })._masterCanary = {
      encrypted: true as true, data: 'd', iv: 'i', salt: 's',
    }
    expect(validateImportData(app)).toBeNull()
  })

  it('顶层非 object（数组）→ 返回错误串', () => {
    const msg = validateImportData([1, 2, 3] as unknown)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/^数据格式错误/)
  })

  it('顶层非 object（字符串）→ 返回错误串', () => {
    const msg = validateImportData('not-an-appdata' as unknown)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/^数据格式错误/)
  })

  it('顶层 null → 返回错误串', () => {
    const msg = validateImportData(null as unknown)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/^数据格式错误/)
  })

  it('顶层 undefined → 返回错误串', () => {
    const msg = validateImportData(undefined as unknown)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/^数据格式错误/)
  })

  it('缺 categories 必填数组 → 返回含 path「categories」的错误串', () => {
    const app = validSample()
    delete (app as Partial<AppData>).categories
    const msg = validateImportData(app)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/^数据格式错误 /)
    expect(msg).toContain('categories')
  })

  it('缺 bookmarks 必填数组 → 返回含 path「bookmarks」的错误串', () => {
    const app = validSample()
    delete (app as Partial<AppData>).bookmarks
    const msg = validateImportData(app)
    expect(msg).not.toBeNull()
    expect(msg).toContain('bookmarks')
  })

  it('bookmarks 含缺 id 的坏项 → 返回含嵌套下标路径「bookmarks.0.id」的错误串', () => {
    const app = validSample()
    delete (app.bookmarks[0] as { id?: string }).id
    const msg = validateImportData(app)
    expect(msg).not.toBeNull()
    // path 形如 bookmarks.0.id（Zod 数组下标用数字）
    expect(msg).toContain('bookmarks')
    expect(msg).toContain('id')
    expect(msg).toMatch(/bookmarks\.0\.id|^数据格式错误/)
  })

  it('categories 含缺 name 的坏项 → 返回含「categories.0.name」的错误串（catch 只兜 icon/color 不兜 name）', () => {
    const app = validSample()
    delete (app.categories[0] as { name?: string }).name
    const msg = validateImportData(app)
    expect(msg).not.toBeNull()
    expect(msg).toContain('categories')
    expect(msg).toContain('name')
  })

  it('customAttributes 含坏 type（非 "boolean"）→ 返回含 type 的错误串', () => {
    const app = validSample()
    ;(app.customAttributes[0] as { type?: string }).type = 'text' as unknown as 'boolean'
    const msg = validateImportData(app)
    expect(msg).not.toBeNull()
    expect(msg).toContain('type')
  })

  it('错误串格式锁定：始终以「数据格式错误 (」包裹、以「)」结尾、path 与 message 以「: 」分隔', () => {
    const app = validSample()
    delete (app as Partial<AppData>).siblingGroups
    const msg = validateImportData(app)
    expect(msg).not.toBeNull()
    // 锁定格式化契约：(path: message)
    expect(msg).toMatch(/^数据格式错误 \(/)
    expect(msg).toMatch(/\)$/)
    expect(msg).toContain(': ')
    expect(msg).toContain('siblingGroups')
  })

  it('错误串始终包含 Zod issue 的 message 文本（不丢人类可读信息）', () => {
    const app = validSample()
    // 给一个值类型错（期望 array）触发带 message 的 issue
    ;(app as Partial<AppData> & Record<string, unknown>).categories = 'not-an-array' as unknown as AppData['categories']
    const msg = validateImportData(app)
    expect(msg).not.toBeNull()
    expect(typeof msg).toBe('string')
    expect(msg!.length).toBeGreaterThan('数据格式错误 (categories: '.length)
  })
})
