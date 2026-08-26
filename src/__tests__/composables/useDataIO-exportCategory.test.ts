/**
 * useDataIO.exportCategory — 分类级导出护栏测试
 *
 * 契约：
 * - 导出「该分类 + 该分类下全部书签（含子书签）+ 该分类下全部组」为 LinkVault JSON
 * - 组引用的、归属其他分类的书签会补全进导出（避免导入后组内悬空）
 * - 默认剔除敏感内容（username/password 置空）；设置开关 lv_exportKeepSensitive=1 后保留
 * - 软删项一律不导出；虚拟分类/不存在分类 → toast 错误 + 不下载
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _dl = vi.hoisted(() => ({ downloadSpy: vi.fn() }))
vi.mock('../../lib/download.js', () => ({
  downloadFile: _dl.downloadSpy,
  dateStamp: () => '20260826',
}))

const _toast = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({ toast: _toast.toastSpy, toastWithUndo: vi.fn(), showConfirm: vi.fn(async () => true) }))

// exportCategory 顶层 import 链会拉 app/persist 等；storageSafe 走真实 localStorage（jsdom 有）
import { useDataStore } from '../../stores/data.js'

const CAT_ID = 'c-tools'

function seed() {
  const ds = useDataStore()
  ds.categories = [
    { id: 'all', name: '全部', icon: 'grid', color: '', order: 0, updatedAt: 1 },
    { id: 'uncategorized', name: '未分类', icon: 'bookmark', color: '', order: 1, updatedAt: 1 },
    { id: CAT_ID, name: '工具', icon: 'tool', color: '#d97706', order: 2, updatedAt: 1 },
    { id: 'c-other', name: '其他', icon: 'star', color: '', order: 3, updatedAt: 1 },
  ]
  const b1 = { id: 'b1', title: 'GitHub', url: 'https://github.com', username: 'user1', password: { encrypted: true as const, data: 'x', iv: 'y', salt: 'z' }, notes: 'n1', icon: '', categoryId: CAT_ID, parentId: null, order: 0, useCount: 0, attributes: { 'requires-login': true }, isExpanded: false, createdAt: 1, updatedAt: 1 }
  const b2 = { id: 'b2', title: '子站', url: 'https://github.com/foo', username: 'child', password: 'pw2', notes: '', icon: '', categoryId: CAT_ID, parentId: 'b1', order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 }
  const b3 = { id: 'b3', title: '别的分类书签', url: 'https://example.com', username: 'u3', password: 'p3', notes: '', icon: '', categoryId: 'c-other', parentId: null, order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1 }
  const bDel = { id: 'bDel', title: '已删', url: 'https://deleted.com', username: 'u', password: 'p', notes: '', icon: '', categoryId: CAT_ID, parentId: null, order: 9, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1, deletedAt: 5 }
  ds.bookmarks = [b1, b2, b3, bDel]
  const g1 = { id: 'g1', name: '开发组', categoryId: CAT_ID, icon: '', order: 0, isExpanded: false, attributes: { 'ai': true }, bookmarkIds: ['b1', 'b2'], notes: '<p>hi</p>', useCount: 0, updatedAt: 1 }
  const g2 = { id: 'g2', name: '跨分类组', categoryId: CAT_ID, icon: '', order: 1, isExpanded: false, attributes: {}, bookmarkIds: ['b3'], notes: '', useCount: 0, updatedAt: 1 }
  const gDel = { id: 'gDel', name: '已删组', categoryId: CAT_ID, icon: '', order: 5, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 1, deletedAt: 5 }
  ds.siblingGroups = [g1, g2, gDel]
  ds.customAttributes = [
    { id: 'requires-login', name: '需要登录', type: 'boolean', updatedAt: 1 },
    { id: 'ai', name: 'AI', type: 'boolean', updatedAt: 1 },
    { id: 'unused', name: '未用', type: 'boolean', updatedAt: 1 },
  ]
  ds._syncMaps()
  return { ds, b1, b2, b3, g1, g2 }
}

beforeEach(() => {
  setActivePinia(createPinia())
  _dl.downloadSpy.mockClear()
  _toast.toastSpy.mockClear()
  try { localStorage.clear() } catch { /* jsdom 兜底 */ }
})

afterEach(() => {
  try { localStorage.clear() } catch { /* ignore */ }
})

function parseDownloaded(): any {
  const json = _dl.downloadSpy.mock.calls[0][1]
  return JSON.parse(json)
}

describe('exportCategory 导出范围与敏感内容', () => {
  it('默认剔除敏感内容：导出该分类书签/组，username/password 置空', async () => {
    const { exportCategory } = await import('../../composables/domain/useDataIO.js')
    seed()
    exportCategory(CAT_ID)

    expect(_dl.downloadSpy).toHaveBeenCalledTimes(1)
    const payload = parseDownloaded()
    // 分类：仅该分类（不含虚拟分类与其他分类）
    expect(payload.categories.map((c: any) => c.id)).toEqual([CAT_ID])
    // 书签：该分类 2 条（含子书签），不含软删；组引用的跨分类书签 b3 补全 → 共 3 条
    const bmIds = payload.bookmarks.map((b: any) => b.id).sort()
    expect(bmIds).toEqual(['b1', 'b2', 'b3'])
    // 敏感字段已清空（默认开关）
    for (const b of payload.bookmarks) {
      expect(b.username).toBe('')
      expect(b.password).toBe('')
    }
    // 组：仅该分类未软删组
    expect(payload.siblingGroups.map((g: any) => g.id).sort()).toEqual(['g1', 'g2'])
    // 属性：仅用到的 requires-login（b1）与 ai（g1），未用的 unused 不导出
    expect(payload.customAttributes.map((a: any) => a.id).sort()).toEqual(['ai', 'requires-login'])
  })

  it('开启导出保留敏感内容后 username/password 原样保留（含 E2E 加密对象）', async () => {
    const { exportCategory, setExportKeepSensitive } = await import('../../composables/domain/useDataIO.js')
    seed()
    setExportKeepSensitive(true)
    exportCategory(CAT_ID)

    const payload = parseDownloaded()
    const b1 = payload.bookmarks.find((b: any) => b.id === 'b1')
    const b2 = payload.bookmarks.find((b: any) => b.id === 'b2')
    expect(b1.username).toBe('user1')
    expect(b1.password).toEqual({ encrypted: true, data: 'x', iv: 'y', salt: 'z' })
    expect(b2.password).toBe('pw2')
  })

  it('分类不存在 → toast 错误且不下载', async () => {
    const { exportCategory } = await import('../../composables/domain/useDataIO.js')
    seed()
    exportCategory('c-missing')
    expect(_dl.downloadSpy).not.toHaveBeenCalled()
    expect(_toast.toastSpy).toHaveBeenCalled()
  })

  it('软删分类 → toast 错误且不下载', async () => {
    const { exportCategory } = await import('../../composables/domain/useDataIO.js')
    seed()
    const ds = useDataStore()
    const cat = { ...ds.categories.find((c: any) => c.id === CAT_ID)!, deletedAt: 9 }
    ds.categories = ds.categories.map((c: any) => c.id === CAT_ID ? cat : c)
    ds._syncMaps()
    exportCategory(CAT_ID)
    expect(_dl.downloadSpy).not.toHaveBeenCalled()
    expect(_toast.toastSpy).toHaveBeenCalled()
  })

  it('文件名带分类名 slug 与日期', async () => {
    const { exportCategory } = await import('../../composables/domain/useDataIO.js')
    seed()
    exportCategory(CAT_ID)
    const name = _dl.downloadSpy.mock.calls[0][0] as string
    expect(name).toMatch(/^ulink-category-工具-20260826\.json$/)
  })
})

describe('getExportKeepSensitive / setExportKeepSensitive', () => {
  it('默认 false，设置后持久化到 lv_exportKeepSensitive', async () => {
    const { getExportKeepSensitive, setExportKeepSensitive } = await import('../../composables/domain/useDataIO.js')
    expect(getExportKeepSensitive()).toBe(false)
    setExportKeepSensitive(true)
    expect(getExportKeepSensitive()).toBe(true)
    expect(localStorage.getItem('lv_exportKeepSensitive')).toBe('1')
  })
})
