/**
 * useFileDropImport 单测：从系统拖入文件时的全局分流
 * 覆盖：Files 类型识别、可导入扩展名、落点 → 去向判定、导入确认（单个 / 多个 / 不支持）、
 * 以及挂载后 document 级 dragover / drop 的真实分流（投放提示、阻止浏览器打开文件、
 * AI 区让位、编辑器已处理不重复、AI 页作为附件、分享页拒收）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useUIStore } from '../../stores/ui.js'

const { toastMock, confirmMock, importMock, attachMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  confirmMock: vi.fn(),
  importMock: vi.fn(),
  attachMock: vi.fn(),
}))
vi.mock('../../lib/toast.js', () => ({ toast: toastMock, showConfirm: confirmMock }))
vi.mock('../../composables/domain/useDataIO.js', () => ({ importData: importMock }))
vi.mock('../../lib/ai/attachFiles.js', () => ({ attachFilesToAi: attachMock }))

import {
  isFileDrag,
  isImportableFile,
  resolveFileDropMode,
  importDroppedFiles,
  useFileDropImport,
} from '../../composables/interaction/useFileDropImport.js'

function file(name: string, type = ''): File {
  return new File(['x'], name, { type })
}

/** jsdom 没有 DragEvent 构造的 dataTransfer：用普通 Event 挂上最小 dataTransfer */
function dragEvent(type: 'dragover' | 'drop', files: File[], opts: { types?: string[] } = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  const dt = { types: opts.types ?? ['Files'], files, dropEffect: 'none' as string }
  Object.defineProperty(e, 'dataTransfer', { value: dt })
  return e
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('纯函数', () => {
  it('isFileDrag：只认含 Files 的拖动，站内卡片拖动不算', () => {
    expect(isFileDrag({ types: ['Files'] } as unknown as DataTransfer)).toBe(true)
    expect(isFileDrag({ types: ['application/x-linkvault'] } as unknown as DataTransfer)).toBe(false)
    expect(isFileDrag(null)).toBe(false)
  })

  it('isImportableFile：html / htm / json / csv（大小写不敏感），其余不行', () => {
    for (const n of ['bookmarks.html', 'a.HTM', 'backup.json', 'list.CSV']) expect(isImportableFile(n)).toBe(true)
    for (const n of ['photo.png', 'doc.pdf', 'notes.txt', 'html']) expect(isImportableFile(n)).toBe(false)
  })

  it('resolveFileDropMode：分享页拒收 > AI 区 > 编辑器 > AI 页 > 导入', () => {
    document.body.innerHTML = `
      <div id="detailPanel"><span id="inPanel"></span></div>
      <div class="ai-workspace"><span id="inWs"></span></div>
      <div class="ProseMirror"><p id="inEditor"></p></div>
      <div id="cardGrid"><span id="inGrid"></span></div>`
    const at = (id: string) => document.getElementById(id)
    const bm = { shareMode: false, activeView: 'bookmarks' }
    expect(resolveFileDropMode(at('inPanel'), bm)).toBe('ai-zone')
    expect(resolveFileDropMode(at('inWs'), bm)).toBe('ai-zone')
    expect(resolveFileDropMode(at('inEditor'), bm)).toBe('editor')
    expect(resolveFileDropMode(at('inGrid'), bm)).toBe('import')
    expect(resolveFileDropMode(at('inGrid'), { shareMode: false, activeView: 'ai' })).toBe('ai')
    expect(resolveFileDropMode(at('inPanel'), { shareMode: true, activeView: 'bookmarks' })).toBe('reject')
    expect(resolveFileDropMode(null, bm)).toBe('import')
  })
})

describe('importDroppedFiles', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('确认后按合并模式导入第一个可导入文件', async () => {
    confirmMock.mockResolvedValue(true)
    const f = file('bookmarks.html')
    expect(await importDroppedFiles([f])).toBe(true)
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('bookmarks.html'))
    expect(importMock).toHaveBeenCalledWith(f)
  })

  it('取消确认则不导入', async () => {
    confirmMock.mockResolvedValue(false)
    expect(await importDroppedFiles([file('a.json')])).toBe(false)
    expect(importMock).not.toHaveBeenCalled()
  })

  it('多个文件：跳过不可导入的，只导入第一个可导入文件，并在确认里说明', async () => {
    confirmMock.mockResolvedValue(true)
    const csv = file('list.csv')
    await importDroppedFiles([file('photo.png'), csv, file('b.json')])
    expect(confirmMock.mock.calls[0][0]).toMatch(/一次只能导入一个文件/)
    expect(importMock).toHaveBeenCalledTimes(1)
    expect(importMock).toHaveBeenCalledWith(csv)
  })

  it('没有可导入文件：提示格式，不弹确认', async () => {
    expect(await importDroppedFiles([file('photo.png')])).toBe(false)
    expect(confirmMock).not.toHaveBeenCalled()
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/HTML、JSON 或 CSV/), false)
  })
})

describe('挂载后的 document 级分流', () => {
  let api: ReturnType<typeof useFileDropImport>
  let wrapper: ReturnType<typeof mount> | null = null
  // 卸载以移除 document 监听，避免用例间叠加
  afterEach(() => { wrapper?.unmount(); wrapper = null })

  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    document.body.innerHTML = ''
    const Comp = defineComponent({
      setup() { api = useFileDropImport(); return () => h('div') },
    })
    wrapper = mount(Comp, { attachTo: document.body })
    document.body.insertAdjacentHTML('beforeend', `
      <div id="detailPanel"><span id="inPanel"></span></div>
      <div class="ProseMirror"><p id="inEditor"></p></div>
      <div id="cardGrid"><span id="inGrid"></span></div>`)
  })

  const at = (id: string) => document.getElementById(id) as HTMLElement

  it('主界面 dragover：接管（防止浏览器打开文件）并显示导入提示', async () => {
    const e = dragEvent('dragover', [])
    at('inGrid').dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
    expect(e.dataTransfer!.dropEffect).toBe('copy')
    expect(api.overlayMode.value).toBe('import')
  })

  it('站内卡片拖动不受影响', () => {
    const e = dragEvent('dragover', [], { types: ['application/x-linkvault'] })
    at('inGrid').dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
    expect(api.overlayMode.value).toBeNull()
  })

  it('主界面 drop：确认后导入，提示收起', async () => {
    at('inGrid').dispatchEvent(dragEvent('dragover', []))
    const f = file('bookmarks.html')
    const e = dragEvent('drop', [f])
    at('inGrid').dispatchEvent(e)
    await flush()
    expect(e.defaultPrevented).toBe(true)
    expect(api.overlayMode.value).toBeNull()
    expect(importMock).toHaveBeenCalledWith(f)
    expect(attachMock).not.toHaveBeenCalled()
  })

  it('右侧 AI 栏：不显示导入提示、不导入（由面板自己引用）', async () => {
    const over = dragEvent('dragover', [])
    at('inPanel').dispatchEvent(over)
    expect(api.overlayMode.value).toBeNull()
    at('inPanel').dispatchEvent(dragEvent('drop', [file('a.html')]))
    await flush()
    expect(importMock).not.toHaveBeenCalled()
    expect(attachMock).not.toHaveBeenCalled()
  })

  it('AI 页的其余位置：显示「添加到 AI 对话」并作为附件引用', async () => {
    useUIStore().activeView = 'ai'
    at('inGrid').dispatchEvent(dragEvent('dragover', []))
    expect(api.overlayMode.value).toBe('ai')
    const f = file('a.html')
    at('inGrid').dispatchEvent(dragEvent('drop', [f]))
    await flush()
    expect(attachMock).toHaveBeenCalledWith([f])
    expect(importMock).not.toHaveBeenCalled()
  })

  it('编辑器已处理（插入图片）时不重复处理；未处理的可导入文件仍走导入', async () => {
    const handled = dragEvent('drop', [file('a.png')])
    handled.preventDefault()
    at('inEditor').dispatchEvent(handled)
    await flush()
    expect(importMock).not.toHaveBeenCalled()

    const png = dragEvent('drop', [file('b.pdf')])
    at('inEditor').dispatchEvent(png)
    await flush()
    expect(confirmMock).not.toHaveBeenCalled()

    const f = file('c.json')
    at('inEditor').dispatchEvent(dragEvent('drop', [f]))
    await flush()
    expect(importMock).toHaveBeenCalledWith(f)
  })

  it('分享只读页：拒收（dropEffect none），不导入也不引用', async () => {
    useUIStore().shareMode = { groupId: 'g1' } as never
    const over = dragEvent('dragover', [])
    at('inPanel').dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    expect(over.dataTransfer!.dropEffect).toBe('none')
    expect(api.overlayMode.value).toBeNull()
    const drop = dragEvent('drop', [file('a.html')])
    at('inGrid').dispatchEvent(drop)
    await flush()
    expect(drop.defaultPrevented).toBe(true)
    expect(importMock).not.toHaveBeenCalled()
    expect(attachMock).not.toHaveBeenCalled()
  })

  it('dragover 停止触发后提示自动收起', async () => {
    vi.useFakeTimers()
    try {
      at('inGrid').dispatchEvent(dragEvent('dragover', []))
      expect(api.overlayMode.value).toBe('import')
      vi.advanceTimersByTime(300)
      await nextTick()
      expect(api.overlayMode.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
