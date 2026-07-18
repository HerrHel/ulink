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

/** L15：salt.iv.data 三段密文判定单一出口，避免 useSyncMapping/useE2E/decrypt 口径漂移 */
export function isThreePartCipher(s: string): boolean {
  if (typeof s !== 'string' || !s) return false
  const parts = s.split('.')
  return parts.length === 3 && !!parts[0] && !!parts[1] && !!parts[2]
}

function _toBuffer(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

/**
 * 把 Uint8Array 规整为 Web Crypto 可接受的 BufferSource。
 *
 * 两路约束冲突的折中：
 * - 运行时：Node 24 / CI 的 SubtleCrypto 拒绝由 TypedArray 派生的 ArrayBuffer
 *   （.buffer.slice 出来的 ArrayBuffer-instanceof 检测会失败），但接受
 *   TypedArray 本身。故运行时必须返回 Uint8Array。
 * - 类型层：TS 5.7+ 把 TypedArray 泛型化，`Uint8Array<ArrayBufferLike>`
 *   含 SharedArrayBuffer，不满足 `BufferSource<ArrayBuffer>`，TS 报错。
 *
 * 因此运行时 `new Uint8Array(u)` 拷贝一份（底层必为纯 ArrayBuffer），
 * 类型上断言为 ArrayBuffer 以满足 Web Crypto 的 BufferSource 约束。
 */
function _bs(u: Uint8Array): ArrayBuffer {
  return new Uint8Array(u) as unknown as ArrayBuffer
}

function _fromBuffer(buf: ArrayBuffer | Uint8Array): string {
  return new TextDecoder().decode(buf)
}

function _bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function _base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** PBKDF2 从主密码派生 AES-256 密钥 */
export async function deriveKey(masterPassword: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', _bs(_toBuffer(masterPassword)), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: _bs(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
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
    { name: 'AES-GCM', iv: _bs(iv) },
    key,
    _bs(_toBuffer(plaintext)),
  )
  // 格式: base64(salt) + "." + base64(iv) + "." + base64(ciphertext)
  const out = _bufToBase64(salt) + '.' + _bufToBase64(iv) + '.' + _bufToBase64(encrypted)
  // S6：防御性校验 —— base64 字母表不含 "."，输出必须恰好 3 段；若不是，说明基础假设被打破，
  // 立即抛错而非返回可被误解析的密文（saveBm 依赖此契约走 EncryptedPassword 切片）。
  if (!isThreePartCipher(out)) {
    throw new Error('加密输出格式异常：期望 salt.iv.data 三段')
  }
  return out
}

/** AES-256-GCM 解密 */
export async function decrypt(ciphertext: string, key: CryptoKey): Promise<string> {
  if (!isThreePartCipher(ciphertext)) return ciphertext // 非加密数据，直接返回
  const parts = ciphertext.split('.')
  // 优雅降级：若 ciphertext 长得像「3 段 . 分隔」但实际不是本系统产出的合法密文
  //（如 E2E 关闭时以明文存云端的 title＝'a.b.c'，或 base64 段非法、密钥不匹配），
  // base64 解码或 AES-GCM 认证会抛错。旧实现直接抛出，让单条坏字段污染整次
  // _pullChanges（其 try 会把整个 pull 判失败，所有远端变更丢失）或 Realtime merge。
  // 改为 catch 后返回原值——真密文（正确 key）必能解，失败只意味着非密文/解不开，
  // 返回原值不崩同步，与锁定态「不解密」行为一致，安全性不降（GCM 认证保证不会
  // 把非密文误解成有意义明文）。
  try {
    const _salt = new Uint8Array(_base64ToBuf(parts[0])) // 解析但不使用，保留格式兼容
    const iv = new Uint8Array(_base64ToBuf(parts[1]))
    const data = _base64ToBuf(parts[2])
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _bs(iv) },
      key,
      _bs(data),
    )
    return _fromBuffer(decrypted)
  } catch {
    return ciphertext
  }
}

/** 生成 canary 明文（用于验证主密码是否正确） */
export async function generateCanary(key: CryptoKey): Promise<string> {
  return encrypt('linkvault-canary-v1', key)
}

/**
 * 验证 canary：直接做 GCM 解密，靠 AES-GCM 认证标签判定真伪，而非「解出明文是否等于固定串」。
 *
 * 旧实现走 decrypt()，但 decrypt() 对 3 段但非法/被篡改的输入做了优雅降级——catch 后
 * 返回原输入串（见 decrypt 注释，单条坏字段不应污染整次 pull）。canary 验证若复用这条
 * 吞错路径，判定就退化为「返回串 !== 'linkvault-canary-v1'」即认为假，这本也能拦住篡改，
 * 但耦合了 decrypt 的降级行为：一旦某平台 SubtleCrypto 对特定篡改的 base64/GCM 走的
 * 分支不同（如 CI Linux Node 与本地 Windows jsdom 在 atob 容错、buffer 对齐上的差异），
 * 可能误把篡改辩过。canary 的语义是「密钥是否正确」，该用 GCM 认证本身回答——解密抛错即
 * 密钥不匹配，绝不依赖返回值串比较。故此处独立走一次 crypto.subtle.decrypt，不吞错。
 */
export async function verifyCanary(encrypted: string, key: CryptoKey): Promise<boolean> {
  try {
    if (!isThreePartCipher(encrypted)) return false
    const parts = encrypted.split('.')
    const iv = new Uint8Array(_base64ToBuf(parts[1]))
    const data = _base64ToBuf(parts[2])
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: _bs(iv) },
      key,
      _bs(data),
    )
    return _fromBuffer(decrypted) === 'linkvault-canary-v1'
  } catch (_) {
    // GCM 认证失败 / base64 非法 / 段数不对 —— 一律视为认证不通过
    return false
  }
}

// ══════════════════════════════════════════════════
// 密码加密/解密（兼容旧版 base64）
// ══════════════════════════════════════════════════

import type { EncryptedPassword } from './types.js'

/**
 * 使用主密码加密明文密码
 * 返回 EncryptedPassword 对象（AES-256-GCM）
 */
export async function encryptPassword(plaintext: string, masterPassword: string): Promise<EncryptedPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(masterPassword, salt)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: _bs(iv) },
    key,
    _bs(_toBuffer(plaintext)),
  )
  return {
    encrypted: true,
    data: _bufToBase64(encrypted),
    iv: _bufToBase64(iv),
    salt: _bufToBase64(salt),
  }
}

/**
 * 自动迁移/解密存储的密码
 * 支持三种格式：
 * 1. EncryptedPassword 对象（AES-256-GCM）→ 解密
 * 2. 普通 base64 字符串 → 解码（旧版兼容）
 * 3. 空字符串 → 返回空
 */
export async function autoMigratePassword(stored: string | EncryptedPassword | null | undefined, masterPassword: string): Promise<string> {
  if (!stored) return ''
  
  // 新格式：EncryptedPassword 对象
  if (typeof stored === 'object' && stored.encrypted === true) {
    if (!masterPassword) throw new Error('需要主密码')
    // 重组为 encrypt 函数使用的格式: base64(salt).base64(iv).base64(ciphertext)
    const ciphertext = stored.salt + '.' + stored.iv + '.' + stored.data
    const salt = new Uint8Array(_base64ToBuf(stored.salt))
    const key = await deriveKey(masterPassword, salt)
    return decrypt(ciphertext, key)
  }
  
  // 旧格式：base64 字符串
  if (typeof stored === 'string') {
    return safeDecodePassword(stored)
  }

  return ''
}

/**
 * 用已就绪的 E2E cryptoKey 解密 EncryptedPassword 对象为明文。
 *
 * 卡片/详情面板展示密码用：saveBm 在 E2E 解锁时用 e2eStore.cryptoKey（全局 E2E 密钥）
 * 加密密码 → 存为 EncryptedPassword 对象（见 useBookmark.saveBm）。展示时拿同一把
 * cryptoKey 解密即可，无需主密码重新派生（与加密侧一致）。
 *
 * 与 autoMigratePassword 对象分支的区别：后者用 deriveKey(masterPassword, salt) 重新派生
 * key——那是为「迁移旧数据」设计的独立路径，本函数面向「运行时已解锁、key 在内存」的展示场景。
 *
 * 非 EncryptedPassword 对象（如 string/null）直接返回原值，交由调用方分支处理。
 */
export async function decryptPasswordWithKey(
  stored: string | EncryptedPassword | null | undefined,
  cryptoKey: CryptoKey | null,
): Promise<string> {
  if (!stored) return ''
  if (typeof stored === 'object' && stored.encrypted === true) {
    if (!cryptoKey) return ''
    // 解不开即不显示，绝不把密文回吐 UI。
    //
    // 旧实现此处走 decrypt(ciphertext, cryptoKey)：decrypt 对「三段但 GCM 认证失败」
    // 的输入做了优雅降级——catch 后返回原 ciphertext 串（见 decrypt 注释，单条坏字段
    // 不该污染整次 pull，那是它服务于 ENCRYPT_FIELDS 通用字段的正确语义）。
    // 但 password 展示端复用这条降级路径会泄漏密文：本机主密码 A 解锁（key_A），某设备
    // 用主密码 B 改了密码并 push，Realtime 拉到用 key_B 加密的 EncryptedPassword 对象
    //（decryptItem 不解 password——它不在 ENCRYPT_FIELDS，见 useE2E 注释），BookmarkCard
    // 用 key_A 去解 → GCM 认证失败 → decrypt 回退返回完整 ciphertext=b64(salt).b64(iv).b64(data)
    // → decodedPw 被写成这串长密文 → 模板渲染出「长串无意义字符」（即用户报的小眼睛乱码）。
    //
    // password 的展示语义与 ENCRYPT_FIELDS 不同：后者服务于同步（同步管线要容单条坏字段，
    // 宁可保留原文回写也不让一条拖垮整批）；password 展示只关心「能否正确解出明文」，
    // 解不出就空——等价于锁定态的『不显示』，安全性不降（GCM 保证非本系统密文不会误解成
    // 有意义明文，故正确 key 永远能解、错 key 必返空，UI 绝不暴露密文形态）。此处独立走一次
    // crypto.subtle.decrypt 并 catch 返 ''，不复用 decrypt 的降级。base64 解析亦在 try 内——
    // 损坏盐/iv 的非法 base64 同样 catch 返空，不抛 InvalidCharacterError 污染展示。
    try {
      const iv = new Uint8Array(_base64ToBuf(stored.iv))
      const data = _base64ToBuf(stored.data)
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: _bs(iv) },
        cryptoKey,
        _bs(data),
      )
      return _fromBuffer(decrypted)
    } catch {
      return ''
    }
  }
  // A1-004：E2E 已启用且未解锁时，禁止把旧 base64/string 解码进 UI（锁定态应与对象密文一致为空）
  // 调用方应在 isE2EEnabled && !isUnlocked 时不传 cryptoKey 且期望 ''；此处 string 仅在「无 E2E 或已解锁」语义下由调用方保证。
  // 为双保险：cryptoKey 显式为 null 且 string 时仍 decode 是旧路径——由 BookmarkCard 在锁定时跳过调用。
  if (typeof stored === 'string') return safeDecodePassword(stored)
  return ''
}
