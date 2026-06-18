import { describe, it, expect } from 'vitest'
import { encryptPassword, decryptPassword, detectPasswordFormat, autoMigratePassword } from '../crypto.js'

describe('Password Encryption (Phase 4)', () => {
  const masterPwd = 'test-master-password-123'

  describe('detectPasswordFormat', () => {
    it('should detect empty', () => {
      expect(detectPasswordFormat(null as any)).toBe('empty')
      expect(detectPasswordFormat('')).toBe('empty')
    })

    it('should detect base64', () => {
      expect(detectPasswordFormat(btoa('hello'))).toBe('base64')
    })

    it('should detect plaintext', () => {
      expect(detectPasswordFormat('not-base64!@#$%')).toBe('plaintext')
    })

    it('should detect encrypted', () => {
      expect(detectPasswordFormat({ encrypted: true, iv: [], data: [], salt: [] })).toBe('encrypted')
    })
  })

  describe('encrypt/decrypt round-trip', () => {
    it('should encrypt and decrypt password correctly', async () => {
      const original = 'mySecretPassword123!'
      const encrypted = await encryptPassword(original, masterPwd)
      expect(encrypted.encrypted).toBe(true)
      expect(encrypted.iv).toBeDefined()
      expect(encrypted.data).toBeDefined()
      expect(encrypted.salt).toBeDefined()

      const decrypted = await decryptPassword(encrypted, masterPwd)
      expect(decrypted).toBe(original)
    })

    it('should fail to decrypt with wrong master password', async () => {
      const original = 'secret'
      const encrypted = await encryptPassword(original, masterPwd)
      await expect(decryptPassword(encrypted, 'wrong-password')).rejects.toThrow()
    })

    it('should produce different ciphertext for same input (random IV/salt)', async () => {
      const enc1 = await encryptPassword('test', masterPwd)
      const enc2 = await encryptPassword('test', masterPwd)
      expect(enc1.iv).not.toEqual(enc2.iv)
      expect(enc1.salt).not.toEqual(enc2.salt)
    })
  })

  describe('autoMigratePassword', () => {
    it('should handle empty password', async () => {
      expect(await autoMigratePassword(null as any, masterPwd)).toBe('')
      expect(await autoMigratePassword('', masterPwd)).toBe('')
    })

    it('should decrypt base64 password', async () => {
      const encoded = btoa('hello')
      expect(await autoMigratePassword(encoded, masterPwd)).toBe('hello')
    })

    it('should handle plaintext', async () => {
      expect(await autoMigratePassword('plaintext', masterPwd)).toBe('plaintext')
    })

    it('should decrypt encrypted format', async () => {
      const encrypted = await encryptPassword('encrypted!', masterPwd)
      expect(await autoMigratePassword(encrypted, masterPwd)).toBe('encrypted!')
    })
  })
})
