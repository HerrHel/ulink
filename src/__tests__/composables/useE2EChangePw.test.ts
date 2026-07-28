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
    resetLockTimer: () => {},
    initVisibilityLock: () => {},
    lock: () => { _e2eState.isUnlocked = false; _e2eState.cryptoKey = null },
  }),
}))

// mock 云端同步链路：_getUserId 返回 null 让 _reencryptCloudPush 走「未登录」早退，专注测核心重加密
vi.mock('../../composables/domain/useSyncHistory.js', () => ({
  _getUserId: () => null,
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

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.isBiometricEnrolled = false
  _e2eState.cryptoKey = null
  vi.mocked(flushSaveAppData).mockResolvedValue(true)
})

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
