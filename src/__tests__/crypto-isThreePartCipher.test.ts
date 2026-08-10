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
 * ⑤三段全非空 + 密文形态 true（salt 32B→44 字符、iv 12B→16 字符、data≥17B→≥24 字符
 *   的合法 base64 三段——见 2026-08-10 收紧：旧判定只查「三段点分隔」，把无 scheme 三段
 *   域名（www.example.com）等普通三段文本误判为密文 → domain()/displayText() 显空白、
 *   saveBm 密文保护误拦编辑（真实事故：另一设备同步后卡片网址空白但点击可打开、
 *   复制提示「含加密字段请先解锁」，且与解锁状态无关）
 * ⑥含多个 '.' 仍按三段判定需 split 后严格 length===3（'a.b.c.d' 四段 false）
 * ⑦单段无点 false
 *
 * 任一回归：误把非密文（如含点号的自然文本 'v1.2.3'、三段域名 'www.example.com'）当密文处理
 * → 渲染层显空白/编辑被拦/同步序列化误走密文分支；漏判真密文（如误改 length 容忍 2/4）让同步
 * 序列化路径走错分支明文泄漏密文。
 *
 * 纯函数无 webcrypto/deps 依赖，不 mock 任何模块，直接 import 直测。
 */
import { describe, it, expect } from 'vitest'
import { isThreePartCipher } from '../crypto.js'

// 真密文形态：salt 32B→44 字符、iv 12B→16 字符、data≥17B→≥24 字符的合法 base64（btoa 输出恒 4 的倍数）
const REAL_SALT = 'A'.repeat(44)
const REAL_IV = 'B'.repeat(16)
const REAL_DATA = 'C'.repeat(24)

describe('isThreePartCipher — 纯布尔判定护栏', () => {
  describe('正路径（真密文三段形态 → true）', () => {
    it('44/16/24 字符合法 base64 三段 → true（本系统 encrypt 输出形态）', () => {
      expect(isThreePartCipher(`${REAL_SALT}.${REAL_IV}.${REAL_DATA}`)).toBe(true)
    })

    it('真实 base64 风格三段 → true', () => {
      // 44/16/24 的 base64 字形，且 data 带 1-2 个 = padding
      const b64 = (n: number) => btoa('x'.repeat(Math.floor(n * 3 / 4)))
      expect(isThreePartCipher(`${b64(44)}.${b64(16)}.${b64(24)}`)).toBe(true)
    })

    it('data 段 ≥24 字符（更长密文）→ true', () => {
      expect(isThreePartCipher(`${REAL_SALT}.${REAL_IV}.${'D'.repeat(44)}`)).toBe(true)
    })
  })

  describe('★误判防护（三段点分隔但非密文 → false）——2026-08-10 收紧', () => {
    it('无 scheme 三段域名 www.example.com → false（真实事故根因）', () => {
      // 'www.example.com'.split('.') = ['www','example','com'] 长度 3/7/3 非 4 倍数 → false
      expect(isThreePartCipher('www.example.com')).toBe(false)
    })

    it('无 scheme 短三段域名 a.b.c → false', () => {
      expect(isThreePartCipher('a.b.c')).toBe(false)
    })

    it('语义版本号 v1.2.3 → false（非密文，URL/标题常见形态）', () => {
      expect(isThreePartCipher('v1.2.3')).toBe(false)
    })

    it('纯数字三段 123.456.789 → false', () => {
      expect(isThreePartCipher('123.456.789')).toBe(false)
    })

    it('三段长度达标但含非法 base64 字符 → false', () => {
      // 44/16/24 字符但段内含 - _ 空格 ! 等非 base64 字符
      expect(isThreePartCipher(`${'a-'.repeat(22)}.${'b c'.padEnd(16, 'b')}.${'!'.repeat(24)}`)).toBe(false)
    })

    it('salt/iv 长度与固定格式不符 → false', () => {
      expect(isThreePartCipher('salt123.iv456.data789')).toBe(false)
      expect(isThreePartCipher('AAAAaa==.BBBBbb==.CCCCcc==')).toBe(false)
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

    it('email a@b.c → false（两段）', () => {
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
      const s = `${REAL_SALT}.${REAL_IV}.${REAL_DATA}`
      const a = isThreePartCipher(s)
      const b = isThreePartCipher(s)
      const c = isThreePartCipher(s)
      expect(a).toBe(b)
      expect(b).toBe(c)
      expect(a).toBe(true)
    })
  })
})
