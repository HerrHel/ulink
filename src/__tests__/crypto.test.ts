import { describe, it, expect } from 'vitest'
import { safeAtob, safeDecodePassword } from '../crypto.js'

describe('Password Decoding', () => {
  describe('safeAtob', () => {
    it('should decode base64', () => {
      expect(safeAtob(btoa('hello'))).toBe('hello')
    })

    it('should return original string on invalid base64', () => {
      expect(safeAtob('not-base64!@#$%')).toBe('not-base64!@#$%')
    })

    it('should handle empty string', () => {
      expect(safeAtob('')).toBe('')
    })
  })

  describe('safeDecodePassword', () => {
    it('should decode base64 password', () => {
      expect(safeDecodePassword(btoa('secret123'))).toBe('secret123')
    })

    it('should return plaintext if not base64', () => {
      expect(safeDecodePassword('plaintext')).toBe('plaintext')
    })

    it('should return empty string for empty input', () => {
      expect(safeDecodePassword('')).toBe('')
    })

    it('should decode MTIz to 123', () => {
      expect(safeDecodePassword('MTIz')).toBe('123')
    })
  })
})
