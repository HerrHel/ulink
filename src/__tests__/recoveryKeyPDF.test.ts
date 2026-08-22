/**
 * recoveryKeyPDF.test.ts — generateRecoveryKeyPDF 护栏单测（D1-10）
 *
 * generateRecoveryKeyPDF 是 E2E 安全相关：用户忘记主密码时，Recovery Key 是
 * 重设主密码的唯一途径，其导出的 HTML 文件是用户保管的物理备份。该函数此前
 * 零测试覆盖。本护栏锁定以下不变量，防回归：
 * 1. XSS 防护：recoveryKey 经 esc() 转义，恶意 key（含 HTML/script）不得以明文
 *    出现在导出 HTML 中——用户若误把含特殊字符的串当 key 输入或被注入，导出物
 *    不能变成可执行 HTML 载荷。
 * 2. 完整性：合法 key 原样出现在 .key-value 区块（仅做 HTML 转义，不丢字符）。
 * 3. 下载触发：downloadFile 以 .html 扩展名 + text/html MIME 被调用。
 * 4. 结构不变：含 <title>、key-box、warning 等必要结构块。
 * 5. 转义与全站 esc 一致（含单引号）——这条契约由 esc 函数本身保证，此处通过
 *    含单引号的 key 间接锁定（导出物中单引号转成 &#39; 而非裸 '）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.mock 工厂会被提升到文件顶部，其内部不得引用顶层普通变量（TDZ）。
// 用 vi.hoisted 包裹 mock fn，使其同步提升到 mock 工厂之前并可在工厂内安全引用。
const { downloadFileMock } = vi.hoisted(() => ({ downloadFileMock: vi.fn() }))

// mock download 模块：仅替换 downloadFile（捕获调用参数，避免触发真实 DOM 下载），
// dateStamp 走 importOriginal 真实实现（jsdom 支持 new Date().toISOString，下断言文件名日期）。
// esc 走真实 utils.js（纯函数）。
vi.mock('../lib/download.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/download.js')>()
  return { ...actual, downloadFile: downloadFileMock }
})

// 在 mock 建立后 import 被测模块与 esc（验证 HTML 内 key 等于 esc(原 key) 这一不变量）
import { generateRecoveryKeyPDF } from '../lib/recoveryKeyPDF.js'
import { esc } from '../utils.js'

/** 抽取导出 HTML 中 .key-value 区块的内容（去壳），返回内部 HTML 字符串 */
function keyValueInner(html: string): string {
  const m = html.match(/<div class="key-value">([\s\S]*?)<\/div>/)
  return m ? m[1] : ''
}

describe('generateRecoveryKeyPDF（D1-10 护栏）', () => {
  beforeEach(() => {
    downloadFileMock.mockReset()
  })

  it('下载触发：以 .html 扩展名 + text/html MIME 调用 downloadFile', () => {
    generateRecoveryKeyPDF('TEST-KEY-1234')
    expect(downloadFileMock).toHaveBeenCalledTimes(1)
    const [filename, content, mime] = downloadFileMock.mock.calls[0]
    expect(filename).toMatch(/^ulink-Recovery-Key-.*\.html$/)
    expect(mime).toBe('text/html')
    expect(typeof content).toBe('string')
    expect(content.length).toBeGreaterThan(0)
  })

  it('文件名含 dateStamp：YYYY-MM-DD 形态（导出物可按时归类）', () => {
    generateRecoveryKeyPDF('K')
    const filename = downloadFileMock.mock.calls[0][0] as string
    // ulink-Recovery-Key-YYYY-MM-DD.html
    expect(filename).toMatch(/^ulink-Recovery-Key-\d{4}-\d{2}-\d{2}\.html$/)
  })

  it('完整性：合法 key 原样出现在 .key-value 区块（不丢字符）', () => {
    const key = 'LV2-ABCD-EFGH-JKLM-NOPQ-RSTUVWXYZ-001'
    generateRecoveryKeyPDF(key)
    const html = downloadFileMock.mock.calls[0][1] as string
    // 合法 key 无需转义字符，转义后应与原文逐字一致
    expect(keyValueInner(html)).toBe(key)
  })

  it('XSS 防护：HTML 内 key-value 区内容 === esc(输入 key)（关键不变量锁定）', () => {
    // 用 esc(原 key) 作为期望，强制"导出 HTML 中展示的 key 必须由全站统一 esc 转义"
    // 这一不变量成立——任一字符的转义漂移都会被此断言抓出。同时锁定原始恶意串不出现在 HTML。
    const malicious = '<script>alert(1)</script>'
    generateRecoveryKeyPDF(malicious)
    const html = downloadFileMock.mock.calls[0][1] as string
    // 原始恶意骨架不得出现（等同 <script> 未被转义）
    const lt = String.fromCharCode(60), gt = String.fromCharCode(62)
    const raw = `${lt}script${gt}alert(1)${lt}/script${gt}`
    expect(html).not.toContain(raw)
    // key-value 内 === esc(malicious)
    expect(keyValueInner(html)).toBe(esc(malicious))
  })

  it('XSS 防护：含单引号的 key 转成 &#39;（与全站 esc 单引号转义契约一致）', () => {
    const key = "O'Reilly's key"
    generateRecoveryKeyPDF(key)
    const html = downloadFileMock.mock.calls[0][1] as string
    const inner = keyValueInner(html)
    expect(inner).toBe(esc(key))
    // 裸单引号不应出现在 key-value 区（应被转成 &#39;）
    expect(inner).not.toContain("'")
    // 转义后形态含 &#39;（单引号实体）
    expect(inner).toContain('&#39;')
  })

  it('XSS 防护：含 & < > " 四类字符各自转成 HTML 实体（防 HTML 实体注入歧义）', () => {
    const key = 'a&b<c>"x'
    generateRecoveryKeyPDF(key)
    const html = downloadFileMock.mock.calls[0][1] as string
    expect(keyValueInner(html)).toBe(esc(key))
  })

  it('XSS 防护：多种混合特殊字符 key，HTML 内 === esc(key)', () => {
    const key = `<img src=x onerror="alert('xss')"> & "quotes" 'apos' > <br/>`
    generateRecoveryKeyPDF(key)
    const html = downloadFileMock.mock.calls[0][1] as string
    expect(keyValueInner(html)).toBe(esc(key))
  })

  it('结构不变：HTML 含 <title>、key-box、warning 必要块', () => {
    generateRecoveryKeyPDF('STRUCT-CHECK')
    const html = downloadFileMock.mock.calls[0][1] as string
    expect(html).toContain('<title>与链 Recovery Key</title>')
    expect(html).toContain('class="key-box"')
    expect(html).toContain('class="key-value"')
    expect(html).toContain('class="warning"')
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('结构不变：含 @media print 规则与 footer 生成时间占位', () => {
    generateRecoveryKeyPDF('K')
    const html = downloadFileMock.mock.calls[0][1] as string
    expect(html).toContain('@media print')
    // footer 区有生成时间：非空且含中横线时间分隔
    expect(html).toMatch(/生成时间：[^<]+与链 E2E Recovery Key/)
  })

  it('空 key 边界：不抛，key-value 区为空串（向后兼容，不强行拒空）', () => {
    expect(() => generateRecoveryKeyPDF('')).not.toThrow()
    const html = downloadFileMock.mock.calls[0][1] as string
    expect(keyValueInner(html)).toBe('')
  })
})
