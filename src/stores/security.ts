/**
 * security.ts — 安全 Store
 * 职责：主密码管理、密码加密/解密、密码验证
 * 从 app.js 拆分而来
 */
import { defineStore } from 'pinia'
import { encryptPassword, autoMigratePassword } from '../crypto.js'
import { toast, showConfirm } from '../lib/toast.js'
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
      const ds = useDataStore()
      const encryptedCount = ds.bookmarks.filter(b => b.password && typeof b.password === 'object' && (b.password as EncryptedPassword).encrypted).length
      const doClear = () => {
        this.masterPassword = ''
        toast('主密码已清除')
      }
      if (encryptedCount > 0) {
        showConfirm(`当前有 ${encryptedCount} 个书签使用了 AES 加密密码。清除主密码后这些密码将无法解密，确定要清除吗？`, doClear)
      } else {
        doClear()
      }
    },
  },
})
