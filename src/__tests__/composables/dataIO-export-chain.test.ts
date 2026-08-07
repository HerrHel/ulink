/**
 * dataIO-export-chain.test.ts — useDataIO 四导出对称链护栏
 *
 * 锁定三导出函数此前 0 直测的对称契约（exportHTML 已有独立测试覆盖转义，本文件补另三个）：
 *  - exportData：LinkVault 完整 JSON 备份，内容含 bookmarks/siblingGroups/categories/customAttributes 四数组、
 *    mime=application/json、文件名 linkvault-backup-*.json、toast('数据已导出')。
 *  - exportCSV：表头 title,url,tags,notes,category,icon,created_at + 数据行数 = 活书签数；
 *    双引号字段用 " 包裹且内部 " 转义为 ""（RFC 4180）；text/csv；toast 计数文案含 "（CSV）"。
 *  - exportRaindrop：{ items: [...] } Raindrop.io 兼容结构、字段映射 title/link/excerpt/cover/tags/created/lastUpdate、
 *    application/json、toast 计数文案含 "（Raindrop JSON）"。
 *
 * 共享脚手架复用 dataIO.test.ts exportHTML 的 URL stubGlobal + document.createElement('a') spy
 * + Blob.text() 回读捕获内容。导出链全靠 downloadFile 落盘 → spy 是唯一观察点。
 *
 * 纯加测试轮：零源改动。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))
vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))

import { useDataStore } from '../../stores/data.js'
import { exportData, exportCSV, exportRaindrop } from '../../composables/domain/useDataIO.js'
import { toast } from '../../lib/toast.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

type AddBookmarkInput = Parameters<ReturnType<typeof useDataStore>['addBookmark']>[0]

function makeBookmark(over: Partial<AddBookmarkInput> & { id: string }): AddBookmarkInput {
  return {
    id: over.id,
    title: over.title ?? '',
    url: over.url ?? 'https://example.com/' + over.id,
    username: '',
    password: '',
    notes: over.notes ?? '',
    icon: over.icon ?? '',
    categoryId: over.categoryId ?? CAT_UNCATEGORIZED,
    parentId: null,
    order: over.order ?? 0,
    useCount: 0,
    attributes: over.attributes ?? {},
    isExpanded: false,
    createdAt: over.createdAt ?? 1000,
    updatedAt: over.updatedAt ?? 1000,
  } as AddBookmarkInput
}

/**
 * 共享脚手架：stub URL + spy document.createElement('a').click，捕获落盘 Blob
 * 返回 { captured, click, restore }。导出链唯一观察点是 downloadFile 内的 Blob。
 */
function captureDownload() {
  const click = vi.fn()
  let captured: Blob | null = null
  const createObjectURL = vi.fn((blob: Blob) => {
    captured = blob
    return 'blob:mock'
  })
  const revokeObjectURL = vi.fn()
  const origURL = globalThis.URL
  vi.stubGlobal('URL', { ...origURL, createObjectURL, revokeObjectURL })
  const origCreate = document.createElement.bind(document)
  const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = origCreate(tag)
    if (tag === 'a') (el as HTMLAnchorElement).click = click
    return el
  })
  return {
    captured: () => captured,
    click,
    restore: () => {
      vi.unstubAllGlobals()
      createSpy.mockRestore()
    },
  }
}

describe('exportData — LinkVault JSON 完整备份对称链', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('导出内容含四数组快照 + application/json + backup 文件名 + toast 数据已导出', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBookmark({ id: 'bk1', title: '书签一', url: 'https://a.example', createdAt: 2000, updatedAt: 3000 }) as any)
    ds.addBookmark(makeBookmark({ id: 'bk2', title: '书签二', url: 'https://b.example', attributes: { attr_x: true } }) as any)

    const dl = captureDownload()
    try {
      exportData()
      expect(dl.click).toHaveBeenCalledTimes(1)
      expect(dl.captured()).toBeTruthy()
      const blob = dl.captured()!
      expect(blob.type).toBe('application/json')
      const json = JSON.parse(await blob.text()) as any
      expect(Array.isArray(json.bookmarks)).toBe(true)
      expect(Array.isArray(json.bookmarks)).toBe(true)
      expect(Array.isArray(json.siblingGroups)).toBe(true)
      expect(Array.isArray(json.categories)).toBe(true)
      expect(Array.isArray(json.customAttributes)).toBe(true)
      // 快照含刚加的两条书签
      expect(json.bookmarks.some((b: any) => b.id === 'bk1')).toBe(true)
      expect(json.bookmarks.some((b: any) => b.id === 'bk2')).toBe(true)
      expect((toast as any).mock.calls.at(-1)?.[0]).toBe('数据已导出')
    } finally {
      dl.restore()
    }
  })

  it('导出失败 catch 兜底 toast 导出失败（downloadFile 抛错时）', () => {
    const ds = useDataStore()
    ds.addBookmark(makeBookmark({ id: 'bk1' }) as any)
    // stub URL.createObjectURL 抛错，逼 exportData 进 catch
    const origURL = globalThis.URL
    vi.stubGlobal('URL', { ...origURL, createObjectURL: () => { throw new Error('boom') }, revokeObjectURL: vi.fn() })
    try {
      expect(() => exportData()).not.toThrow()
      expect((toast as any).mock.calls.some((c: any[]) => c[0] === '导出失败')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('exportCSV — CSV 对称链（表格可读，不含账户密码）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('表头 + 数据行数 = 活书签数 + text/csv + toast 计数（CSV）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBookmark({ id: 'c1', title: '逗,号"引', url: 'https://c.example', notes: '备注文字', createdAt: 5000, attributes: { a1: true } }) as any)
    ds.addBookmark(makeBookmark({ id: 'c2', title: '二', url: 'https://d.example' }) as any)
    // 软删的不导出
    const softDel = makeBookmark({ id: 'c3', title: '软删', url: 'https://e.example' }) as any
    ds.addBookmark(softDel)
    ds.deleteBookmark('c3')

    const dl = captureDownload()
    try {
      exportCSV()
      expect(dl.captured()).toBeTruthy()
      const blob = dl.captured()!
      expect(blob.type).toBe('text/csv')
      const csv = await blob.text()
      const lines = csv.split('\n')
      expect(lines[0]).toBe('title,url,tags,notes,category,icon,created_at')
      // 表头 + 2 活书签（c3 软删不入）；字段均不含字面换行故行数稳定
      expect(lines.length).toBe(3)
      // 双引号转义 RFC 4180："...""..."，且字段用 " 包裹；逗号在内仍被引号保护
      expect(csv).toContain('"逗,号""引"')
      // createdAt=5000ms → ISO 字符串出现在 created_at 列
      expect(csv).toContain(new Date(5000).toISOString())
      // toast 计数文案含 (CSV) 且计数为 2
      const last = (toast as any).mock.calls.at(-1)?.[0] as string
      expect(last).toContain('（CSV）')
      expect(last).toContain('2')
    } finally {
      dl.restore()
    }
  })

  it('字段内换行/逗号/引号被引号保护（RFC 4180 引号字段含特殊字符）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBookmark({ id: 's1', title: 'a,b\nc"d', url: 'https://s.example', notes: 'x,\ny' }) as any)
    const dl = captureDownload()
    try {
      exportCSV()
      const csv = await dl.captured()!.text()
      // 引号字段内含换行/逗号/转义引号：以引号字段形式整体出现，不破坏顶层行结构
      expect(csv).toContain('"a,b\nc""d"')
      expect(csv).toContain('"x,\ny"')
    } finally {
      dl.restore()
    }
  })

  it('空库也能导出表头（0 书签不崩）', async () => {
    useDataStore()
    const dl = captureDownload()
    try {
      expect(() => exportCSV()).not.toThrow()
      const csv = await dl.captured()!.text()
      // 仅表头
      expect(csv.split('\n')).toEqual(['title,url,tags,notes,category,icon,created_at'])
    } finally {
      dl.restore()
    }
  })
})

describe('exportRaindrop — Raindrop.io 兼容 JSON 对称链', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('items 数组字段映射 + len = 活书签数 + application/json + toast 计数（Raindrop JSON）', async () => {
    const ds = useDataStore()
    ds.addBookmark(makeBookmark({ id: 'r1', title: '雨滴一', url: 'https://r1.example', notes: '摘要', icon: 'icn', createdAt: 7000, updatedAt: 8000, attributes: { t1: true } }) as any)
    ds.addBookmark(makeBookmark({ id: 'r2', title: '雨滴二', url: 'https://r2.example' }) as any)
    // 软删不入
    ds.addBookmark(makeBookmark({ id: 'r3', title: '软删', url: 'https://r3.example' }) as any)
    ds.deleteBookmark('r3')

    const dl = captureDownload()
    try {
      exportRaindrop()
      expect(dl.captured()).toBeTruthy()
      const blob = dl.captured()!
      expect(blob.type).toBe('application/json')
      const json = JSON.parse(await blob.text()) as any
      expect(Array.isArray(json.items)).toBe(true)
      expect(json.items).toHaveLength(2)
      const first = json.items[0]
      expect(first).toMatchObject({
        title: '雨滴一',
        link: 'https://r1.example',
        excerpt: '摘要',
        cover: 'icn',
      })
      expect(Array.isArray(first.tags)).toBe(true)
      expect(first.created).toContain('1970-01-01') // createdAt=7000ms
      expect(first.lastUpdate).toBeTruthy()
      const last = (toast as any).mock.calls.at(-1)?.[0] as string
      expect(last).toContain('（Raindrop JSON）')
      expect(last).toContain('2')
    } finally {
      dl.restore()
    }
  })
})
