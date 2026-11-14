/**
 * useE2E-canary-mismatch.test.ts — 多设备主密码不一致检测与切换护栏
 *
 * 云端 user_security.master_canary 单行单槽：多设备各设各的主密码时，后写覆盖先写，
 * 且各 key 互解不开对方密文。detectCloudCanaryMismatch 在登录后对比本机与云端 canary；
 * adoptCloudCanary 切到云端 canary（统一主密码）并复位为锁定态，随后引导原主密码解锁。
 * 本护栏锁六条行为契约：
 *  - 本机/云端任一侧缺失 → mismatch=false（不打扰正常首次设置/解锁场景）
 *  - 本机与云端 canary 同源（canary + salt 一致）→ mismatch=false
 *  - 不同源（canary 字段或 salt 不同）→ mismatch=true
 *  - adoptCloudCanary：覆盖本地 canary = 云端 + setEnabled(true) + 复位锁定态
 *  - adoptCloudCanary：云端无 canary → 返 false，本地 canary 不被覆盖
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _e2eState = vi.hoisted(() => ({ isE2EEnabled: false, isUnlocked: false, isBiometricEnrolled: false, cryptoKey: null as CryptoKey | null, cloudCanaryStale: false }))
vi.mock('../../stores/e2e.js', () => ({
  useE2EStore: () => ({
    get isE2EEnabled() { return _e2eState.isE2EEnabled },
    get isUnlocked() { return _e2eState.isUnlocked },
    get isBiometricEnrolled() { return _e2eState.isBiometricEnrolled },
    get cryptoKey() { return _e2eState.cryptoKey },
    get visibilityLocked() { return false },
    setEnabled: (v: boolean) => { _e2eState.isE2EEnabled = v },
    setKey: (k: CryptoKey) => { _e2eState.cryptoKey = k },
    setUnlocked: (v: boolean) => { _e2eState.isUnlocked = v },
    setBiometricEnrolled: (v: boolean) => { _e2eState.isBiometricEnrolled = v },
    setCloudCanaryStale: (v: boolean) => { _e2eState.cloudCanaryStale = v },
    resetLockTimer: () => {},
    initVisibilityLock: () => {},
    lock: () => { _e2eState.isUnlocked = false; _e2eState.cryptoKey = null },
  }),
}))

const _authState = vi.hoisted(() => ({ user: null as { id: string } | null }))
vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({
    get user() { return _authState.user },
    get session() { return null },
    signOut: vi.fn(),
  }),
}))

// supabase mock：maybeSingle 返回可配置的云端 master_canary；upsert 共享 stub 供断言推送
const _supabaseStub = vi.hoisted(() => ({
  maybeSingleRes: { data: null as { master_canary: unknown } | null, error: null },
  upsertResHandler: vi.fn().mockResolvedValue({ error: null }),
}))
// #20 双形态：SUT 的数据访问统一走 lib/dbApi（dbFrom/dbRpc）。把这一层指向同一个
// supabase 桩，用例的主体逻辑在 Supabase / CloudBase 两种后端形态下都成立；
// dbApi 自身的形态分支由 src/__tests__/lib/dbApi*.test.ts 专门覆盖。
vi.mock('../../lib/dbApi.js', async () => {
  const { supabase } = await import('../../lib/supabase.js')
  return {
    dbFrom: (table: string) => (supabase as any).from(table),
    dbRpc: (fn: string, args?: Record<string, unknown>) => (supabase as any).rpc(fn, args),
  }
})

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve(_supabaseStub.maybeSingleRes) })),
      })),
      upsert: (payload: unknown, opts?: unknown) => _supabaseStub.upsertResHandler(payload, opts),
    })),
  },
}))
vi.mock('../../composables/domain/useSyncHistory.js', () => ({
  _getUserId: () => _authState.user?.id ?? null,
}))
vi.mock('../../composables/domain/useSyncRealtime.js', () => ({
  subscribeRealtime: vi.fn(),
  unsubscribeRealtime: vi.fn(),
}))
vi.mock('../../composables/domain/syncPush.js', () => ({
  enqueueDirtyAsOps: vi.fn(),
  pushFromQueue: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../composables/domain/syncPull.js', () => ({
  pullChanges: vi.fn().mockResolvedValue(true),
}))
vi.mock('../../composables/domain/syncPending.js', () => ({
  _clearAllPendingSync: vi.fn(),
}))
vi.mock('../../stores/storage.js', () => ({
  clearAllSyncOps: vi.fn().mockResolvedValue(undefined),
  enqueueSyncOps: vi.fn(),
  syncOpsCount: vi.fn().mockResolvedValue(0),
}))
vi.mock('../../stores/app.js', () => ({
  flushSaveAppData: vi.fn().mockResolvedValue(true),
  debouncedSaveAppData: vi.fn(),
  saveAppData: vi.fn(),
}))

import { useE2E, canaryQueryError, clearCanaryQueryError } from '../../composables/domain/useE2E.js'
import { useDataStore } from '../../stores/data.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { deriveKey, generateCanary, encrypt, decryptPasswordWithKey } from '../../crypto.js'

const E2E_CANARY_KEY = 'lv_e2e_canary'

/** 构造 canaryData（salt 为 number[] 序列化形态） */
function makeCanary(canary: string, salt: number[]): Record<string, unknown> {
  return { canary, salt, it: 600000 }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.isBiometricEnrolled = false
  _e2eState.cryptoKey = null
  _e2eState.cloudCanaryStale = false
  _authState.user = null
  _supabaseStub.maybeSingleRes = { data: null, error: null }
  _supabaseStub.upsertResHandler.mockReset()
  _supabaseStub.upsertResHandler.mockResolvedValue({ error: null })
  clearCanaryQueryError() // canaryQueryError 是模块级 ref，用例间复位
})

function setAuthUser(id = 'user-1') { _authState.user = { id } }
function setCloudCanary(c: Record<string, unknown> | null) {
  _supabaseStub.maybeSingleRes = { data: c ? { master_canary: c } : null, error: null }
}

describe('detectCloudCanaryMismatch — 多设备主密码一致性检测', () => {
  it('本机无 canary、云端无 canary（首次设置前）→ mismatch=false', async () => {
    const r = await useE2E().detectCloudCanaryMismatch()
    expect(r).toEqual({ mismatch: false, hasLocal: false, hasCloud: false, upgraded: false })
  })

  it('本机有 canary、未登录 → hasLocal=true、hasCloud=false、mismatch=false（不打扰）', async () => {
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(makeCanary('local.canary', [1, 2])))
    const r = await useE2E().detectCloudCanaryMismatch()
    expect(r).toEqual({ mismatch: false, hasLocal: true, hasCloud: false, upgraded: false })
  })

  it('登录 + 本机无 canary、云端有 → hasCloud=true、hasLocal=false、mismatch=false（正常解锁引导场景）', async () => {
    setAuthUser()
    setCloudCanary(makeCanary('cloud.canary', [3, 4]))
    const r = await useE2E().detectCloudCanaryMismatch()
    expect(r).toEqual({ mismatch: false, hasLocal: false, hasCloud: true, upgraded: false })
  })

  it('登录 + 本机/云端 canary 同源（canary + salt 全等）→ mismatch=false', async () => {
    setAuthUser()
    const c = makeCanary('same.encrypted', [9, 8, 7])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(c))
    setCloudCanary(c)
    const r = await useE2E().detectCloudCanaryMismatch()
    expect(r).toEqual({ mismatch: false, hasLocal: true, hasCloud: true, upgraded: false })
  })

  it('登录 + 本机/云端 canary 字段不同且云端无 prev_* → mismatch=true、upgraded=false（多设备各设主密码）', async () => {
    setAuthUser()
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(makeCanary('deviceB.canary', [1, 1])))
    setCloudCanary(makeCanary('deviceA.canary', [2, 2]))
    const r = await useE2E().detectCloudCanaryMismatch()
    expect(r).toEqual({ mismatch: true, hasLocal: true, hasCloud: true, upgraded: false })
  })

  it('登录 + 本机/云端 canary 同但 salt 不同 → mismatch=true（salt 决定派生 key）', async () => {
    setAuthUser()
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(makeCanary('x.y.z', [1, 2, 3])))
    setCloudCanary(makeCanary('x.y.z', [4, 5, 6]))
    const r = await useE2E().detectCloudCanaryMismatch()
    expect(r.mismatch).toBe(true)
    expect(r.upgraded).toBe(false)
  })

  it('登录 + 云端带 prev_*（其他设备改过主密码）→ upgraded=true', async () => {
    setAuthUser()
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(makeCanary('old.canary', [1, 1])))
    setCloudCanary({ ...makeCanary('new.canary', [2, 2]), prev_canary: 'old.canary', prev_salt: [1, 1], prev_it: 600000 })
    const r = await useE2E().detectCloudCanaryMismatch()
    expect(r.mismatch).toBe(true)
    expect(r.upgraded).toBe(true)
  })
})

describe('ensureCloudCanarySynced — 登录后本机 canary 自动上云（一主密码解锁所有设备）', () => {
  it('登录 + 本地有 canary + 云端无 → 推本地 canary 上云（upsert master_canary = 本地值）', async () => {
    setAuthUser()
    const local = makeCanary('deviceA.canary', [5, 6])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))

    await useE2E().ensureCloudCanarySynced()

    expect(_supabaseStub.upsertResHandler).toHaveBeenCalledTimes(1)
    const payload = _supabaseStub.upsertResHandler.mock.calls[0][0] as { user_id: string; master_canary: Record<string, unknown> }
    expect(payload.user_id).toBe('user-1')
    expect(payload.master_canary).toEqual(local)
  })

  it('登录 + 本地有 canary + 云端已有 canary → 不自动覆盖（交给冲突弹窗处理）', async () => {
    setAuthUser()
    const local = makeCanary('deviceB.canary', [1, 1])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))
    setCloudCanary(makeCanary('deviceA.canary', [2, 2])) // 云端已有另一设备 canary

    await useE2E().ensureCloudCanarySynced()

    expect(_supabaseStub.upsertResHandler).not.toHaveBeenCalled()
  })

  it('登录 + 本机无 canary → no-op（未设置主密码不推送）', async () => {
    setAuthUser()
    await useE2E().ensureCloudCanarySynced()
    expect(_supabaseStub.upsertResHandler).not.toHaveBeenCalled()
  })

  it('未登录 + 本地有 canary → no-op（无 user_id 不推送）', async () => {
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(makeCanary('local.canary', [1])))
    await useE2E().ensureCloudCanarySynced()
    expect(_supabaseStub.upsertResHandler).not.toHaveBeenCalled()
  })
})

describe('followMasterPasswordChange — 跟随其他设备的主密码修改（同步修改）', () => {
  // 测试用小迭代数加速 PBKDF2（canaryData 显式携带 it，changeMasterPassword 复用 overrideCanary.it）
  const IT = 1000

  it('云端带 prev_* → 本地 canary 被覆盖为云端原样（含 prev_*），本机数据用新 key 重加密（同一把 key 互通）', async () => {
    setAuthUser()
    // 旧 canary（本机）+ 旧 key 加密的书签密码
    const saltA = new Uint8Array([1, 2, 3, 4])
    const keyA = await deriveKey('old-master', saltA, IT)
    const canaryA = await generateCanary(keyA)
    const local = { canary: canaryA, salt: Array.from(saltA), it: IT }
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))
    // 云端新 canary（设备 A 改过主密码，带 prev_* 标记）
    const saltB = new Uint8Array([5, 6, 7, 8])
    const keyB = await deriveKey('new-master', saltB, IT)
    const canaryB = await generateCanary(keyB)
    const cloud = {
      canary: canaryB,
      salt: Array.from(saltB),
      it: IT,
      prev_canary: canaryA,
      prev_salt: Array.from(saltA),
      prev_it: IT,
    }
    setCloudCanary(cloud)

    // 本机数据：一条旧 key 加密的密码（三段串）
    const ds = useDataStore()
    const encryptedPw = await encrypt('secret-pw', keyA)
    ds.addBookmark({
      id: 'b1', title: 'S', url: 'https://s.example', username: 'u', password: encryptedPw, notes: 'n',
      icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null, order: 0, useCount: 0,
      attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    const ok = await useE2E().followMasterPasswordChange('old-master', 'new-master')

    expect(ok).toBe(true)
    // 本地 canary = 云端原样（含 prev_*），与设备 A 完全一致 → _sameCanary 通过不再误报
    expect(JSON.parse(localStorage.getItem(E2E_CANARY_KEY) || '{}')).toEqual(cloud)
    // 本机数据已用新 key（与 A 同一把）重加密：新 key 能解出原文
    const storedPw = ds.bookmarks[0].password as unknown as { encrypted: true; data: string; iv: string; salt: string }
    await expect(decryptPasswordWithKey(storedPw, keyB)).resolves.toBe('secret-pw')
  })

  it('云端无 prev_*（不是主密码升级场景）→ 返 false，不迁移', async () => {
    setAuthUser()
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(makeCanary('old.canary', [1, 1])))
    setCloudCanary(makeCanary('other.canary', [2, 2])) // 无 prev_*
    const ok = await useE2E().followMasterPasswordChange('old-master', 'new-master')
    expect(ok).toBe(false)
  })

  it('云端无 canary / 本机无本地 canary → 返 false', async () => {
    setAuthUser()
    expect(await useE2E().followMasterPasswordChange('old-master', 'new-master')).toBe(false)
    setCloudCanary(makeCanary('cloud.canary', [2, 2]))
    expect(await useE2E().followMasterPasswordChange('old-master', 'new-master')).toBe(false)
  })
})

describe('adoptCloudCanary — 统一主密码（切到云端 canary）', () => {
  it('云端有 canary → 本地被覆盖为云端 + enabled=true + 复位锁定态（unlocked=false, key=null）', async () => {
    setAuthUser()
    const local = makeCanary('deviceB.canary', [1, 1])
    const cloud = makeCanary('deviceA.canary', [2, 2])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))
    setCloudCanary(cloud)
    _e2eState.isUnlocked = true // 模拟本机当前已解锁（切换后必须复位为锁定）

    const ok = await useE2E().adoptCloudCanary()

    expect(ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(E2E_CANARY_KEY) || '{}')).toEqual(cloud)
    expect(_e2eState.isE2EEnabled).toBe(true)
    expect(_e2eState.isUnlocked).toBe(false)
    expect(_e2eState.cryptoKey).toBeNull()
    expect(_e2eState.cloudCanaryStale).toBe(false)
  })

  it('云端无 canary → 返 false，本地 canary 不被覆盖', async () => {
    setAuthUser()
    const local = makeCanary('deviceB.canary', [1, 1])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))

    const ok = await useE2E().adoptCloudCanary()

    expect(ok).toBe(false)
    expect(JSON.parse(localStorage.getItem(E2E_CANARY_KEY) || '{}')).toEqual(local)
  })

  it('未登录 → 云端读不到 → 返 false', async () => {
    const ok = await useE2E().adoptCloudCanary()
    expect(ok).toBe(false)
  })
})

/**
 * #4 回归：云端 canary 查询失败（res.error / 抛异常）必须与「确实无行」区分。
 * 旧实现 .catch(()=>null) 且不读 res.error，把查询失败当成「云端无 canary」：
 *  - ensureCloudCanarySynced 会用本地 canary 覆盖云端真实 canary（锁死其他设备）；
 *  - detectCloudCanaryMismatch 不弹冲突弹窗、换设备被引导重设主密码。
 */
describe('#4 云端 canary 查询失败三态（不静默、跳过覆盖/判定）', () => {
  // maybeSingleRes.error 初始为 null；直接 mutate 置错误对象模拟 Postgrest 查询失败
  function setCloudQueryError(msg = 'network down') {
    ;(_supabaseStub.maybeSingleRes as any).error = { message: msg }
  }

  it('ensureCloudCanarySynced：res.error 时跳过覆盖，绝不把本地 canary 推上云覆盖云端真值', async () => {
    setAuthUser()
    const local = makeCanary('deviceA.canary', [5, 6])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))
    setCloudQueryError()

    await useE2E().ensureCloudCanarySynced()

    expect(_supabaseStub.upsertResHandler).not.toHaveBeenCalled()
    expect(canaryQueryError.value).toBeTruthy() // 可见提示，不静默
  })

  it('ensureCloudCanarySynced：查询抛异常时也跳过覆盖并给出可见提示', async () => {
    setAuthUser()
    const local = makeCanary('deviceA.canary', [5, 6])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))
    const { supabase } = await import('../../lib/supabase.js')
    vi.mocked(supabase.from).mockImplementationOnce(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.reject(new Error('boom')) }) }),
    } as any))

    await useE2E().ensureCloudCanarySynced()

    expect(_supabaseStub.upsertResHandler).not.toHaveBeenCalled()
    expect(canaryQueryError.value).toBeTruthy()
  })

  it('detectCloudCanaryMismatch：查询失败时跳过冲突判定（mismatch=false、不弹窗）+ 可见提示', async () => {
    setAuthUser()
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(makeCanary('local.canary', [1, 1])))
    setCloudQueryError()

    const r = await useE2E().detectCloudCanaryMismatch()

    expect(r.mismatch).toBe(false)
    expect(canaryQueryError.value).toBeTruthy()
  })

  it('adoptCloudCanary：查询失败时返 false 且不覆盖本地 canary', async () => {
    setAuthUser()
    const local = makeCanary('local.canary', [1, 1])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))
    setCloudQueryError()

    const ok = await useE2E().adoptCloudCanary()

    expect(ok).toBe(false)
    expect(JSON.parse(localStorage.getItem(E2E_CANARY_KEY) || '{}')).toEqual(local)
    expect(canaryQueryError.value).toBeTruthy()
  })

  it('查询恢复成功（error=null）后可见提示自动清除', async () => {
    setAuthUser()
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(makeCanary('local.canary', [1, 1])))
    setCloudQueryError()
    await useE2E().ensureCloudCanarySynced()
    expect(canaryQueryError.value).toBeTruthy()

    // 网络恢复：云端有 canary，error 归 null
    setCloudCanary(makeCanary('cloud.canary', [2, 2]))
    const r = await useE2E().detectCloudCanaryMismatch()

    expect(canaryQueryError.value).toBeNull()
    expect(r.hasCloud).toBe(true)
  })

  it('确实无行（error=null, data=null）不算查询失败：正常推本地 canary 上云且无错误提示', async () => {
    setAuthUser()
    const local = makeCanary('deviceA.canary', [5, 6])
    localStorage.setItem(E2E_CANARY_KEY, JSON.stringify(local))
    // beforeEach 已把 maybeSingleRes 置为 { data: null, error: null }（确实无行）

    await useE2E().ensureCloudCanarySynced()

    expect(_supabaseStub.upsertResHandler).toHaveBeenCalledTimes(1)
    expect(canaryQueryError.value).toBeNull()
  })
})
