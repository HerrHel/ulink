/**
 * crypto.js — LinkVault 扩展密码解密（Web Crypto API）
 *
 * 复用 PWA 主站 (src/crypto.ts) 的加密格式：
 *   PBKDF2 (600K) → AES-256-GCM
 *
 * 支持的存储格式：
 *   1. EncryptedPassword 对象 { encrypted: true, data, iv, salt }
 *   2. base64 字符串（旧版兼容）
 *   3. 空 → 返回 ''
 */
(function () {
  'use strict'

  const PBKDF2_ITERATIONS = 600000
  const SALT_LENGTH = 32
  const IV_LENGTH = 12

  function _toBuffer(str) {
    return new TextEncoder().encode(str)
  }

  function _fromBuffer(buf) {
    return new TextDecoder().decode(buf)
  }

  function _bufToBase64(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
    var binary = ''
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  function _base64ToBuf(b64) {
    var binary = atob(b64)
    var bytes = new Uint8Array(binary.length)
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  /** 派生密钥 */
  async function deriveKey(masterPassword, salt) {
    var keyMaterial = await crypto.subtle.importKey('raw', _toBuffer(masterPassword), 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    )
  }

  /** AES-256-GCM 解密，输入格式 base64(salt).base64(iv).base64(data) */
  async function decrypt(ciphertext, key) {
    var parts = ciphertext.split('.')
    if (parts.length !== 3) return ciphertext
    var iv = _base64ToBuf(parts[1])
    var data = _base64ToBuf(parts[2])
    var decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    )
    return _fromBuffer(decrypted)
  }

  /**
   * 自动识别格式并解密密码
   * @param {string|Object|null} stored - 存储的密码值
   * @param {string} masterPassword - 主密码（E2E 解密时必需）
   * @returns {Promise<string>} 明文密码
   */
  async function autoDecryptPassword(stored, masterPassword) {
    if (!stored) return ''
    // EncryptedPassword 对象 { encrypted: true, data, iv, salt }
    if (typeof stored === 'object' && stored.encrypted === true) {
      if (!masterPassword) throw new Error('需要主密码才能解密')
      var ciphertext = stored.salt + '.' + stored.iv + '.' + stored.data
      var salt = _base64ToBuf(stored.salt)
      var key = await deriveKey(masterPassword, salt)
      return decrypt(ciphertext, key)
    }
    // base64 编码的旧格式
    if (typeof stored === 'string') {
      try { return atob(stored) } catch (e) { return stored }
    }
    return ''
  }

  /** base64 编码（保存时用） */
  function encodeToBase64(plaintext) {
    return btoa(plaintext)
  }

  window.LinkVaultCrypto = {
    autoDecryptPassword: autoDecryptPassword,
    encodeToBase64: encodeToBase64,
  }
})()
