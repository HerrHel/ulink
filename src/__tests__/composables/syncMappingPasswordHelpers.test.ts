/**
 * syncMappingPasswordHelpers.test.ts — useSyncMapping 密码序列化/解析内层护栏
 *
 * 锁定两个被 toRemoteRow/fromRemote* 编排间接覆盖、但自身分支决策此前零直接
 * 单测的内层私有纯决策函数：
 * - _parseRemotePassword：远端 password 字段 → 本地 string|EncryptedPassword。
 *   6 分支：falsy 空 / 非 string → 空、JSON 历史损坏(encrypted:true + 三段齐全)
 *   → 还原对象、三段加密串(isThreePartCipher) → 还原对象、合法 JSON 非加密
 *   格式 → 落三段判断非三段透传 string、非法 JSON 串 starts/ends `{}` 但
 *   JSON.parse 抛 → catch 落三段透传、旧版 base64/纯文本 → 透传 string。
 * - _serializePassword：本地 password 字段 → 远端可存 string。5 分支：falsy 空、
 *   string 透传、EncryptedPassword 三段齐全重组 "salt.iv.data"、encrypted:true
 *   但缺字段 → 空、非 encrypted 对象 → 空。
 *
 * 两函数是账号密码跨端映射读写路径的核心承载逻辑——分支漂移会致密码永久损坏
 * （源码注释 line 52-60 明示：旧版 JSON.stringify 把 EncryptedPassword 降级成
 * JSON 文本、回程被当 string 存回本地再被 autoDecodePassword 当 base64 解码
 * 成乱码）。补独立单测锁契约，仅增 export 关键字零逻辑改动，与 D1-1 crypto
 * roundtrip / D1-8 parseTimestamp 同源「纯加测锁契约」口径。
 */
import { describe, it, expect } from 'vitest'
import {
  _parseRemotePassword,
  _serializePassword,
} from '../../composables/domain/useSyncMapping.js'
import type { EncryptedPassword } from '../../types.js'

// 三段加密串固定样本（与 crypto.ts encrypt() 输出格式 "salt.iv.data" 一致）。
// SALT/IV/DATA 必须精确等于 THREE_PART 按 "." 拆分的真实三段（护栏抓出首轮手写
// 常量字符数错位笔误——E 个数与段长对不上），故由 split() 派生保证字节精确。
const THREE_PART = 'AAAABBBBCCCCDDDDEEEEFFFF.FFFFEEEECCCCBBBBAAAA.999988887777666655554444'
const [SALT, IV, DATA] = THREE_PART.split('.')
const THREE_PART_OBJ: EncryptedPassword = { encrypted: true, salt: SALT, iv: IV, data: DATA }

describe('_parseRemotePassword — 远端 password → 本地 string|EncryptedPassword', () => {
  describe('falsy / 非 string 入参恒返空串', () => {
    it('空串 → 空串', () => {
      expect(_parseRemotePassword('')).toBe('')
    })
    it('null → 空串', () => {
      expect(_parseRemotePassword(null)).toBe('')
    })
    it('undefined → 空串', () => {
      expect(_parseRemotePassword(undefined)).toBe('')
    })
    it('number(0) → 空串（!raw 真值守卫先于 typeof 判定）', () => {
      expect(_parseRemotePassword(0)).toBe('')
    })
    it('number(非0) → 空串（!raw 之后 typeof!==string 守卫命中）', () => {
      expect(_parseRemotePassword(12345)).toBe('')
    })
    it('object → 空串（typeof 非 string）', () => {
      expect(_parseRemotePassword({ encrypted: true } as unknown)).toBe('')
    })
    it('array → 空串', () => {
      expect(_parseRemotePassword(['salt', 'iv', 'data'] as unknown)).toBe('')
    })
    it('boolean false → 空串', () => {
      expect(_parseRemotePassword(false as unknown)).toBe('')
    })
  })

  describe('三段加密串 → 还原 EncryptedPassword 对象', () => {
    it('三段齐全的加密串还原成带 encrypted:true 的对象', () => {
      const r = _parseRemotePassword(THREE_PART)
      expect(r).toEqual(THREE_PART_OBJ)
    })
    it('还原对象的四字段精确匹配（encrypted/salt/iv/data 不丢字符）', () => {
      const r = _parseRemotePassword(THREE_PART) as EncryptedPassword
      expect(r.encrypted).toBe(true)
      expect(r.salt).toBe(SALT)
      expect(r.iv).toBe(IV)
      expect(r.data).toBe(DATA)
    })
    it('空段三段串(中段空 a..b)不被识别为加密串(isThreePartCipher 拒空段) → 透传 string', () => {
      // isThreePartCipher: parts.length===3 && !!每个段；'a..b' split('.')=['a','','b']
      // length=3 但 parts[1]='' falsy → 不是三段加密串 → 走透传 string 分支
      expect(_parseRemotePassword('a..b')).toBe('a..b')
    })
    it('两段串 salt.iv(非三段)不被识别为加密串 → 透传 string', () => {
      expect(_parseRemotePassword('salt.iv')).toBe('salt.iv')
    })
  })

  describe('JSON 历史损坏数据(旧 JSON.stringify 产物) → 还原对象', () => {
    it('合法 JSON 且 encrypted:true + 三段齐全 → 还原 EncryptedPassword 对象', () => {
      const json = JSON.stringify(THREE_PART_OBJ)
      const r = _parseRemotePassword(json)
      expect(r).toEqual(THREE_PART_OBJ)
    })
    it('encrypted:true 但缺 salt 字段 → 不匹配 encrypted 分支 → 落三段判断(非三段) → 透传 string', () => {
      const json = JSON.stringify({ encrypted: true, iv: IV, data: DATA })
      expect(_parseRemotePassword(json)).toBe(json)
    })
    it('encrypted:true 但缺 iv 字段 → 同上透传 string', () => {
      const json = JSON.stringify({ encrypted: true, salt: SALT, data: DATA })
      expect(_parseRemotePassword(json)).toBe(json)
    })
    it('encrypted:true 但缺 data 字段 → 同上透传 string', () => {
      const json = JSON.stringify({ encrypted: true, salt: SALT, iv: IV })
      expect(_parseRemotePassword(json)).toBe(json)
    })
    it('encrypted:false 的对象 JSON → 不匹配 encrypted===true → 透传 string', () => {
      const json = JSON.stringify({ encrypted: false, salt: SALT, iv: IV, data: DATA })
      expect(_parseRemotePassword(json)).toBe(json)
    })
    it('无 encrypted 键的对象 JSON → 透传 string', () => {
      const json = JSON.stringify({ salt: SALT, iv: IV, data: DATA })
      expect(_parseRemotePassword(json)).toBe(json)
    })
  })

  describe('非法 JSON 串(starts/ends 匹配 `{}` 但 JSON.parse 抛) → catch 落三段透传', () => {
    it('前缀 `{` 后缀 `}` 但内容非法 JSON → catch 落三段判断非三段 → 透传 string', () => {
      // `{bad json}` startsWith('{') && endsWith('}') 但 JSON.parse 抛 SyntaxError
      // → catch 不 return → isThreePartCipher('{bad json}')=false（split('.') 段数≠3）
      // → 透传 string
      const bad = '{bad json}'
      expect(_parseRemotePassword(bad)).toBe(bad)
    })
    it('`{` 单字符 → JSON.parse 抛 + 非三段 → 透传 string', () => {
      expect(_parseRemotePassword('{')).toBe('{')
    })
  })

  describe('旧版 base64 / 纯文本 → 透传 string', () => {
    it('base64 串(无 `{}` 边界、无三段 `.`) → 透传 string', () => {
      const b64 = 'cGFzc3dvcmQxMjM='
      expect(_parseRemotePassword(b64)).toBe(b64)
    })
    it('纯文本 → 透传 string', () => {
      expect(_parseRemotePassword('plaintext')).toBe('plaintext')
    })
    it('含单点但非三段的纯文本 → 透传 string', () => {
      expect(_parseRemotePassword('hello.txt')).toBe('hello.txt')
    })
  })
})

describe('_serializePassword — 本地 password → 远端可存 string', () => {
  describe('falsy 入参恒返空串', () => {
    it('空串 → 空串', () => {
      expect(_serializePassword('')).toBe('')
    })
    it('null → 空串', () => {
      expect(_serializePassword(null)).toBe('')
    })
    it('undefined → 空串', () => {
      expect(_serializePassword(undefined)).toBe('')
    })
    it('number 0 → 空串', () => {
      expect(_serializePassword(0)).toBe('')
    })
    it('false → 空串', () => {
      expect(_serializePassword(false as unknown)).toBe('')
    })
  })

  describe('string 入参原样透传', () => {
    it('普通 string → 原样', () => {
      expect(_serializePassword('plaintext')).toBe('plaintext')
    })
    it('已是三段加密串 → 原样透传不重组', () => {
      expect(_serializePassword(THREE_PART)).toBe(THREE_PART)
    })
    it('base64 串 → 原样透传', () => {
      const b64 = 'cGFzc3dvcmQxMjM='
      expect(_serializePassword(b64)).toBe(b64)
    })
  })

  describe('EncryptedPassword 对象 → 重组三段串', () => {
    it('三段齐全的对象 → "salt.iv.data" 重组（与 encrypt() 输出格式一致）', () => {
      expect(_serializePassword(THREE_PART_OBJ)).toBe(THREE_PART)
    })
    it('重组顺序固定 salt.iv.data（非 iv.salt.data 等错序）', () => {
      const r = _serializePassword(THREE_PART_OBJ)
      const parts = r.split('.')
      expect(parts[0]).toBe(SALT)
      expect(parts[1]).toBe(IV)
      expect(parts[2]).toBe(DATA)
    })
    it('encrypted:true 但缺 salt → 空串（三段不齐不重组防半截密文）', () => {
      expect(_serializePassword({ encrypted: true, iv: IV, data: DATA } as unknown)).toBe('')
    })
    it('encrypted:true 但缺 iv → 空串', () => {
      expect(_serializePassword({ encrypted: true, salt: SALT, data: DATA } as unknown)).toBe('')
    })
    it('encrypted:true 但缺 data → 空串', () => {
      expect(_serializePassword({ encrypted: true, salt: SALT, iv: IV } as unknown)).toBe('')
    })
    it('encrypted:false 对象 → 空串（非 encrypted 不重组）', () => {
      expect(_serializePassword({ encrypted: false, salt: SALT, iv: IV, data: DATA } as unknown)).toBe('')
    })
    it('无 encrypted 键的普通对象 → 空串', () => {
      expect(_serializePassword({ salt: SALT, iv: IV, data: DATA } as unknown)).toBe('')
    })
    it('null 对象（已 falsy 早返空）→ 空串', () => {
      expect(_serializePassword(null)).toBe('')
    })
  })
})

describe('_serializePassword ↔ _parseRemotePassword 对称 roundtrip', () => {
  it('对象 → serialize → parse → 等价值对象（远端存取往返不丢字段）', () => {
    const s = _serializePassword(THREE_PART_OBJ)
    const r = _parseRemotePassword(s)
    expect(r).toEqual(THREE_PART_OBJ)
  })
  it('三段串 → parse → serialize → 等价值三段串', () => {
    const obj = _parseRemotePassword(THREE_PART) as EncryptedPassword
    const back = _serializePassword(obj)
    expect(back).toBe(THREE_PART)
  })
  it('纯文本 string → serialize 透传 → parse 透传 → 等价值 string', () => {
    const plain = 'plaintext123'
    expect(_parseRemotePassword(_serializePassword(plain))).toBe(plain)
  })
})
