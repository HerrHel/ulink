/**
 * extension/auth-flow.js 护栏测试（A3 Auth 状态变化契约）。
 *
 * 仿 config.test.ts / keypress.test.ts / notes-update.test.ts 范式：auth-flow.js 是 IIFE 挂
 * window.LinkVaultAuthFlow 全局（jsdom 安全、无 chrome.* / supabase / DOM 依赖），import 即挂载，
 * 经全局对象断言纯函数分支。
 *
 * 锁 A3 修复契约：Supabase v2 onAuthStateChange 注册即发 INITIAL_SESSION（当前会话快照），由
 * sidepanel.js checkAuth() 的 getSession() 独占加载——listener 收到 INITIAL_SESSION 应跳过
 * 不触发 loadFromCloud。handleAuthStateChange 返回 { action } 供调用方 translate 副作用：
 *   - INITIAL_SESSION → 'skip'（不触发任何副作用回调 = 不触发 loadFromCloud）
 *   - 登录事件带 session → 'authed'（含 user 引用）
 *   - 登出/无 session → 'signedout'
 * SDK 未来若改事件名（INITIAL_SESSION 改名）或行为，测试会 fail 提示。
 */
import { describe, it, expect } from 'vitest'

// 导入即执行 IIFE 挂 `window.LinkVaultAuthFlow`，jsdom window 安全（无 chrome.* 依赖）。
import '../../../extension/auth-flow.js'

function getApi() {
  // @ts-expect-error extension 挂 window 全局
  const api = window.LinkVaultAuthFlow
  expect(api, 'extension/auth-flow.js 应挂载 window.LinkVaultAuthFlow').toBeDefined()
  expect(typeof api.handleAuthStateChange, 'handleAuthStateChange 应是函数').toBe('function')
  return api
}

describe('extension/auth-flow.js — handleAuthStateChange Auth 事件决策（A3 契约）', () => {
  it('INITIAL_SESSION 返回 skip（A3 修复核心：不触发 loadFromCloud，由 checkAuth 独占加载）', () => {
    expect(getApi().handleAuthStateChange('INITIAL_SESSION', { user: { id: 'u1' } }).action).toBe('skip')
    expect(getApi().handleAuthStateChange('INITIAL_SESSION', null).action).toBe('skip')
  })

  it('SIGNED_IN 带 session 返回 authed 并透传 user', () => {
    const d = getApi().handleAuthStateChange('SIGNED_IN', { user: { id: 'u1' } })
    expect(d.action).toBe('authed')
    expect(d.user.id).toBe('u1')
  })

  it('SIGNED_IN 无 session 返回 signedout（session 快照被清）', () => {
    expect(getApi().handleAuthStateChange('SIGNED_IN', null).action).toBe('signedout')
  })

  it('SIGNED_OUT 返回 signedout', () => {
    expect(getApi().handleAuthStateChange('SIGNED_OUT', null).action).toBe('signedout')
  })

  it('TOKEN_REFRESHED 带 session 返回 authed（后续真实事件仍正常拉数据，不误 skip）', () => {
    const d = getApi().handleAuthStateChange('TOKEN_REFRESHED', { user: { id: 'u2' } })
    expect(d.action).toBe('authed')
  })
})
