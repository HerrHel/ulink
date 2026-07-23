/**
 * useBiometric.test.ts — WebAuthn PRF 指纹录入/解锁单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBiometric } from '../../composables/domain/useBiometric.js'

let bio: ReturnType<typeof useBiometric>

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  if (!navigator.credentials) {
    Object.defineProperty(navigator, 'credentials', {
      value: { create: vi.fn(), get: vi.fn() },
      writable: true,
      configurable: true,
    })
  }
  vi.restoreAllMocks()
  bio = useBiometric()
})

describe('useBiometric.isBiometricAvailable', () => {
  it('有 PublicKeyCredential 时返回 boolean 不抛错', () => {
    expect(typeof bio.isBiometricAvailable()).toBe('boolean')
  })

  it('无 PublicKeyCredential 时返回 false', () => {
    const orig = window.PublicKeyCredential
    ;(window as any).PublicKeyCredential = undefined
    expect(bio.isBiometricAvailable()).toBe(false)
    window.PublicKeyCredential = orig
  })
})

describe('useBiometric.isBiometricEnrolled', () => {
  it('localStorage 无数据时返回 false', () => {
    expect(bio.isBiometricEnrolled()).toBe(false)
  })

  it('localStorage 有合法数据时返回 true', () => {
    localStorage.setItem('lv_e2e_biometric', JSON.stringify({
      credentialId: 'test-cred',
      prfSalt: 'dGVzdA==',
      encrypted: 'dGVzdA==.dGVzdA==.dGVzdA==',
    }))
    expect(bio.isBiometricEnrolled()).toBe(true)
  })
})

describe('useBiometric.enrollBiometric → unlockWithBiometric 闭环', () => {
  // enrollBiometric 受 isBiometricAvailable() HTTPS/localhost 门禁，jsdom 无法可靠通过。
  // 绕过门禁直接测核心加解密路径：手动构造 localStorage 数据 → unlockWithBiometric。
  it('手动构造加密数据后 unlockWithBiometric 返回正确主密码', async () => {
    // 生成 AES key，模拟 PRF 输出经 HKDF 派生的 key
    const encKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    )
    const { encrypt } = await import('../../crypto.js')
    const masterPw = 'my-secret-password-123'
    const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', encKey))

    // HKDF 从 rawKey 派生 AES key（与 useBiometric._deriveAesFromPrf 一致）
    const hkdfKey = await crypto.subtle.importKey('raw', rawKey, 'HKDF', false, ['deriveKey'])
    const aesFromPrf = await crypto.subtle.deriveKey(
      {
        name: 'HKDF', hash: 'SHA-256',
        salt: new TextEncoder().encode('lv-biometric-hkdf-v1'),
        info: new TextEncoder().encode('lv-biometric-aes-key'),
      },
      hkdfKey,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    )
    const encrypted = await encrypt(masterPw, aesFromPrf)

    const credId = crypto.getRandomValues(new Uint8Array(32))
    const prfSalt = crypto.getRandomValues(new Uint8Array(32))
    localStorage.setItem('lv_e2e_biometric', JSON.stringify({
      credentialId: btoa(String.fromCharCode(...credId)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
      prfSalt: btoa(String.fromCharCode(...prfSalt)),
      encrypted,
    }))

    // mock credentials.get 返回 rawKey 作为 PRF 输出
    ;(navigator as any).credentials = {
      create: vi.fn(),
      get: vi.fn().mockResolvedValueOnce({
        id: 'fake',
        type: 'public-key',
        rawId: credId.buffer as ArrayBuffer,
        authenticatorAttachment: 'platform',
        response: {} as AuthenticatorAssertionResponse,
        getClientExtensionResults: () => ({ prf: { results: { first: rawKey.buffer as ArrayBuffer } } }),
      } as unknown as PublicKeyCredential),
    } as any

    const result = await bio.unlockWithBiometric()
    expect(result).toBe(masterPw)
  })

  // enrollBiometric 完整路径。非 localhost 时 isBiometricAvailable 返回 false 跳过。
  it('enrollBiometric 成功写入 localStorage', async () => {
    if (!bio.isBiometricAvailable()) return

    const prfOut = crypto.getRandomValues(new Uint8Array(32)).buffer
    const credId = crypto.getRandomValues(new Uint8Array(32))
    ;(navigator as any).credentials = {
      create: vi.fn().mockResolvedValueOnce({
        id: 'enroll-test',
        type: 'public-key',
        rawId: credId.buffer as ArrayBuffer,
        authenticatorAttachment: 'platform',
        response: {} as AuthenticatorAttestationResponse,
        getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: prfOut } } }),
      } as unknown as PublicKeyCredential),
      get: vi.fn(),
    } as any

    const ok = await bio.enrollBiometric('enroll-test-pw')
    expect(ok).toBe(true)
    expect(bio.isBiometricEnrolled()).toBe(true)
  })
})

describe('useBiometric.enrollBiometric 失败场景', () => {
  it('credentials.create 抛错时返回 false', async () => {
    vi.spyOn(navigator.credentials, 'create').mockRejectedValueOnce(new Error('NotAllowedError'))
    const ok = await bio.enrollBiometric('pw')
    expect(ok).toBe(false)
    expect(bio.isBiometricEnrolled()).toBe(false)
  })

  it('PRF 扩展未启用时返回 false', async () => {
    const credId = crypto.getRandomValues(new Uint8Array(32))
    vi.spyOn(navigator.credentials, 'create').mockResolvedValueOnce({
      id: 'no-prf',
      type: 'public-key',
      rawId: credId.buffer as ArrayBuffer,
      authenticatorAttachment: 'platform',
      response: {} as AuthenticatorAttestationResponse,
      getClientExtensionResults: () => ({ prf: { enabled: false } }),
    } as unknown as PublicKeyCredential)
    const ok = await bio.enrollBiometric('pw')
    expect(ok).toBe(false)
  })
})

describe('useBiometric.unlockWithBiometric 失败场景', () => {
  it('未录入时返回 null', async () => {
    const result = await bio.unlockWithBiometric()
    expect(result).toBeNull()
  })

  it('credentials.get 拒绝（用户取消）时返回 null', async () => {
    localStorage.setItem('lv_e2e_biometric', JSON.stringify({
      credentialId: 'dGVzdA',
      prfSalt: 'dGVzdA==',
      encrypted: 'dGVzdA==.dGVzdA==.dGVzdA==',
    }))
    vi.spyOn(navigator.credentials, 'get').mockRejectedValueOnce(new Error('NotAllowedError'))
    const result = await bio.unlockWithBiometric()
    expect(result).toBeNull()
  })
})

describe('useBiometric.removeBiometric', () => {
  it('删除后 isBiometricEnrolled 返回 false', async () => {
    localStorage.setItem('lv_e2e_biometric', JSON.stringify({
      credentialId: 'test',
      prfSalt: 'dGVzdA==',
      encrypted: 'dGVzdA==.dGVzdA==.dGVzdA==',
    }))
    await bio.removeBiometric()
    expect(bio.isBiometricEnrolled()).toBe(false)
  })
})
