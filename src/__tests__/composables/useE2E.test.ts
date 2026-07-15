/**
 * useE2E.test.ts — 解锁补解密回归测试
 *
 * #4 修复：Realtime 在 E2E 未解锁期间推来的远端密文条目，storeItem 仅在 isUnlocked=true
 * 时解密，未解锁那批条目的 title/url/username/notes 停留密文态进 store → 解锁后 UI 乱码。
 * unlock 成功后 decryptStoreItems 扫 store 全部条目对 ENCRYPT_FIELDS 字段补解密。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// e2e store mock 共享 state（不需 reactive——useE2E 用 getter 实时读，plain 对象即可；
// getter 闭包对 plain 对象属性实时返回，无 reactive 也能模拟 isUnlocked 等）。
const _e2eState = vi.hoisted(() => ({ isE2EEnabled: false, isUnlocked: false, cryptoKey: null as CryptoKey | null }))
vi.mock('../../stores/e2e.js', () => ({
  useE2EStore: () => ({
    get isE2EEnabled() { return _e2eState.isE2EEnabled },
    get isUnlocked() { return _e2eState.isUnlocked },
    get cryptoKey() { return _e2eState.cryptoKey },
    get visibilityLocked() { return false },
    setEnabled: (v: boolean) => { _e2eState.isE2EEnabled = v },
    setKey: (k: CryptoKey) => { _e2eState.cryptoKey = k },
    setUnlocked: (v: boolean) => { _e2eState.isUnlocked = v },
    resetLockTimer: () => {},
    initVisibilityLock: () => {},
    lock: () => { _e2eState.isUnlocked = false; _e2eState.cryptoKey = null },
  }),
}))

import { useE2E } from '../../composables/domain/useE2E.js'
import { useDataStore } from '../../stores/data.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.cryptoKey = null
})

describe('useE2E.decryptStoreItems 解锁后补解密', () => {
  it('store 中残留的密文态敏感字段在 decryptStoreItems 后解回明文，明文字段不动', async () => {
    const e2e = useE2E()
    const ds = useDataStore()

    // 1) 设主密码（真 Web Crypto，jsdom 提供 crypto.subtle）
    const masterPw = 'test-password-123'
    const ok = await e2e.setupMasterPassword(masterPw)
    expect(ok).toBe(true)
    expect(e2e.isUnlocked.value).toBe(true) // setup 后自动解锁

    // 2) 用真加密生成一条密文 username 的 bookmark，塞 store 模拟「未解锁时 Realtime 落的密文态」。
    //    现行加密范围已收窄到 username/notes，title/url 不再被 encryptItem 加密。
    const enc = await e2e.encryptItem('bookmark', {
      title: '普通标题', url: 'https://cipher.example', username: '机密用户名', notes: '私密笔记',
    } as any)
    const cipherUsername = enc.username as string
    const cipherNotes = enc.notes as string
    expect(cipherUsername).not.toBe('机密用户名') // 确真加密了（三段 salt.iv.data）
    expect(cipherNotes).not.toBe('私密笔记')
    expect(enc.title).toBe('普通标题') // title 现已明文存云端，不被加密

    ds.addBookmark({
      id: 'b1', title: '普通标题', url: 'https://cipher.example', username: cipherUsername, password: '',
      notes: cipherNotes, icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    // 一条全明文的 bookmark，模拟「未加密的本地条目」
    ds.addBookmark({
      id: 'b2', title: '普通明文标题', url: 'https://plain.example', username: 'plainUser',
      password: '', notes: 'plainNotes', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    // 3) lock 再 unlock，模拟「未解锁 → 已解锁」过渡
    e2e.lock()
    const ok2 = await e2e.unlock(masterPw)
    expect(ok2).toBe(true)
    expect(e2e.isUnlocked.value).toBe(true)

    // 4) 验证：b1 的密文 username/notes 被解回明文；title/url 明文不动；b2 全明文不动
    expect(ds.bookmarkMap['b1'].username).toBe('机密用户名')
    expect(ds.bookmarkMap['b1'].notes).toBe('私密笔记')
    expect(ds.bookmarkMap['b1'].title).toBe('普通标题')
    expect(ds.bookmarkMap['b1'].url).toBe('https://cipher.example')
    expect(ds.bookmarkMap['b2'].username).toBe('plainUser')
    expect(ds.bookmarkMap['b2'].notes).toBe('plainNotes')
    expect(ds.bookmarkMap['b2'].title).toBe('普通明文标题')
  }, 15000)

  it('legacy 旧密文 title/url（迁移期云端残留）经 decryptStoreItems 解回明文', async () => {
    const e2e = useE2E()
    const ds = useDataStore()
    const masterPw = 'legacy-pw-789'
    await e2e.setupMasterPassword(masterPw)
    expect(e2e.isUnlocked.value).toBe(true)

    // 模拟迁移期：云端旧数据里 title/url 仍是 E2E 密文（旧版本加密过）。
    // 手动用当前 key 给 title/url 加密，模拟云端拉下的旧密文行。
    const cipherTitle = await e2e.encryptField('旧密文标题') as string
    const cipherUrl = await e2e.encryptField('https://old.example') as string
    expect(cipherTitle).not.toBe('旧密文标题')
    expect(cipherUrl).not.toBe('https://old.example')
    ds.addBookmark({
      id: 'b3', title: cipherTitle, url: cipherUrl, username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    e2e.lock()
    const ok = await e2e.unlock(masterPw)
    expect(ok).toBe(true)
    // decryptStoreItems 对 title/url 走 legacy 解密，旧密文被还原
    expect(ds.bookmarkMap['b3'].title).toBe('旧密文标题')
    expect(ds.bookmarkMap['b3'].url).toBe('https://old.example')
  }, 15000)

  it('未登录也工作（canary 仅本地 localStorage，不经 Supabase）', async () => {
    // 复用同上但确认无 supabase 调用崩溃——本测试用例就是「未登录」场景：
    // 上一测试已足，此处仅断言可重复 setup/unlock 而不依赖云端。
    const e2e = useE2E()
    const ok = await e2e.setupMasterPassword('pw-another-456')
    expect(ok).toBe(true)
    e2e.lock()
    const ok2 = await e2e.unlock('pw-another-456')
    expect(ok2).toBe(true)
  })
})

describe('useE2E.encryptItem / decryptItem 契约（RE-1 / RE-2）', () => {
  it('decryptItem 返回新对象且不 mutate 入参；调用方必须用返回值', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('contract-pw-1')
    const enc = await e2e.encryptItem('bookmark', {
      title: '明文标题', url: 'https://a.example', username: '机密用户名', notes: 'n',
    } as any)
    const cipher = { ...enc } as Record<string, unknown>
    const usernameBefore = cipher.username
    // title 不再被加密（收窄后明文存），username 被加密成密文
    expect(cipher.title).toBe('明文标题')
    expect(cipher.username).not.toBe('机密用户名')
    const plain = await e2e.decryptItem('bookmark', cipher as any)
    // 入参仍是密文
    expect(cipher.username).toBe(usernameBefore)
    // 返回值是明文
    expect(plain.username).toBe('机密用户名')
    expect(plain.title).toBe('明文标题')
    expect(plain.url).toBe('https://a.example')
    expect(plain).not.toBe(cipher)
  }, 15000)

  it('decryptItem 对 legacy 旧密文 title/url 解回明文，明文串原样过', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('contract-pw-legacy')
    expect(e2e.isUnlocked.value).toBe(true)
    // 手动给 title/url 加密模拟云端迁移期残留旧密文
    const cipherTitle = await e2e.encryptField('旧密文标题') as string
    const cipherUrl = await e2e.encryptField('https://old.example') as string
    const item = { title: cipherTitle, url: cipherUrl, username: '', notes: '' }
    const plain = await e2e.decryptItem('bookmark', item as any)
    expect(plain.title).toBe('旧密文标题')
    expect(plain.url).toBe('https://old.example')
    // 明文 url（含点但非密文）原样返回，不误判
    const plainItem = { title: '明文标题', url: 'https://plain.example', username: '', notes: '' }
    const plainOut = await e2e.decryptItem('bookmark', plainItem as any)
    expect(plainOut.title).toBe('明文标题')
    expect(plainOut.url).toBe('https://plain.example')
  }, 15000)

  it('E2E 启用未解锁时：含非空敏感字段 throw；敏感字段全空透传（支持锁定态同步普通内容）', async () => {
    const e2e = useE2E()
    await e2e.setupMasterPassword('contract-pw-2')
    e2e.lock()
    expect(e2e.isE2EEnabled.value).toBe(true)
    expect(e2e.isUnlocked.value).toBe(false)
    // 只改 title/url（无敏感字段）→ 透传不 throw，锁定态可明文推送
    const nonSens = await e2e.encryptItem('bookmark', { title: 't', url: 'https://x.example', username: '', notes: '' } as any)
    expect(nonSens.title).toBe('t')
    // 含非空 username → throw，调用方据此静默排队等解锁
    await expect(
      e2e.encryptItem('bookmark', { title: 't', url: 'https://x.example', username: 'secret', notes: '' } as any)
    ).rejects.toThrow(/未解锁/)
    // 含非空 notes → 同样 throw
    await expect(
      e2e.encryptItem('bookmark', { title: 't', url: 'https://x.example', username: '', notes: '私密' } as any)
    ).rejects.toThrow(/未解锁/)
    // category 无敏感字段 → 锁定态也透传
    const cat = await e2e.encryptItem('category', { name: '工作' } as any)
    expect(cat.name).toBe('工作')
  }, 15000)

  it('E2E 未启用时 encryptItem 无 key 透传原文', async () => {
    const e2e = useE2E()
    // 不 setup，isE2EEnabled=false，无 cryptoKey
    expect(e2e.isE2EEnabled.value).toBe(false)
    const item = { title: 'plain', url: 'https://p.example', username: 'u', notes: 'n' }
    const out = await e2e.encryptItem('bookmark', item as any)
    expect(out).toBe(item)
    expect(out.title).toBe('plain')
    expect(out.username).toBe('u')
  })
})
