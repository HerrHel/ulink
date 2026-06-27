import { describe, it, expect } from 'vitest'
import { safeAtob, safeDecodePassword, encrypt, decrypt, deriveKey, generateCanary, verifyCanary, encryptPassword, autoMigratePassword } from '../crypto.js'

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

describe('Password Migration', () => {
  it('should return empty for null/undefined', async () => {
    expect(await autoMigratePassword(null, '')).toBe('')
    expect(await autoMigratePassword(undefined, '')).toBe('')
  })

  it('should decode base64 string (legacy format)', async () => {
    expect(await autoMigratePassword(btoa('legacy-pw'), '')).toBe('legacy-pw')
  })

  it('should return empty for empty string', async () => {
    expect(await autoMigratePassword('', '')).toBe('')
  })

  it('should throw if EncryptedPassword but no masterPassword', async () => {
    const ep = { encrypted: true as const, data: 'x', iv: 'y', salt: 'z' }
    await expect(autoMigratePassword(ep, '')).rejects.toThrow('需要主密码')
  })
})

describe('E2E Encryption', () => {
  const MASTER_PW = 'test-master-password-123'

  describe('deriveKey', () => {
    it('should produce a CryptoKey from password and salt', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      expect(key).toBeInstanceOf(CryptoKey)
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    })

    it('should produce different keys for different passwords', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const keyA = await deriveKey('password-a', salt)
      const keyB = await deriveKey('password-b', salt)
      // 用同一个明文加密，密文不同说明密钥不同
      const cipherA = await encrypt('test', keyA)
      const cipherB = await encrypt('test', keyB)
      expect(cipherA).not.toBe(cipherB)
      // 各自能解密
      expect(await decrypt(cipherA, keyA)).toBe('test')
      expect(await decrypt(cipherB, keyB)).toBe('test')
    })
  })

  describe('encrypt/decrypt roundtrip', () => {
    it('should encrypt and decrypt a string', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      const original = 'sensitive-data-123'
      const encrypted = await encrypt(original, key)
      expect(encrypted).not.toBe(original)
      expect(encrypted.split('.')).toHaveLength(3)
      const decrypted = await decrypt(encrypted, key)
      expect(decrypted).toBe(original)
    })

    it('should produce different ciphertexts for same plaintext', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      const a = await encrypt('hello', key)
      const b = await encrypt('hello', key)
      expect(a).not.toBe(b)
    })

    it('should return original string for non-encrypted format', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      const result = await decrypt('not-encrypted', key)
      expect(result).toBe('not-encrypted')
    })
  })

  describe('generateCanary/verifyCanary', () => {
    it('should generate and verify a canary', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      const canary = await generateCanary(key)
      expect(canary).toBeTruthy()
      const ok = await verifyCanary(canary, key)
      expect(ok).toBe(true)
    })

    it('should reject canary with wrong key', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const keyA = await deriveKey(MASTER_PW, salt)
      const keyB = await deriveKey('wrong-password', crypto.getRandomValues(new Uint8Array(32)))
      const canary = await generateCanary(keyA)
      const ok = await verifyCanary(canary, keyB)
      expect(ok).toBe(false)
    })

    it('should reject tampered canary', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      const canary = await generateCanary(key)
      const parts = canary.split('.')
      parts[2] = 'X' + parts[2].slice(1) // 篡改 ciphertext
      const ok = await verifyCanary(parts.join('.'), key)
      expect(ok).toBe(false)
    })
  })

  describe('encryptPassword', () => {
    it('should produce EncryptedPassword object', async () => {
      const ep = await encryptPassword('my-plaintext-password', MASTER_PW)
      expect(ep.encrypted).toBe(true)
      expect(ep.data).toBeTruthy()
      expect(ep.iv).toBeTruthy()
      expect(ep.salt).toBeTruthy()
    })
  })
})
