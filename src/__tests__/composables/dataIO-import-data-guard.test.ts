/**
 * dataIO-import-data-guard.test.ts — importData 多格式分发 + 5 分支 toast 守卫护栏
 *
 * Explore ab9f0fef9d18c9f9b 缺口 #4：useDataIO.ts:142-180 `importData(file)` 的
 * FileReader.onload 多格式分发编排此前零直接断言（dataIO.test.ts 仅测 validateImportData/
 * parseRaindropJSON 等下层 helper 与 importFromDataInternal 内部行为，从未从 importData
 * 这个用户导入首层入口逐分支锁分发 + 早返 Toast 守卫文案）。
 *
 * 本文件纯加测轮：useDataIO.ts 已 export importData（:142），零源改动。
 *
 * 锁 8 分支真路径（每分支断 toast 守卫文案 + 是否早返）：
 *   1. json + validateImportData===null（LinkVault native）→ 真 importFromDataInternal(data,'LinkVault')
 *   2. json + Raindrop {items:[]} 空数组 → toast 'Raindrop JSON 格式不正确或为空' + 早返
 *   3. json + Raindrop array [] 空 → 同上
 *   4. json + 未识别（非 LinkVault 非 Raindrop）→ toast 'JSON 格式不识别，请确认是 LinkVault 或 Raindrop.io 导出文件'
 *   5. html + parseBookmarkHTML 空守卫 → toast '未在 HTML 中找到书签' + 早返
 *   6. csv + parseCSV 空守卫 → toast 'CSV 文件为空或格式不正确' + 早返
 *   7. 不支持的格式（detectFormat=null）→ toast '不支持的文件格式'
 *   8. 任一分支抛 → 外 catch → toast '导入失败：' + msg
 *
 * 「早返 vs 正常」判定策略：importFromDataInternal 末尾必调 saveAppData + clearSearchCache +
 * 一条 toast 计数文案（data.ts 的 _merge* 路径）；早返分支只调「守卫 toast」单调、
 * 不触 saveAppData / clearSearchCache。借这两个 mock 的调用计数精确区分。
 *
 * FileReader stub：jsdom 真 FileReader onload 异步（fake timer 不稳），新建可控同步 stub
 * ——readAsText 同步设 result、同步触发 onload，让 importData 全程同步可断言。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../lib/toast.js', () => ({ toast: vi.fn(), toastWithUndo: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)) }))
vi.mock('../../lib/search.js', () => ({ clearSearchCache: vi.fn() }))
vi.mock('../../stores/app.js', () => ({ saveAppData: vi.fn(), debouncedSaveAppData: vi.fn() }))

import { useDataStore } from '../../stores/data.js'
import { importData } from '../../composables/domain/useDataIO.js'
import { toast } from '../../lib/toast.js'
import { clearSearchCache } from '../../lib/search.js'
import { saveAppData } from '../../stores/app.js'
import { __testMarkDataReady } from '../../lib/dataReady.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

/** 可控同步 FileReader stub：readAsText 同步设 result + 同步触发 onload */
/** 造带 .text 的简版文件对象供 stub readAsText 读内容（避免 File API 的 text():Promise 签名冲突） */
interface StubFile {
  name: string
  text: string
}
function makeFileReaderStub() {
  return class FileReaderStub {
    result: string | null = null
    onload: ((ev: { target: { result: string } }) => void) | null = null
    readAsText(file: StubFile) {
      this.result = file.text
      // 同步触发 onload（importData 闭包内 reader.onload 赋的正是这个）
      this.onload?.({ target: { result: this.result as string } })
    }
  }
}

function makeFile(name: string, content: string): File {
  // jsdom File 需 Blob，但我们的 stub 只读 file.text 字符串属性，故直接挂上并断言成 File
  const f = { name } as unknown as File
  Object.defineProperty(f, 'text', { value: content, configurable: true })
  return f
}

describe('importData 多格式分发 + 分支 toast 守卫（ab9#4）', () => {
  let ds: ReturnType<typeof useDataStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('FileReader', makeFileReaderStub())
    ds = useDataStore()
    __testMarkDataReady()
  })

  /**
   * 早返分支断言 helper：
   *   - toast（mock）恰好被调一次（守卫 toast）
   *   - 守卫 toast 文案精确匹配期望
   *   - saveAppData / clearSearchCache 零调用（早返不进 importFromDataInternal）
   */
  function expectEarlyReturn(toastMsg: string) {
    expect(toast).toHaveBeenCalledTimes(1)
    expect((toast as any).mock.calls[0][0]).toBe(toastMsg)
    // 早返：不进 importFromDataInternal → 不调其末尾的 saveAppData / clearSearchCache
    expect(saveAppData).not.toHaveBeenCalled()
    expect(clearSearchCache).not.toHaveBeenCalled()
  }

  describe('json 分支', () => {
    it('LinkVault 原生 JSON（validateImportData===null）→ 真 importFromDataInternal 副作用（store 入库 + saveAppData + clearSearchCache）', () => {
      const validAppData = {
        bookmarks: [
          { id: 'bv1', title: '导入书签', url: 'https://imp.example', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0 } as any,
        ],
        siblingGroups: [],
        categories: [],
        customAttributes: [],
      }
      importData(makeFile('bookmarks.json', JSON.stringify(validAppData)))

      // 正常分支：真调 importFromDataInternal → 末尾 saveAppData + clearSearchCache
      expect(saveAppData).toHaveBeenCalled()
      expect(clearSearchCache).toHaveBeenCalled()
      // 真入库副作用：书签真的进了 store
      expect(ds.bookmarkMap['bv1']).toBeTruthy()
      // toast 计数文案（importFromDataInternal 末尾 toast「从 LinkVault 导入：...」）
      const toastMsg = (toast as any).mock.calls.at(-1)?.[0] as string
      expect(toastMsg).toContain('从 LinkVault 导入')
      expect(toastMsg).toContain('1')
    })

    it('Raindrop.io JSON {items:[]} 空数组 → toast 早返不进 importFromDataInternal', () => {
      importData(makeFile('raindrop.json', JSON.stringify({ items: [] })))
      expectEarlyReturn('Raindrop JSON 格式不正确或为空')
    })

    it('Raindrop array 含带 link 项 → 进 importFromDataInternal 副作用', () => {
      // Array.isArray(data) && data[0]?.link 真 → 进 Raindrop array 分支
      // parseRaindropJSON 过滤掉无 link/url 项；首项有 link 必留存 → 非空 → 进 importFromDataInternal
      importData(makeFile('raindrop.json', JSON.stringify([
        { title: '首项有 link', link: 'https://r.example/first' },
        { title: '无 link 被过滤' },
      ])))
      // 正常分支：saveAppData + clearSearchCache 被 importFromDataInternal 调
      expect(saveAppData).toHaveBeenCalled()
      expect(clearSearchCache).toHaveBeenCalled()
      // toast 计数文案（importFromDataInternal 末「从 Raindrop.io 导入：...」）
      const toastMsg = (toast as any).mock.calls.at(-1)?.[0] as string
      expect(toastMsg).toContain('从 Raindrop.io 导入')
    })

    it('Raindrop array 首项无 link（data[0]?.link 假）→ 落入未识别 JSON 分支（不进 array 分支）', () => {
      // 关键守卫：Array.isArray(data) && data[0]?.link 假 → 不进 Raindrop array 分支，走 else 未识别
      // 这正是 array 分支空守卫（L161）「不可达」的根因——进 array 分支的前置 data[0].link 真已保证
      // parseRaindropJSON 的 filter 至少留存 data[0]，故 array 分支内 parseRaindropJSON 永不返 []，L161 死守卫。
      // 此用例锁前置守卫 data[0]?.link 的假分支边界。
      importData(makeFile('raindrop.json', JSON.stringify([{ title: '只 title 无 link' }])))
      expectEarlyReturn('JSON 格式不识别，请确认是 LinkVault 或 Raindrop.io 导出文件')
    })

    it('未识别 JSON（非 LinkVault 非 Raindrop）→ toast 文案守卫', () => {
      // 非 LinkVault（validateImportData 返非 null）+ 非 items 数组 + 非数组+link → 未识别
      importData(makeFile('weird.json', JSON.stringify({ foo: 'bar', baz: [1, 2, 3] })))
      expectEarlyReturn('JSON 格式不识别，请确认是 LinkVault 或 Raindrop.io 导出文件')
    })
  })

  describe('html 分支', () => {
    it('空 HTML（parseBookmarkHTML 返 []）→ toast 早返不进 importFromDataInternal', () => {
      importData(makeFile('bookmarks.html', '<html><body><p>no bookmark here</p></body></html>'))
      // parseBookmarkHTML 遍历找 DT/A 节点，纯 body 段无书签锚 → 返 [] → 空守卫
      expectEarlyReturn('未在 HTML 中找到书签')
    })

    it('含书签真链接的 HTML → 真 importFromDataInternal 副作用', () => {
      const html = '<html><body><dl><dt><a href="https://real.example">真</a></dt></dl></body></html>'
      importData(makeFile('bookmarks.html', html))
      // 正常分支：parseBookmarkHTML 返非空 → 进 importFromDataInternal
      expect(saveAppData).toHaveBeenCalled()
      expect(clearSearchCache).toHaveBeenCalled()
    })
  })

  describe('csv 分支', () => {
    it('空 CSV（parseCSV 返 []）→ toast 早返不进 importFromDataInternal', () => {
      importData(makeFile('data.csv', ''))
      // parseCSV 空文本 lines.length<2 → 返 [] → 空守卫
      expectEarlyReturn('CSV 文件为空或格式不正确')
    })

    it('仅一行的 CSV（lines.length<2）→ toast 早返', () => {
      importData(makeFile('data.csv', 'title,url\n')) // 单行表头无数据行
      expectEarlyReturn('CSV 文件为空或格式不正确')
    })
  })

  describe('不支持格式分支', () => {
    it('detectFormat=null（未知扩展名且内容不以 { [ < 开头）→ toast 文案守卫', () => {
      // 扩展名非 json/html/htm/csv + 内容不以 { [ < 开头 → detectFormat 返 null
      importData(makeFile('data.txt', 'just some plain text no structure'))
      expectEarlyReturn('不支持的文件格式')
    })

    it('detectFormat=null 的兜底分支不进任一规模解析', () => {
      importData(makeFile('notes.md', '# 标题无结构内容'))
      // 不支持格式分支：toast 单调 + 不调 saveAppData/clearSearchCache（已在 expectEarlyReturn 锁）
      expectEarlyReturn('不支持的文件格式')
    })
  })

  describe('外 catch 分支', () => {
    it('JSON.parse 抛（json 内容非法）→ catch toast「导入失败：」+ 错误信息', () => {
      // 扩展名 .json → detectFormat 返 json → JSON.parse('not legal json') 抛 SyntaxError
      importData(makeFile('broken.json', '{not legal json'))
      expect(toast).toHaveBeenCalledTimes(1)
      const toastMsg = (toast as any).mock.calls[0][0] as string
      expect(toastMsg).toMatch(/^导入失败：/)
      // catch 不进 importFromDataInternal
      expect(saveAppData).not.toHaveBeenCalled()
    })

    it('catch 分支 toast 文案含原错误 message', () => {
      const content = '{ 非法 JSON 会被 JSON.parse 抛'
      importData(makeFile('bad.json', content))
      const toastMsg = (toast as any).mock.calls[0][0] as string
      // 至少包含「导入失败：」前缀（具体 error.message 跨 V8 版本可能略异，只锁前缀）
      expect(toastMsg).toContain('导入失败：')
      expect(toastMsg.length).toBeGreaterThan('导入失败：'.length)
    })
  })

  describe('detectFormat 按内容推断兜底', () => {
    it('无扩展名但内容以 { 开头 → 推断为 json', () => {
      // 无扩展名文件 + 合法 LinkVault JSON 内容 → detectFormat 按内容推断 json → 进 LinkVault 分支
      const validAppData = {
        bookmarks: [], siblingGroups: [], categories: [], customAttributes: [],
      }
      importData(makeFile('noext', JSON.stringify(validAppData)))
      // 进 LinkVault 分支（空四数组，importFromDataInternal total=0 → 「所有数据已存在无新增」toast）
      expect(saveAppData).toHaveBeenCalled()
      expect(clearSearchCache).toHaveBeenCalled()
      const toastMsg = (toast as any).mock.calls.at(-1)?.[0] as string
      expect(toastMsg).toContain('从 LinkVault 导入')
    })
  })
})
