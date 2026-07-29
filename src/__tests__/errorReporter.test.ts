import { describe, it, expect } from 'vitest'
import { sanitizeReportUrl, looksLikeSecret } from '../lib/errorReporter.js'

describe('sanitizeReportUrl (H8)', () => {
  it('strips query and hash from absolute URL', () => {
    expect(sanitizeReportUrl('https://app.example.com/path?ext_save_url=https%3A%2F%2Fsecret.com&title=x#frag'))
      .toBe('https://app.example.com/path')
  })

  it('strips query from relative path', () => {
    expect(sanitizeReportUrl('/index.html?url=https://secret&notes=pw')).toBe('/index.html')
  })

  it('empty stays empty', () => {
    expect(sanitizeReportUrl('')).toBe('')
  })

  it('no query stays same', () => {
    expect(sanitizeReportUrl('https://app.example.com/path')).toBe('https://app.example.com/path')
  })
})

describe('looksLikeSecret (H9)', () => {
  it('detects JWT-like tokens', () => {
    expect(looksLikeSecret('err eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc')).toBe(true)
  })

  it('detects Bearer tokens', () => {
    expect(looksLikeSecret('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345')).toBe(true)
  })

  it('detects password assignments', () => {
    expect(looksLikeSecret('password=supersecret123')).toBe(true)
  })

  it('detects sk- API keys (≥20 位字母数字)', () => {
    expect(looksLikeSecret('err Authorization sk-abcdef0123456789ghij')).toBe(true)
  })

  it('sk- 后不足 20 位字母数字不命中（宽度边界）', () => {
    expect(looksLikeSecret('sk-abcdef0123456789')).toBe(false)
  })

  it('detects apikey 赋值（冒号/等号两种分隔）', () => {
    expect(looksLikeSecret('config apikey: sk_abc123defghijk')).toBe(true)
    expect(looksLikeSecret('config apikey=sk_abc123defghijk')).toBe(true)
  })

  it('falsy 短路：空串/0/false/null 入参恒 false 不抛', () => {
    expect(looksLikeSecret('')).toBe(false)
    // @ts-expect-error 故意传非 string 验证短路
    expect(looksLikeSecret(null)).toBe(false)
    // @ts-expect-error 故意传非 string 验证短路
    expect(looksLikeSecret(undefined)).toBe(false)
  })

  it('password/apikey 子串边界：单词含 password 但无赋值不误命中', () => {
    // password 后仅有空白、无 [:=] 不满足 password\s*[:=] 分支
    expect(looksLikeSecret('the password field is required')).toBe(false)
  })

  it('allows normal error messages', () => {
    expect(looksLikeSecret('Cannot read properties of undefined')).toBe(false)
    expect(looksLikeSecret('NetworkError when attempting to fetch resource')).toBe(false)
  })
})
