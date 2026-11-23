/**
 * lib/extPanel.ts — 扩展侧边栏协议纯函数
 */
import { describe, it, expect } from 'vitest'
import {
  EXT_MSG_NS,
  EXT_MSG_VERSION,
  buildOutboundMessage,
  detectPanelMode,
  guessParentOrigin,
  isExtensionOrigin,
  parseInboundMessage,
  parseTabInfo,
  safeHttpUrl,
} from '../../lib/extPanel'

const msg = (body: Record<string, unknown>) => ({ ns: EXT_MSG_NS, v: EXT_MSG_VERSION, ...body })

describe('isExtensionOrigin', () => {
  it('只认浏览器扩展 origin', () => {
    expect(isExtensionOrigin('chrome-extension://epjlkfndeonlpjocdafoiaomdigopeeh')).toBe(true)
    expect(isExtensionOrigin('moz-extension://0f1e2d3c-aaaa-bbbb-cccc-1234567890ab')).toBe(true)
    expect(isExtensionOrigin('https://ulink.ren')).toBe(false)
    expect(isExtensionOrigin('null')).toBe(false)
    expect(isExtensionOrigin('chrome-extension://abc/path')).toBe(false)
    expect(isExtensionOrigin(undefined)).toBe(false)
  })
})

describe('safeHttpUrl / parseTabInfo', () => {
  it('只放行 http(s)，拒绝 javascript: / data: / 内部页', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHttpUrl('javascript:alert(1)')).toBe('')
    expect(safeHttpUrl('data:text/html,x')).toBe('')
    expect(safeHttpUrl('chrome://settings')).toBe('')
    expect(safeHttpUrl('/relative')).toBe('')
    expect(safeHttpUrl(42)).toBe('')
  })

  it('url 不合法时整条丢弃', () => {
    expect(parseTabInfo({ url: 'chrome://newtab', title: 'x' })).toBeNull()
    expect(parseTabInfo(null)).toBeNull()
  })

  it('字段截断，非字符串字段归空，图标同样只认 http(s)', () => {
    const tab = parseTabInfo({
      url: 'https://example.com',
      title: 'T'.repeat(1000),
      description: 123,
      selection: '  选中文字  ',
      icon: 'javascript:alert(1)',
    })!
    expect(tab.title.length).toBe(300)
    expect(tab.description).toBe('')
    expect(tab.selection).toBe('选中文字')
    expect(tab.icon).toBe('')
  })
})

describe('parseInboundMessage', () => {
  it('解析 tab 与 save', () => {
    expect(parseInboundMessage(msg({ type: 'tab', tab: { url: 'https://a.com', title: 'A' } }))).toEqual({
      type: 'tab',
      tab: { url: 'https://a.com/', title: 'A', description: '', selection: '', icon: '' },
    })
    expect(parseInboundMessage(msg({ type: 'save' }))).toEqual({ type: 'save' })
  })

  it('内部页推来 tab=null，表示清空当前页', () => {
    expect(parseInboundMessage(msg({ type: 'tab', tab: { url: 'edge://newtab' } }))).toEqual({ type: 'tab', tab: null })
  })

  it('命名空间 / 版本 / 类型不符一律忽略', () => {
    expect(parseInboundMessage({ type: 'save' })).toBeNull()
    expect(parseInboundMessage({ ns: EXT_MSG_NS, v: 999, type: 'save' })).toBeNull()
    expect(parseInboundMessage(msg({ type: 'deleteAll' }))).toBeNull()
    expect(parseInboundMessage('save')).toBeNull()
  })
})

describe('buildOutboundMessage', () => {
  it('自动带命名空间与版本', () => {
    expect(buildOutboundMessage({ type: 'matched', url: 'https://a.com/', saved: true })).toEqual({
      ns: EXT_MSG_NS, v: EXT_MSG_VERSION, type: 'matched', url: 'https://a.com/', saved: true,
    })
  })
})

describe('detectPanelMode', () => {
  it('必须被嵌入 iframe：顶层直接打开 ?mode=panel 不进入侧栏模式', () => {
    expect(detectPanelMode({ search: '?mode=panel', isFramed: false, sessionFlag: null })).toBe(false)
    expect(detectPanelMode({ search: '?mode=panel', isFramed: true, sessionFlag: null })).toBe(true)
  })

  it('URL 参数被清掉后靠会话标记延续', () => {
    expect(detectPanelMode({ search: '', isFramed: true, sessionFlag: '1' })).toBe(true)
    expect(detectPanelMode({ search: '', isFramed: true, sessionFlag: null })).toBe(false)
  })
})

describe('guessParentOrigin', () => {
  it('取 ancestorOrigins 首项且必须是扩展 origin', () => {
    expect(guessParentOrigin(['chrome-extension://abcdef'])).toBe('chrome-extension://abcdef')
    expect(guessParentOrigin(['https://evil.example'])).toBeNull()
    expect(guessParentOrigin([])).toBeNull()
    expect(guessParentOrigin(undefined)).toBeNull()
  })
})
