/**
 * crypto.js — LinkVault 扩展密码解密（Web Crypto API）
 *
 * 复用 PWA 主站 (src/crypto.ts) 的加密格式：
 *   PBKDF2 (600K) → AES-256-GCM
 *
 * 支持的存储格式：
 *   1. EncryptedPassword 对象 { encrypted: true, data, iv, salt } — 走 decryptWithGlobalKey
 *      （重建主项目 global cryptoKey 复用 decryptPasswordWithKey 语义，见 useE2E 方向 E）
 *   2. base64 字符串（旧版兼容）— 走 autoDecryptPassword 的 string 分支
 *   3. 空 → 返回 ''
 */
(function () {
  'use strict'

  // 当前加密所用的 PBKDF2 迭代数。与主项目 PBKDF2_ITERATIONS 同口径（主项目 crypto.ts:23）。
  // AUDIT-R19：扩展端不再硬编码 600000 解密——解密 EncryptedPassword 时读 canaryData.it，
  // 无 it 字段的旧 canaryData 才回退 PBKDF2_DEFAULT_ITERATIONS（与主项目同口径，固化 600000
  // 不随本常量演进，兼容现网旧数据，见主项目 crypto.ts:37 注释）。
  const PBKDF2_ITERATIONS = 600000
  const PBKDF2_DEFAULT_ITERATIONS = 600000
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

  /** 派生密钥。iterations 可选——读 canaryData.it 或回退 PBKDF2_DEFAULT_ITERATIONS。 */
  async function deriveKey(masterPassword, salt, iterations) {
    var it = typeof iterations === 'number' ? iterations : PBKDF2_DEFAULT_ITERATIONS
    var keyMaterial = await crypto.subtle.importKey('raw', _toBuffer(masterPassword), 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: it, hash: 'SHA-256' },
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
   * 自动识别格式并解密密码（旧路径，base64 兼容）
   * @param {string|Object|null} stored - 存储的密码值
   * @param {string} masterPassword - 主密码（E2E 解密时必需，旧 base64 路径忽略）
   * @returns {Promise<string>} 明文密码
   */
  async function autoDecryptPassword(stored, masterPassword) {
    if (!stored) return ''
    // EncryptedPassword 对象 { encrypted: true, data, iv, salt } — 旧路径用 stored.salt 派生
    //（与主项目 saveBm 实际用 global cryptoKey 不一致，GCM 认证会失败——见 decryptWithGlobalKey
    // 的正确路径）。保留此对象分支仅为向后兼容，生产链路已改走 decryptWithGlobalKey。
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

  /**
   * AUDIT-R19+R44 方向 E：用主项目 global cryptoKey 重建路径解密 EncryptedPassword。
   *
   * 主项目 saveBm 用 unlock 时一次性派生的 global cryptoKey（deriveKey(主密码, canarySalt, it)）
   * 加密存为 {encrypted:true, salt(占位), iv, data}——salt 是 encrypt 内部随机占位盐、不参与解密，
   * decryptPasswordWithKey 解密只用 iv + data + global key。故扩展端需从 user_security.master_canary
   * 拿 canaryData（含 salt + it）重建同一把 global key，再用 iv+data 解，与主项目展示链路一致。
   *
   * 接收两种远端存储形态（与主项目 useSyncMapping._parseRemotePassword 同口径判别）：
   *   A) EncryptedPassword 对象 { encrypted: true, iv, data, salt(占位) }
   *      —— 主项目同步还原回对象后存的形态，或旧版 toRemoteRow 用 JSON.stringify 写入的损坏形态
   *      （sidepanel 单查 bookmarks.password 列碰到的 JSON 文本会先被 JSON.parse 还原为对象）。
   *   B) "salt.iv.data" 三段串 —— 当前 toRemoteRow._serializePassword 写入的正常远端形态，
   *      扩展端 select('password') 单查直接拿到此字符串。内部拆解为对象后走同一解密路径。
   * 非上述两种形态（旧 base64 string / 空等）直接返 ''，交调用方按旧路径处理。
   *
   * @param {Object|string|null} stored - EncryptedPassword 对象或三段串
   * @param {string} masterPassword - 用户输入主密码（瞬态，不驻留）
   * @param {Object} canaryData - 主项目 _saveCanaryData 存的结构 { salt: number[], it?: number, canary: string }
   * @returns {Promise<string>} 明文；非加密形态返 ''；解不开返 ''（不回吐密文，对齐主项目 decryptPasswordWithKey 语义）
   */
  // 2026-08-10：与主项目 crypto.isThreePartCipher 同步收紧——真密文三段必为合法 base64
  //（salt 32B→44 字符、iv 12B→16 字符、data≥17B→≥24 字符，btoa 输出恒 4 的倍数）。
  // 旧判定只查「三段点分隔」，无 scheme 三段域名（www.example.com）等普通三段文本会被误判为
  // 密文（主项目真实事故：卡片网址空白、编辑被「含加密字段请先解锁」误拦）。
  function _isThreePartCipher(s) {
    if (typeof s !== 'string' || !s) return false
    var parts = s.split('.')
    if (parts.length !== 3) return false
    var salt = parts[0], iv = parts[1], data = parts[2]
    if (!salt || !iv || !data) return false
    if (salt.length !== 44 || iv.length !== 16 || data.length < 24) return false
    var b64 = /^[A-Za-z0-9+/]+={0,2}$/
    return b64.test(salt) && b64.test(iv) && b64.test(data)
  }

  async function decryptWithGlobalKey(stored, masterPassword, canaryData) {
    if (!stored) return ''
    // 形态 B：三段串 → 拆解为对象
    if (typeof stored === 'string') {
      if (!_isThreePartCipher(stored)) return '' // 非加密形态，交调用方处理
      var segs = stored.split('.')
      stored = { encrypted: true, salt: segs[0], iv: segs[1], data: segs[2] }
    }
    if (typeof stored !== 'object' || stored.encrypted !== true) return ''
    if (!stored.iv || !stored.data) return ''
    if (!masterPassword) throw new Error('需要主密码才能解密')
    if (!canaryData || !canaryData.salt) throw new Error('缺少解锁数据 (canaryData)')
    try {
      var canarySalt = new Uint8Array(canaryData.salt)
      var it = typeof canaryData.it === 'number' ? canaryData.it : PBKDF2_DEFAULT_ITERATIONS
      var globalKey = await deriveKey(masterPassword, canarySalt, it)
      var iv = _base64ToBuf(stored.iv)
      var data = _base64ToBuf(stored.data)
      var decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        globalKey,
        data
      )
      return _fromBuffer(decrypted)
    } catch (e) {
      // GCM 认证失败 / base64 非法 / canaryData 不匹配 —— 一律返 ''，绝不回吐密文给 UI
      return ''
    }
  }

  /** base64 编码（保存时用） */
  function encodeToBase64(plaintext) {
    return btoa(plaintext)
  }

  window.LinkVaultCrypto = {
    autoDecryptPassword: autoDecryptPassword,
    decryptWithGlobalKey: decryptWithGlobalKey,
    encodeToBase64: encodeToBase64,
  }
})()
