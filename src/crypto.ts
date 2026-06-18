import type { EncryptedPassword } from './types.js'

export function safeAtob(s: string): string { try { return atob(s) } catch (_) { return s } }

export async function deriveKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(masterPassword), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptPassword(password: string, masterPassword: string): Promise<EncryptedPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(masterPassword, salt)
  const encoded = new TextEncoder().encode(password)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)
  return {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted)),
    salt: Array.from(salt),
    encrypted: true
  }
}

export async function decryptPassword(stored: EncryptedPassword | string, masterPassword: string): Promise<string> {
  if (!stored || (typeof stored === 'object' && !(stored as EncryptedPassword).encrypted)) return stored ? safeAtob(stored as string) : ''
  const enc = stored as EncryptedPassword
  const salt = new Uint8Array(enc.salt)
  const iv = new Uint8Array(enc.iv)
  const key = await deriveKey(masterPassword, salt)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, key, new Uint8Array(enc.data)
  )
  return new TextDecoder().decode(decrypted)
}

export function detectPasswordFormat(password: string | EncryptedPassword): 'empty' | 'encrypted' | 'base64' | 'plaintext' {
  if (!password) return 'empty'
  if (typeof password === 'object' && (password as EncryptedPassword).encrypted) return 'encrypted'
  if (typeof password === 'string') {
    try { atob(password); return 'base64' } catch (_) { return 'plaintext' }
  }
  return 'plaintext'
}

export async function autoMigratePassword(storedPassword: string | EncryptedPassword, masterPassword: string): Promise<string> {
  if (!storedPassword) return ''
  const fmt = detectPasswordFormat(storedPassword)
  if (fmt === 'encrypted') return decryptPassword(storedPassword as EncryptedPassword, masterPassword)
  if (fmt === 'base64') return safeAtob(storedPassword as string)
  return storedPassword as string
}

export async function safeDecodePassword(storedPassword: string | EncryptedPassword, masterPassword: string): Promise<string> {
  try { return await autoMigratePassword(storedPassword, masterPassword) } catch { return '' }
}