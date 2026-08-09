/**
 * useE2E-cloud-unlock-status.test.ts — 登录后解锁「云端有 canary、本地无」场景 E2E 状态护栏
 *
 * 根因（用户报告）：登录一个在云端设置过主密码的账户后，点击有密码的书签编辑会弹解锁，
 * 输入主密码解锁成功，却又提示需要设置主密码。
 *
 * 时序链：
 *  - checkE2EStatus 仅在 App onMounted 时执行；彼时未登录 → 本地无 canary + 云端读不到
 *    → isE2EEnabled=false。
 *  - 登录动作（AuthModal.onVerify）只 initialSync，不刷新 E2E 状态 → isE2EEnabled 停留 false。
 *  - openBmModal 只检查 isUnlocked（不检查 isE2EEnabled）→ 弹解锁 → unlock() 从云端拉 canary
 *    验通 → isUnlocked=true，但 isE2EEnabled 仍 false。
 *  - BookmarkModal 的 e2eFieldsOpen = enabled && unlocked = false → 字段仍锁定 → hint「开启
 *    E2E 后可存储密码」→ 点击 → e2eSetup 弹窗「设置主密码」。
 *
 * 修复：unlock 成功即 setEnabled(true)（解锁成功本身证明 canary 存在，E2E 必然已启用）。
 * 本测试锁「解锁成功 = 已启用」不变量 + 修复 B 依赖的机制（登录后 checkE2EStatus 能读云端）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// e2e store mock（plain 对象 + getter；computed 不追踪 plain 属性变化，
// 故断言一律走 _e2eState 直接读，不走 e2e.isXxx.value——见 mismatch 测试同款注释）
const _e2eState = vi.hoisted(() => ({ isE2EEnabled: false, isUnlocked: false, isBiometricEnrolled: false, cryptoKey: null as CryptoKey | null }))
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
    setCloudCanaryStale: () => {},
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
  }),
}))

// supabase mock：maybeSingle 返回可配置的云端 master_canary（unlock 的 _getCanaryData 云端分支）
const _supabaseStub = vi.hoisted(() => ({
  maybeSingleRes: { data: null as { master_canary: unknown } | null, error: null },
  upsertResHandler: vi.fn().mockResolvedValue({ error: null }),
}))
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

import { useE2E } from '../../composables/domain/useE2E.js'
import { deriveKey, generateCanary } from '../../crypto.js'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.isBiometricEnrolled = false
  _e2eState.cryptoKey = null
  _authState.user = null
  _supabaseStub.maybeSingleRes = { data: null, error: null }
})

// 小迭代数加速 PBKDF2（canaryData 显式携带 it，unlock 按其派生）
const IT = 1000

async function cloudCanaryFor(pw: string, salt = new Uint8Array([1, 2, 3, 4])) {
  const key = await deriveKey(pw, salt, IT)
  const canary = await generateCanary(key)
  return { canary, salt: Array.from(salt), it: IT }
}

describe('unlock 成功 → isE2EEnabled 置 true（云端解锁场景回归）', () => {
  it('云端有 canary、本地无、isE2EEnabled 停留 false → unlock 成功后 enabled 变 true', async () => {
    _authState.user = { id: 'user-1' }
    _supabaseStub.maybeSingleRes = { data: { master_canary: await cloudCanaryFor('master-pw') }, error: null }
    // localStorage 无 canary（换设备/清缓存）；isE2EEnabled 停留 false（模拟登录前 checkE2EStatus 已判过且登录不刷新）
    expect(_e2eState.isE2EEnabled).toBe(false)

    const e2e = useE2E()
    const ok = await e2e.unlock('master-pw')

    expect(ok).toBe(true)
    expect(_e2eState.isUnlocked).toBe(true)
    // 修复核心：解锁成功即证明 E2E 已启用，enabled 必须为 true，否则编辑框字段仍锁定并引导设置主密码
    expect(_e2eState.isE2EEnabled).toBe(true)
  })

  it('checkE2EStatus 在登录后能从云端读到 canary 并置 enabled=true（修复 B 依赖的机制）', async () => {
    _authState.user = { id: 'user-1' }
    _supabaseStub.maybeSingleRes = { data: { master_canary: await cloudCanaryFor('master-pw') }, error: null }
    expect(_e2eState.isE2EEnabled).toBe(false)

    const e2e = useE2E()
    await e2e.checkE2EStatus()

    // 直接断言 store 底层状态（computed 对 plain mock 不追踪变化）
    expect(_e2eState.isE2EEnabled).toBe(true)
  })

  it('本地有 canary 时 unlock 走本地分支，enabled 同样保持 true', async () => {
    // 本地 canary（已在本机设过主密码）+ 登录 + 云端无 → unlock 只读本地即可验通
    const local = await cloudCanaryFor('local-master', new Uint8Array([9, 9, 9, 9]))
    localStorage.setItem('lv_e2e_canary', JSON.stringify(local))
    _authState.user = { id: 'user-1' }
    _supabaseStub.maybeSingleRes = { data: null, error: null }
    _e2eState.isE2EEnabled = false // 即便 enabled 误判 false，unlock 成功也要拉回 true

    const e2e = useE2E()
    const ok = await e2e.unlock('local-master')

    expect(ok).toBe(true)
    expect(_e2eState.isE2EEnabled).toBe(true)
    expect(_e2eState.isUnlocked).toBe(true)
  })

  it('密码错误 → unlock 返回 false，enabled 不变（不误拉高）', async () => {
    _authState.user = { id: 'user-1' }
    _supabaseStub.maybeSingleRes = { data: { master_canary: await cloudCanaryFor('correct-pw') }, error: null }

    const e2e = useE2E()
    const ok = await e2e.unlock('wrong-pw')

    expect(ok).toBe(false)
    expect(_e2eState.isE2EEnabled).toBe(false)
    expect(_e2eState.isUnlocked).toBe(false)
  })
})
