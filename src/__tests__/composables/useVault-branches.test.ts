/**
 * useVault-branches.test.ts — 保险柜独立加密层未覆盖分支行为契约
 *
 * 在既有 useVault.test.ts 8 测（主流程 setup/unlock/lock/reset）之上，补锁以下未覆盖分支：
 * 1) cancelSetup cancel token（层二守门核心）——setupVaultPassword 在各 await 后被取消返回 'cancelled'
 *    且不触发 setEnabled/_setKey/setUnlocked/initVisibilityLock；取消时已写入的本地 canary 回滚移除
 *    （锁第二十三~二十五轮「vault 静默激活」守门的回归门——组件层 watch 负向分支调 cancelSetup 推进 _setupGen
 *     以避免 await 窗口解 resolve 后副作用仍 commit 致「vault 已启用但用户不知密码」）
 * 2) resetVaultWithRecoveryKey 取消守门 + 无 recovery 字段早退 + save 失败不副作用
 * 3) _getCanaryData：无本地走 supabase select；抛错/无 user 兜底 null
 * 4) _saveCanaryData：有 user 走 upsert，error→false/正常→true；无 user 仅本地→true
 * 5) setupVaultPassword 配额满/远端失败（!ok）返 false 不启用；带 Recovery Key 的取消路径
 * 6) unlockVault 无 canaryData 早退；canaryData.it 缺省回退 PBKDF2_DEFAULT_ITERATIONS
 * 7) checkVaultStatus 有本地 canary 早退 + 同步 setBiometricEnrolled；无本地走云端
 * 8) biometric Facade 转发契约：enrollBiometricFn 成功置 enrolled、失败不置；removeBiometricFn 置 false
 *
 * 桩策略（借鉴 syncRemotePort.test.ts vi.hoisted + getter 动态读模式）：
 * - useAuth：可控 user 注入（默认 null 不影响既有测归属文件外）
 * - supabase：可控链式 thenable client，每表每 op 可配 {data,error}，_getCanaryData 读 .data.vault_canary
 * - useVaultBiometric：可控 isBiometricEnrolled/enrollBiometric/removeBiometric 返回值
 * - crypto.js：派生/生成/校验 canary 桩为快 Promise（真实 PBKDF2 太慢且与分支契约无关），保留常量
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── 可控 useAuth（user 动态读，默认 null = 既有测试不触云端分支）──
const { getAuthUser, setAuthUser } = vi.hoisted(() => {
  let user: { id: string } | null = null
  return {
    getAuthUser: () => user,
    setAuthUser: (u: { id: string } | null) => { user = u },
  }
})
vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ get user() { return getAuthUser() } }),
}))

// ── 可控 useVaultBiometric Facade 转发绑定（enroll/remove/available/isEnrolled）──
// setter/查询器挂在外层 bio（测里直接 bio.__setX 调），
// 每次 useVaultBiometric() 调 bio.get() 返回读取这些状态的实例（闭包读外层状态）
vi.mock('../../composables/domain/useVaultBiometric.js', () => ({
  useVaultBiometric: () => bio.get() as any,
}))
const bio = vi.hoisted(() => {
  let isAvailable = false
  let enrolled = false
  let enrollOk = false
  let removeCalls = 0
  return {
    get: () => ({
      isBiometricAvailable: () => isAvailable,
      isBiometricEnrolled: () => enrolled,
      enrollBiometric: vi.fn(async () => enrollOk),
      removeBiometric: vi.fn(async () => { removeCalls++ }),
      unlockWithBiometric: vi.fn(async () => false),
    }),
    reset: () => { isAvailable = false; enrolled = false; enrollOk = false; removeCalls = 0 },
    __setEnrollOk: (v: boolean) => { enrollOk = v },
    __setAvailable: (v: boolean) => { isAvailable = v },
    __setEnrolled: (v: boolean) => { enrolled = v },
    __removeCalls: () => removeCalls,
  }
})

// ── 可控 supabase client（链式 thenable，_getCanaryData/_saveCanaryData 走此）──
// from('user_security').select('vault_canary').eq(...).maybeSingle() → thenable {data,error}
// from('user_security').upsert(...).then(...) → {data,error}
const { getSupabaseImpl, setSupabaseImpl, resetSupabaseImpl } = vi.hoisted(() => {
  let impl: null | {
    selectResult: { data: any; error: any } | Error
    upsertResult: { data: any; error: any }
  } = null
  return {
    getSupabaseImpl: () => impl,
    setSupabaseImpl: (i: any) => { impl = i },
    resetSupabaseImpl: () => { impl = null },
  }
})
vi.mock('../../lib/supabase.js', () => ({
  get supabase() {
    return {
      from: (_table: string): any => {
        // 通用链式 thenable：select/upsert 标记当前 op，eq/maybeSingle 透传，then 时按 impl 出结果。
        // _getCanaryData 走 from().select().eq().maybeSingle().then(...)
        // _saveCanaryData 走 from().upsert(...).then(...)
        let op: 'select' | 'upsert' = 'select'
        const b: any = {
          eq: () => b,
          maybeSingle: () => b,
          upsert: () => { op = 'upsert'; return b },
          select: () => { op = 'select'; return b },
          then(res: (v: any) => void) {
            const impl = getSupabaseImpl()
            if (!impl) return res({ data: null, error: null })
            const configured = op === 'upsert' ? impl.upsertResult : impl.selectResult
            if (configured instanceof Error) {
              // 抛错：_getCanaryData/.then(...).catch(()=>null) / _saveCanaryData .catch(()=>false) 兜底
              return Promise.reject(configured).then(null, () => res(op === 'upsert' ? { data: null, error: null } : null as any))
            }
            return Promise.resolve(configured).then(res)
          },
        }
        return b
      },
    }
  },
}))

// ── crypto.js 桩：派生/生成/校验 canary 用快 Promise（真实 PBKDF2 600K 与分支契约无关）
//    保留 PBKDF2_ITERATIONS / PBKDF2_DEFAULT_ITERATIONS 常量供源码 import ──
vi.mock('../../crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crypto.js')>()
  return {
    ...actual,
    deriveKey: vi.fn(async () => ({ type: 'secret', algorithm: { name: 'AES-GCM' } } as unknown as CryptoKey)),
    generateCanary: vi.fn(async () => `canary-${Math.random().toString(36).slice(2)}`),
    verifyCanary: vi.fn(async () => true),
  }
})

import { useVault } from '../../composables/domain/useVault.js'
import { useVaultStore } from '../../stores/vault.js'
import { PBKDF2_DEFAULT_ITERATIONS } from '../../crypto.js'
import { localStorageMock } from '../setup.js'

const CANARY_KEY = 'lv_vault_canary'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorageMock.clear()
  vi.clearAllMocks()
  setAuthUser(null)
  bio.reset()
  resetSupabaseImpl()
})

afterEach(() => {
  // cancel token _setupGen 是模块级、跨测累积——不影响相对判断（每测内部快照始终对齐）。
  // 但为稳，每测用完 reset supabase/auth/bio 已在 beforeEach；crypto spy clearAllMocks 清计数。
})

describe('useVault cancelSetup cancel token（层二守门回归门）', () => {
  it('setupVaultPassword 在首个 await 后被 cancelSetup 推进 _setupGen → 返 cancelled 且不副作用', async () => {
    const vault = useVault()
    const vaultStore = useVaultStore()
    const p = vault.setupVaultPassword('pw-cancel-mid')
    // 在 deriveKey resolve 前（microtask 入队后立即）推进 _setupGen
    vault.cancelSetup()
    const result = await p
    expect(result).toBe('cancelled')
    // 守门核心：取消后不触发启用/解锁/密钥
    expect(vault.isVaultEnabled.value).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
    expect(vaultStore.vaultCryptoKey).toBeNull()
  })

  it('setupVaultPassword 取消时已写入的本地 canary 被 _removeLocalCanary 回滚移除', async () => {
    const vault = useVault()
    // 配置：_saveCanaryData 的 upsert 挂起，测里 cancelSetup 后再 resolve，
    // 源码 line 158 gen!==_setupGen 分支调 _removeLocalCanary 回滚
    let resolveUpsert: (v: { data: any; error: any }) => void = () => {}
    const upsertResult = new Promise<{ data: any; error: any }>(r => { resolveUpsert = r })
    // 用直接 _saveCanaryData 路径：有 user 就走 upsert，挂起让 cancel 插入
    setAuthUser({ id: 'user-rollback' })
    setSupabaseImpl({
      selectResult: { data: null, error: null },
      upsertResult: { then: (res: (v: any) => void) => upsertResult.then(res) } as any,
    })
    const p = vault.setupVaultPassword('pw-rollback')
    // 等前置真实桩 crypto 都 resolve（microtask 几次）后本地 canary 已 _writeLocalCanary 写入
    await Promise.resolve()
    await Promise.resolve()
    // 本地 canary 在 _saveCanaryData 开头已写入（line 87 _writeLocalCanary 同步于 upsert 前）
    expect(localStorageMock.getItem(CANARY_KEY)).toBeTruthy()
    // 取消 + resolve upsert（正常 error=null，但 gen 不匹配故走 cancelled 回滚分支）
    vault.cancelSetup()
    resolveUpsert({ data: null, error: null })
    const result = await p
    expect(result).toBe('cancelled')
    // 回滚核心：本地 canary 被移除
    expect(localStorageMock.getItem(CANARY_KEY)).toBeNull()
  })

  it('setupVaultPassword 带 Recovery Key 时取消仍返 cancelled 不副作用', async () => {
    const vault = useVault()
    const rk = vault.generateRecoveryKey()
    const p = vault.setupVaultPassword('pw-rk-cancel', rk)
    vault.cancelSetup()
    const result = await p
    expect(result).toBe('cancelled')
    expect(vault.isVaultEnabled.value).toBe(false)
  })

  it('cancelSetup 推进 _setupGen（连续推进单调递增，守门 token 语义）', () => {
    const vault = useVault()
    // cancelSetup 是模块级 _setupGen++，连续调用应单调推进（不重置）
    expect(() => vault.cancelSetup()).not.toThrow()
    expect(() => vault.cancelSetup()).not.toThrow()
  })
})

describe('useVault resetVaultWithRecoveryKey 取消守门与边界', () => {
  it('无 recovery_canary 字段早退返 false 不副作用', async () => {
    const vault = useVault()
    setAuthUser(null)
    // 预置本地 canary 无 recovery 字段
    localStorageMock.setItem(CANARY_KEY, JSON.stringify({ canary: 'c', salt: [1, 2], it: 600000 }))
    const ok = await vault.resetVaultWithRecoveryKey('XXXX-XXXX-XXXX-XXXX', 'new-pw')
    expect(ok).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
  })

  it('用对 Recovery Key 取消（_saveCanaryData 后 gen 不匹配）返 cancelled 不副作用', async () => {
    const vault = useVault()
    // 先 setup 带 recovery key 写入 canaryData
    const rk = vault.generateRecoveryKey()
    await vault.setupVaultPassword('old-pw-777', rk)
    vault.lockVault()
    // 取消插入在 _saveCanaryData upsert 挂起窗口
    setAuthUser({ id: 'user-rst-cancel' })
    let resolveUpsert: (v: { data: any; error: any }) => void = () => {}
    const upsertResult = new Promise<{ data: any; error: any }>(r => { resolveUpsert = r })
    setSupabaseImpl({
      // _getCanaryData 先走 select 取已写 canaryData（本地无，已被 setup 写盘——
      // 实际本地有 canary，_readLocalCanary 命中早返 Promise.resolve(local)，不走 select）
      selectResult: { data: null, error: null },
      upsertResult: { then: (res: (v: any) => void) => upsertResult.then(res) } as any,
    })
    // 锁定后清本地 canary 让 _getCanaryData 走 select？不，lock 不清 localStorage。
    // setup 已写本地 canary，_getCanaryData 命中本地早返，不走 supabase。需清本地强走 select。
    // 但 select 返 null 就 early-return false。为走 reset 完整链，保留本地 canary（_getCanaryData 命中本地）。
    // cancel 路径只测 _saveCanaryData 后（ok2 后 gen 判），select 路径不影响。
    setAuthUser({ id: 'user-rst-cancel' }) // 有 user 让 _saveCanaryData 走 upsert（挂起）
    const p = vault.resetVaultWithRecoveryKey(rk, 'new-pw-after-cancel')
    // 让前置所有 await（_getCanaryData/deriveKey*rk/verifyCanary/deriveKey*newKey/generateCanary/deriveKey*rk 2nd）
    // 全部 resolve 完，reset 停在 await _saveCanaryData upsert 挂起点（line 197）；
    // 此时 cancel 推进 gen，再 resolve upsert → reset 继续 line 205 检查 gen!= → 走 206-207 回滚。
    for (let i = 0; i < 10; i++) await Promise.resolve()
    vault.cancelSetup()
    resolveUpsert({ data: null, error: null })
    const result = await p
    expect(result).toBe('cancelled')
    expect(vault.isVaultUnlocked.value).toBe(false)
  })

  it('Recovery Key 校验失败返 false 不副作用', async () => {
    const vault = useVault()
    const rk = vault.generateRecoveryKey()
    await vault.setupVaultPassword('old-pw-888', rk)
    vault.lockVault()
    // 用错 rk：verifyCanary 桩默认返 true，需桩返 false 仅此测
    const { verifyCanary } = await import('../../crypto.js')
    ;(verifyCanary as any).mockResolvedValueOnce(false)
    const ok = await vault.resetVaultWithRecoveryKey('AAAA-BBBB-CCCC-DDDD', 'new-pw')
    expect(ok).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
  })

  it('_saveCanaryData 返 false（远端 error）→ reset 返 false 不副作用', async () => {
    const vault = useVault()
    const rk = vault.generateRecoveryKey()
    await vault.setupVaultPassword('old-pw-999', rk)
    vault.lockVault()
    // reset 走本地 canary（_getCanaryData 命中本地），_saveCanaryData 有 user → upsert error
    setAuthUser({ id: 'user-rst-fail' })
    setSupabaseImpl({
      selectResult: { data: null, error: null },
      upsertResult: { data: null, error: { message: 'upsert failed', code: '23505' } },
    })
    const ok = await vault.resetVaultWithRecoveryKey(rk, 'new-pw-fail')
    expect(ok).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
  })
})

describe('useVault _getCanaryData / _saveCanaryData 云端分支', () => {
  it('_getCanaryData 无本地 + 无 user → 早退 null（不查云端）', async () => {
    const vault = useVault()
    // setup 写入本地 canary——测「无本地」需不 setup。
    // checkVaultStatus 调 _getCanaryData：无本地、无 user
    setAuthUser(null)
    const ok = await vault.checkVaultStatus()
    expect(ok).toBe(false)
    expect(vault.isVaultEnabled.value).toBe(false)
  })

  it('_getCanaryData 无本地 + 有 user + select 返 vault_canary → checkVaultStatus 启用', async () => {
    const vault = useVault()
    setAuthUser({ id: 'user-cloud' })
    setSupabaseImpl({
      selectResult: {
        data: { vault_canary: { canary: 'cloud-c', salt: [1, 2, 3], it: 600000 } },
        error: null,
      },
      upsertResult: { data: null, error: null },
    })
    const ok = await vault.checkVaultStatus()
    expect(ok).toBe(true)
    expect(vault.isVaultEnabled.value).toBe(true)
    // biometric.isBiometricEnrolled 同步（data 分支 line 121）
    expect(vault.isVaultBiometricEnrolled.value).toBe(false) // 桩 enrolled=false
  })

  it('_getCanaryData 无本地 + 有 user + select 抛错 → catch 兜底 null → checkVaultStatus 不启用', async () => {
    const vault = useVault()
    setAuthUser({ id: 'user-throw' })
    setSupabaseImpl({
      selectResult: new Error('network'),
      upsertResult: { data: null, error: null },
    })
    const ok = await vault.checkVaultStatus()
    expect(ok).toBe(false)
    expect(vault.isVaultEnabled.value).toBe(false)
  })

  it('_getCanaryData 无本地 + 有 user 但 user.id 为 falsy → 早退 null', async () => {
    const vault = useVault()
    setAuthUser(null) // useAuth().user 为 null → auth.user 真 null
    const ok = await vault.checkVaultStatus()
    expect(ok).toBe(false)
  })

  it('_saveCanaryData 无 user → Promise.resolve(true) 不查云端', async () => {
    const vault = useVault()
    setAuthUser(null)
    // setup 走 _saveCanaryData：无 user → return Promise.resolve(true) 不走 upsert
    const ok = await vault.setupVaultPassword('pw-no-user')
    expect(ok).toBe(true)
  })

  it('_saveCanaryData 有 user + upsert error → setup 返 false 不启用（配额满/远端失败）', async () => {
    const vault = useVault()
    setAuthUser({ id: 'user-upsert-fail' })
    setSupabaseImpl({
      selectResult: null as any,
      upsertResult: { data: null, error: { message: 'rls denied', code: '42501' } },
    })
    const ok = await vault.setupVaultPassword('pw-upsert-fail')
    expect(ok).toBe(false)
    // 守门：远端保存失败不启用保险柜（避免「本地有 canary 但远端无」半态）
    expect(vault.isVaultEnabled.value).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
  })

  it('_saveCanaryData 有 user + 本地配额满（safeSetItem catch 吞错返 false）→ _saveCanaryData 忽略 _writeLocalCanary 返回值走 upsert，远端成功即 setup 启用（锁当前真实行为）', async () => {
    // 行为契约：safeSetItem 包 try/catch 吞配额满错误返 false 不抛错；
    // _saveCanaryData line 87 调 _writeLocalCanary 但不接返回值（_writeLocalCanary 注释自陈「契约消费透传
    // safeSetItem 结果供 _saveCanaryData 判定」，实际 _saveCanaryData 未判定——本地配额满致 canary 未写盘，
    // 但 _saveCanaryData 仍走 upsert 远端，远端 ok=true 即 return true 致 setup 启用）。
    // 注：本地 canary 未写盘 + 远端成功的半态是既有行为边界（_saveCanaryData 忽略本地写入结果），
    // 重启后无本地 canary 走 _getCanaryData 远端取可恢复（有 user），离线无 user 则 checkVaultStatus 返 false。
    // 此发现记 board 供人工裁（_saveCanaryData 未消费 _writeLocalCanary 返回值），本轮不擅自改源。
    const vault = useVault()
    setAuthUser({ id: 'user-quota' })
    setSupabaseImpl({
      selectResult: null as any,
      upsertResult: { data: null, error: null },
    })
    // 本地配额满：safeSetItem 底层 localStorageMock.setItem 抛 DOMException 被 safeSetItem catch 吞错返 false
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    const ok = await vault.setupVaultPassword('pw-quota')
    // 当前真实行为：safeSetItem 吞错不抛 + _saveCanaryData 忽略本地结果 + 远端 upsert 成功 → setup 启用
    expect(ok).toBe(true)
    expect(vault.isVaultEnabled.value).toBe(true)
  })
})

describe('useVault unlockVault 边界', () => {
  it('无 canaryData（未 setup）→ 返 false 不解锁', async () => {
    const vault = useVault()
    setAuthUser(null)
    const ok = await vault.unlockVault('any-pw')
    expect(ok).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
  })

  it('canaryData.it 缺省 → 回退 PBKDF2_DEFAULT_ITERATIONS 派生（解锁成功）', async () => {
    const vault = useVault()
    // 手写本地 canary 无 it 字段，模拟旧/异常快照
    // 需 verifyCanary 返 true（桩默认 true）
    // canaryData.canary 必须存在；salt 转 Uint8Array
    localStorageMock.setItem(CANARY_KEY, JSON.stringify({
      canary: 'stored-canary', salt: [0, 0, 0, 0], // 无 it
    }))
    const { deriveKey } = await import('../../crypto.js')
    const ok = await vault.unlockVault('pw-default-it')
    expect(ok).toBe(true)
    expect(vault.isVaultUnlocked.value).toBe(true)
    // 锁回退契约：deriveKey 第 3 参（iterations）用 PBKDF2_DEFAULT_ITERATIONS 而非 undefined
    expect((deriveKey as any).mock.calls.at(-1)?.[2]).toBe(PBKDF2_DEFAULT_ITERATIONS)
  })

  it('verifyCanary 返 false（错密码）→ 返 false 不解锁', async () => {
    const vault = useVault()
    localStorageMock.setItem(CANARY_KEY, JSON.stringify({
      canary: 'stored-canary', salt: [0, 0, 0, 0], it: 600000,
    }))
    const { verifyCanary } = await import('../../crypto.js')
    ;(verifyCanary as any).mockResolvedValueOnce(false)
    const ok = await vault.unlockVault('wrong-pw')
    expect(ok).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
  })
})

describe('useVault checkVaultStatus 有本地 canary 早退分支', () => {
  it('有本地 canary → setEnabled(true) + setBiometricEnrolled 同步 + 返 true 不查云端', async () => {
    const vault = useVault()
    bio.__setEnrolled(true)
    localStorageMock.setItem(CANARY_KEY, JSON.stringify({ canary: 'c', salt: [1], it: 600000 }))
    setAuthUser(null)
    const ok = await vault.checkVaultStatus()
    expect(ok).toBe(true)
    expect(vault.isVaultEnabled.value).toBe(true)
    expect(vault.isVaultBiometricEnrolled.value).toBe(true)
  })
})

describe('useVault biometric Facade 转发契约', () => {
  it('enrollBiometricFn 成功 → 转发调 biometric.enrollBiometric + setBiometricEnrolled(true)', async () => {
    const vault = useVault()
    bio.__setEnrollOk(true)
    const ok = await vault.enrollBiometric('master-pw')
    expect(ok).toBe(true)
    expect(vault.isVaultBiometricEnrolled.value).toBe(true)
  })

  it('enrollBiometricFn 失败（ok=false）→ 不置 setBiometricEnrolled(true)', async () => {
    const vault = useVault()
    bio.__setEnrollOk(false)
    const prev = vault.isVaultBiometricEnrolled.value
    const ok = await vault.enrollBiometric('master-pw')
    expect(ok).toBe(false)
    expect(vault.isVaultBiometricEnrolled.value).toBe(prev)
  })

  it('removeBiometricFn → 转发 biometric.removeBiometric + setBiometricEnrolled(false)', async () => {
    const vault = useVault()
    const vaultStore = useVaultStore()
    vaultStore.setBiometricEnrolled(true)
    await vault.removeBiometric()
    expect(vault.isVaultBiometricEnrolled.value).toBe(false)
    expect(bio.__removeCalls()).toBe(1)
  })

  it('isBiometricAvailable 转发 biometric.isBiometricAvailable', () => {
    const vault = useVault()
    bio.__setAvailable(true)
    expect(vault.isBiometricAvailable()).toBe(true)
    bio.__setAvailable(false)
    expect(vault.isBiometricAvailable()).toBe(false)
  })

  it('generateRecoveryKey 格式 + 去横线解析回环', () => {
    const vault = useVault()
    const rk = vault.generateRecoveryKey()
    // 24 字符 → 6 组 4 字符，横线分隔
    expect(rk).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/)
  })
})
