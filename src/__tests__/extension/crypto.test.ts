/**
 * extension/crypto.js 护栏测试（d1-110-extension-crypto-pure-branch-guard）。
 *
 * 测 extension/crypto.js IIFE 挂载的 `window.LinkVaultCrypto` 公开 API 的**纯分支**：
 *   - decryptWithGlobalKey（方向 E 跨端解密修复 commit cf57035b 的核心承载）
 *   - autoDecryptPassword（旧 base64 兼容路径）
 *   - encodeToBase64（保存编码）
 *
 * 基建约束：jsdom `window.crypto.subtle === undefined`（node 探针实证），故 PBKDF2/AES-GCM
 * 真派生与解密**无法在 jsdom 端到端验证**——本护栏只锁「crypto.subtle 调用之前」的纯决策/形态判别/
 * 兜底分支（try 块之前的 8 条 exit path + throw 守卫），这些正是方向 E 新增「识别 EncryptedPassword
 * 对象 vs 三段串 vs 非加密形态」承载逻辑的回归防线。回归会让扩展端要么抛错（无主密码/无 canaryData）、
 * 要么返密文（形态判错），此前零护栏——本 chunk 开 src/ 之外 extension 端护栏新面。
 *
 * 零生产源文件改动：仅 import extension/crypto.js 触发其 IIFE 挂 `window.LinkVaultCrypto`，
 * 经公开 API 间接断言纯分支，crypto.js 一字不改。
 */
import { describe, it, expect, beforeEach } from 'vitest'

// 导入即执行 IIFE——顶层仅声明常量 + 函数定义并挂全局 `window.LinkVaultCrypto`，
// 不触发 crypto.subtle（派生调用仅在函数体内，测试调纯分支时不触达），jsdom 安全。
import '../../../extension/crypto.js'

// 经公开 API 取句柄（与 sidepanel.js 实际消费点同源——走 window.LinkVaultCrypto）。
function getApi() {
  // @ts-expect-error extension crypto 挂 window 全局
  const api = window.LinkVaultCrypto
  expect(api, 'extension/crypto.js IIFE 应挂载 window.LinkVaultCrypto').toBeDefined()
  return api as {
    decryptWithGlobalKey: (
      stored: unknown,
      masterPassword: unknown,
      canaryData: unknown,
    ) => Promise<string>
    autoDecryptPassword: (stored: unknown, masterPassword: unknown) => Promise<string>
    encodeToBase64: (plaintext: unknown) => string
    isThreePartCipher: (s: unknown) => boolean
    decryptTextIfCipher: (text: unknown, masterPassword: unknown, canaryData: unknown) => Promise<string>
    clearKeyCache: () => void
    verifyMasterPassword: (masterPassword: unknown, canaryData: unknown) => Promise<boolean>
  }
}

const MASTER = 'correct horse battery staple'
const CANARY = { salt: new Array(32).fill(1), it: 600000, canary: 'deadbeef' }

describe('extension/crypto.js — decryptWithGlobalKey 纯分支护栏（方向 E 承载）', () => {
  beforeEach(() => {
    // 防 try 块内 crypto.subtle undefined 抛被 catch 吞后返 '' 干扰纯分支断言：
    // 纯分支测试入参必触发 try 之前 return/throw，不进 catch 块。
  })

  it('null stored 直接返 ""（line 127 !stored 守卫）', async () => {
    expect(await getApi().decryptWithGlobalKey(null, MASTER, CANARY)).toBe('')
  })

  it('undefined stored 返 ""', async () => {
    expect(await getApi().decryptWithGlobalKey(undefined, MASTER, CANARY)).toBe('')
  })

  it('空串 stored 返 ""（空串 falsy 同走 !stored 守卫）', async () => {
    expect(await getApi().decryptWithGlobalKey('', MASTER, CANARY)).toBe('')
  })

  it('0 stored 返 ""（number 0 falsy 走 !stored 守卫，直锁真实隐特性）', async () => {
    expect(await getApi().decryptWithGlobalKey(0, MASTER, CANARY)).toBe('')
  })

  it('非三段串形态返 ""（_isThreePartCipher false → 调用方旧路径处理）', async () => {
    expect(await getApi().decryptWithGlobalKey('not-a-cipher', MASTER, CANARY)).toBe('')
    expect(await getApi().decryptWithGlobalKey('two.parts', MASTER, CANARY)).toBe('')
    expect(await getApi().decryptWithGlobalKey('one.two.three.four', MASTER, CANARY)).toBe('')
  })

  it('三段但末段空返 ""（_isThreePartCipher 第三段 !!空串=false）', async () => {
    expect(await getApi().decryptWithGlobalKey('a.b.', MASTER, CANARY)).toBe('')
  })

  it('三段但中段空返 ""', async () => {
    expect(await getApi().decryptWithGlobalKey('a..c', MASTER, CANARY)).toBe('')
  })

  it('三段但首段空返 ""', async () => {
    expect(await getApi().decryptWithGlobalKey('.b.c', MASTER, CANARY)).toBe('')
  })

  it('encrypted!==true 对象返 ""（line 134 守卫拦截非加密对象）', async () => {
    expect(
      await getApi().decryptWithGlobalKey(
        { encrypted: false, iv: 'x', data: 'y' },
        MASTER,
        CANARY,
      ),
    ).toBe('')
  })

  it('缺 encrypted 字段的对象返 ""', async () => {
    expect(
      await getApi().decryptWithGlobalKey({ iv: 'x', data: 'y' }, MASTER, CANARY),
    ).toBe('')
  })

  it('encrypted=true 但缺 iv 返 ""（line 135 守卫）', async () => {
    expect(
      await getApi().decryptWithGlobalKey(
        { encrypted: true, data: 'y' },
        MASTER,
        CANARY,
      ),
    ).toBe('')
  })

  it('encrypted=true 但缺 data 返 ""', async () => {
    expect(
      await getApi().decryptWithGlobalKey(
        { encrypted: true, iv: 'x' },
        MASTER,
        CANARY,
      ),
    ).toBe('')
  })

  it('encrypted=true 但 iv 空串返 ""（空串 falsy）', async () => {
    expect(
      await getApi().decryptWithGlobalKey(
        { encrypted: true, iv: '', data: 'y' },
        MASTER,
        CANARY,
      ),
    ).toBe('')
  })

  it('加密对象形态但无 masterPassword 抛错（line 136 try 之前守卫）', async () => {
    await expect(
      getApi().decryptWithGlobalKey(
        { encrypted: true, iv: 'x', data: 'y' },
        '',
        CANARY,
      ),
    ).rejects.toThrow('需要主密码才能解密')
  })

  it('null masterPassword 抛错（null falsy，与空串同）', async () => {
    await expect(
      getApi().decryptWithGlobalKey(
        { encrypted: true, iv: 'x', data: 'y' },
        null,
        CANARY,
      ),
    ).rejects.toThrow('需要主密码才能解密')
  })

  it('加密对象 + 主密码但无 canaryData 抛错（line 137）', async () => {
    await expect(
      getApi().decryptWithGlobalKey(
        { encrypted: true, iv: 'x', data: 'y' },
        MASTER,
        null,
      ),
    ).rejects.toThrow('缺少解锁数据')
  })

  it('canaryData 缺 salt 字段抛错', async () => {
    await expect(
      getApi().decryptWithGlobalKey(
        { encrypted: true, iv: 'x', data: 'y' },
        MASTER,
        { it: 600000 },
      ),
    ).rejects.toThrow('缺少解锁数据')
  })

  it('canaryData.salt 为空数组抛错（![]真值在 !canaryData.salt 判定——空数组 truthy 故不抛此条，验真实：空数组 truthy 直锁）', async () => {
    // 空数组 [] 在 JS 中 truthy，!canaryData.salt 不会因空数组抛错——直锁真实行为：
    // { encrypted:true, iv, data } + master + { salt: [] } 不抛「缺少解锁数据」，
    // 而是进 try 走 crypto.subtle（jsdom 无 subtle）→ catch 返 ''。
    const r = await getApi().decryptWithGlobalKey(
      { encrypted: true, iv: 'x', data: 'y' },
      MASTER,
      { salt: [] },
    )
    expect(r).toBe('') // 进 try → crypto.subtle undefined 抛 → catch 返 ''
  })

  it('三段串形态 + 主密码但无 canaryData 抛错（验三段串拆对象后仍走 line 137 守卫，链路完整）', async () => {
    await expect(
      getApi().decryptWithGlobalKey('A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24), MASTER, null),
    ).rejects.toThrow('缺少解锁数据')
  })

  it('三段串形态 + 主密码 + canary 但无主密码抛错（拆对象后 line 136 守卫生效）', async () => {
    await expect(getApi().decryptWithGlobalKey('A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24), '', CANARY)).rejects.toThrow(
      '需要主密码才能解密',
    )
  })
})

describe('extension/crypto.js — autoDecryptPassword 纯分支护栏（旧 base64 兼容）', () => {
  it('null stored 返 ""', async () => {
    expect(await getApi().autoDecryptPassword(null, MASTER)).toBe('')
  })

  it('undefined stored 返 ""', async () => {
    expect(await getApi().autoDecryptPassword(undefined, MASTER)).toBe('')
  })

  it('空串 stored 返 ""', async () => {
    expect(await getApi().autoDecryptPassword('', MASTER)).toBe('')
  })

  it('base64 编码串经 atob 解码（旧格式正路径，不走 crypto.subtle）', async () => {
    // 'test' 的 base64 = 'dGVzdA=='
    expect(await getApi().autoDecryptPassword('dGVzdA==', MASTER)).toBe('test')
  })

  it('非法 base64 串 catch 后透传原串', async () => {
    // 含非 base64 字符（如 '!'）atob 抛 → catch 返原串
    const badInput = 'not!base64'
    const result = await getApi().autoDecryptPassword(badInput, MASTER)
    // jsdom atob 对非法 base64 抛 InvalidCharacterError，catch 返 stored 原值
    expect(result).toBe(badInput)
  })

  it('encrypted 对象但无 masterPassword 抛错（line 86 守卫，try 之前）', async () => {
    await expect(
      getApi().autoDecryptPassword({ encrypted: true, salt: 's', iv: 'i', data: 'd' }, ''),
    ).rejects.toThrow('需要主密码才能解密')
  })

  it('encrypted===false 对象（非 true）不进 object 分支，落 string 判定 false 后返 ""', async () => {
    // line 85 条件 encrypted === true 严格相等，false 不匹配；line 93 非 string；line 96 返 ''
    expect(
      await getApi().autoDecryptPassword(
        { encrypted: false, salt: 's', iv: 'i', data: 'd' },
        MASTER,
      ),
    ).toBe('')
  })

  it('number 入参（既非 object 亦非 string）返 ""', async () => {
    expect(await getApi().autoDecryptPassword(12345, MASTER)).toBe('')
  })

  it('空对象（无 encrypted 字段）返 ""', async () => {
    expect(await getApi().autoDecryptPassword({}, MASTER)).toBe('')
  })
})

describe('extension/crypto.js — encodeToBase64 护栏', () => {
  it('ASCII 文本经 btoa 编码', async () => {
    expect(getApi().encodeToBase64('test')).toBe('dGVzdA==')
  })

  it('空串编码返空串', async () => {
    expect(getApi().encodeToBase64('')).toBe('')
  })

  it('单字母编码', async () => {
    expect(getApi().encodeToBase64('A')).toBe('QQ==')
  })

  it('Latin-1 范围字符编码不抛', async () => {
    // ñ U+00F1 在 Latin-1 范围 btoa 可处理
    expect(typeof getApi().encodeToBase64('ñ')).toBe('string')
    expect(getApi().encodeToBase64('ñ').length).toBeGreaterThan(0)
  })
})

describe('extension/crypto.js — isThreePartCipher 密文精确识别', () => {
  it('标准三段 Base64 密文识别为 true', () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    expect(getApi().isThreePartCipher(cipher)).toBe(true)
  })

  it('普通点号分隔文本（域名、版本号）识别为 false', () => {
    expect(getApi().isThreePartCipher('www.example.com')).toBe(false)
    expect(getApi().isThreePartCipher('v1.2.3')).toBe(false)
    expect(getApi().isThreePartCipher('127.0.0.1')).toBe(false)
  })

  it('段长不符或非 base64 字符识别为 false', () => {
    expect(getApi().isThreePartCipher('A.B.C')).toBe(false)
    expect(getApi().isThreePartCipher('A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(10))).toBe(false)
    expect(getApi().isThreePartCipher('A'.repeat(44) + '!' + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24))).toBe(false)
  })

  it('非字符串或空值识别为 false', () => {
    expect(getApi().isThreePartCipher('')).toBe(false)
    expect(getApi().isThreePartCipher(null)).toBe(false)
    expect(getApi().isThreePartCipher(undefined)).toBe(false)
    expect(getApi().isThreePartCipher(123)).toBe(false)
  })
})

describe('extension/crypto.js — decryptTextIfCipher 安全解密与非密文放行', () => {
  it('明文文本原样放行', async () => {
    expect(await getApi().decryptTextIfCipher('普通备注', MASTER, CANARY)).toBe('普通备注')
    expect(await getApi().decryptTextIfCipher('<p>HTML备注</p>', MASTER, CANARY)).toBe('<p>HTML备注</p>')
    expect(await getApi().decryptTextIfCipher('', MASTER, CANARY)).toBe('')
    expect(await getApi().decryptTextIfCipher(null, MASTER, CANARY)).toBe('')
  })

  it('未提供主密码或解锁数据时，密文返回空串（绝不回吐密文乱码）', async () => {
    const cipher = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    expect(await getApi().decryptTextIfCipher(cipher, '', CANARY)).toBe('')
    expect(await getApi().decryptTextIfCipher(cipher, null, CANARY)).toBe('')
    expect(await getApi().decryptTextIfCipher(cipher, MASTER, null)).toBe('')
    expect(await getApi().decryptTextIfCipher(cipher, MASTER, { salt: null })).toBe('')
  })

  it('clearKeyCache 不抛异常', () => {
    expect(() => getApi().clearKeyCache()).not.toThrow()
  })

  it('verifyMasterPassword 在缺失参数时返回 false', async () => {
    expect(await getApi().verifyMasterPassword('', CANARY)).toBe(false)
    expect(await getApi().verifyMasterPassword(MASTER, null)).toBe(false)
    expect(await getApi().verifyMasterPassword(MASTER, { salt: null, canary: 'abc' })).toBe(false)
    expect(await getApi().verifyMasterPassword(MASTER, { salt: [1], canary: '' })).toBe(false)
  })
})

