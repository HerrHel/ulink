/**
 * syncMappingPasswordHelpers.test.ts — useSyncMapping 密码序列化/解析内层护栏（精简版）
 *
 * 锁定 _parseRemotePassword（远端 password → 本地 string|EncryptedPassword,6 分支）与
 * _serializePassword（本地 password → 远端可存 string,5 分支）两被编排间接覆盖的内层私有纯决策。
 * 分支漂移致密码永久损坏(源码注释 line 52-60:旧版 JSON.stringify 把 EncryptedPassword 降级成 JSON 文本、
 * 回程被当 string 存回本地再被 autoDecodePassword 当 base64 解码成乱码)。
 *
 * 原 42 例含真契约(三段还原/JSON 损坏还原/重组顺序固定/roundtrip)与对称镜像(falsy 8+5 走同一双守卫、
 * 缺字段 3+3 对称、非 encrypted 对称透传)。此精简版留 ~22 例守核心,falsy/缺字段/对称透传各留代表即可。
 *
 * 仅增 export 关键字零逻辑改动,与 D1-1 crypto roundtrip / D1-8 parseTimestamp 同源「纯加测锁契约」口径。
 */
import { describe, it, expect } from 'vitest'
import {
  _parseRemotePassword,
  _serializePassword,
} from '../../composables/domain/useSyncMapping.js'
import type { EncryptedPassword } from '../../types.js'

// 三段加密串固定样本（与 crypto.ts encrypt() 输出格式 "salt.iv.data" 一致）。
// SALT/IV/DATA 必须精确等于 THREE_PART 按 "." 拆分的真实三段（护栏抓出首轮手写常量字符数错位笔误）,故由 split() 派生保证字节精确。
// 2026-08-10：样本改为真密文段长（salt 32B→44、iv 12B→16、data≥17B→≥24 的合法 base64）——
// isThreePartCipher 已按段长收紧，旧样本（24/20/24）不再被识别为密文。
const THREE_PART = `${'A'.repeat(44)}.${'B'.repeat(16)}.${'C'.repeat(24)}`
const [SALT, IV, DATA] = THREE_PART.split('.')
const THREE_PART_OBJ: EncryptedPassword = { encrypted: true, salt: SALT, iv: IV, data: DATA }

describe('_parseRemotePassword — 远端 password → 本地 string|EncryptedPassword', () => {
  describe('falsy / 非 string 入参恒返空串（!raw 真值守卫 + typeof!==string 双守卫,各代表覆盖）', () => {
    it('null → 空串', () => {
      expect(_parseRemotePassword(null)).toBe('')
    })
    it('number(非0) → 空串（!raw 之后 typeof!==string 守卫命中）', () => {
      expect(_parseRemotePassword(12345)).toBe('')
    })
    it('object → 空串（typeof 非 string，涵盖 array/boolean 等非 string）', () => {
      expect(_parseRemotePassword({ encrypted: true } as unknown)).toBe('')
      expect(_parseRemotePassword(['salt', 'iv', 'data'] as unknown)).toBe('') // array 同走 typeof!==string
      expect(_parseRemotePassword(false as unknown)).toBe('') // boolean false !raw 真值守卫
    })
  })

  describe('三段加密串 → 还原 EncryptedPassword 对象', () => {
    it('三段齐全的加密串还原成四字段精确匹配的 encrypted:true 对象', () => {
      const r = _parseRemotePassword(THREE_PART)
      expect(r).toEqual(THREE_PART_OBJ) // toEqual 含四字段精确匹配 + encrypted:true
    })
    it('非三段串不被识别为加密串 → 透传 string（空段 a..b 与两段 salt.iv 同守 isThreePartCipher 拒空段/非三段）', () => {
      expect(_parseRemotePassword('a..b')).toBe('a..b') // 'a..b' split=['a','','b'] 中段空 → 非三段
      expect(_parseRemotePassword('salt.iv')).toBe('salt.iv') // 两段
    })
  })

  describe('JSON 历史损坏数据(旧 JSON.stringify 产物) → 还原对象', () => {
    it('合法 JSON 且 encrypted:true + 三段齐全 → 还原 EncryptedPassword 对象', () => {
      const json = JSON.stringify(THREE_PART_OBJ)
      expect(_parseRemotePassword(json)).toEqual(THREE_PART_OBJ)
    })
    it('encrypted:true 但缺任一字段(salt/iv/data) → 不匹配 encrypted 分支 → 落三段判断(非三段) → 透传 string', () => {
      // 缺 salt/iv/data 三缺其一走同一分支,以缺 salt 代表
      const json = JSON.stringify({ encrypted: true, iv: IV, data: DATA })
      expect(_parseRemotePassword(json)).toBe(json)
    })
    it('encrypted:false / 无 encrypted 键的对象 JSON → 不匹配 encrypted===true → 透传 string', () => {
      expect(_parseRemotePassword(JSON.stringify({ encrypted: false, salt: SALT, iv: IV, data: DATA }))).toBe(JSON.stringify({ encrypted: false, salt: SALT, iv: IV, data: DATA }))
      expect(_parseRemotePassword(JSON.stringify({ salt: SALT, iv: IV, data: DATA }))).toBe(JSON.stringify({ salt: SALT, iv: IV, data: DATA }))
    })
  })

  describe('非法 JSON 串(starts/ends 匹配 `{}` 但 JSON.parse 抛) → catch 落三段透传', () => {
    it('前缀 `{` 后缀 `}` 但内容非法 JSON / `{ 单字符 → catch 落三段判断非三段 → 透传 string', () => {
      expect(_parseRemotePassword('{bad json}')).toBe('{bad json}')
      expect(_parseRemotePassword('{')).toBe('{')
    })
  })

  describe('旧版 base64 / 纯文本 → 透传 string', () => {
    it('base64 / 纯文本 / 含单点非三段串 → 透传 string（无 `{}` 边界、无三段 `.`）', () => {
      const b64 = 'cGFzc3dvcmQxMjM='
      expect(_parseRemotePassword(b64)).toBe(b64)
      expect(_parseRemotePassword('plaintext')).toBe('plaintext')
      expect(_parseRemotePassword('hello.txt')).toBe('hello.txt') // 含单点但非三段
    })
  })
})

describe('_serializePassword — 本地 password → 远端可存 string', () => {
  describe('falsy 入参恒返空串（!raw 守卫,代表覆盖）', () => {
    it('null → 空串', () => {
      expect(_serializePassword(null)).toBe('')
    })
    it('number 0 → 空串（falsy 真值边界）', () => {
      expect(_serializePassword(0)).toBe('')
    })
  })

  describe('string 入参原样透传（普通/三段/base64 同透传不重组）', () => {
    it('普通 string 与 base64 → 原样', () => {
      expect(_serializePassword('plaintext')).toBe('plaintext')
      const b64 = 'cGFzc3dvcmQxMjM='
      expect(_serializePassword(b64)).toBe(b64)
    })
    it('已是三段加密串 → 原样透传不重组', () => {
      expect(_serializePassword(THREE_PART)).toBe(THREE_PART)
    })
  })

  describe('EncryptedPassword 对象 → 重组三段串', () => {
    it('三段齐全 → "salt.iv.data" 重组（顺序固定 salt.iv.data 且与 encrypt() 输出格式一致）', () => {
      const r = _serializePassword(THREE_PART_OBJ)
      expect(r).toBe(THREE_PART)
      const parts = r.split('.')
      expect(parts[0]).toBe(SALT)
      expect(parts[1]).toBe(IV)
      expect(parts[2]).toBe(DATA)
    })
    it('encrypted:true 但缺任一字段(salt/iv/data) → 空串（三段不齐不重组防半截密文）', () => {
      // 缺 salt/iv/data 三缺其一同分支,以缺 salt 代表
      expect(_serializePassword({ encrypted: true, iv: IV, data: DATA } as unknown)).toBe('')
    })
    it('encrypted:false / 无 encrypted 键 / null 对象 → 空串（非 encrypted 不重组）', () => {
      expect(_serializePassword({ encrypted: false, salt: SALT, iv: IV, data: DATA } as unknown)).toBe('')
      expect(_serializePassword({ salt: SALT, iv: IV, data: DATA } as unknown)).toBe('')
      expect(_serializePassword(null)).toBe('') // null 对象已 falsy 早返空
    })
  })
})

describe('_serializePassword ↔ _parseRemotePassword 对称 roundtrip（不丢字段真契约）', () => {
  it('对象 → serialize → parse → 等价值对象（远端存取往返不丢字段）', () => {
    const s = _serializePassword(THREE_PART_OBJ)
    expect(_parseRemotePassword(s)).toEqual(THREE_PART_OBJ)
  })
  it('三段串 → parse → serialize → 等价值三段串', () => {
    const obj = _parseRemotePassword(THREE_PART) as EncryptedPassword
    expect(_serializePassword(obj)).toBe(THREE_PART)
  })
  it('纯文本 string → serialize 透传 → parse 透传 → 等价值 string', () => {
    const plain = 'plaintext123'
    expect(_parseRemotePassword(_serializePassword(plain))).toBe(plain)
  })
})
