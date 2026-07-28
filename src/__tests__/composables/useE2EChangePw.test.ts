/**
 * useE2E.changeMasterPassword 数据层重加密迁移测试
 *
 * 根因：换 key 时只覆盖 canaryData，云端历史密文（username/notes/name + password）
 * 仍是旧 key 加密 → 新 key 解不开 → 数据永久丢失。changeMasterPassword 把换 key 补成
 * 旧 key 解全量 → 新 key 重加密 → 内存明文（password 存 newKey 对象）→ push 加密一次。
 *
 * 测试聚焦核心重加密逻辑：mock 云端同步链路（_getUserId 返回 null → _reencryptCloudPush 早退），
 * 不重复测 syncPush 已覆盖的 push 链路。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// e2e store mock（复用 useE2E.test.ts 同款 plain getter 模式）
const _e2eState = vi.hoisted(() => ({
  isE2EEnabled: false, isUnlocked: false, isBiometricEnrolled: false,
  cryptoKey: null as CryptoKey | null, cloudCanaryStale: false,
}))
vi.mock('../../stores/e2e.js', () => ({
  useE2EStore: () => ({
    get isE2EEnabled() { return _e2eState.isE2EEnabled },
    get isUnlocked() { return _e2eState.isUnlocked },
    get isBiometricEnrolled() { return _e2eState.isBiometricEnrolled },
    get cryptoKey() { return _e2eState.cryptoKey },
    get cloudCanaryStale() { return _e2eState.cloudCanaryStale },
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

// mock 云端同步链路：_getUserId（经 useAuth）默认返 null → _reencryptCloudPush 走「未登录」早退，
// 专注测核心重加密。登录态用例在 before 用 setAuthUser 切换为有 user。
// useAuth 是可变 stub：默认 user=null（保持既有未登录用例行为），登录用例 setAuthUser({id}) 覆写。
// _getUserId(L15-18)、_getCanaryData(L113-127)、_saveCanaryData(L133-139) 均经 auth.user?.id 判定。
const _authState = vi.hoisted(() => ({ user: null as { id: string } | null }))
vi.mock('../../composables/domain/useAuth.js', () => ({
  // useAuth 是可变 stub：默认 user=null（保持既有未登录用例行为），登录用例 setAuthUser({id}) 覆写。
  useAuth: () => ({
    get user() { return _authState.user },
    get session() { return null },
    signOut: vi.fn(),
  }),
}))
// supabase mock：默认所有 from().* 返空/成功。个别用例覆写 upsert 报错测 4c 兜底。
const _supabaseStub = vi.hoisted(() => ({
  upsertResHandler: vi.fn().mockResolvedValue({ error: null }),
}))
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) })),
      })),
      upsert: (payload: unknown, opts?: unknown) => _supabaseStub.upsertResHandler(payload, opts),
    })),
  },
}))
vi.mock('../../composables/domain/useSyncHistory.js', () => ({
  // 直接走真实 _getUserId 不行（它会依赖 useAuth mock）——重新导出一个走 _authState 的版本
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
// flushSaveAppData 默认成功；个别用例 spy 改返失败测回滚
vi.mock('../../stores/app.js', () => ({
  flushSaveAppData: vi.fn().mockResolvedValue(true),
  debouncedSaveAppData: vi.fn(),
  saveAppData: vi.fn(),
}))

import { useE2E } from '../../composables/domain/useE2E.js'
import { useDataStore } from '../../stores/data.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { deriveKey, encrypt, decryptForDisplay, isThreePartCipher, verifyCanary } from '../../crypto.js'
import { flushSaveAppData } from '../../stores/app.js'
import { subscribeRealtime, unsubscribeRealtime } from '../../composables/domain/useSyncRealtime.js'
// vi.mock 后 import 的符号，TS 静态类型取自真实模块签名（普通函数），
// 但运行时是 vi.Mock。cast 成 vi.Mock 让 .mockClear/.mockResolvedValue/.mock 可见，
// 不改任何测试逻辑。
import { enqueueDirtyAsOps, pushFromQueue } from '../../composables/domain/syncPush.js'

const enqueueDirtyAsOpsMock = enqueueDirtyAsOps as unknown as ReturnType<typeof vi.fn>
const pushFromQueueMock = pushFromQueue as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.isBiometricEnrolled = false
  _e2eState.cryptoKey = null
  _e2eState.cloudCanaryStale = false
  _authState.user = null // 默认未登录（保持既有用例行为）
  _supabaseStub.upsertResHandler.mockResolvedValue({ error: null }) // 默认 canary 云端写成功
  vi.mocked(flushSaveAppData).mockResolvedValue(true)
  vi.mocked(subscribeRealtime).mockClear?.()
  vi.mocked(unsubscribeRealtime).mockClear?.()
  vi.mocked(enqueueDirtyAsOps).mockClear?.()
  vi.mocked(pushFromQueue).mockClear?.()
  vi.mocked(pushFromQueue).mockResolvedValue(true)
})

/** 登录态用例切 mock：设 user.id 让 _getUserId 返非 null（_reencryptCloudPush 不早退） */
function setAuthUser(id = 'user-login-1') { _authState.user = { id } }

/** 读取本地 canaryData 直接断言（不经 _getCanaryData） */
function localCanary(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem('lv_e2e_canary') || '{}')
}

describe('useE2E.changeMasterPassword 数据层重加密', () => {
  it('成功：旧密文全部重加密，新 key 可解，password 升级为 newKey 对象', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw', 'RK-AAAA-BBBB-CCCC-DDDD-EEEE')
    expect(e2e.isUnlocked.value).toBe(true)
    const oldKey = _e2eState.cryptoKey!

    // 用旧 key 加密 bookmark.username/notes + password 三段串（存对象）
    const cipherUser = await encrypt('机密用户名', oldKey)
    const cipherNotes = await encrypt('私密笔记', oldKey)
    const cipherPwStr = await encrypt('p@ssw0rd', oldKey)
    const [salt, iv, data] = cipherPwStr.split('.')
    const encPw = { encrypted: true as const, salt, iv, data }

    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: cipherUser, password: encPw,
      notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    ds.addGroup({
      id: 'g1', name: await encrypt('组名', oldKey), categoryId: CAT_UNCATEGORIZED, icon: '',
      order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: await encrypt('组笔记', oldKey),
      useCount: 0, updatedAt: 1,
    } as any)

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)

    // 内存形态：username/notes 明文（push 时才加密），password 是 newKey 对象
    const b = ds.bookmarkMap['b1']
    expect(b.username).toBe('机密用户名')
    expect(b.notes).toBe('私密笔记')
    const pw = b.password as { encrypted: true; salt: string; iv: string; data: string }
    expect(pw.encrypted).toBe(true)
    expect(isThreePartCipher(`${pw.salt}.${pw.iv}.${pw.data}`)).toBe(true)

    // new key 可解 password 三段串
    const newCanary = localCanary()
    const newKey = await deriveKey('new-master-pw-9', new Uint8Array(newCanary.salt as number[]), newCanary.it as number)
    const plainPw = await decryptForDisplay(`${pw.salt}.${pw.iv}.${pw.data}`, newKey)
    expect(plainPw).toBe('p@ssw0rd')

    // 组也重加密
    expect(ds.groupMap['g1'].name).toBe('组名')
    expect(ds.groupMap['g1'].notes).toBe('组笔记')

    // cryptoKey 已切到 newKey：用当前 cryptoKey 解新 canary 能通、用旧 key 解新 canary 解不开
    expect(await verifyCanary(newCanary.canary as string, _e2eState.cryptoKey!)).toBe(true)
    expect(await verifyCanary(newCanary.canary as string, oldKey)).toBe(false)
  }, 20000)

  it('旧密码错误（未解锁态）：verifyCanary 失败返回 false，store/canary/canary 未改', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw')
    const oldKey = _e2eState.cryptoKey!
    const cipherNotes = await encrypt('私密笔记', oldKey)
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: '', password: '',
      notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    const canaryBefore = localCanary()

    e2e.lock()
    const ok = await e2e.changeMasterPassword('wrong-old-pw', 'new-master-pw-9')
    expect(ok).toBe(false)
    // store 未动：notes 仍是旧密文
    expect(ds.bookmarkMap['b1'].notes).toBe(cipherNotes)
    // canary 未改
    expect(localCanary()).toEqual(canaryBefore)
    // cryptoKey 仍 null（lock 后未恢复）
    expect(_e2eState.cryptoKey).toBeNull()
  }, 15000)

  it('脏三段串（oldKey 也解不开）：保留原样不抛错、不二次加密', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw')
    const dirty = 'AAAA.BBBB.CCCC' // isThreePartCipher 真但非本系统密文，oldKey 解不开返 ''
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: dirty, password: '',
      notes: '正常明文笔记', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)
    // 脏三段串保留原样
    expect(ds.bookmarkMap['b1'].username).toBe(dirty)
    // 明文笔记原样（本就明文）
    expect(ds.bookmarkMap['b1'].notes).toBe('正常明文笔记')
  }, 15000)

  it('password 是旧 base64 string → 升级为 newKey EncryptedPassword 对象', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw')
    // 旧 base64 密码（safeDecodePassword 不需 key）
    const oldBase64 = btoa('legacy-password')
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: '', password: oldBase64,
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)
    const pw = ds.bookmarkMap['b1'].password as { encrypted: true; salt: string; iv: string; data: string }
    expect(pw.encrypted).toBe(true)
    // newKey 可解回 legacy-password
    const newCanary = localCanary()
    const newKey = await deriveKey('new-master-pw-9', new Uint8Array(newCanary.salt as number[]), newCanary.it as number)
    const plain = await decryptForDisplay(`${pw.salt}.${pw.iv}.${pw.data}`, newKey)
    expect(plain).toBe('legacy-password')
  }, 15000)

  it('IDB 写失败：回滚 _setKey(oldKey)、store 还原原密文引用、canary 未改', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw')
    const oldKey = _e2eState.cryptoKey!
    const cipherNotes = await encrypt('私密笔记', oldKey)
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: '', password: '',
      notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    const canaryBefore = localCanary()

    // 已 unlock 态调 changePw：oldPw 空串 "";
    vi.mocked(flushSaveAppData).mockResolvedValue(false)

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(false)
    // store 还原：notes 仍是旧密文（非明文）
    expect(ds.bookmarkMap['b1'].notes).toBe(cipherNotes)
    // canary 未改
    expect(localCanary()).toEqual(canaryBefore)
    // cryptoKey 复位为 oldKey
    expect(_e2eState.cryptoKey).toBe(oldKey)
  }, 15000)

  it('canaryData 只更新主密码字段，recovery_* 复用旧值（不改 recovery key）', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('old-master-pw', 'RK-AAAA-BBBB-CCCC-DDDD-EEEE')
    const canaryBefore = localCanary()
    expect(canaryBefore.recovery_canary).toBeTruthy()
    expect(canaryBefore.recovery_salt).toBeTruthy()

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)

    const after = localCanary()
    // 主密码三件套已换
    expect(after.canary).not.toEqual(canaryBefore.canary)
    expect(after.salt).not.toEqual(canaryBefore.salt)
    // recovery_* 复用旧值
    expect(after.recovery_canary).toEqual(canaryBefore.recovery_canary)
    expect(after.recovery_salt).toEqual(canaryBefore.recovery_salt)
    expect(after.recovery_it).toEqual(canaryBefore.recovery_it)
  }, 15000)

  it('已 unlock 态：oldPw 空串复用全局 cryptoKey，无需再输旧密码', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw')
    const oldKey = _e2eState.cryptoKey!
    const cipherNotes = await encrypt('私密', oldKey)
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: '', password: '',
      notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    // 不 lock，直接空旧密码调
    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)
    // 重加密成功
    expect(ds.bookmarkMap['b1'].notes).toBe('私密')
  }, 15000)

  it('未解锁态 oldPw 空串：返回 false（无法派生 oldKey）', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('old-master-pw')
    e2e.lock()
    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(false)
  }, 15000)

  it('新密码 < 8 位返回 false', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('old-master-pw')
    const ok = await e2e.changeMasterPassword('', 'short')
    expect(ok).toBe(false)
  }, 15000)

  it('updatedAt 被 bump（保证远端 isRemoteNewer）', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw')
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 100,
    } as any)
    ds.addGroup({
      id: 'g1', name: 'g', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0, isExpanded: false,
      attributes: {}, bookmarkIds: [], notes: '', useCount: 0, updatedAt: 100,
    } as any)

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)
    expect(ds.bookmarkMap['b1'].updatedAt).toBeGreaterThan(100)
    expect(ds.groupMap['g1'].updatedAt).toBeGreaterThan(100)
  }, 15000)

  it('未登录场景：_reencryptCloudPush 早退不崩，changePw 仍成功落本地', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw')
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)
    // 未登录 _reencryptCloudPush 早退（_getUserId 返 null）→ 不调 pushFromQueue/enqueueDirtyAsOps
    expect(ds.bookmarkMap['b1'].username).toBe('')
    // 此用例确认未登录场景不崩；登录场景的 push 标记由 syncPushPull 覆盖
    const { enqueueDirtyAsOps, pushFromQueue } = await import('../../composables/domain/syncPush.js')
    expect(enqueueDirtyAsOps).not.toHaveBeenCalled()
    expect(pushFromQueue).not.toHaveBeenCalled()
  }, 15000)

  it('明确无双重加密：username/notes 内存存明文（被 push 时 encryptItem 加密一次）', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await e2e.setupMasterPassword('old-master-pw')
    const oldKey = _e2eState.cryptoKey!
    const cipherUser = await encrypt('明文用户名', oldKey)
    const cipherNotes = await encrypt('明文笔记', oldKey)
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: cipherUser, password: '',
      notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)
    // 内存是明文（不是密文、不是「密文的密文」）→ 验证无双重加密
    const b = ds.bookmarkMap['b1']
    expect(b.username).toBe('明文用户名')
    expect(b.notes).toBe('明文笔记')
    // 三段密文形态绝不在 username/notes 里（新 key 也好旧 key 也好，都不是密文）
    expect(isThreePartCipher(b.username)).toBe(false)
    expect(isThreePartCipher(b.notes)).toBe(false)
  }, 15000)
})

describe('useE2E.changeMasterPassword 登录态云端链路（push 失败 / realtime 回声 / canary 云端写失败兜底）', () => {
  /** 登录态预置：setup + 一条密文 bookmark，setAuthUser 切登录 */
  async function loginSetup(e2e: ReturnType<typeof useE2E>, ds: ReturnType<typeof useDataStore>) {
    await e2e.setupMasterPassword('old-master-pw')
    const oldKey = _e2eState.cryptoKey!
    const cipherNotes = await encrypt('私密笔记登录态', oldKey)
    ds.addBookmark({
      id: 'b1', title: 't', url: 'https://a.example', username: '', password: '',
      notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    setAuthUser() // 切登录态：_getUserId 返非 null，_reencryptCloudPush 不再早退
  }

  it('⑦ push 失败：changeMasterPassword 仍返 true（本地+IDB 已成功）、本地已切 newKey，canary 仍覆盖（步骤9无条件）', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await loginSetup(e2e, ds)
    // _reencryptCloudPush 内 withLock → pushFromQueue 返 false（模拟云端不可达/部分失败）
    vi.mocked(pushFromQueue).mockResolvedValue(false)

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    // 不回滚：本机重加密已落 IDB 成功，push 失败的 op 据 _reencryptCloudPush 注释留 syncOps 队列下次 online 重试
    expect(ok).toBe(true)
    // 本地已切 newKey：notes 被解回明文（oldKey 解 → newKey 重加在 push 时发生，内存存明文）
    expect(ds.bookmarkMap['b1'].notes).toBe('私密笔记登录态')
    // canary 仍被覆盖（步骤 9 无条件，与 push 成败解耦）——旧主密码已无法验通
    const newCanary = localCanary()
    const newKey = await deriveKey('new-master-pw-9', new Uint8Array(newCanary.salt as number[]), newCanary.it as number)
    expect(await verifyCanary(newCanary.canary as string, newKey)).toBe(true)
    expect(await verifyCanary(newCanary.canary as string, await deriveKey('old-master-pw', new Uint8Array(newCanary.salt as number[]), newCanary.it as number))).toBe(false)
    // push 链路确被调用（未早退）
    expect(vi.mocked(enqueueDirtyAsOps)).toHaveBeenCalled()
    expect(vi.mocked(pushFromQueue)).toHaveBeenCalled()
    // canary 云端写成功（默认 stub）→ 未置 stale
    expect(_e2eState.cloudCanaryStale).toBe(false)
  }, 20000)

  it('⑨ realtime 回声清洗：_reencryptCloudPush 先 unsubscribe 后无条件 re-subscribe（即使 push 失败 finally 仍恢复）', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await loginSetup(e2e, ds)
    vi.mocked(pushFromQueue).mockResolvedValue(false) // push 失败

    await e2e.changeMasterPassword('', 'new-master-pw-9')

    const unsub = vi.mocked(unsubscribeRealtime)
    const sub = vi.mocked(subscribeRealtime)
    // 先 unsubscribe 后 subscribe：unsubscribe 的调用序早于 subscribe
    expect(unsub).toHaveBeenCalled()
    expect(sub).toHaveBeenCalled()
    const unsubOrder = unsub.mock.invocationCallOrder[0]
    const subOrder = sub.mock.invocationCallOrder[0]
    expect(unsubOrder).toBeLessThan(subOrder)
    // subscribe 用 pullChanges（防回声期后恢复实时推送）——mock 收到的实参是函数
    expect(typeof sub.mock.calls[0][0]).toBe('function')
  }, 20000)

  it('4c canary 云端写失败：置 cloudCanaryStale=true 提示 UI 引导其他设备 reset；本机仍成功且本地 canary 已写', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await loginSetup(e2e, ds)
    // supabase upsert reject → _saveCanaryData 返 false（_saveCanaryData 内 .then(r=>!r.error) catch→false）
    _supabaseStub.upsertResHandler.mockRejectedValue(new Error('cloud down'))

    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true) // 本机重加密成功，不因 canary 云端失败回滚
    expect(_e2eState.cloudCanaryStale).toBe(true) // 触发 UI 强提示标记
    // 本地 canary 仍写成功（_saveCanaryData 总先写本地）——本机用新主密码可正常 unlock
    const localC = localCanary()
    expect(localC.canary).toBeTruthy()
    expect(localC.salt).toBeTruthy()
    const newKey = await deriveKey('new-master-pw-9', new Uint8Array(localC.salt as number[]), localC.it as number)
    expect(await verifyCanary(localC.canary as string, newKey)).toBe(true)
  }, 20000)

  it('canary 云端写成功后 stale 清零：先前 stale 过、再成功改密码应复位', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    await loginSetup(e2e, ds)
    _e2eState.cloudCanaryStale = true // 模拟先前曾 stale

    // 本次云端写成功（默认 stub）
    const ok = await e2e.changeMasterPassword('', 'new-master-pw-9')
    expect(ok).toBe(true)
    expect(_e2eState.cloudCanaryStale).toBe(false)
  }, 20000)
})

/**
 * 修复：unlock 成功后应触发 enqueueDirtyAsOps + pushFromQueue，清空锁定期间积压队列。
 *
 * 根因：锁定态下带敏感字段的 upsert op 被 pushFromQueue 静默跳过留 syncOps 队列，
 * unlock 前 key 不在内存推不上去；原 unlock() 只补解密、不发 push，队列要等下次
 * autoSync tick / 可见性回前台才被动推（autoSync 关掉的用户压根不会被推），徽章长期
 * 显「N 项待同步」误导成「同步坏了」。修复：unlock 成功后 fire 一次 push 清队列。
 */
describe('useE2E.unlock 解锁后重推积压队列', () => {
  it('登录态下 unlock 成功后触发 enqueueDirtyAsOps + pushFromQueue（清空锁定积压）', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('master-pw-1')
    setAuthUser() // _getUserId 返非 null，unlock 末尾的发 push 守门通过
    e2e.lock() // 锁定：key 出内存，模拟锁定期间队列已积压
    expect(e2e.isUnlocked.value).toBe(false)

    enqueueDirtyAsOpsMock.mockClear()
    pushFromQueueMock.mockClear()
    pushFromQueueMock.mockResolvedValue(true)

    const ok = await e2e.unlock('master-pw-1')
    expect(ok).toBe(true)

    // unlock 内 void withLock(push) 是 fire-and-forget，需 flush 让其执行
    await vi.waitFor(() => expect(pushFromQueue).toHaveBeenCalled())
    expect(enqueueDirtyAsOps).toHaveBeenCalled()
    // 时序：enqueue 先于 push（先把内存脏标转成持久 op 再推）
    const enqCall = enqueueDirtyAsOpsMock.mock.invocationCallOrder[0]
    const pushCall = pushFromQueueMock.mock.invocationCallOrder[0]
    expect(enqCall).toBeLessThan(pushCall)
  }, 20000)

  it('未登录（_getUserId 返 null）时 unlock 不触发 push（无云端可推，避免无谓调用）', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('master-pw-1')
    // 不 setAuthUser：_getUserId 返 null
    e2e.lock()
    enqueueDirtyAsOpsMock.mockClear()
    pushFromQueueMock.mockClear()

    const ok = await e2e.unlock('master-pw-1')
    expect(ok).toBe(true)

    // 解密补全仍 await 完成，但 push 相关不应被调
    await new Promise(r => setTimeout(r, 50))
    expect(enqueueDirtyAsOps).not.toHaveBeenCalled()
    expect(pushFromQueue).not.toHaveBeenCalled()
  }, 20000)

  it('unlock 主密码错误（verifyCanary 失败）返 false 且不触发 push', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('master-pw-1')
    setAuthUser()
    e2e.lock()
    enqueueDirtyAsOpsMock.mockClear()
    pushFromQueueMock.mockClear()

    const ok = await e2e.unlock('wrong-password')
    expect(ok).toBe(false)
    expect(enqueueDirtyAsOps).not.toHaveBeenCalled()
    expect(pushFromQueue).not.toHaveBeenCalled()
  }, 20000)
})
