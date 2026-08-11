/**
 * extension/notes-update.js 护栏测试（ext B1 备注更新决策）。
 *
 * 仿 config.test.ts / keypress.test.ts 范式：notes-update.js 是 IIFE 挂
 * window.LinkVaultNotesUpdate 全局（jsdom 安全、无 chrome.* 依赖），import 即挂载，
 * 经全局对象断言纯函数分支。
 *
 * 测 notesUpdateOutcome(newNotes, r)：
 *   - update 成功 → writeLocal=true（写本地引用 + toast 成功 + refresh 详情）
 *   - update 失败 → writeLocal=false（B1 修复核心：不污染 allBookmarks，搜索/详情不显假备注）
 *   - 空 error / 无 error 字段 → 按成功处理
 */
import { describe, it, expect } from 'vitest'

// 导入即执行 IIFE 挂 `window.LinkVaultNotesUpdate`，jsdom window 安全（无 chrome.* 依赖）。
import '../../../extension/notes-update.js'

function getApi() {
  // @ts-expect-error extension 挂 window 全局
  const api = window.LinkVaultNotesUpdate
  expect(api, 'extension/notes-update.js 应挂载 window.LinkVaultNotesUpdate').toBeDefined()
  expect(typeof api.notesUpdateOutcome, 'notesUpdateOutcome 应是函数').toBe('function')
  return api
}

describe('extension/notes-update.js — notesUpdateOutcome 备注更新决策', () => {
  it('update 成功时 writeLocal=true（写本地引用 + toast 成功 + refresh 详情）', () => {
    const out = getApi().notesUpdateOutcome('新备注', { error: null })
    expect(out.writeLocal).toBe(true)
    expect(out.toast).toBe('备注已更新')
    expect(out.refresh).toBe(true)
  })

  it('update 失败时 writeLocal=false（B1 修复核心：不污染 allBookmarks）', () => {
    const out = getApi().notesUpdateOutcome('新备注', { error: { message: 'Network' } })
    expect(out.writeLocal).toBe(false)
    expect(out.toast).toContain('保存失败')
    expect(out.refresh).toBe(false)
  })

  it('error 字段缺失（r 为空对象）时按成功处理', () => {
    const out = getApi().notesUpdateOutcome('新备注', {})
    expect(out.writeLocal).toBe(true)
  })

  it('r 为 null 时按成功处理', () => {
    const out = getApi().notesUpdateOutcome('新备注', null)
    expect(out.writeLocal).toBe(true)
  })
})
