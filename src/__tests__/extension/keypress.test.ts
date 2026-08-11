/**
 * extension/keypress.js 护栏测试（ext B3 搜索快捷键劫持判定）。
 *
 * 仿 config.test.ts / crypto.test.ts 范式：keypress.js 是 IIFE 挂 window.LinkVaultKeyHijack
 * 全局（jsdom 安全、无 chrome.* 依赖），import 即执行挂载，经全局对象断言纯函数分支。
 *
 * 测 shouldHijackSearchKey(e) 全分支：
 *   - INPUT 内 Ctrl+F / / 不劫（B3 修复核心：焦点在输入框时尊重输入上下文，补 tagName 限制）
 *   - INPUT 外 Ctrl+F / / 劫
 *   - metaKey（Cmd+/）不劫（macOS 浏览器快捷键）
 *   - 普通按键不劫
 *   - 仅豁免 INPUT、TEXTAREA 等非 INPUT 输入元素仍劫（对齐原 / 分支 `tagName !== 'INPUT'` 语义）
 */
import { describe, it, expect } from 'vitest'

// 导入即执行 IIFE 挂 `window.LinkVaultKeyHijack`，jsdom window 安全（无 chrome.* 依赖）。
import '../../../extension/keypress.js'

function getApi() {
  // @ts-expect-error extension 挂 window 全局
  const api = window.LinkVaultKeyHijack
  expect(api, 'extension/keypress.js 应挂载 window.LinkVaultKeyHijack').toBeDefined()
  expect(typeof api.shouldHijackSearchKey, 'shouldHijackSearchKey 应是函数').toBe('function')
  return api
}

function keyEvent(overrides: Record<string, unknown> = {}): {
  ctrlKey: boolean
  metaKey: boolean
  key: string
  target: { tagName: string }
} {
  return { ctrlKey: false, metaKey: false, key: '', target: { tagName: 'DIV' }, ...overrides }
}

describe('extension/keypress.js — shouldHijackSearchKey 搜索快捷键劫持判定', () => {
  describe('INPUT 内（B3 修复核心）', () => {
    it('焦点在 INPUT 时按 Ctrl+F 不劫（修复：尊重输入框上下文，不劫焦点）', () => {
      const e = keyEvent({ ctrlKey: true, key: 'f', target: { tagName: 'INPUT' } })
      expect(getApi().shouldHijackSearchKey(e)).toBe(false)
    })

    it('焦点在 INPUT 时按 / 不劫（与原 / 分支 design intent 对齐）', () => {
      const e = keyEvent({ key: '/', target: { tagName: 'INPUT' } })
      expect(getApi().shouldHijackSearchKey(e)).toBe(false)
    })
  })

  describe('INPUT 外（应劫）', () => {
    it('焦点在非输入元素时按 Ctrl+F 劫', () => {
      const e = keyEvent({ ctrlKey: true, key: 'f', target: { tagName: 'DIV' } })
      expect(getApi().shouldHijackSearchKey(e)).toBe(true)
    })

    it('焦点在非输入元素时按 / 劫', () => {
      const e = keyEvent({ key: '/', target: { tagName: 'DIV' } })
      expect(getApi().shouldHijackSearchKey(e)).toBe(true)
    })
  })

  describe('边界', () => {
    it('Cmd+/（metaKey）不劫（macOS 浏览器快捷键保留）', () => {
      const e = keyEvent({ metaKey: true, key: '/', target: { tagName: 'DIV' } })
      expect(getApi().shouldHijackSearchKey(e)).toBe(false)
    })

    it('普通按键（非 f / 非 /）不劫', () => {
      expect(getApi().shouldHijackSearchKey(keyEvent({ key: 'a' }))).toBe(false)
      expect(getApi().shouldHijackSearchKey(keyEvent({ key: 'Escape' }))).toBe(false)
    })

    it('仅豁免 INPUT，TEXTAREA 等非 INPUT 输入元素仍劫（对齐原 / 分支 tagName !== INPUT 语义）', () => {
      const e = keyEvent({ ctrlKey: true, key: 'f', target: { tagName: 'TEXTAREA' } })
      expect(getApi().shouldHijackSearchKey(e)).toBe(true)
    })
  })
})
