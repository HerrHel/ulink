/**
 * useE2E-hasEncryptedData.test.ts — 换设备防呆检测护栏
 *
 * setupMasterPassword 在「本机无 canary 却已有历史密文」时生成全新 key，旧主密码加密的
 * 数据永久解不开（用户报的换设备密码乱码根因场景之一）。hasEncryptedData 供 setup 弹窗
 * 打开时检测 store 是否残留 E2E 密文形态，从而给出「引导原主密码解锁」的警告。本护栏锁：
 *  - EncryptedPassword 对象 / 三段 salt.iv.data 串（password/username/notes/group.name/
 *    category.name）任一命中 → true
 *  - 明文 / 普通 base64 string（非三段，旧版非 E2E 场景）→ false
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// e2e store mock（useE2E 构造需 useE2EStore，hasEncryptedData 本体不读它，占位不炸即可）
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

import { useE2E } from '../../composables/domain/useE2E.js'
import { useDataStore } from '../../stores/data.js'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  _e2eState.isE2EEnabled = false
  _e2eState.isUnlocked = false
  _e2eState.isBiometricEnrolled = false
  _e2eState.cryptoKey = null
})

type AddBookmarkInput = Parameters<ReturnType<typeof useDataStore>['addBookmark']>[0]

function makeBookmark(id: string, over: Partial<AddBookmarkInput> = {}): AddBookmarkInput {
  return {
    id,
    title: '书签' + id,
    url: 'https://example.com/' + id,
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: CAT_UNCATEGORIZED,
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  } as AddBookmarkInput
}

describe('useE2E.hasEncryptedData — 换设备防呆检测', () => {
  it('空库 → false', () => {
    expect(useE2E().hasEncryptedData()).toBe(false)
  })

  it('EncryptedPassword 对象 password → true', () => {
    useDataStore().addBookmark(makeBookmark('b1', { password: { encrypted: true, data: 'd', iv: 'v', salt: 's' } }) as any)
    expect(useE2E().hasEncryptedData()).toBe(true)
  })

  it('三段 salt.iv.data 串 password → true', () => {
    useDataStore().addBookmark(makeBookmark('b1', { password: 'abc.def.ghi' }) as any)
    expect(useE2E().hasEncryptedData()).toBe(true)
  })

  it('username 三段密文 → true', () => {
    useDataStore().addBookmark(makeBookmark('b1', { username: 'u.v.w' }) as any)
    expect(useE2E().hasEncryptedData()).toBe(true)
  })

  it('notes 三段密文 → true', () => {
    useDataStore().addBookmark(makeBookmark('b1', { notes: 'n.o.p' }) as any)
    expect(useE2E().hasEncryptedData()).toBe(true)
  })

  it('group.name 三段密文 → true', () => {
    const ds = useDataStore()
    ds.addBookmark(makeBookmark('b1') as any)
    ds.addGroup({ id: 'g1', name: 'a.b.c', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '', updatedAt: 1, useCount: 0 } as any)
    expect(useE2E().hasEncryptedData()).toBe(true)
  })

  it('category.name 三段密文 → true', () => {
    const ds = useDataStore()
    ds.addBookmark(makeBookmark('b1') as any)
    ds.addCategory({ id: 'c1', name: 'x.y.z', icon: 'star', color: '', order: 0 } as any)
    expect(useE2E().hasEncryptedData()).toBe(true)
  })

  it('全部明文 / 旧 base64 string（非三段）→ false', () => {
    const ds = useDataStore()
    // 旧版非 E2E 场景的 base64 密码（非三段、无 '.'）不应误判为密文
    ds.addBookmark(makeBookmark('b1', { password: 'cGFzc3dvcmQ=', username: 'user', notes: '备注' }) as any)
    ds.addBookmark(makeBookmark('b2', { password: 'plain', username: 'u2', notes: 'note2' }) as any)
    ds.addGroup({ id: 'g1', name: '组名', categoryId: CAT_UNCATEGORIZED, icon: '', order: 0, isExpanded: false, attributes: {}, bookmarkIds: [], notes: '组备注', updatedAt: 1, useCount: 0 } as any)
    ds.addCategory({ id: 'c1', name: '分类名', icon: 'star', color: '', order: 0 } as any)
    expect(useE2E().hasEncryptedData()).toBe(false)
  })
})
