import { describe, it, expect } from 'vitest'
import { safeAtob, safeDecodePassword, encrypt, decrypt, deriveKey, generateCanary, verifyCanary, encryptPassword, autoMigratePassword, decryptPasswordWithKey } from '../crypto.js'

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

    it('3 段 . 分隔但非合法密文时优雅降级返回原值，不抛错（避免污染整次 pull）', async () => {
      // 场景：E2E 关闭时明文 url='a.b.c' 存云端，某次解锁态 pull 调 decrypt。
      // 旧实现 split('.') 得 3 段 → base64 解 'a' 抛 RangeError → decrypt 抛出 →
      // _pullChanges try 失败 → 整次 pull 判失败、所有远端变更丢失。修复后 decrypt
      // 内部 catch 返回原值，单条坏字段不再污染同步。
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      const fake = 'a.b.c'
      const result = await decrypt(fake, key)
      expect(result).toBe(fake)
      // 真密文(正确 key)仍正常解密
      const realCipher = await encrypt('real-secret', key)
      expect(await decrypt(realCipher, key)).toBe('real-secret')
    })

    it('3 段似密文但 wrong key 时优雅降级返回原值（不再抛错）', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const keyA = await deriveKey(MASTER_PW, salt)
      const keyB = await deriveKey('other-password', crypto.getRandomValues(new Uint8Array(32)))
      const cipherA = await encrypt('secret-A', keyA)
      // 用 keyB 解 keyA 加密的密文：AES-GCM 认证失败 → 旧实现抛错，新实现返回原密文
      const result = await decrypt(cipherA, keyB)
      expect(result).toBe(cipherA)
    })

    it('S6: encrypt output is always salt.iv.data with no empty segments', async () => {
      // encrypt 契约：saveBm 依赖 split 后严格 3 段且每段非空
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      const out = await encrypt('contract-test-payload', key)
      const parts = out.split('.')
      expect(parts).toHaveLength(3)
      parts.forEach((p) => expect(p.length).toBeGreaterThan(0))
      // 任一段都不应再含 "." —— 防止 saveBm 切片越界
      parts.forEach((p) => expect(p).not.toContain('.'))
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
      // 翻转 ciphertext 段首字符（base64 合法字符间互换，不改变长度/padding），
      // 既保证 base64 仍可解码（避免不同平台 atob 容错差异导致 flaky），
      // 又必触发 GCM 认证失败——认证标签覆盖整个密文，改一字节即 reject。
      const first = parts[2][0]
      parts[2] = (first === 'A' ? 'B' : 'A') + parts[2].slice(1)
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

  describe('decryptPasswordWithKey', () => {
    it('用加密侧的同一把 cryptoKey 解 EncryptedPassword 对象得回明文', async () => {
      // 复刻 saveBm 的加密路径：E2E 解锁态下用 e2eStore.cryptoKey（deriveKey 派生的全局 key）加密。
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const key = await deriveKey(MASTER_PW, salt)
      const raw = await encrypt('plaintext-pw-456', key)
      const parts = raw.split('.')
      const ep = { encrypted: true, salt: parts[0], iv: parts[1], data: parts[2] }
      // 用同一把 key 解密（卡片侧拿到的是 cryptoKey 本身，无主密码）
      const out = await decryptPasswordWithKey(ep, key)
      expect(out).toBe('plaintext-pw-456')
    })

    it('无 cryptoKey 时对象态返回空串而非乱抛（卡片未解锁场景）', async () => {
      const ep = { encrypted: true, salt: 'a', iv: 'b', data: 'c' }
      expect(await decryptPasswordWithKey(ep, null)).toBe('')
    })

    it('string 形态（旧 base64）走 safeDecodePassword', async () => {
      expect(await decryptPasswordWithKey(btoa('legacy-pw'), null)).toBe('legacy-pw')
      expect(await decryptPasswordWithKey('', null)).toBe('')
    })
  })
})
