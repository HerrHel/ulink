/**
 * 行为契约护栏：useDataIO.importData 多格式分发 + 5 分支 toast 守卫编排
 *
 * Explore ab9f0fef9d18c9f9b 缺口 #4（useDataIO.ts:142-179）：
 * `importData(file)` 是数据导入用户可见唯一入口。FileReader onload 回调内编排：
 *   detectFormat(file.name, content) → 路由到 5 格式分发：
 *     json → 5 子分支：
 *              (a) validateImportData(data)===null  → importFromDataInternal(data,'LinkVault')
 *              (b) data.items Array                  → parseRaindropJSON → 空守卫 toast / importFromDataInternal(...,'Raindrop.io')
 *              (c) Array.isArray(data) && data[0].link → parseRaindropJSON → 空守卫 toast / importFromDataInternal(...,'Raindrop.io')
 *              (d) 未识别                            → toast('JSON 格式不识别，请确认是与链（ulink）或 Raindrop.io 导出文件', false)
 *     html → parseBookmarkHTML → 空守卫 toast('未在 HTML 中找到书签') / importFromDataInternal(...,'浏览器书签')
 *     csv  → parseCSV → 空守卫 toast('CSV 文件为空或格式不正确') / importFromDataInternal(...,'CSV')
 *     null → toast('不支持的文件格式', false)
 *   外层 catch(e) → toast('导入失败：' + e.message, false)
 *   reader.readAsText(file)
 *
 * 此前现状：dataIO.test.ts 仅测 detectFormat 路由纯函数（L380-442）+ validateImportData 专测文件。
 * importData 整段 FileReader onload 编排链路（5 子分支分发 + 4 空 guard toast + 外 catch toast
 * + readAsText 调用契约）零直接断言——此文件直锁。回归路径：
 *   (1) 误删某分支（如 Raindrop Array.isArray&&data[0].link 分支）→ Raindrop 数组导出导入失败，
 *       此分支出厂写法含 `data[0]?.link` 巧妙兼容空数组与非对象首项，重构者易误并到 (b) items 分支或删，
 *       静默退化（用户 Raindrop 导入显示「JSON 格式不识别」误导）。
 *   (2) 误删空守卫（parse* 返 [] 仍走 importFromDataInternal）→ 合入空数据触发无 toast 反馈 + 浪费 store 写。
 *   (3) 误删外层 catch 或改文案 → 抛错时无 toast 用户看到静默失败。
 *   (4) 误改 readAsText 为 readAsArrayBuffer → FileReader.onerror 未实现分支，破坏文件读取触发。
 *
 * 纯加测试零源改动：importData 已 export（useDataIO.ts:142），FileReader 用 vi.stubGlobal 注入可同步触发
 * onload 的桩。同模块内部直接调用的 validateImportData/parseRaindropJSON/parseBookmarkHTML/parseCSV/
 * importFromDataInternal/detectFormat 全真跑（纯函数或 store-read path 无破坏），只 mock 外围松散依赖：
 *   - toast spy（断言分支文案）
 *   - persist.saveToLocalStorage（防真 localStorage 写）
 *   - app.saveAppData / debouncedSaveAppData（防真 cascade）
 *   - search.clearSearchCache（防真 Fuse 依赖）
 *   - storage.clearAllSyncOps（防真 IDB 依赖）
 *   - migrations.runMigrations（防真迁移链依赖，隔离 fixture 被 mutate）
 * importFromDataInternal 真跑合入真 Pinia store（setActivePinia 真实例），用 store.bookmarks.length 增长
 * 与 toast summary 文案双断言验证编排正确性。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── toast mock：spy 断言分支文案 ——..
const _toast = vi.hoisted(() => ({ toastSpy: vi.fn() }))
vi.mock('../../lib/toast.js', () => ({
  toast: _toast.toastSpy,
  toastWithUndo: vi.fn(),
  showConfirm: vi.fn(() => Promise.resolve(true)),
}))

// ── persist mock：防真 localStorage 写链 ──
vi.mock('../../stores/persist.js', () => ({
  saveToLocalStorage: vi.fn(),
  loadFromStorage: vi.fn(),
  getStorageInfo: vi.fn(),
}))

// ── app mock：防 saveAppData cascade ──
vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

// ── search mock：防 clearSearchCache 触发真 Fuse 依赖 ──
vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))

// ── storage mock：防 clearAllSyncOps 触真 IDB ──
vi.mock('../../stores/storage.js', () => ({ clearAllSyncOps: vi.fn() }))

// ── migrations mock：runMigrations noop 隔离 fixture，防真迁移链 mutate ──
vi.mock('../../stores/migrations.js', () => ({ runMigrations: vi.fn() }))

import { useDataStore } from '../../stores/data.js'
import { importData } from '../../composables/domain/useDataIO.js'
import type { AppData } from '../../types.js'

// ── FileReader 桩：可同步触发 onload，content 由测试注入 ──
// importData L143 `new FileReader()` + L145 reader.onload + L178 reader.readAsText(file)，
// 真浏览器异步经 microtask，本桩在 readAsText 内同步 fire onload（够锁编排链，不测异步时序）。
class FileReaderStub {
  result: string | ArrayBuffer | null = ''
  onload: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  readAsText(_file: File) {
    this.result = __fileContent
    // 同步触发 onload（importData L145 已绑 onload）
    if (this.onload) this.onload({ target: this } as unknown as Event)
  }
}
let __fileContent = ''
function stubFileReader(content: string) {
  __fileContent = content
}

/** 构造 AppDataSchema 必然通过的合法 LinkVault 原生备份样本 */
function linkvaultBackup(): AppData {
  return {
    bookmarks: [
      {
        id: 'b1', title: 'GitHub', url: 'https://github.com', username: '', password: '', notes: '',
        icon: '', categoryId: 'uncategorized', parentId: null, order: 0, useCount: 0,
        attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
      },
    ],
    siblingGroups: [],
    categories: [{ id: 'c1', name: '分类1', icon: 'star', color: '', order: 0 }],
    customAttributes: [],
    _schemaVersion: 3,
  } as unknown as AppData
}

describe('useDataIO.importData 多格式分发 + 5 分支 toast 守卫编排护栏（缺口 #4）', () => {
  let ds: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    ds = useDataStore()
    vi.clearAllMocks()
    vi.stubGlobal('FileReader', FileReaderStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // ═══ json 分支 4 子分派 ═══

  it('json-LinkVault 原生：validateImportData===null → importFromDataInternal(data,"LinkVault") 真合入 + summary toast', () => {
    const content = JSON.stringify(linkvaultBackup())
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'backup.json', { type: 'application/json' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    // importFromDataInternal 真跑，bookmark 真并入 store（_mergeBookmarks 过同 ID 跳过，新 store 空→合入）
    expect(ds.bookmarks.length).toBe(before + 1)
    // summary toast 含 '从 与链 · ulink 导入'（品牌已由 LinkVault → 与链 · ulink）
    const msg = _toast.toastSpy.mock.calls[0][0] as string
    expect(msg).toContain('从 与链 · ulink 导入')
    // 空守卫 toast / 未识别 toast / 不支持 toast / 失败 toast 都不应出现（仅 summary 一调）
    expect(msg).not.toContain('不识别')
    expect(msg).not.toContain('失败')
  })

  it('json-Raindrop {items}：data.items Array → parseRaindropJSON 产 Bookmark → 过空守卫 → importFromDataInternal(summary "Raindrop.io")', () => {
    const content = JSON.stringify({ items: [{ link: 'https://x.com', title: 'X' }] })
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'raindrop.json', { type: 'application/json' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    // Raindrop 单条因 url 无 '?collection/$id' 走 categoryId=CAT_UNCATEGORIZED，_mergeBookmarks 按 url 去重，新 store 空→合入
    expect(ds.bookmarks.length).toBe(before + 1)
    const msg = _toast.toastSpy.mock.calls[0][0] as string
    expect(msg).toContain('从 Raindrop.io 导入')
  })

  it('json-Raindrop 数组：Array.isArray(data) && data[0].link → importFromDataInternal(summary "Raindrop.io")', () => {
    const content = JSON.stringify([{ link: 'https://y.com', title: 'Y' }])
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'raindrop-arr.json', { type: 'application/json' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    expect(ds.bookmarks.length).toBe(before + 1)
    const msg = _toast.toastSpy.mock.calls[0][0] as string
    expect(msg).toContain('从 Raindrop.io 导入')
  })

  it('json-未识别（非 LinkVault 非 Raindrop）：走 else 分支 toast "JSON 格式不识别" 且不调 importFromDataInternal（store 不增长）', () => {
    const content = JSON.stringify({ random: 1, notLinked: true })
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'weird.json', { type: 'application/json' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    const msg = _toast.toastSpy.mock.calls[0][0] as string
    expect(msg).toBe('JSON 格式不识别，请确认是与链（ulink）或 Raindrop.io 导出文件')
    // 未识别分支不调 importFromDataInternal → store 不增长
    expect(ds.bookmarks.length).toBe(before)
  })

  it('json-Raindrop {items} 空 bookmarks：parseRaindropJSON 返 [] → 空守卫 toast "Raindrop JSON 格式不正确或为空" return（不调 importFromDataInternal）', () => {
    const content = JSON.stringify({ items: [] })
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'raindrop-empty.json', { type: 'application/json' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    const msg = _toast.toastSpy.mock.calls[0][0] as string
    expect(msg).toBe('Raindrop JSON 格式不正确或为空')
    expect(ds.bookmarks.length).toBe(before)
  })

  it('json-Raindrop 数组首元素无 link：Array.isArray 但 data[0]?.link falsy → 不进 Array 分支落 (d) 未识别 toast（锁分支 (c) 门控 data[0]?.link 必 truthy 非任意数组）', () => {
    // data[0] 无 link 字段 → 分支 (c) 门 `Array.isArray(data) && data[0]?.link` 判 false → 落 (d) 未识别。
    // 回归路径：误改门为 `data?.[0]` 或 `Array.isArray(data)` 裸判（无 link 检查）→ 任意 JSON 数组
    //   误入 Raindrop 路径，parseRaindropJSON 对无 link/url 元素 filter 返 [] 触空守卫，
    //   用户导出非 Raindrop 数组（如 [{ a: 1 }]）得到「Raindrop JSON 格式不正确或为空」误导而非「未识别」。
    const content = JSON.stringify([{ notLink: true, notUrl: true }])
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'raindrop-arr-nolink.json', { type: 'application/json' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    expect(_toast.toastSpy.mock.calls[0][0]).toBe('JSON 格式不识别，请确认是与链（ulink）或 Raindrop.io 导出文件')
    expect(ds.bookmarks.length).toBe(before)
  })

  it('json-Raindrop 数组首元素仅 url（无 link）：data[0]?.link falsy → 同落 (d) 未识别（锁分支 (c) 门控严格查 link 非 url 兼容）', () => {
    // 首元素只有 url 无 link → 分支 (c) `data[0]?.link` 判 false，即便 parseRaindropJSON 内部
    // 用 `r.link || r.url` 能识别 url，importData 的分支门只查 link → 此类数据落未识别。
    // 此为 source 既有行为（非 bug）：Raindrop 数组格式以 link 字段为门控特征，仅有 url 不被 importData 识别为 Raindrop 数组。
    const content = JSON.stringify([{ url: 'https://only-url.com', title: 'U' }])
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'raindrop-arr-urlonly.json', { type: 'application/json' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    expect(_toast.toastSpy.mock.calls[0][0]).toBe('JSON 格式不识别，请确认是与链（ulink）或 Raindrop.io 导出文件')
    expect(ds.bookmarks.length).toBe(before)
  })

  // ═══ html 分支 ═══

  it('html 空：parseBookmarkHTML 返 [] → 空守卫 toast "未在 HTML 中找到书签" return', () => {
    const content = '<!DOCTYPE html><html><body><h1>无书签</h1></body></html>'
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'bookmarks.html', { type: 'text/html' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    expect(_toast.toastSpy.mock.calls[0][0]).toBe('未在 HTML 中找到书签')
    expect(ds.bookmarks.length).toBe(before)
  })

  it('html 有书签：<A HREF> 解析产 Bookmark → importFromDataInternal(summary "浏览器书签")', () => {
    // parseBookmarkHTML 识别 Netscape 格式 <DT><A HREF="..." >title</A>
    const content = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DT><A HREF="https://example.com">Example</A>'
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'bookmarks.html', { type: 'text/html' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    // 至少 store 长度增长（parseBookmarkHTML 成功产 bookmark → 过空守卫 → importFromDataInternal 真合入）
    expect(ds.bookmarks.length).toBeGreaterThan(before)
    const msg = _toast.toastSpy.mock.calls[0][0] as string
    expect(msg).toContain('从 浏览器书签 导入')
  })

  // ═══ csv 分支 ═══

  it('csv 空（lines < 2）：parseCSV 返 [] → 空守卫 toast "CSV 文件为空或格式不正确" return', () => {
    // 仅一行无换行 → parseCSV L482 lines.length < 2 return []
    const content = 'onlyHeaderNoNewline'
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'data.csv', { type: 'text/csv' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    expect(_toast.toastSpy.mock.calls[0][0]).toBe('CSV 文件为空或格式不正确')
    expect(ds.bookmarks.length).toBe(before)
  })

  it('csv 无 URL 列（urlIdx<0）：parseCSV 返 [] → 空守卫 toast return（锁 urlIdx<0 守卫也走空 toast 分支）', () => {
    // 有表头但无 url 列别名 → resolveCsvColumns urlIdx=-1 → parseCSV 返 []
    const content = 'title,notes\nA,hello\nB,world'
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'no-url.csv', { type: 'text/csv' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    expect(_toast.toastSpy.mock.calls[0][0]).toBe('CSV 文件为空或格式不正确')
    expect(ds.bookmarks.length).toBe(before)
  })

  it('csv 有 URL：parseCSV 产 Bookmark → importFromDataInternal(summary "CSV")', () => {
    // 一行表头（含 url 列）+ 一行带 '.' 的 url → parseCSV 产 1 bookmark
    const content = 'title,url\nGoogle,https://google.com'
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'real.csv', { type: 'text/csv' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    expect(ds.bookmarks.length).toBe(before + 1)
    const msg = _toast.toastSpy.mock.calls[0][0] as string
    expect(msg).toContain('从 CSV 导入')
  })

  // ═══ 不支持格式 ═══

  it('null 格式（无扩展名 + 内容非 json/html 前缀）：toast "不支持的文件格式"', () => {
    const content = 'just plain text content with no prefix markers'
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'noext_file', { type: 'text/plain' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    expect(_toast.toastSpy.mock.calls[0][0]).toBe('不支持的文件格式')
    expect(ds.bookmarks.length).toBe(before)
  })

  // ═══ 外层 catch ═══

  it('外层 catch：JSON.parse 抛错 → toast "导入失败：..." 兜底（锁 catch 编排不丢错）', () => {
    // 非法 JSON 文本，detectFormat 走扩展名 → json，JSON.parse 抛 SyntaxError 被外层 catch
    const content = '{invalid json syntax !!!}'
    stubFileReader(content)
    const before = ds.bookmarks.length

    importData(new File([content], 'broken.json', { type: 'application/json' }))

    expect(_toast.toastSpy).toHaveBeenCalled()
    const msg = _toast.toastSpy.mock.calls[0][0] as string
    expect(msg.startsWith('导入失败：')).toBe(true)
    expect(ds.bookmarks.length).toBe(before)
  })

  // ═══ readAsText 调用契约 ═══

  it('readAsText 被 FileReader 调用触发 onload：FileReaderStub 收 file 且 onload 同步 fire', () => {
    const content = JSON.stringify({ random: 1 })
    stubFileReader(content)
    // 确认桩同步 fire 不会丢：toast 被调即间接证明 readAsText→onload 链通
    importData(new File([content], 'x.json', { type: 'application/json' }))
    expect(_toast.toastSpy).toHaveBeenCalled()
  })
})
