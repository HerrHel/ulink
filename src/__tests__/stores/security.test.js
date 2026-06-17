import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSecurityStore } from '../../stores/security.js'
import { useDataStore } from '../../stores/data.js'

vi.mock('../../lib/toast.js', () => ({
  toast: vi.fn(),
  toastWithUndo: vi.fn(),
}))

describe('SecurityStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSecurityStore()
  })

  describe('主密码管理', () => {
    it('setMasterPassword - 应该设置主密码', async () => {
      await store.setMasterPassword('test-password')
      expect(store.masterPassword).toBe('test-password')
    })

    it('clearMasterPassword - 应该清除主密码', () => {
      store.masterPassword = 'test-password'
      store.clearMasterPassword()
      expect(store.masterPassword).toBe('')
    })
  })

  describe('密码加密', () => {
    it('encryptFormPassword - 无主密码时应该抛出错误', async () => {
      store.masterPassword = ''
      await expect(store.encryptFormPassword('test')).rejects.toThrow('请先设置主密码')
    })

    it('encryptFormPassword - 应该返回加密后的密码对象', async () => {
      store.masterPassword = 'master-pw'
      const encrypted = await store.encryptFormPassword('my-password')
      expect(encrypted).toHaveProperty('encrypted', true)
      expect(encrypted).toHaveProperty('data')
      expect(encrypted).toHaveProperty('iv')
      expect(encrypted).toHaveProperty('salt')
    })
  })

  describe('密码解密', () => {
    it('decryptStoredPassword - 应该解密加密的密码', async () => {
      store.masterPassword = 'master-pw'
      const encrypted = await store.encryptFormPassword('my-password')
      const decrypted = await store.decryptStoredPassword(encrypted)
      expect(decrypted).toBe('my-password')
    })

    it('decryptStoredPassword - 应该处理空密码', async () => {
      const result = await store.decryptStoredPassword(null)
      expect(result).toBe('')
    })

    it('decryptStoredPassword - 应该处理 base64 密码', async () => {
      const base64 = btoa('old-password')
      const result = await store.decryptStoredPassword(base64)
      expect(result).toBe('old-password')
    })
  })

  describe('主密码验证', () => {
    it('verifyMasterPassword - 无加密书签时应该返回 true 如果密码非空', async () => {
      const dataStore = useDataStore()
      dataStore.bookmarks = [{ id: 'b1', password: 'plain' }]
      
      const result = await store.verifyMasterPassword('any-password')
      expect(result).toBe(true)
    })

    it('verifyMasterPassword - 无加密书签时应该返回 false 如果密码为空', async () => {
      const dataStore = useDataStore()
      dataStore.bookmarks = [{ id: 'b1', password: 'plain' }]
      
      const result = await store.verifyMasterPassword('')
      expect(result).toBe(false)
    })

    it('verifyMasterPassword - 有加密书签时应该验证密码', async () => {
      const dataStore = useDataStore()
      store.masterPassword = 'correct-pw'
      const encrypted = await store.encryptFormPassword('test')
      
      dataStore.bookmarks = [
        { id: 'b1', password: encrypted },
      ]
      
      const correctResult = await store.verifyMasterPassword('correct-pw')
      expect(correctResult).toBe(true)
      
      const wrongResult = await store.verifyMasterPassword('wrong-pw')
      expect(wrongResult).toBe(false)
    })
  })
})
