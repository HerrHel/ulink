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

import { decideOpenPwa } from '../../../extension/pwa-open.js'

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

/**
 * B2 回归门：background.js（MV3 service worker）经 ES module import 引入 decideOpenPwa
 * ——SW 无 window 全局，不走 window.LinkVaultPwaOpen 挂载。此 describe 直接消费 export，
 * 锁死「import 路径必须可用」+「协议拦截必须生效」回归门。
 *
 * 修复前 background.js 用 `window.LinkVaultPwaOpen ? ... : fallback(!!url)`，
 * pwa-open.js 未被引入 SW → 走 fallback → fallback 丢 7 种危险协议拦截 → 安全回归。
 */
describe('extension/pwa-open.js — ES module export 路径（B2 回归门）', () => {
  it('import decideOpenPwa 是函数（不依赖 window 挂载）', () => {
    expect(typeof decideOpenPwa).toBe('function')
  })

  it('import 路径拦截 7 种危险协议（修复前 fallback 仅判 !!url 导致回归）', () => {
    const unsafe = ['chrome://settings', 'edge://flags', 'about:blank', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,<script>', 'blob:abc123', 'view-source:https://example.com']
    for (const u of unsafe) {
      const d = decideOpenPwa(u, 't', null, 'https://app.example')
      expect(d.shouldOpen, `import 路径应拒危险协议: ${u}`).toBe(false)
      expect(d.reason).toBe('UNSAFE_PROTOCOL')
    }
  })

  it('import 路径空 url → NO_URL', () => {
    expect(decideOpenPwa('', 't', null, 'https://app.example').reason).toBe('NO_URL')
  })

  it('import 路径合法 http url → shouldOpen=true targetUrl 含参数', () => {
    const d = decideOpenPwa('https://example.com', 'My Page', null, 'https://app.example')
    expect(d.shouldOpen).toBe(true)
    expect(d.targetUrl).toContain('ext_save_url=https%3A%2F%2Fexample.com')
  })
})