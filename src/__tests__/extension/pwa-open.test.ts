/**
 * extension/pwa-open.js 护栏测试（ext B2 SAVE_TO_VAULT 决策纯函数）。
 *
 * 仿 config.test.ts / keypress.test.ts 范式：pwa-open.js 是 IIFE 挂
 * window.LinkVaultPwaOpen 全局（jsdom 安全、无 chrome.* 依赖），import 即挂载。
 *
 * 测 decideOpenPwa(url, title, notes, pwaUrl) 全分支：
 *   - 空 url → shouldOpen=false reason=NO_URL
 *   - 7 种不安全协议 → shouldOpen=false reason=UNSAFE_PROTOCOL
 *   - 合法 http(s) url → shouldOpen=true + targetUrl 正确包含参数
 *   - 有选中文本时 notes 参数加入 targetUrl
 */
import { describe, it, expect } from 'vitest'

import '../../../extension/pwa-open.js'

function getApi() {
  // @ts-expect-error extension 挂 window 全局
  const api = window.LinkVaultPwaOpen
  expect(api, 'extension/pwa-open.js 应挂载 window.LinkVaultPwaOpen').toBeDefined()
  expect(typeof api.decideOpenPwa, 'decideOpenPwa 应是函数').toBe('function')
  return api
}

describe('extension/pwa-open.js — decideOpenPwa PWA 打开决策（B2）', () => {
  it('空 url → shouldOpen=false', () => {
    expect(getApi().decideOpenPwa('', 't', null, 'https://app.example').shouldOpen).toBe(false)
    expect(getApi().decideOpenPwa(null, 't', null, 'https://app.example').shouldOpen).toBe(false)
  })

  it('不安全协议 → shouldOpen=false', () => {
    const apis = ['chrome://settings', 'edge://flags', 'about:blank', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<script>', 'blob:abc123', 'view-source:https://example.com']
    for (const u of apis) {
      expect(getApi().decideOpenPwa(u, 't', null, 'https://app.example').shouldOpen, `应拒: ${u}`).toBe(false)
    }
  })

  it('合法 http/https url → shouldOpen=true + targetUrl 含正确参数', () => {
    const d = getApi().decideOpenPwa('https://example.com', 'My Page', null, 'https://app.example')
    expect(d.shouldOpen).toBe(true)
    expect(d.targetUrl).toContain('ext_save_url=https%3A%2F%2Fexample.com')
    expect(d.targetUrl).toContain('ext_save_title=My+Page')
    expect(d.targetUrl).toContain('https://app.example/?ext_save=1')
  })

  it('有选中文本时 notes 参数加入 targetUrl', () => {
    const d = getApi().decideOpenPwa('https://example.com', 't', '选中文本', 'https://app.example')
    expect(d.shouldOpen).toBe(true)
    expect(d.targetUrl).toContain('ext_save_notes=%E9%80%89%E4%B8%AD%E6%96%87%E6%9C%AC')
  })
})