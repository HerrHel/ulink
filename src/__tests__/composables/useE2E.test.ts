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
})

describe('useE2E.decryptStoreItems 解锁后补解密', () => {
  it('store 中残留的密文态 title 在 decryptStoreItems 后解回明文，明文字段不动', async () => {
    const e2e = useE2E()
    const ds = useDataStore()

    // 1) 设主密码（真 Web Crypto，jsdom 提供 crypto.subtle）
    const masterPw = 'test-password-123'
    const ok = await e2e.setupMasterPassword(masterPw)
    expect(ok).toBe(true)
    expect(e2e.isUnlocked.value).toBe(true) // setup 后自动解锁

    // 2) 用真加密生成一条密文 title 的 bookmark，塞 store 模拟「未解锁时 Realtime 落的密文态」。
    //    setup 后 e2e 已解锁、key 入内存，用同 key 加密得密文（与远端密文同 key 来源语义一致）。
    const enc = await e2e.encryptItem('bookmark', {
      title: '密文标题', url: 'https://cipher.example', notes: '',
    } as any)
    const cipherTitle = enc.title as string
    expect(cipherTitle).not.toBe('密文标题') // 确真加密了（三段 salt.iv.data）

    ds.addBookmark({
      id: 'b1', title: cipherTitle, url: enc.url, username: '', password: '',
      notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 0, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)
    // 一条明文 title 的 bookmark，模拟「未加密的本地条目」
    ds.addBookmark({
      id: 'b2', title: '普通明文标题', url: 'https://plain.example', username: '',
      password: '', notes: '', icon: '', categoryId: CAT_UNCATEGORIZED, parentId: null,
      order: 1, useCount: 0, attributes: {}, isExpanded: false, createdAt: 1, updatedAt: 1,
    } as any)

    // 3) lock 再 unlock，模拟「未解锁 → 已解锁」过渡
    e2e.lock()
    // lock 清了 key，fetch e2e 实例（isUnlocked.value 已假）。unlock 重新派生 key 入内存，
    // 随后调 decryptStoreItems 补解密残留密文。
    const ok2 = await e2e.unlock(masterPw)
    expect(ok2).toBe(true)
    expect(e2e.isUnlocked.value).toBe(true)

    // 4) 验证：b1 的密文 title/url 被解回明文；b2 明文不动
    expect(ds.bookmarkMap['b1'].title).toBe('密文标题')
    expect(ds.bookmarkMap['b1'].url).toBe('https://cipher.example')
    expect(ds.bookmarkMap['b2'].title).toBe('普通明文标题')
    expect(ds.bookmarkMap['b2'].url).toBe('https://plain.example')
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
