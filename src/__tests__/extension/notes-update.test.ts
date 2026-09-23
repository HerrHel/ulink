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

describe('extension/notes-update.js — formatNotesForDisplay 备注净化与格式化', () => {
  it('处理空串或无效值返回空串', () => {
    expect(getApi().formatNotesForDisplay('')).toBe('')
    expect(getApi().formatNotesForDisplay(null as any)).toBe('')
    expect(getApi().formatNotesForDisplay(undefined as any)).toBe('')
    expect(getApi().formatNotesForDisplay('   ')).toBe('')
  })

  it('保留纯文本多行与普通空白', () => {
    const text = '第一行\n第二行\n第三行'
    expect(getApi().formatNotesForDisplay(text)).toBe(text)
  })

  it('净化 TipTap/HTML 段落并转换为自然换行', () => {
    const html = '<p>第一行笔记</p><p>第二行笔记</p>'
    expect(getApi().formatNotesForDisplay(html)).toBe('第一行笔记\n第二行笔记')
  })

  it('净化 HTML 实体与行内标签', () => {
    const html = '<p>A &amp; B &lt; C &gt; &quot;D&quot; &#39;E&#39;&nbsp;F</p><br><span>尾注</span>'
    expect(getApi().formatNotesForDisplay(html)).toBe("A & B < C > \"D\" 'E' F\n\n尾注")
  })


  it('收敛超过两行的冗余连续空行', () => {
    const text = '段落一\n\n\n\n\n段落二'
    expect(getApi().formatNotesForDisplay(text)).toBe('段落一\n\n段落二')
  })

  it('三段密文字符串直接返回空串（防止展示 Base64 密文乱码）', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    expect(getApi().isThreePartCipher(cipher)).toBe(true)
    expect(getApi().formatNotesForDisplay(cipher)).toBe('')
  })

  it('普通三段文本（如域名或版本号）不受密文拦截', () => {
    expect(getApi().isThreePartCipher('www.example.com')).toBe(false)
    expect(getApi().formatNotesForDisplay('www.example.com')).toBe('www.example.com')
    expect(getApi().isThreePartCipher('v1.2.3')).toBe(false)
    expect(getApi().formatNotesForDisplay('v1.2.3')).toBe('v1.2.3')
  })
})


