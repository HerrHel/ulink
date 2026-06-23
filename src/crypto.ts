/**
 * crypto.ts — 密码工具 + E2E 加密（AES-256-GCM）
 *
 * 旧功能：base64 编码/解码（safeAtob/safeDecodePassword）
 * P2 新增：PBKDF2 密钥派生 + AES-256-GCM 加密/解密
 */
export function safeAtob(s: string): string { try { return atob(s) } catch (_) { return s } }

export function safeDecodePassword(storedPassword: string): string {
  if (!storedPassword) return ''
  try { return atob(storedPassword) } catch (_) { return storedPassword }
}

// ══════════════════════════════════════════════════
// E2E 加密（P2）
// ══════════════════════════════════════════════════

const PBKDF2_ITERATIONS = 600000
const SALT_LENGTH = 32
const IV_LENGTH = 12

function _toBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer
}

function _fromBuffer(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf)
}

function _bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function _base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/** PBKDF2 从主密码派生 AES-256 密钥 */
export async function deriveKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', _toBuffer(masterPassword), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** AES-256-GCM 加密，返回 base64 编码的 salt:iv:ciphertext */
export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    _toBuffer(plaintext),
  )
  // 格式: base64(salt) + "." + base64(iv) + "." + base64(ciphertext)
  return _bufToBase64(salt.buffer) + '.' + _bufToBase64(iv.buffer) + '.' + _bufToBase64(encrypted)
}

/** AES-256-GCM 解密 */
export async function decrypt(ciphertext: string, key: CryptoKey): Promise<string> {
  const parts = ciphertext.split('.')
  if (parts.length !== 3) return ciphertext // 非加密数据，直接返回
  try {
    const _salt = new Uint8Array(_base64ToBuf(parts[0])) // 解析但不使用，保留格式兼容
    const iv = new Uint8Array(_base64ToBuf(parts[1]))
    const data = _base64ToBuf(parts[2])
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      data,
    )
    return _fromBuffer(decrypted)
  } catch (_) {
    return ciphertext // 解密失败，返回原值
  }
}

/** 生成 canary 明文（用于验证主密码是否正确） */
export async function generateCanary(key: CryptoKey): Promise<string> {
  return encrypt('linkvault-canary-v1', key)
}

/** 验证 canary */
export async function verifyCanary(encrypted: string, key: CryptoKey): Promise<boolean> {
  const result = await decrypt(encrypted, key)
  return result === 'linkvault-canary-v1'
}
