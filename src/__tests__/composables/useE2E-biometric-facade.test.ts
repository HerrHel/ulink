/**
 * useE2E-biometric-facade.test.ts — useE2E.ts E2E 加密核心零触达分支补测
 *
 * 既有 6 测文件（useE2E.test.ts decryptStoreItems / useE2EChangePw / useE2E-canary-mismatch /
 * useE2E-cloud-unlock-status / useE2E-encryptFields-invariant / useE2E-hasEncryptedData）深覆盖
 * setup/unlock/changeMasterPassword/encrypt/decrypt/reset 等 crypto 派生主链，但 useE2E 导出的
 * **5 个 Facade 转发与云端 canary 检测函数从未被任何测触达**（ Func 77.27% 缺口根源）：
 *
 *   ① enrollBiometricFn(797-800) — E2E 设置指纹入口 Facade：ok→setBiometricEnrolled(true)。
 *      安全契约：**失败（ok=false）绝不 setBiometricEnrolled(true)**，否则 UI 显示「已开启指纹」但
 *      实际无凭证，用户误以为加密保护生效却从未 enroll。锁门防 enroll 失败误置 enrolled。
 *   ② removeBiometricFn(805-807) — 移除指纹 Facade：await removeBiometric() 后**无条件** setBiometricEnrolled(false)。
 *      移除后必须清 enrolled 标志，否则指纹失效仍显示已开启。
 *   ③ ensureCloudCanarySynced(214-222) — 登录后把本地 canary 推上云（多设备一致性最后一环）：
 *      本地有 + 云端无 + 已登录 → _saveCanaryData(local) 上推；本地无/云端已有/未登录 → 早退不覆盖
 *      （云端已有交给 detectCloudCanaryMismatch 冲突弹窗处理，防覆盖锁死其他设备）。
 *   ④ detectCloudCanaryMismatch(225-232) — 返回 {mismatch,hasLocal,hasCloud,upgraded} 四态分类：
 *      本地/云端有无四组合 + _sameCanary 真假 mismatch 判定 + mismatch + cloud 带 prev_canary 的
 *      upgraded 标记（主密码升级走跟随迁移而非误判多设备冲突）。
 *   ⑤ adoptCloudCanary(239-248) — 切到云端 canary 统一主密码：云端有 → 覆盖本地 + 复位锁定态
 *      （setEnabled(true)+setUnlocked(false)+setKey(null)+setCloudCanaryStale(false)）返 true；
 *      云端无 → 返 false。
 *
 * 桩设计：沿用 useE2E.test.ts 的 _e2eState hoisted + getter 模拟 readonly computed + setter 模式，
 * 仅扩展 setEnabled/setEnabled/setEnabled 调用追踪；useBiometric 4 导出桩为可控行为 fn；
 * supabase 链式 thenable 桩（from().select().eq().maybeSingle() / .upsert() 返可控 {data,error}）；
 * useAuth getter 桩可控 user.id。crypto.subtle 不桩（5 目标函数均不派生 key，用真 AES-GCM 无需）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// ── e2e store mock：沿用 useE2E.test.ts plain 对象 + getter 闭包实时读模式（注释同源），
//    扩展 setter 调用追踪供 adopt/detect/enroll 的状态转移契约断言。 ──
const _e2eState = vi.hoisted(() => ({
  isE2EEnabled: false,
  isUnlocked: false,
  isBiometricEnrolled: false,
  cryptoKey: null as CryptoKey | null,
  cloudCanaryStale: false,
  // setter 调用追踪（每个 beforeEach 复位）
  setEnabledCalls: [] as boolean[],
  setUnlockedCalls: [] as boolean[],
  setKeyCalls: [] as unknown[],
  setCloudCanaryStaleCalls: [] as boolean[],
  setBiometricEnrolledCalls: [] as boolean[],
}))
vi.mock('../../stores/e2e.js', () => ({
  useE2EStore: () => ({
    get isE2EEnabled() { return _e2eState.isE2EEnabled },
    get isUnlocked() { return _e2eState.isUnlocked },
    get isBiometricEnrolled() { return _e2eState.isBiometricEnrolled },
    get cryptoKey() { return _e2eState.cryptoKey },
    get visibilityLocked() { return false },
    get cloudCanaryStale() { return _e2eState.cloudCanaryStale },
    setEnabled: (v: boolean) => { _e2eState.isE2EEnabled = v; _e2eState.setEnabledCalls.push(v) },
    setKey: (k: unknown) => { _e2eState.cryptoKey = k as CryptoKey; _e2eState.setKeyCalls.push(k) },
    setUnlocked: (v: boolean) => { _e2eState.isUnlocked = v; _e2eState.setUnlockedCalls.push(v) },
    setBiometricEnrolled: (v: boolean) => { _e2eState.isBiometricEnrolled = v; _e2eState.setBiometricEnrolledCalls.push(v) },
    setCloudCanaryStale: (v: boolean) => { _e2eState.cloudCanaryStale = v; _e2eState.setCloudCanaryStaleCalls.push(v) },
    resetLockTimer: () => {},
    initVisibilityLock: () => {},
    lock: () => { _e2eState.isUnlocked = false; _e2eState.cryptoKey = null },
  }),
}))

// ── useBiometric mock：4 导出桩为可控行为 fn（enrollBiometric/removeBiometric/isBiometricAvailable/
//    unlockWithBiometric），enroll/remove 返回值由测现场 mockResolvedValueOnce 控制。 ──
const _bio = vi.hoisted(() => ({
  enrollBiometric: vi.fn(),
  removeBiometric: vi.fn(),
  isBiometricAvailable: vi.fn(),
  unlockWithBiometric: vi.fn(),
}))
vi.mock('../../composables/domain/useBiometric.js', () => ({
  useBiometric: () => _bio,
}))

// ── useAuth mock：getter 闭包动态读 user.id（detect/ensure/adopt 都用 auth.user.id）──
const _auth = vi.hoisted(() => ({ user: null as { id: string } | null }))
vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => _auth,
}))

// ── supabase 链式 thenable 桩：from(table) 返 chain builder，select/eq/upsert/maybeSingle
//    各返自身（链式），终端 maybeSingle()/upsert 返 Promise.resolve(可控 {data,error})。
//    测现场 setNextResult 设下次链终端返回。沿用 syncShare.test.ts thenable 链模式 +
//    第五十七轮 vi.hoisted 持容器法（工厂提升时容器已就绪，工厂引用稳定属性）。
//    nextResult 经 hoisted 闭包共享，from 返由链 builder 闭包实时读 nextResult。
// ──
const _supa = vi.hoisted(() => {
  // 闭包共享的「下次终端返回」容器，工厂内 chain builder 实时读
  let nextResult: { data: unknown; error: unknown } = { data: null, error: null }
  const from = vi.fn(() => {
    const chain: any = {
      select() { return chain },
      eq() { return chain },
      maybeSingle() { return Promise.resolve(nextResult) },
      upsert() { return Promise.resolve(nextResult) },
    }
    return chain
  })
  return {
    from,
    setNextResult: (r: { data: unknown; error: unknown }) => { nextResult = r },
  }
})
vi.mock('../../lib/supabase.js', () => ({
  supabase: { from: _supa.from },
}))

import { useE2E } from '../../composables/domain/useE2E.js'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.isBiometricEnrolled = false
  _e2eState.cryptoKey = null
  _e2eState.cloudCanaryStale = false
  _e2eState.setEnabledCalls = []
  _e2eState.setUnlockedCalls = []
  _e2eState.setKeyCalls = []
  _e2eState.setCloudCanaryStaleCalls = []
  _e2eState.setBiometricEnrolledCalls = []
  _bio.enrollBiometric.mockReset()
  _bio.removeBiometric.mockReset()
  _bio.isBiometricAvailable.mockReset()
  _bio.unlockWithBiometric.mockReset()
  _auth.user = null
  _supa.setNextResult({ data: null, error: null })
})

// ── 本地 canary 辅助：写 localStorage『lv_e2e_canary』模拟 _readLocalCanary 命中 ──
function setLocalCanary(data: Record<string, unknown>) {
  localStorage.setItem('lv_e2e_canary', JSON.stringify(data))
}
function clearLocalCanary() {
  localStorage.removeItem('lv_e2e_canary')
}

const CANARY_A = { canary: 'aaa', salt: [1, 2, 3], it: 600000 }
const CANARY_B = { canary: 'bbb', salt: [4, 5, 6], it: 600000 }

// ═════════════════ ① enrollBiometricFn Facade 安全契约 ═════════════════
describe('useE2E.enrollBiometricFn — Facade 转发 + 失败不误置 enrolled 安全门', () => {
  it('★enroll 成功(ok=true) → setBiometricEnrolled(true) + 返 true', async () => {
    _bio.enrollBiometric.mockResolvedValueOnce(true)
    const e2e = useE2E()
    const ok = await e2e.enrollBiometric('master-pw-123')
    expect(ok).toBe(true)
    expect(_bio.enrollBiometric).toHaveBeenCalledTimes(1)
    expect(_bio.enrollBiometric).toHaveBeenCalledWith('master-pw-123')
    // 安全契约：成功才置 enrolled
    expect(_e2eState.setBiometricEnrolledCalls).toEqual([true])
    expect(_e2eState.isBiometricEnrolled).toBe(true)
  })

  it('★enroll 失败(ok=false) → 绝不 setBiometricEnrolled(true) + 返 false（防误置 enrolled 看似开启实则无凭证）', async () => {
    _bio.enrollBiometric.mockResolvedValueOnce(false)
    const e2e = useE2E()
    const ok = await e2e.enrollBiometric('master-pw-123')
    expect(ok).toBe(false)
    // 安全门：失败不调 setBiometricEnrolled（连 setBiometricEnrolled(false) 也不该调，
    // 因 enroll 前若已 enrolled，失败调用方不应被动清旧状态——失败即无副作用透传）
    expect(_e2eState.setBiometricEnrolledCalls).toEqual([])
    expect(_e2eState.isBiometricEnrolled).toBe(false)
  })

  it('enroll 抛错 → 抛错向上，不 setBiometricEnrolled（不吞错误不误置）', async () => {
    _bio.enrollBiometric.mockRejectedValueOnce(new Error('指纹硬件不可用'))
    const e2e = useE2E()
    await expect(e2e.enrollBiometric('master-pw-123')).rejects.toThrow('指纹硬件不可用')
    expect(_e2eState.setBiometricEnrolledCalls).toEqual([])
  })
})

// ═════════════════ ② removeBiometricFn Facade（无条件清 enrolled 指纹失效后必须清标志） ═════════════════
describe('useE2E.removeBiometricFn — 无条件 setBiometricEnrolled(false) 防指纹失效仍显已开启', () => {
  it('★remove 后无条件 setBiometricEnrolled(false)（即使调前 isBiometricEnrolled=true 也要清）', async () => {
    _bio.removeBiometric.mockResolvedValueOnce(undefined)
    _e2eState.isBiometricEnrolled = true // 模拟 enroll 过、当前显示已开启
    const e2e = useE2E()
    await e2e.removeBiometric()
    expect(_bio.removeBiometric).toHaveBeenCalledTimes(1)
    // 契约：移除后 enrolled 必须清成 false（无条件，不依赖 remove 返回值）
    expect(_e2eState.setBiometricEnrolledCalls).toEqual([false])
    expect(_e2eState.isBiometricEnrolled).toBe(false)
  })

  it('remove 抛错 → 抛错向上，不清 enrolled（移除失败保持原状态不误清）', async () => {
    _bio.removeBiometric.mockRejectedValueOnce(new Error('移除失败'))
    _e2eState.isBiometricEnrolled = true
    const e2e = useE2E()
    await expect(e2e.removeBiometric()).rejects.toThrow('移除失败')
    // 移除失败抛错向上，不调 setBiometricEnrolled（避免移除失败却清了标志致指纹实活着而 UI 显示未开启）
    expect(_e2eState.setBiometricEnrolledCalls).toEqual([])
    expect(_e2eState.isBiometricEnrolled).toBe(true)
  })
})

// ═════════════════ ③ ensureCloudCanarySynced（登录后推本地 canary 上云，多设备一致性） ═════════════════
describe('useE2E.ensureCloudCanarySynced — 本地有+云端无+已登录 → 推本地 canary 上云', () => {
  it('本地有 canary + 云端无(返回 null) + 已登录 → _saveCanaryData(local) 推上云', async () => {
    setLocalCanary(CANARY_A)
    _auth.user = { id: 'user-1' }
    // 第一次链（_getCloudCanary 读云端）返 data=null（无云端 canary）
    // 第二次链（_saveCanaryData upsert）返 error=null（成功）；
    // 但_ensureCloudCanarySynced 只调 _getCloudCanary 一次 + _saveCanaryData 一次，两者各一条链
    _bio.removeBiometric.mockResolvedValue(undefined)
    const e2e = useE2E()
    // 首次 _getCloudCanary → maybeSingle 返 {data:null}（云端无）；二次 _saveCanaryData upsert → {error:null}
    _supa.setNextResult({ data: null, error: null })
    await e2e.ensureCloudCanarySynced()

    // from 应被调用 2 次：_getCloudCanary(user_security.select.eq.maybeSingle) + _saveCanaryData(user_security.upsert)
    expect(_supa.from).toHaveBeenCalledTimes(2)

    // 验证：本地 canary 仍写本地犒劳（_saveCanaryData 总先写本地），且 key 名=lv_e2e_canary
    expect(_e2eState.setEnabledCalls).toEqual([])
  })

  it('★本地无 canary → 早退，不调 supabase（无本地无可推）', async () => {
    clearLocalCanary()
    _auth.user = { id: 'user-1' }
    const e2e = useE2E()
    await e2e.ensureCloudCanarySynced()
    expect(_supa.from).not.toHaveBeenCalled()
  })

  it('★本地有 + 云端已有 canary → 早退不覆盖（云端交给 detect 冲突弹窗处理，防覆盖锁死其他设备）', async () => {
    setLocalCanary(CANARY_A)
    _auth.user = { id: 'user-1' }
    // _getCloudCanary 返云端已存在 canary（非 null）
    _supa.setNextResult({ data: { master_canary: CANARY_B }, error: null })
    const e2e = useE2E()
    await e2e.ensureCloudCanarySynced()
    // 仅 _getCloudCanary 一次链，不推 _saveCanaryData（云端已有不覆盖）
    expect(_supa.from).toHaveBeenCalledTimes(1)
  })

  it('本地有 + 云端无 + 未登录(auth.user=null) → 早退不推（无 user 无云端路径）', async () => {
    setLocalCanary(CANARY_A)
    _auth.user = null
    const e2e = useE2E()
    await e2e.ensureCloudCanarySynced()
    // _readLocalCanary 命中 → _getCloudCanary 调用：_getCloudCanary 内 auth.user falsy 早退返 null（不经 supabase）
    expect(_supa.from).not.toHaveBeenCalled()
  })
})

// ═════════════════ ④ detectCloudCanaryMismatch（四态分类 + mismatch + upgraded 标记） ═════════════════
describe('useE2E.detectCloudCanaryMismatch — 本地/云端四态 + mismatch + upgraded 分类', () => {
  it('★本地无 canary → mismatch:false + hasLocal:false + hasCloud:false（无云端时）', async () => {
    clearLocalCanary()
    // _getCloudCanary：auth.user null → 早退返 null（cloud=null）。_readLocalCanary null
    _auth.user = null
    const e2e = useE2E()
    const r = await e2e.detectCloudCanaryMismatch()
    expect(r).toEqual({ mismatch: false, hasLocal: false, hasCloud: false, upgraded: false })
  })

  it('本地有 + 云端无 → mismatch:false + hasLocal:true + hasCloud:false', async () => {
    setLocalCanary(CANARY_A)
    _auth.user = { id: 'u' }
    // _getCloudCanary：返 data=null（云端无）
    _supa.setNextResult({ data: null, error: null })
    const e2e = useE2E()
    const r = await e2e.detectCloudCanaryMismatch()
    expect(r).toEqual({ mismatch: false, hasLocal: true, hasCloud: false, upgraded: false })
  })

  it('★本地+云端都有 + _sameCanary 真(canary+salt 一致) → mismatch:false（同一主密码设置）', async () => {
    setLocalCanary(CANARY_A)
    _auth.user = { id: 'u' }
    // 云端 canary = 本地 copy（canary+salt 相同）
    _supa.setNextResult({ data: { master_canary: { canary: 'aaa', salt: [1, 2, 3] } }, error: null })
    const e2e = useE2E()
    const r = await e2e.detectCloudCanaryMismatch()
    expect(r.mismatch).toBe(false)
    expect(r.hasLocal).toBe(true)
    expect(r.hasCloud).toBe(true)
    expect(r.upgraded).toBe(false)
  })

  it('★本地+云端都有 + 不一致(canary 不同) → mismatch:true + upgraded:false（多设备冲突，无 prev_canary）', async () => {
    setLocalCanary(CANARY_A)
    _auth.user = { id: 'u' }
    // 云端 canary=B（本地=A，不一致），且无 prev_canary → 多设备冲突非升级
    _supa.setNextResult({ data: { master_canary: { canary: 'bbb', salt: [4, 5, 6] } }, error: null })
    const e2e = useE2E()
    const r = await e2e.detectCloudCanaryMismatch()
    expect(r.mismatch).toBe(true)
    expect(r.upgraded).toBe(false) // 无 prev_canary → 多设备冲突
    expect(r.hasLocal).toBe(true)
    expect(r.hasCloud).toBe(true)
  })

  it('★本地+云端不一致 + 云端带 prev_canary → upgraded:true（主密码升级，走跟随迁移而非冲突）', async () => {
    setLocalCanary(CANARY_A)
    _auth.user = { id: 'u' }
    // 云端 canary=B 且带 prev_canary（其他设备主动改过主密码）
    _supa.setNextResult({
      data: { master_canary: { canary: 'bbb', salt: [4, 5, 6], prev_canary: 'aaa' } },
      error: null,
    })
    const e2e = useE2E()
    const r = await e2e.detectCloudCanaryMismatch()
    expect(r.mismatch).toBe(true)
    expect(r.upgraded).toBe(true) // 带 prev_canary → 主密码升级场景
  })

  it('salt 不同(canary 同)也判 mismatch（_sameCanary 要求 canary+salt 双一致）', async () => {
    setLocalCanary(CANARY_A)
    _auth.user = { id: 'u' }
    // 云端 canary=aaa 同但 salt 不同
    _supa.setNextResult({ data: { master_canary: { canary: 'aaa', salt: [9, 9, 9] } }, error: null })
    const e2e = useE2E()
    const r = await e2e.detectCloudCanaryMismatch()
    expect(r.mismatch).toBe(true) // salt 不同即 conflict
    expect(r.upgraded).toBe(false)
  })
})

// ═════════════════ ⑤ adoptCloudCanary（切云端 canary 统一主密码，覆盖本地 + 复位锁定态） ═════════════════
describe('useE2E.adoptCloudCanary — 云端有 → 覆盖本地 + 复位锁定态 返 true', () => {
  it('★云端有 canary → _writeLocalCanary(cloud) 覆盖本地 + setEnabled(true)+setUnlocked(false)+setKey(null)+setCloudCanaryStale(false) 返 true', async () => {
    _auth.user = { id: 'u' }
    _supa.setNextResult({ data: { master_canary: CANARY_B }, error: null })
    const e2e = useE2E()
    const ok = await e2e.adoptCloudCanary()
    expect(ok).toBe(true)
    // 本地 canary 被覆盖为云端 CANARY_B
    const raw = localStorage.getItem('lv_e2e_canary')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toEqual(CANARY_B)
    // 状态转移契约：切到云端 canary 后复位锁定态 + 清 stale
    expect(_e2eState.setEnabledCalls).toEqual([true])
    expect(_e2eState.setUnlockedCalls).toEqual([false])
    expect(_e2eState.setKeyCalls).toEqual([null])
    expect(_e2eState.setCloudCanaryStaleCalls).toEqual([false])
    expect(_e2eState.isE2EEnabled).toBe(true)
    expect(_e2eState.isUnlocked).toBe(false)
    expect(_e2eState.cloudCanaryStale).toBe(false)
  })

  it('★云端无 canary → 返 false，不动本地 + 不动状态', async () => {
    setLocalCanary(CANARY_A) // 本地原有 canary
    _auth.user = { id: 'u' }
    _supa.setNextResult({ data: null, error: null }) // 云端 null
    const e2e = useE2E()
    const ok = await e2e.adoptCloudCanary()
    expect(ok).toBe(false)
    // 本地 canary 保留不动（未被覆盖）
    expect(JSON.parse(localStorage.getItem('lv_e2e_canary') as string)).toEqual(CANARY_A)
    // 无任何状态转移
    expect(_e2eState.setEnabledCalls).toEqual([])
    expect(_e2eState.setCloudCanaryStaleCalls).toEqual([])
  })
})

// ═════════════════ isBiometricAvailable / unlockWithBiometric Facade 转发（透传不变） ═════════════════
describe('useE2E biometric Facade 透传转发', () => {
  it('isBiometricAvailable 透传 biometric.isBiometricAvailable() 同一 fn 引用', async () => {
    _bio.isBiometricAvailable.mockReturnValue(true)
    const e2e = useE2E()
    // isBiometricAvailableFn = biometric.isBiometricAvailable（模块顶层绑定同一引用）
    expect(e2e.isBiometricAvailable).toBe(_bio.isBiometricAvailable)
    expect(e2e.isBiometricAvailable()).toBe(true)
  })

  it('unlockWithBiometric 透传 biometric.unlockWithBiometric 同一 fn 引用', async () => {
    _bio.unlockWithBiometric.mockResolvedValue('fake-key' as any)
    const e2e = useE2E()
    // unlockWithBiometricFn = biometric.unlockWithBiometric（透传同一引用）
    expect(e2e.unlockWithBiometric).toBe(_bio.unlockWithBiometric)
    const r = await e2e.unlockWithBiometric()
    expect(r).toBe('fake-key')
  })
})
