import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { deriveKey, encrypt, decrypt, decryptPasswordWithKey } from '../../crypto.js'
import { useUIStore } from '../../stores/ui.js'
import { setSharePassword } from '../../composables/domain/useSharePassword.js'
import { useE2EStore } from '../../stores/e2e.js'
import { useVaultStore } from '../../stores/vault.js'
import { useAuthStore } from '../../stores/auth.js'
import { useDataStore } from '../../stores/data.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { useVault } from '../../composables/domain/useVault.js'
import { setLocale } from '../../i18n/index.js'
import { purgeAccount } from '../../composables/domain/useAccountDeletion.js'
import { createCloudBaseAuthDriver } from '../../lib/authDriver.js'
import { useBiometric } from '../../composables/domain/useBiometric.js'
import { useVaultBiometric } from '../../composables/domain/useVaultBiometric.js'
import { useSpaceMove } from '../../composables/domain/useSpaceMove.js'
import { openBmModal, saveBm, bmForm } from '../../composables/domain/useBookmark.js'
import { editGroup, saveGroupEdit, saveGroupBody, geForm } from '../../composables/domain/useGroup.js'
import { useInlineRename } from '../../composables/ui/useInlineRename.js'

// Mock supabase / dbApi / cloudbase
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
    auth: {
      signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
      verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: {}, error: null })),
      sendPasswordReset: vi.fn(async () => ({ data: {}, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'fake-token' } } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    },
  },
}))

vi.mock('../../lib/cloudbase.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    isCloudBaseBackend: () => true,
    edgeFnUrl: () => 'https://mock.cloudbase.net/account',
  }
})

describe('模块 4 审计修复专项回归套件 — 安全认证、E2E 与权限隔离', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    setLocale('zh-CN')
  })

  it('缺陷 1 & 2：authStore 双语错误与 signOut 深度清理', async () => {
    const auth = useAuthStore()
    const e2eStore = useE2EStore()
    const vaultStore = useVaultStore()

    e2eStore.setUnlocked(true)
    vaultStore.setUnlocked(true)

    setLocale('en-US')

    const ok = await auth.confirmSetPassword('test@example.com', '123456', 'short')
    expect(ok).toBe(false)
    expect(auth.authError).toContain('Password must be between 8 and 32 characters')

    const ok2 = await auth.confirmSetPassword('test@example.com', '   ', 'Valid123456')
    expect(ok2).toBe(false)
    expect(auth.authError).toContain('Please enter the verification code')

    await auth.signOut()
    expect(auth.user).toBeNull()
    expect(auth.session).toBeNull()
    expect(e2eStore.isUnlocked).toBe(false)
    expect(vaultStore.isVaultUnlocked).toBe(false)
  })

  it('缺陷 3：deriveKey 对对象/数组类型 Salt 具备防御性兼容', async () => {
    const rawSalt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    const arraySalt = Array.from(rawSalt)
    const objSalt = { ...arraySalt }

    const key1 = await deriveKey('password123', rawSalt, 1000)
    const key2 = await deriveKey('password123', arraySalt, 1000)
    const key3 = await deriveKey('password123', objSalt, 1000)

    expect(key1).toBeDefined()
    expect(key2).toBeDefined()
    expect(key3).toBeDefined()

    const cipher = await encrypt('hello-ulink', key1)
    const plain = await decrypt(cipher, key3)
    expect(plain).toBe('hello-ulink')
  })

  it('缺陷 4：e2eStore.lock() 清空并拒绝 pendingUnlock 队列', async () => {
    const e2eStore = useE2EStore()
    const results: boolean[] = []

    const p1 = new Promise<boolean>(resolve => e2eStore.pendingUnlock.push(resolve)).then(ok => {
      results.push(ok)
      return ok
    })
    const p2 = new Promise<boolean>(resolve => e2eStore.pendingUnlock.push(resolve)).then(ok => {
      results.push(ok)
      return ok
    })

    expect(e2eStore.pendingUnlock.length).toBe(2)

    e2eStore.lock()

    expect(e2eStore.pendingUnlock.length).toBe(0)
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe(false)
    expect(r2).toBe(false)
    expect(results).toEqual([false, false])
  })

  it('缺陷 5：CloudBase 驱动中 pending 与 resetPending 的 TTL 清理机制', async () => {
    vi.useFakeTimers()
    try {
      const mockVerify = vi.fn(async () => ({ error: null }))
      const mockCb = {
        signInWithOtp: vi.fn(async () => ({
          data: { verifyOtp: mockVerify },
          error: null,
        })),
      } as any
      const driver = createCloudBaseAuthDriver(mockCb)

      // 发送验证码，存入 pending
      await driver.sendOtp('test@example.com')

      // 在 TTL（10 分钟）之内验证：成功
      vi.advanceTimersByTime(5 * 60 * 1000)
      const res1 = await driver.verifyOtp('test@example.com', '123456')
      expect(res1.error).toBeNull()
      expect(mockVerify).toHaveBeenCalledWith({ token: '123456' })

      // 再次发送验证码，然后时间推进超过 10 分钟（过期）
      await driver.sendOtp('test@example.com')
      vi.advanceTimersByTime(11 * 60 * 1000)

      // 验证时由于已过期，应直接被阻断并提示重新获取
      const res2 = await driver.verifyOtp('test@example.com', '654321')
      expect(res2.error?.message).toContain('验证码已失效，请重新获取')
    } finally {
      vi.useRealTimers()
    }
  })

  it('缺陷 6：resetWithRecoveryKey 成功后放行 pendingUnlock 队列（true）', async () => {
    const e2e = useE2E()
    const e2eStore = useE2EStore()

    const rk = e2e.generateRecoveryKey()
    const setupOk = await e2e.setupMasterPassword('oldPassword123', rk)
    expect(setupOk).toBe(true)

    e2e.lock()
    expect(e2eStore.isUnlocked).toBe(false)

    let unlockedResult = false
    e2eStore.pendingUnlock.push((ok) => {
      unlockedResult = ok
    })
    expect(e2eStore.pendingUnlock.length).toBe(1)

    const ok = await e2e.resetWithRecoveryKey(rk, 'newPassword456')
    expect(ok).toBe(true)
    expect(e2eStore.isUnlocked).toBe(true)
    expect(unlockedResult).toBe(true)
    expect(e2eStore.pendingUnlock.length).toBe(0)
  })

  it('缺陷 7：decryptStoreItems 解密遗留密文后记录 _changedFields', async () => {
    const e2e = useE2E()
    const ds = useDataStore()

    const rk = e2e.generateRecoveryKey()
    await e2e.setupMasterPassword('myPassword123', rk)

    const key = useE2EStore().cryptoKey as unknown as CryptoKey
    expect(key).toBeDefined()

    const cipherTitle = await encrypt('My Legacy Title', key)
    ds.bookmarks = [
      {
        id: 'bm-legacy',
        title: cipherTitle,
        url: 'https://example.com',
        categoryId: 'cat1',
        createdAt: 1000,
        updatedAt: 1000,
      } as any,
    ]

    await e2e.decryptStoreItems()

    expect(ds.bookmarks[0].title).toBe('My Legacy Title')
    expect(ds._dirtyIds.has('bm-legacy')).toBe(true)
    expect(ds._changedFields.get('bm-legacy')?.has('title')).toBe(true)
  })

  it('缺陷 8：changeMasterPassword 对 bookmarks 的 title/url 及 categories 的 name 重解密', async () => {
    const e2e = useE2E()
    const ds = useDataStore()

    const rk = e2e.generateRecoveryKey()
    await e2e.setupMasterPassword('initialPassword123', rk)

    const oldKey = useE2EStore().cryptoKey as unknown as CryptoKey
    expect(oldKey).toBeDefined()

    const cipherTitle = await encrypt('Secret Title', oldKey)
    const cipherUrl = await encrypt('https://secret.url', oldKey)
    const cipherCat = await encrypt('Secret Category', oldKey)

    ds.bookmarks = [
      {
        id: 'b1',
        title: cipherTitle,
        url: cipherUrl,
        username: 'admin',
        notes: '',
        categoryId: 'c1',
        createdAt: 1000,
        updatedAt: 1000,
      } as any,
    ]
    ds.categories = [
      {
        id: 'c1',
        name: cipherCat,
        updatedAt: 1000,
      } as any,
    ]

    const ok = await e2e.changeMasterPassword('initialPassword123', 'brandNewPassword456')
    expect(ok).toBe(true)

    expect(ds.bookmarks[0].title).toBe('Secret Title')
    expect(ds.bookmarks[0].url).toBe('https://secret.url')
    expect(ds.categories[0].name).toBe('Secret Category')
  })

  it('缺陷 9：_saveCanaryData 在本地写失败时正确返回 false', async () => {
    const e2e = useE2E()
    const vault = useVault()

    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    try {
      const rk = e2e.generateRecoveryKey()
      const e2eResult = await e2e.setupMasterPassword('testPass123', rk)
      expect(e2eResult).toBe(false)

      const vaultRk = vault.generateRecoveryKey()
      const vaultResult = await vault.setupVaultPassword('testPass123', vaultRk)
      expect(vaultResult).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('缺陷 11：purgeAccount 清空 E2E、Vault 密钥与 Pinia 数据内存', async () => {
    const e2eStore = useE2EStore()
    const vaultStore = useVaultStore()
    const ds = useDataStore()

    e2eStore.setUnlocked(true)
    vaultStore.setUnlocked(true)
    ds.bookmarks = [{ id: 'b1', title: 'test', url: 'https://test.com' } as any]

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: true, dataDeleted: true }),
      json: async () => ({ ok: true, dataDeleted: true }),
    })) as any

    try {
      const res = await purgeAccount()
      expect(res.ok).toBe(true)

      expect(e2eStore.isUnlocked).toBe(false)
      expect(vaultStore.isVaultUnlocked).toBe(false)
      expect(ds.bookmarks.length).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
  it('缺陷 12：decryptPasswordWithKey 适配 3 段密文字符串形态（锁定返空，解锁解密）', async () => {
    const salt = new Uint8Array(32).fill(1)
    const key = await deriveKey('master-pw', salt, 100)
    const cipher = await encrypt('my-secret-password', key)

    // 锁定态（key 为 null）：三段密文不应外泄，应返回空串
    const lockedRes = await decryptPasswordWithKey(cipher, null)
    expect(lockedRes).toBe('')

    // 解锁态（传入 key）：正确解密为明文
    const unlockedRes = await decryptPasswordWithKey(cipher, key)
    expect(unlockedRes).toBe('my-secret-password')
  })

  it('缺陷 13：deriveKey 对非法/非正整数 iterations 健壮回退，不崩溃', async () => {
    const salt = new Uint8Array(32).fill(2)
    const key1 = await deriveKey('pw', salt, 0 as any)
    expect(key1).toBeTruthy()

    const key2 = await deriveKey('pw', salt, -10 as any)
    expect(key2).toBeTruthy()

    const key3 = await deriveKey('pw', salt, NaN as any)
    expect(key3).toBeTruthy()
  })

  it('缺陷 14：changeMasterPassword 清理已录入的生物识别指纹凭据', async () => {
    const e2e = useE2E()
    const e2eStore = useE2EStore()
    e2eStore.setBiometricEnrolled(true)
    expect(e2eStore.isBiometricEnrolled).toBe(true)

    const rk = e2e.generateRecoveryKey()
    await e2e.setupMasterPassword('old-password-1', rk)
    expect(e2eStore.isUnlocked).toBe(true)

    // 修改主密码
    const ok = await e2e.changeMasterPassword('', 'new-password-2')
    expect(ok).toBe(true)

    // 指纹凭据应被安全清除，防止持旧密码凭据永久死锁
    expect(e2eStore.isBiometricEnrolled).toBe(false)
  })

  it('缺陷 15：setSharePassword 前置拦截过短密码（<6 字符）返回 weak_password', async () => {
    const res = await setSharePassword('g1', '123')
    expect(res.ok).toBe(false)
    expect(res.error).toBe('weak_password')
  })

  it('缺陷 16：signOut 在私密空间时自动切回主页空间并清除冲突检查标记', async () => {
    const auth = useAuthStore()
    const ui = useUIStore()

    sessionStorage.setItem('lv_e2e_canary_conflict_checked', '1')
    ui.curSpace = 'vault'

    await auth.signOut()

    expect(ui.curSpace).toBe('main')
    expect(sessionStorage.getItem('lv_e2e_canary_conflict_checked')).toBeNull()
  })

  it('缺陷 20：useBiometric 与 useVaultBiometric 在本地 stored 异常时优雅返回 null，不抛未捕获异常', async () => {
    localStorage.setItem('lv_biometric', JSON.stringify({ credentialId: '@@bad_base64@@', prfSalt: '@@bad_base64@@' }))
    const bio = useBiometric()
    const bioResult = await bio.unlockWithBiometric()
    expect(bioResult).toBeNull()

    localStorage.setItem('lv_vault_biometric', JSON.stringify({ credentialId: '@@bad_base64@@', prfSalt: '@@bad_base64@@' }))
    const vaultBio = useVaultBiometric()
    const vaultBioResult = await vaultBio.unlockWithBiometric()
    expect(vaultBioResult).toBeNull()
  })

  it('缺陷 21-23：useSpaceMove 在 E2E 锁定时全面拦截含密文字段（包括加密密码、跨分类引用、组密文）的迁移', async () => {
    const ds = useDataStore()
    const ui = useUIStore()
    const e2eStore = useE2EStore()
    const spaceMove = useSpaceMove()

    ui.curSpace = 'main'
    e2eStore.isE2EEnabled = true
    e2eStore.isUnlocked = false

    const salt = new Uint8Array(32).fill(1)
    const key = await deriveKey('pass', salt, 100)
    const validCipher = await encrypt('secret', key)

    // 1. 书签含 EncryptedPassword 对象
    ds.addBookmark({
      id: 'b_enc_obj',
      title: 'Normal Title',
      url: 'https://example.com/1',
      password: { encrypted: true, salt: 's', iv: 'i', data: 'd' },
      categoryId: 'cat1',
    } as any)
    ds._syncMaps()

    await spaceMove.moveBookmarksToVault(['b_enc_obj'])
    expect(ds.bookmarkMap['b_enc_obj']).toBeDefined() // 拦截迁移，原书签保留

    // 2. 书签含三段密文字符串密码
    ds.addBookmark({
      id: 'b_enc_str',
      title: 'Normal Title 2',
      url: 'https://example.com/2',
      password: validCipher,
      categoryId: 'cat1',
    } as any)
    ds._syncMaps()

    await spaceMove.moveBookmarksToVault(['b_enc_str'])
    expect(ds.bookmarkMap['b_enc_str']).toBeDefined() // 拦截迁移

    // 3. 组含密文字段
    ds.addBookmark({
      id: 'b_plain_in_group',
      title: 'Plain Title',
      url: 'https://example.com/3',
      categoryId: 'cat1',
    } as any)
    ds.siblingGroups = [
      {
        id: 'g_cipher',
        name: 'Normal Group',
        categoryId: 'cat1',
        bookmarkIds: ['b_plain_in_group'],
        notes: validCipher,
      } as any,
    ]
    ds._syncMaps()

    await spaceMove.moveGroupsToVault(['g_cipher'])
    expect(ds.groupMap['g_cipher']).toBeDefined() // 拦截迁移

    // 4. moveCategoryToVault 跨分类收集到的书签含密文字段
    ds.addBookmark({
      id: 'b_cross_cat',
      title: 'Cross Cat Title',
      url: 'https://example.com/4',
      categoryId: 'other_cat',
      notes: validCipher,
    } as any)
    ds.categories = [{ id: 'cat_move', name: 'Cat Move', order: 1 } as any]
    ds.siblingGroups = [
      {
        id: 'g_in_cat',
        name: 'Group in Cat',
        categoryId: 'cat_move',
        bookmarkIds: ['b_cross_cat'],
      } as any,
    ]
    ds._syncMaps()

    await spaceMove.moveCategoryToVault('cat_move')
    expect(ds.categoryMap['cat_move']).toBeDefined() // 拦截迁移
  })

  it('缺陷 24：useE2E().encryptField 幂等防重：对已加密的三段密文原样返回', async () => {
    const e2e = useE2E()
    const rk = e2e.generateRecoveryKey()
    await e2e.setupMasterPassword('test-password-field', rk)

    const cipher = await e2e.encryptField('plaintext-content')
    expect(cipher.split('.').length).toBe(3)

    // 对已加密密文再次调用 encryptField，应幂等直接返回，不生成嵌套密文
    const reCipher = await e2e.encryptField(cipher)
    expect(reCipher).toBe(cipher)
  })

  it('缺陷 25 & 26：useBookmark 在 E2E 锁定状态下的安全保护（三段密文密码防乱码回显、防覆盖原加密密码）', async () => {
    const ds = useDataStore()
    const e2eStore = useE2EStore()

    e2eStore.isE2EEnabled = true
    e2eStore.lock()

    const salt = new Uint8Array(32).fill(2)
    const key = await deriveKey('pass', salt, 100)
    const validCipher = await encrypt('super-secret-password', key)

    // 书签存有三段密文密码
    ds.addBookmark({
      id: 'bm_e2e_locked',
      title: 'Original Title',
      url: 'https://test.com/login',
      password: validCipher,
      categoryId: 'all',
    } as any)
    ds._syncMaps()

    // 1. openBmModal: 自动入队 pendingUnlock，并且在未解锁时不将密文裸字符串作为明文填入 bmForm.password
    let modalOpened = false
    const openPromise = openBmModal('bm_e2e_locked').then(() => {
      modalOpened = true
    })

    expect(e2eStore.pendingUnlock.length).toBe(1)
    expect(modalOpened).toBe(false)

    // 取消解锁
    const resolver = e2eStore.pendingUnlock.pop()!
    resolver(false)
    await openPromise

    expect(bmForm.password).toBe('') // 绝不泄露三段密文字符串到编辑框

    // 2. saveBm: 锁定态下编辑书签其他字段，原加密密码绝不能被置空覆盖
    bmForm.title = 'Updated Title Without Password'
    await saveBm()

    // 校验：由于原书签含有未解锁的加密密码，保存被阻止，原书签保持不变
    expect(ds.bookmarkMap['bm_e2e_locked'].title).toBe('Original Title')
    expect(ds.bookmarkMap['bm_e2e_locked'].password).toBe(validCipher)
  })

  it('缺陷 28：e2eStore & vaultStore 在未解锁状态下调用 resetLockTimer() 不启动空转定时器', () => {
    const e2eStore = useE2EStore()
    const vaultStore = useVaultStore()

    e2eStore.lock()
    vaultStore.lock()

    // 在未解锁状态下重置锁定时钟，不应起定时器
    e2eStore.resetLockTimer()
    vaultStore.resetLockTimer()

    // 状态保持未解锁，无异常
    expect(e2eStore.isUnlocked).toBe(false)
    expect(vaultStore.isVaultUnlocked).toBe(false)
  })

  it('缺陷 29：dataActionsIO.switchSpace 并发/重入互斥防护', async () => {
    const ds = useDataStore()
    const ui = useUIStore()

    ui.curSpace = 'main'
    await Promise.all([
      ds.switchSpace('vault'),
      ds.switchSpace('vault'),
    ])

    expect(ui.curSpace).toBe('vault')
  })

  it('缺陷 31 & 32：authStore 与 CloudBase authDriver 邮箱大小写规范化', async () => {
    const auth = useAuthStore()

    // 1. authStore limits 规范化
    // verifyOtp 失败 5 次触发锁
    for (let i = 0; i < 5; i++) {
      await auth.verifyOtp('User@Domain.COM', '000000')
    }
    // 查询大小写不同的邮箱，应当同样处于锁定状态（verifyLockRemaining > 0）
    expect(auth.verifyLockRemaining('user@domain.com')).toBeGreaterThan(0)
    expect(auth.verifyLockRemaining('USER@DOMAIN.COM')).toBeGreaterThan(0)

    // 成功后重置
    auth.resetVerifyState('User@Domain.COM')
    expect(auth.verifyLockRemaining('user@domain.com')).toBe(0)

    // 2. CloudBase driver pending map 规范化
    let verifyCalled = false
    const mockAuthObj = {
      signInWithOtp: vi.fn(async () => ({
        data: {
          verifyOtp: async () => {
            verifyCalled = true
            return { error: null }
          },
        },
        error: null,
      })),
    }
    const driver = createCloudBaseAuthDriver(mockAuthObj as any)
    await driver.sendOtp('User@Company.COM')
    // 用全小写邮箱验证，应当能够命中 pending 记录
    const verifyRes = await driver.verifyOtp('user@company.com', '123456')
    expect(verifyRes.error).toBeNull()
    expect(verifyCalled).toBe(true)
  })


  it('缺陷 35 & 36：useGroup.saveGroupBody 与 saveGroupEdit 在 E2E 锁定时保护密文笔记和组名不被覆盖', async () => {
    const ds = useDataStore()
    const e2eStore = useE2EStore()

    e2eStore.isE2EEnabled = true
    e2eStore.lock()

    const salt = new Uint8Array(32).fill(3)
    const key = await deriveKey('pass', salt, 100)
    const validCipherNotes = await encrypt('<p>Secret Notes</p>', key)
    const validCipherName = await encrypt('Secret Group', key)

    ds.siblingGroups = [
      {
        id: 'g_locked',
        name: validCipherName,
        notes: validCipherNotes,
        categoryId: 'all',
        bookmarkIds: [],
        attributes: {},
      } as any,
    ]
    ds._syncMaps()

    // 1. saveGroupBody: 当 group.notes 为密文时，直接早退，不覆盖原密文
    saveGroupBody('g_locked')
    expect(ds.groupMap['g_locked'].notes).toBe(validCipherNotes)

    // 2. editGroup: 密文名称经 displayText 过滤为 ''，不泄露乱码密文
    editGroup('g_locked')
    expect(geForm.name).toBe('')

    // 3. saveGroupEdit: 锁定时尝试保存修改，被 encryptedBlocked 拦截，原组名和笔记完好
    geForm.name = 'New Plain Name'
    saveGroupEdit()
    expect(ds.groupMap['g_locked'].name).toBe(validCipherName)
    expect(ds.groupMap['g_locked'].notes).toBe(validCipherNotes)
  })

  it('缺陷 37：useInlineRename 行内重命名在 E2E 锁定时保护密文分类名不被覆盖', () => {
    const ds = useDataStore()
    const e2eStore = useE2EStore()

    e2eStore.isE2EEnabled = true
    e2eStore.lock()

    // 伪造一个含三段密文的分类（段长 44.16.24 格式）
    const validCipherName = 'A'.repeat(44) + '.' + 'B'.repeat(16) + '.' + 'C'.repeat(24)
    ds.categories = [
      { id: 'cat_enc', name: validCipherName, order: 0 } as any,
    ]
    ds._syncMaps()

    const inline = useInlineRename(ds as any, 'renameCategory')

    // 1. startRename: displayText 将密文过滤为 ''，输入框不展示长串乱码
    inline.startRename({ id: 'cat_enc', name: validCipherName })
    expect(inline.editingName.value).toBe('')

    // 2. confirmRename: 锁定时尝试覆盖密文名，被拦截阻止
    inline.editingName.value = 'Hacked Name'
    inline.confirmRename()

    expect(ds.categoryMap['cat_enc'].name).toBe(validCipherName)
  })

  it('缺陷 38：CloudBase 驱动 onAuthStateChange 与 signOut 代际隔离防会话复活', async () => {
    let authListener: ((event: string, session: unknown) => void) | null = null
    let resolveGetUser: ((val: any) => void) | null = null

    const mockAuthObj = {
      onAuthStateChange: (cb: any) => {
        authListener = cb
        return { unsubscribe: () => {} }
      },
      getUser: vi.fn(() => new Promise((resolve) => {
        resolveGetUser = resolve
      })),
      signOut: vi.fn(async () => ({ error: null })),
    }

    const driver = createCloudBaseAuthDriver(mockAuthObj as any)
    const emittedSessions: any[] = []
    driver.onAuthStateChange((s) => {
      emittedSessions.push(s)
    })

    // 1. 触发 SIGNED_IN（无昵称，开启 getUser 异步查询）
    authListener!('SIGNED_IN', { id: 'u1', email: 'test@example.com' })
    expect(emittedSessions.length).toBe(1)
    expect(emittedSessions[0]?.user?.email).toBe('test@example.com')

    // 2. 在 getUser 还未 resolve 时，用户点击 signOut
    await driver.signOut()

    // 3. 此时旧的 getUser 终于 resolve
    resolveGetUser!({
      data: {
        user: { id: 'u1', email: 'test@example.com', nickname: 'ResurrectedName' },
      },
    })
    await Promise.resolve()

    // 4. 代际计数改变，旧的 getUser 回调被丢弃，不会向外触发第二次带旧 profile 的 session
    expect(emittedSessions.length).toBe(1)
  })

  it('缺陷 39：CloudBase 驱动所有核心方法在底层抛出异常时安全捕获并返回 error 对象', async () => {
    const erroringAuth = {
      getSession: async () => { throw new Error('Network timeout in getSession') },
      signInWithOtp: async () => { throw new Error('SDK fault in signInWithOtp') },
      signOut: async () => { throw new Error('Network crash in signOut') },
      signInWithPassword: async () => { throw new Error('Network drop in signInWithPassword') },
      resetPasswordForEmail: async () => { throw new Error('Network drop in resetPasswordForEmail') },
      updateUser: async () => { throw new Error('Network drop in updateUser') },
    }
    const erroringDb = {
      rpc: async () => { throw new Error('DB RPC crashed') },
    }

    const driver = createCloudBaseAuthDriver(erroringAuth as any, erroringDb as any)

    const s = await driver.getSession()
    expect(s.session).toBeNull()
    expect(s.error?.message).toContain('Network timeout')

    const otp = await driver.sendOtp('test@test.com')
    expect(otp.error?.message).toContain('SDK fault')

    const so = await driver.signOut()
    expect(so.error?.message).toContain('Network crash')

    const pw = await driver.signInWithPassword('test@test.com', 'pass')
    expect(pw.error?.message).toContain('Network drop')

    const rst = await driver.sendPasswordReset('test@test.com')
    expect(rst.error?.message).toContain('Network drop')

    const up = await driver.updateUserMeta({ display_name: 'Name' })
    expect(up.user).toBeNull()
    expect(up.error?.message).toContain('Network drop')

    const claim = await driver.claimLegacyIdentity()
    expect(claim.claimed).toBe(false)
    expect(claim.error?.message).toContain('DB RPC crashed')
  })

  it('缺陷 40：authStore 会话远程失效/切出时自动锁定 E2E 与 Vault 敏感密钥', async () => {
    let authListener: ((session: any) => void) | null = null
    const mockDriver = {
      getSession: async () => ({ session: { user: { id: 'u-initial', email: 'a@b.com' } } as any, error: null }),
      onAuthStateChange: (cb: any) => { authListener = cb },
    }

    const { __setAuthDriverForTest } = await import('../../lib/authDriver.js')
    __setAuthDriverForTest(mockDriver as any)

    try {
      const auth = useAuthStore()
      const e2eStore = useE2EStore()
      const vaultStore = useVaultStore()

      await auth.init()
      expect(auth.isLoggedIn).toBe(true)

      // 解锁 E2E 与 Vault
      e2eStore.setUnlocked(true)
      vaultStore.setUnlocked(true)

      // 模拟远端 Token 过期或被踢，onAuthStateChange 派发 null
      authListener!(null)

      expect(auth.isLoggedIn).toBe(false)
      // E2E 与 Vault 密钥必须被立即锁定
      expect(e2eStore.isUnlocked).toBe(false)
      expect(vaultStore.isVaultUnlocked).toBe(false)
    } finally {
      __setAuthDriverForTest(null)
    }
  })

  it('缺陷 41：useE2E().unlock(password) 成功时自动放行 pendingUnlock 队列', async () => {
    const e2e = useE2E()
    const e2eStore = useE2EStore()

    const rk = e2e.generateRecoveryKey()
    await e2e.setupMasterPassword('mySecurePassword123', rk)

    e2e.lock()
    expect(e2eStore.isUnlocked).toBe(false)

    let resolvedResult = false
    e2eStore.pendingUnlock.push((ok) => {
      resolvedResult = ok
    })
    expect(e2eStore.pendingUnlock.length).toBe(1)

    // 执行普通解锁
    const ok = await e2e.unlock('mySecurePassword123')
    expect(ok).toBe(true)
    expect(e2eStore.isUnlocked).toBe(true)

    // pendingUnlock 队列中的等待者必须被放行 (true)
    expect(resolvedResult).toBe(true)
    expect(e2eStore.pendingUnlock.length).toBe(0)
  })

  it('缺陷 42：useVault().unlockVault(password) 成功时确保 isVaultEnabled=true 不变量成立', async () => {
    const vault = useVault()
    const vaultStore = useVaultStore()

    await vault.setupVaultPassword('vaultPass1234')
    vault.lockVault()

    // 模拟换设备或刚登录，内存中 isVaultEnabled 曾为 false
    vaultStore.setEnabled(false)
    expect(vaultStore.isVaultEnabled).toBe(false)

    // 解锁保险柜
    const ok = await vault.unlockVault('vaultPass1234')
    expect(ok).toBe(true)
    expect(vaultStore.isVaultUnlocked).toBe(true)
    // 保证「已解锁 = 已启用」不变量
    expect(vaultStore.isVaultEnabled).toBe(true)
  })

  it('缺陷 43：purgeAccount 账号注销时同步清空 undoStore 历史堆栈', async () => {
    const { useUndoStore } = await import('../../stores/undo.js')
    const undoStore = useUndoStore()

    undoStore.ensureStack('g1').undo.push({ notes: 'secret notes', bookmarkIds: [] })
    expect(undoStore.canUndo('g1')).toBe(true)

    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ ok: true, dataDeleted: true }),
      json: async () => ({ ok: true, dataDeleted: true }),
    })) as any

    try {
      const res = await purgeAccount()
      expect(res.ok).toBe(true)
      // 撤销堆栈必须被清空
      expect(undoStore.canUndo('g1')).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('缺陷 44：useVaultBiometric 在 SubtleCrypto 抛出硬件或算法异常时安全降级', async () => {
    const origCredentials = navigator.credentials
    const origSubtle = crypto.subtle

    try {
      const mockCredentials = {
        create: vi.fn(async () => ({
          rawId: new Uint8Array(32),
          getClientExtensionResults: () => ({
            prf: { enabled: true, results: { first: new Uint8Array(32).buffer } },
          }),
        })),
        get: vi.fn(async () => ({
          rawId: new Uint8Array(32),
          getClientExtensionResults: () => ({
            prf: { results: { first: new Uint8Array(32).buffer } },
          }),
        })),
      }
      Object.defineProperty(navigator, 'credentials', {
        value: mockCredentials,
        configurable: true,
        writable: true,
      })

      // 模拟底层 SubtleCrypto importKey 抛出 OperationError (如平台硬件模块暂不可用)
      const mockSubtle = {
        ...crypto.subtle,
        importKey: vi.fn(async () => {
          throw new DOMException('Hardware unavailable', 'OperationError')
        }),
      }
      Object.defineProperty(crypto, 'subtle', {
        value: mockSubtle,
        configurable: true,
        writable: true,
      })

      const vaultBio = useVaultBiometric()

      // enrollBiometric 捕获并返回 false，不向外抛 unhandled rejection
      const enrollRes = await vaultBio.enrollBiometric('mypassword')
      expect(enrollRes).toBe(false)

      // unlockWithBiometric 捕获并返回 null，不崩溃调用栈
      localStorage.setItem('lv_vault_biometric', JSON.stringify({
        credentialId: 'cred-123',
        prfSalt: 'salt-123',
        encrypted: 'enc-data',
      }))
      const unlockRes = await vaultBio.unlockWithBiometric()
      expect(unlockRes).toBeNull()
    } finally {
      Object.defineProperty(navigator, 'credentials', {
        value: origCredentials,
        configurable: true,
        writable: true,
      })
      Object.defineProperty(crypto, 'subtle', {
        value: origSubtle,
        configurable: true,
        writable: true,
      })
    }
  })
})
