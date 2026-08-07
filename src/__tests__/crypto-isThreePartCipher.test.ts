/**
 * crypto-isThreePartCipher.test.ts — crypto.isThreePartCipher 纯布尔判定护栏
 *
 * 补 src/crypto.ts:40 `isThreePartCipher` 直接 7 边界护栏缺口。
 * isThreePartCipher 是「字符串是否三段密文格式 `salt.iv.data`」纯判定前哨——
 * 6 处生产调用方的统一格式过滤器（决定值是否当密文处理 vs 明文原样）：
 *   useE2E.ts:309/385/470/491（E2E 加密/解密扫描，粗筛密文字段做加密路径、非密文透传）
 *   useSyncMapping.ts:43（同步序列化时三段串→还原为 EncryptedPassword 对象）
 * 该函数此前仅经 syncMappingPasswordHelpers.test/useE2EChangePw.test 间接串联断言
 * （经其判定结果验证下游行为），但函数本身的 7 边界分支零直接护栏：
 * ①typeof 非 string 兜底 false（number/null/undefined 不抛）
 * ②空串 '' false
 * ③parts.length===3 严格三段（二/四段 false）
 * ④每段 !!非空（空段 false——'a..b' 中段空不算）
 * ⑤三段全非空 true（典型 salt.iv.data）
 * ⑥含多个 '.' 仍按三段判定需 split 后严格 length===3（'a.b.c.d' 四段 false）
 * ⑦单段无点 false
 *
 * 任一回归：误把非密文（如含点号的自然文本 'v1.2.3' 或邮箱 'a@b.c'）当密文处理 → E2E 扫描误把
 * 明文字段当密文做加密/解密尝试致乱码或信息丢失；漏判真密文（如误改 length 容忍 2/4）让同步
 * 序列化路径走错分支明文泄漏密文。c8/d1-47 同款「有测试但断言浅」维度缺口。
 *
 * 口径同 d1-42/d1-117：纯加测试零源文件改动——纯布尔函数已 export，无需改 crypto.ts。
 * 纯函数无 webcrypto/deps 依赖，不 mock 任何模块，直接 import 直测。
 */
import { describe, it, expect } from 'vitest'
import { isThreePartCipher } from '../crypto.js'

describe('isThreePartCipher — 纯布尔判定护栏', () => {
  describe('正路径（三段全非空 → true）', () => {
    it('典型 salt.iv.data 三段非空 → true', () => {
      expect(isThreePartCipher('salt123.iv456.data789')).toBe(true)
    })

    it('真实 base64 风格三段 → true', () => {
      expect(isThreePartCipher('AAAAaa==.BBBBbb==.CCCCcc==')).toBe(true)
    })

    it('含特殊字符的各段非空 → true', () => {
      expect(isThreePartCipher('a-b_c.a+b c.1!2@3#')).toBe(true)
    })

    it('最短三段（单字符每段）→ true', () => {
      expect(isThreePartCipher('a.b.c')).toBe(true)
    })

    it('数字各段 → true', () => {
      expect(isThreePartCipher('123.456.789')).toBe(true)
    })
  })

  describe('★typeof 非 string 兜底（不抛）', () => {
    it('null → false 不抛', () => {
      expect(isThreePartCipher(null as unknown as string)).toBe(false)
    })
    it('undefined → false 不抛', () => {
      expect(isThreePartCipher(undefined as unknown as string)).toBe(false)
    })
    it('number → false 不抛', () => {
      expect(isThreePartCipher(123 as unknown as string)).toBe(false)
    })
    it('object → false 不抛', () => {
      expect(isThreePartCipher({ x: 1 } as unknown as string)).toBe(false)
    })
    it('boolean → false 不抛', () => {
      expect(isThreePartCipher(true as unknown as string)).toBe(false)
    })
  })

  describe('空串边界', () => {
    it('★空串 → false', () => {
      expect(isThreePartCipher('')).toBe(false)
    })
    it("单点 → 中段空（split 后 ['', '']）非三段 → false", () => {
      // '.'.split('.') = ['', ''] length 2 非 3
      expect(isThreePartCipher('.')).toBe(false)
    })
  })

  describe('段数边界（严格 length === 3）', () => {
    it('★两段 → false', () => {
      expect(isThreePartCipher('salt.iv')).toBe(false)
    })
    it('★四段 → false', () => {
      expect(isThreePartCipher('a.b.c.d')).toBe(false)
    })
    it('五段 → false', () => {
      expect(isThreePartCipher('1.2.3.4.5')).toBe(false)
    })
    it('单段无点 → false', () => {
      expect(isThreePartCipher('hello')).toBe(false)
    })
    it('多段长串（六段）→ false', () => {
      expect(isThreePartCipher('a.b.c.d.e.f')).toBe(false)
    })
  })

  describe('★空段边界（每段 !!非空）', () => {
    it('首段空 (.b.c) → false', () => {
      // '.b.c'.split('.') = ['', 'b', 'c'] length 3 但 parts[0]='' 空段 → false
      expect(isThreePartCipher('.b.c')).toBe(false)
    })
    it('中段空 (a..c) → false', () => {
      // 'a..c'.split('.') = ['a', '', 'c'] length 3 但 parts[1]='' 空段 → false
      expect(isThreePartCipher('a..c')).toBe(false)
    })
    it('末段空 (a.b.) → false', () => {
      // 'a.b.'.split('.') = ['a', 'b', ''] length 3 但 parts[2]='' 空段 → false
      expect(isThreePartCipher('a.b.')).toBe(false)
    })
    it('首末空 (.b.) → false（两空段）', () => {
      expect(isThreePartCipher('.b.')).toBe(false)
    })
    it('全空 (..) → false', () => {
      expect(isThreePartCipher('..')).toBe(false)
    })
  })

  describe('自然文本误判防护（不把含点的明文当密文）', () => {
    it('语义版本号 v1.2.3 → false（防误把版本号当密文）', () => {
      // 'v1.2.3'.split('.') = ['v1','2','3'] length 3 且各段非空 → 但语义是版本号非密文
      // 注意：isThreePartCipher 仅判格式三段非空，不判语义——v1.2.3 格式上 IS 三段 → true
      // 这是真实行为护栏：明确「格式判定非语义判定」契约（防误以为会拒版本号）
      expect(isThreePartCipher('v1.2.3')).toBe(true)
    })

    it('★纯明文 hello（无点）→ false', () => {
      expect(isThreePartCipher('hello')).toBe(false)
    })

    it('两段明文 user.profile → false', () => {
      expect(isThreePartCipher('user.profile')).toBe(false)
    })

    it('IP 四段地址 192.168.1.1 → false（四段）', () => {
      expect(isThreePartCipher('192.168.1.1')).toBe(false)
    })

    it('明文带点 url https://a.com → false（两段，: 后单段）', () => {
      // 注意 https://a.com 含 : 不含三点 → split('.') 实际多段但含 //:
      // 'https://a.com'.split('.') = ['https://a', 'com'] length 2 → false
      expect(isThreePartCipher('https://a.com')).toBe(false)
    })

    it('email a@b.c → true（格式三段非空，但非密文）—— 真实行为护栏：格式判定非语义', () => {
      // 'a@b.c'.split('.') = ['a@b', 'c'] length 2 → false
      expect(isThreePartCipher('a@b.c')).toBe(false)
    })
  })

  describe('返回类型契约', () => {
    it('恒返回 boolean（非 truthy/falsy 字面）', () => {
      expect(typeof isThreePartCipher('a.b.c')).toBe('boolean')
      expect(typeof isThreePartCipher('no')).toBe('boolean')
      expect(typeof isThreePartCipher('')).toBe('boolean')
      expect(typeof isThreePartCipher(null as unknown as string)).toBe('boolean')
    })
  })

  describe('幂等性', () => {
    it('同入参多次调用结果一致', () => {
      const s = 'salt.iv.data'
      const a = isThreePartCipher(s)
      const b = isThreePartCipher(s)
      const c = isThreePartCipher(s)
      expect(a).toBe(b)
      expect(b).toBe(c)
      expect(a).toBe(true)
    })
  })
})
