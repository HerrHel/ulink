/**
 * extension/panel-bridge.js — 侧边栏壳 ↔ 主站 iframe 协议纯函数
 */
import { describe, it, expect } from 'vitest'
import {
  APP_ORIGIN,
  appPanelUrl,
  buildTabPayload,
  parseAppMessage,
  resolveAppOrigin,
  sameUrl,
  toAppMessage,
} from '../../../extension/panel-bridge.js'
import { parseInboundMessage } from '../../lib/extPanel'

describe('resolveAppOrigin', () => {
  it('默认生产主站，只允许覆盖为本地调试地址', () => {
    expect(resolveAppOrigin('')).toBe('https://ulink.ren')
    expect(resolveAppOrigin('?app=http://localhost:4173')).toBe('http://localhost:4173')
    expect(resolveAppOrigin('?app=https://evil.example')).toBe(APP_ORIGIN)
    expect(resolveAppOrigin('?app=javascript:alert(1)')).toBe(APP_ORIGIN)
  })

  it('iframe 地址带侧栏模式参数', () => {
    expect(appPanelUrl('https://ulink.ren')).toBe('https://ulink.ren/app?mode=panel')
  })
})

describe('buildTabPayload', () => {
  it('内部页 / 拿不到网址时返回 null', () => {
    expect(buildTabPayload({ url: 'chrome://newtab' })).toBeNull()
    expect(buildTabPayload({ title: '无 activeTab 授权' })).toBeNull()
    expect(buildTabPayload(null)).toBeNull()
  })

  it('元数据优先于标签属性，划词优先于视频字幕', () => {
    const tab = { url: 'https://a.com/v', title: '标签标题', favIconUrl: 'https://a.com/f.ico' }
    expect(buildTabPayload(tab, { title: 'OG 标题', selection: '划的字', currentSubtitle: '字幕', videoTime: '01:02' })).toEqual({
      url: 'https://a.com/v', title: 'OG 标题', description: '', selection: '划的字', icon: 'https://a.com/f.ico',
    })
    expect(buildTabPayload(tab, { currentSubtitle: '字幕', videoTime: '01:02' })!.selection).toBe('【01:02】字幕')
  })

  it('图标只认 http(s)', () => {
    const p = buildTabPayload({ url: 'https://a.com', favIconUrl: 'data:image/png;base64,xx' }, { icon: 'javascript:1' })
    expect(p!.icon).toBe('')
  })

  it('产出的消息能被主站协议解析（两端契约）', () => {
    const payload = buildTabPayload({ url: 'https://a.com/x', title: 'A' }, { selection: '重点' })
    const parsed = parseInboundMessage(toAppMessage('tab', { tab: payload }))
    expect(parsed).toEqual({
      type: 'tab',
      tab: { url: 'https://a.com/x', title: 'A', description: '', selection: '重点', icon: '' },
    })
    expect(parseInboundMessage(toAppMessage('save'))).toEqual({ type: 'save' })
  })
})

describe('parseAppMessage', () => {
  const ok = { ns: 'ulink-ext', v: 1 }
  it('只认当前主站 origin 发来的本协议消息', () => {
    expect(parseAppMessage(APP_ORIGIN, { ...ok, type: 'ready' }, APP_ORIGIN)).toEqual({ type: 'ready' })
    expect(parseAppMessage(APP_ORIGIN, { ...ok, type: 'matched', url: 'https://a.com/', saved: true }, APP_ORIGIN))
      .toEqual({ type: 'matched', url: 'https://a.com/', saved: true })
    expect(parseAppMessage('https://evil.example', { ...ok, type: 'ready' }, APP_ORIGIN)).toBeNull()
    expect(parseAppMessage(APP_ORIGIN, { type: 'ready' }, APP_ORIGIN)).toBeNull()
    expect(parseAppMessage(APP_ORIGIN, { ...ok, v: 2, type: 'ready' }, APP_ORIGIN)).toBeNull()
    expect(parseAppMessage(APP_ORIGIN, { ...ok, type: 'matched' }, APP_ORIGIN)).toBeNull()
  })

  it('saved 只认严格的 true', () => {
    expect(parseAppMessage(APP_ORIGIN, { ...ok, type: 'matched', url: 'https://a.com/', saved: 'yes' }, APP_ORIGIN))
      .toEqual({ type: 'matched', url: 'https://a.com/', saved: false })
  })
})

describe('sameUrl', () => {
  it('按 URL 规整后比较', () => {
    expect(sameUrl('https://a.com', 'https://a.com/')).toBe(true)
    expect(sameUrl('https://a.com/x', 'https://a.com/y')).toBe(false)
    expect(sameUrl('not a url', 'https://a.com/')).toBe(false)
  })
})
