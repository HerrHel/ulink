/**
 * security.ts — 安全 Store
 * 职责：主密码管理、密码加密/解密、密码验证
 * 从 app.js 拆分而来
 */
import { defineStore } from 'pinia'
import { encryptPassword, autoMigratePassword } from '../crypto.js'
import { toast } from '../lib/toast.js'
import { useDataStore } from './data.js'
import type { EncryptedPassword } from '../types.js'

const CANARY_PLAINTEXT = 'linkvault_canary_v1'

interface SecurityState {
  masterPassword: string
  masterPasswordOpen: boolean
}

export const useSecurityStore = defineStore('security', {
  state: (): SecurityState => ({
    masterPassword: '',
    masterPasswordOpen: false,
  }),

  actions: {
    async setMasterPassword(pw: string) {
      this.masterPassword = pw
      if (pw) {
        const ds = useDataStore()
        if (!ds._masterCanary) {
          ds._masterCanary = await encryptPassword(CANARY_PLAINTEXT, pw)
        }
      }
    },

    async encryptFormPassword(plaintext: string): Promise<EncryptedPassword> {
      if (!this.masterPassword) throw new Error('请先设置主密码')
      return await encryptPassword(plaintext, this.masterPassword)
    },

    async decryptStoredPassword(stored: string | EncryptedPassword): Promise<string> {
      return await autoMigratePassword(stored, this.masterPassword || '')
    },

    /** 通过解密 canary 验证主密码；回退到加密书签验证 */
    async verifyMasterPassword(pw: string): Promise<boolean> {
      const ds = useDataStore()
      if (ds._masterCanary) {
        try {
          const plain = await autoMigratePassword(ds._masterCanary, pw)
          return plain === CANARY_PLAINTEXT
        } catch (_) { return false }
      }
      const fallback = ds.bookmarks.find(b => b.password && typeof b.password === 'object' && b.password.encrypted)
      if (fallback) {
        try {
          await autoMigratePassword(fallback.password, pw)
          return true
        } catch (_) { return false }
      }
      return !!pw
    },

    clearMasterPassword() {
      this.masterPassword = ''
      toast('主密码已清除')
    },
  },
})
