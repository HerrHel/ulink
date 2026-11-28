import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const _db = vi.hoisted(() => ({
  upsertError: { message: 'network unavailable' } as { message: string } | null,
}))

vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ user: { id: 'u-reset-test' } }),
}))

vi.mock('../../lib/dbApi.js', () => ({
  dbFrom: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
    upsert: () => Promise.resolve({ data: null, error: _db.upsertError }),
  }),
}))

import { useE2E } from '../../composables/domain/useE2E.js'
import { useVault } from '../../composables/domain/useVault.js'

describe('Recovery Key 重置云端写入失败回滚本地 canary', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    _db.upsertError = null
  })

  it('useE2E.resetWithRecoveryKey 云端保存失败时回滚 lv_e2e_canary，保持原主密码仍可解锁', async () => {
    const e2e = useE2E()
    const rk = e2e.generateRecoveryKey()
    expect(await e2e.setupMasterPassword('old-master-123', rk)).toBe(true)
    const origCanary = localStorage.getItem('lv_e2e_canary')
    expect(origCanary).toBeTruthy()
    e2e.lock()

    _db.upsertError = { message: 'cloud write failed' }
    const ok = await e2e.resetWithRecoveryKey(rk, 'new-master-456')
    expect(ok).toBe(false)
    expect(localStorage.getItem('lv_e2e_canary')).toBe(origCanary)
    expect(await e2e.unlock('old-master-123')).toBe(true)
  })

  it('useVault.resetVaultWithRecoveryKey 云端保存失败时回滚 lv_vault_canary，保持原密码仍可解锁', async () => {
    const vault = useVault()
    const rk = vault.generateRecoveryKey()
    expect(await vault.setupVaultPassword('old-vault-123', rk)).toBe(true)
    const origCanary = localStorage.getItem('lv_vault_canary')
    expect(origCanary).toBeTruthy()
    vault.lockVault()

    _db.upsertError = { message: 'cloud write failed' }
    const ok = await vault.resetVaultWithRecoveryKey(rk, 'new-vault-456')
    expect(ok).toBe(false)
    expect(localStorage.getItem('lv_vault_canary')).toBe(origCanary)
    expect(await vault.unlockVault('old-vault-123')).toBe(true)
  })
})
