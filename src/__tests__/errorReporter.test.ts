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

  it('allows normal error messages', () => {
    expect(looksLikeSecret('Cannot read properties of undefined')).toBe(false)
    expect(looksLikeSecret('NetworkError when attempting to fetch resource')).toBe(false)
  })
})
