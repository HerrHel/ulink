/**
 * master-password.ts — 主密码 + WebAuthn 生物识别
 * 提供 vault 级别的密码保护和生物识别解锁能力。
 *
 * 流程：
 * 1. 用户首次设置主密码 → PBKDF2 派生密钥 → 存储盐值和验证哈希到 localStorage
 * 2. 后续打开页面 → 检查是否已设置主密码 → 弹出验证模态框
 * 3. 用户可注册 WebAuthn 凭据 → 后续可用指纹/面部识别替代密码输入
 */

const STORAGE_KEY = 'lv_masterPw'
const CREDENTIAL_ID_KEY = 'lv_webauthn_cred'

interface StoredPw {
  salt: string
  hash: string
  iter: number
}

function _bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function _hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  return bytes
}

async function _deriveKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function _hashForVerify(password: string, salt: Uint8Array, iter: number): Promise<string> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, keyMaterial, 256)
  return _bufToHex(bits)
}

/**
 * 是否已设置主密码
 */
export function hasMasterPassword(): boolean {
  return !!localStorage.getItem(STORAGE_KEY)
}

/**
 * 设置主密码
 */
export async function setMasterPassword(password: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iter = 100000
  const hash = await _hashForVerify(password, salt, iter)
  const stored: StoredPw = { salt: _bufToHex(salt.buffer as ArrayBuffer), hash, iter }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
}

/**
 * 验证主密码
 */
export async function verifyMasterPassword(password: string): Promise<boolean> {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return true
  const stored: StoredPw = JSON.parse(raw)
  const salt = _hexToBuf(stored.salt)
  const hash = await _hashForVerify(password, salt, stored.iter)
  return hash === stored.hash
}

/**
 * 移除主密码保护
 */
export function removeMasterPassword(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(CREDENTIAL_ID_KEY)
}

// ── WebAuthn 生物识别 ──

function _b64enc(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

function _b64dec(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

/**
 * 是否已注册 WebAuthn 凭据
 */
export function hasWebAuthnCredential(): boolean {
  return !!localStorage.getItem(CREDENTIAL_ID_KEY)
}

/**
 * 是否支持 WebAuthn
 */
export function isWebAuthnAvailable(): boolean {
  return !!(window.PublicKeyCredential && navigator.credentials)
}

/**
 * 注册 WebAuthn 凭据（绑定生物识别）
 * 在用户已验证主密码后调用
 */
export async function registerWebAuthn(): Promise<boolean> {
  if (!isWebAuthnAvailable()) return false
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const userId = crypto.getRandomValues(new Uint8Array(16))
    const createOptions: CredentialCreationOptions = {
      publicKey: {
        challenge,
        rp: { name: 'LinkVault', id: location.hostname },
        user: { id: userId, name: 'linkvault-user', displayName: 'LinkVault User' },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        timeout: 60000,
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        attestation: 'none',
      },
    }
    const cred = await navigator.credentials.create(createOptions) as PublicKeyCredential | null
    if (!cred) return false
    localStorage.setItem(CREDENTIAL_ID_KEY, _b64enc(cred.rawId))
    return true
  } catch (e) {
    console.warn('[WebAuthn] register failed:', e)
    return false
  }
}

/**
 * 使用 WebAuthn 验证（生物识别解锁）
 * 返回 true 表示验证通过
 */
export async function authenticateWebAuthn(): Promise<boolean> {
  if (!isWebAuthnAvailable() || !hasWebAuthnCredential()) return false
  try {
    const credId = localStorage.getItem(CREDENTIAL_ID_KEY)!
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const getOptions: CredentialRequestOptions = {
      publicKey: {
        challenge,
        allowCredentials: [{ id: _b64dec(credId), type: 'public-key', transports: ['internal'] }],
        timeout: 60000,
        userVerification: 'required',
      },
    }
    const assertion = await navigator.credentials.get(getOptions)
    return !!assertion
  } catch (e) {
    console.warn('[WebAuthn] auth failed:', e)
    return false
  }
}
