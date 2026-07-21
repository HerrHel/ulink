import { describe, it, expect, vi, afterEach } from 'vitest'
import { downloadFile, dateStamp } from '../lib/download.js'

describe('download', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('dateStamp 返回 YYYY-MM-DD', () => {
    expect(dateStamp()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('downloadFile 创建 Blob URL 并触发 a.click', () => {
    const click = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'a') (el as HTMLAnchorElement).click = click
      return el
    })
    const append = vi.spyOn(document.body, 'appendChild')
    const remove = vi.spyOn(document.body, 'removeChild')

    downloadFile('x.json', '{"a":1}', 'application/json')
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(append).toHaveBeenCalled()
    expect(remove).toHaveBeenCalled()
  })
})
