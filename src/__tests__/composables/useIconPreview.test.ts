/**
 * useIconPreview — previewIconUrl / clearIcon 图标预览可见行为护栏
 *
 * 两函数被 useBookmark (bmForm) 与 useGroup (geForm) 复用，是「书签/组编辑表单里
 * 图标 URL 输入 → 实时预览图标 + 显示清除按钮」这一用户可见行为的唯一承载逻辑。
 * 在 useBookmark.test.ts 中两者被 vi.mock 成空 fn（line 119-121），真实逻辑零直测；
 * 本护栏把三分支可见态与清除清零契约直锁为可回归断言，防未来误改可见性语义。
 */
import { describe, it, expect } from 'vitest'
import { previewIconUrl, clearIcon } from '../../composables/ui/useIconPreview.js'

interface IconForm {
  icon: string
  clearIconVisible: boolean
  iconPreviewVisible: boolean
  iconPreviewUrl: string
}

function makeForm(over: Partial<IconForm> = {}): IconForm {
  return {
    icon: '',
    clearIconVisible: false,
    iconPreviewVisible: false,
    iconPreviewUrl: '',
    ...over,
  }
}

describe('previewIconUrl', () => {
  it('非空 url：置 clearIconVisible + iconPreviewVisible + 写 iconPreviewUrl', () => {
    const form = makeForm({ icon: 'https://example.com/favicon.ico' })
    previewIconUrl(form)
    expect(form.clearIconVisible).toBe(true)
    expect(form.iconPreviewVisible).toBe(true)
    expect(form.iconPreviewUrl).toBe('https://example.com/favicon.ico')
  })

  it('非空 url 含首尾空白：trim 后写入 iconPreviewUrl（预览用规范化 url）', () => {
    const form = makeForm({ icon: '  https://example.com/favicon.ico  ' })
    previewIconUrl(form)
    expect(form.iconPreviewUrl).toBe('https://example.com/favicon.ico')
    expect(form.clearIconVisible).toBe(true)
    expect(form.iconPreviewVisible).toBe(true)
  })

  it('纯空白 url（trim 后空）：走空分支清可见态不写预览 url', () => {
    const form = makeForm({ icon: '   \t  ', iconPreviewUrl: 'stale-url' })
    previewIconUrl(form)
    expect(form.clearIconVisible).toBe(false)
    expect(form.iconPreviewVisible).toBe(false)
    expect(form.iconPreviewUrl).toBe('stale-url')
  })

  it('上一态有可见标志 + 新 url 空：可见标志被翻转回 false（不残留旧态）', () => {
    const form = makeForm({
      icon: '',
      clearIconVisible: true,
      iconPreviewVisible: true,
      iconPreviewUrl: 'old.ico',
    })
    previewIconUrl(form)
    expect(form.clearIconVisible).toBe(false)
    expect(form.iconPreviewVisible).toBe(false)
    // iconPreviewUrl 不被动清，保留 old.ico（防误判空分支会清预览 url）
    expect(form.iconPreviewUrl).toBe('old.ico')
  })

  it('连续非空→空→非空：可见态随 url 重新翻转而 back true', () => {
    const form = makeForm()
    form.icon = 'https://a.com/favicon.ico'
    previewIconUrl(form)
    expect(form.iconPreviewVisible).toBe(true)
    form.icon = ''
    previewIconUrl(form)
    expect(form.iconPreviewVisible).toBe(false)
    form.icon = 'https://b.com/favicon.ico'
    previewIconUrl(form)
    expect(form.iconPreviewVisible).toBe(true)
    expect(form.iconPreviewUrl).toBe('https://b.com/favicon.ico')
  })
})

describe('clearIcon', () => {
  it('清空 icon 字段 + 清三个可见态（含 iconPreviewUrl 不显式清但视觉隐藏）', () => {
    const form = makeForm({
      icon: 'https://example.com/favicon.ico',
      clearIconVisible: true,
      iconPreviewVisible: true,
      iconPreviewUrl: 'https://example.com/favicon.ico',
    })
    clearIcon(form)
    expect(form.icon).toBe('')
    expect(form.clearIconVisible).toBe(false)
    expect(form.iconPreviewVisible).toBe(false)
  })

  it('不改写 iconPreviewUrl（仅清可见标志，预览 url 留作无副作用残留——锁定真实行为）', () => {
    const form = makeForm({
      icon: 'https://example.com/favicon.ico',
      clearIconVisible: true,
      iconPreviewVisible: true,
      iconPreviewUrl: 'https://example.com/favicon.ico',
    })
    clearIcon(form)
    // clearIcon 只清三个可见态 + icon 字段，不碰 iconPreviewUrl
    // 锁定此真实行为：防未来误以为 clear 应一并清预览 url 而加赋值
    expect(form.iconPreviewUrl).toBe('https://example.com/favicon.ico')
  })

  it('空态 form 调 clear 原地无抛（幂等清已空字段）', () => {
    const form = makeForm()
    clearIcon(form)
    expect(form.icon).toBe('')
    expect(form.clearIconVisible).toBe(false)
    expect(form.iconPreviewVisible).toBe(false)
  })

  it('部分可见态 + 有 icon：clear 后全部归零', () => {
    const form = makeForm({
      icon: 'x.ico',
      clearIconVisible: true,
      iconPreviewVisible: false,
      iconPreviewUrl: '',
    })
    clearIcon(form)
    expect(form.icon).toBe('')
    expect(form.clearIconVisible).toBe(false)
    expect(form.iconPreviewVisible).toBe(false)
  })
})
