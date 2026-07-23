/**
 * useBiometric.ts — WebAuthn PRF 指纹解锁
 *
 * 用平台认证器（Android 指纹 / Windows Hello / Touch ID）安全托管主密码：
 * - 设置时：PRF 输出经 HKDF 派生 AES-256-GCM key，加密主密码后存 localStorage
 * - 解锁时：弹指纹 → PRF 输出 → HKDF → AES key → 解密主密码 → 走现有 e2e.unlock()
 *
 * PRF 凭据设备绑定、不可提取，JS 层拿不到。仅支持 Chrome/Edge 116+。
 */

import { encrypt, decrypt } from '../../crypto.js'
import { safeGetItem, safeSetItem, safeRemoveItem } from '../../lib/storageSafe.js'

const BIO_KEY = 'lv_e2e_biometric'
const HKDF_SALT_RAW = 'lv-biometric-hkdf-v1'
const HKDF_INFO_RAW = 'lv-biometric-aes-key'

function _bufToBase64(buf: Uint8Array): string {
  let binary = ''
  for (const b of buf) binary += String.fromCharCode(b)
  return btoa(binary)
}

function _base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function _bufToBase64Url(buf: Uint8Array): string {
  return _bufToBase64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function _base64UrlToBuf(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  return _base64ToBuf(b64)
}

function _toBuffer(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function _bs(u: Uint8Array): ArrayBuffer {
  return new Uint8Array(u) as unknown as ArrayBuffer
}

interface BiometricData {
  credentialId: string
  prfSalt: string
  encrypted: string
}

function _readStored(): BiometricData | null {
  const raw = safeGetItem(BIO_KEY)
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj.credentialId === 'string' && typeof obj.prfSalt === 'string' && typeof obj.encrypted === 'string') {
      return obj as BiometricData
    }
    return null
  } catch {
    return null
  }
}

/** HKDF-SHA256 从 PRF 输出派生 AES-256-GCM CryptoKey（不可提取） */
async function _deriveAesFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey(
    'raw', prfOutput, 'HKDF', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: _bs(_toBuffer(HKDF_SALT_RAW)), info: _bs(_toBuffer(HKDF_INFO_RAW)) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export function useBiometric() {
  /** 浏览器是否支持 WebAuthn PRF */
  function isBiometricAvailable(): boolean {
    if (typeof window === 'undefined') return false
    if (!window.PublicKeyCredential) return false
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return false
    return true
  }

  /** 是否已录入指纹凭据 */
  function isBiometricEnrolled(): boolean {
    return _readStored() !== null
  }

  /** 录入指纹凭据：PRF 加密主密码并存 localStorage */
  async function enrollBiometric(masterPassword: string): Promise<boolean> {
    if (!isBiometricAvailable()) return false

    const prfSalt = crypto.getRandomValues(new Uint8Array(32))
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const userId = crypto.getRandomValues(new Uint8Array(16))

    let credential: PublicKeyCredential
    try {
      credential = (await navigator.credentials.create({
        publicKey: {
          challenge: _bs(challenge),
          rp: { name: 'LinkVault' },
          user: { id: _bs(userId), name: 'lv-e2e-biometric', displayName: 'LinkVault E2E Unlock' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: {
            userVerification: 'required',
            residentKey: 'preferred',
            authenticatorAttachment: 'platform',
          },
          extensions: {
            prf: { eval: { first: _bs(prfSalt) } },
          } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential
    } catch {
      return false
    }

    const extResults = credential.getClientExtensionResults() as Record<string, unknown>
    const prfResult = extResults?.prf as { enabled?: boolean; results?: { first: ArrayBuffer } } | undefined
    if (!prfResult?.enabled || !prfResult?.results?.first) {
      return false
    }

    const credentialId = _bufToBase64Url(new Uint8Array(credential.rawId))
    const aesKey = await _deriveAesFromPrf(prfResult.results.first)
    const encrypted = await encrypt(masterPassword, aesKey)

    safeSetItem(BIO_KEY, JSON.stringify({
      credentialId,
      prfSalt: _bufToBase64(prfSalt),
      encrypted,
    } satisfies BiometricData))

    return true
  }

  /** 弹指纹解锁，返回主密码或 null */
  async function unlockWithBiometric(): Promise<string | null> {
    const stored = _readStored()
    if (!stored) return null

    const prfSalt = _base64ToBuf(stored.prfSalt)
    const credentialId = _base64UrlToBuf(stored.credentialId)
    const challenge = crypto.getRandomValues(new Uint8Array(32))

    let assertion: PublicKeyCredential
    try {
      assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: _bs(challenge),
          allowCredentials: [{ type: 'public-key', id: _bs(credentialId) }],
          userVerification: 'required',
          extensions: {
            prf: { eval: { first: _bs(prfSalt) } },
          } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential
    } catch {
      return null
    }

    const extResults = assertion.getClientExtensionResults() as Record<string, unknown>
    const prfResult = extResults?.prf as { results?: { first: ArrayBuffer } } | undefined
    if (!prfResult?.results?.first) return null

    const aesKey = await _deriveAesFromPrf(prfResult.results.first)
    const masterPw = await decrypt(stored.encrypted, aesKey)

    // decrypt 对解不开的输入返回原密文串，此时应判为失败
    if (masterPw === stored.encrypted) return null

    return masterPw
  }

  /** 删除已录入的指纹凭据 */
  async function removeBiometric(): Promise<void> {
    safeRemoveItem(BIO_KEY)
  }

  return { isBiometricAvailable, isBiometricEnrolled, enrollBiometric, unlockWithBiometric, removeBiometric }
}
