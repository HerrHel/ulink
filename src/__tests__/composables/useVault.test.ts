/**
 * useVault.test.ts — 保险柜独立加密层 setup/unlock/lock 主流程测试
 *
 * 保险柜与全局 E2E 解耦：独立 canary（lv_vault_canary）、独立主密码、
 * 独立解锁态。测试覆盖：
 * - setupVaultPassword 后自动解锁 + 本地 canary 落盘
 * - unlockVault 正确/错误密码行为
 * - lockVault 清密钥 + 解锁态
 * - resetVaultWithRecoveryKey 用 Recovery Key 重置主密码
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../composables/domain/useAuth.js', () => ({
  useAuth: () => ({ user: null }),
}))

import { useVault } from '../../composables/domain/useVault.js'
import { useVaultStore } from '../../stores/vault.js'
import { PBKDF2_ITERATIONS } from '../../crypto.js'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('useVault 保险柜独立加密层', () => {
  it('setupVaultPassword 后自动解锁 + 本地 canary 落盘 + 启用态置真', async () => {
    const vault = useVault()
    // 注意：不在此处预读 isVaultEnabled.value——computed 首次求值缓存 false 后不会因
    // plain-object setter 重算（依赖无 reactive trigger）。setup 完成后首次读即取 setup 后的值。
    const ok = await vault.setupVaultPassword('vault-password-123')
    expect(ok).toBe(true)
    expect(vault.isVaultEnabled.value).toBe(true)
    expect(vault.isVaultUnlocked.value).toBe(true)
    const raw = localStorage.getItem('lv_vault_canary')
    expect(raw).toBeTruthy()
    const canary = JSON.parse(raw!)
    expect(typeof canary.canary).toBe('string')
    expect(Array.isArray(canary.salt)).toBe(true)
    expect(canary.it).toBe(PBKDF2_ITERATIONS)
  })

  it('unlockVault 正确密码解锁成功；错误密码返回 false 且不置解锁态', async () => {
    const vault = useVault()
    const pw = 'correct-vault-pw'
    await vault.setupVaultPassword(pw)
    // 模拟锁定再解锁
    vault.lockVault()
    expect(vault.isVaultUnlocked.value).toBe(false)

    const okGood = await vault.unlockVault(pw)
    expect(okGood).toBe(true)
    expect(vault.isVaultUnlocked.value).toBe(true)

    vault.lockVault()
    const okBad = await vault.unlockVault('wrong-vault-pw')
    expect(okBad).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
  })

  it('lockVault 清密钥与解锁态', async () => {
    const vault = useVault()
    await vault.setupVaultPassword('any-pw-12345')
    expect(vault.isVaultUnlocked.value).toBe(true)
    vault.lockVault()
    expect(vault.isVaultUnlocked.value).toBe(false)
  })

  it('保险柜 canary 与全局 E2E canary 互不复用（独立 localStorage 键）', async () => {
    const vault = useVault()
    await vault.setupVaultPassword('vault-pw-12345')
    // 全局 E2E canary 键不应被保险柜写入
    expect(localStorage.getItem('lv_e2e_canary')).toBeNull()
    expect(localStorage.getItem('lv_vault_canary')).toBeTruthy()
  })

  it('setupVaultPassword 带 Recovery Key 时 canary 含 recovery_* 字段', async () => {
    const vault = useVault()
    const rk = vault.generateRecoveryKey()
    expect(rk).toMatch(/[A-Z0-9]{4}-/) // 格式化作证
    const ok = await vault.setupVaultPassword('vault-pw-12345', rk)
    expect(ok).toBe(true)
    const canary = JSON.parse(localStorage.getItem('lv_vault_canary')!)
    expect(canary.recovery_canary).toBeTruthy()
    expect(Array.isArray(canary.recovery_salt)).toBe(true)
    expect(typeof canary.recovery_it).toBe('number')
  })

  it('resetVaultWithRecoveryKey 用对 Recovery Key 重置主密码成功', async () => {
    const vault = useVault()
    const rk = vault.generateRecoveryKey()
    await vault.setupVaultPassword('old-vault-pw-123', rk)
    vault.lockVault()

    const ok = await vault.resetVaultWithRecoveryKey(rk, 'new-vault-pw-456')
    expect(ok).toBe(true)
    expect(vault.isVaultUnlocked.value).toBe(true)
    // 新密码可解锁
    vault.lockVault()
    const okNew = await vault.unlockVault('new-vault-pw-456')
    expect(okNew).toBe(true)
    // 旧密码失效
    vault.lockVault()
    const okOld = await vault.unlockVault('old-vault-pw-123')
    expect(okOld).toBe(false)
  })

  it('resetVaultWithRecoveryKey 用错 Recovery Key 返回 false', async () => {
    const vault = useVault()
    const rk = vault.generateRecoveryKey()
    await vault.setupVaultPassword('old-pw-12345', rk)
    vault.lockVault()
    const ok = await vault.resetVaultWithRecoveryKey('AAAA-BBBB-CCCC-DDDD', 'new-pw-12345')
    expect(ok).toBe(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
  })

  it('checkVaultStatus 未设置时返回 false；设置后返回 true', async () => {
    const vault = useVault()
    const vaultStore = useVaultStore()
    const before = await vault.checkVaultStatus()
    expect(before).toBe(false)
    expect(vault.isVaultEnabled.value).toBe(false)
    await vault.setupVaultPassword('pw-123456')
    // 模拟进程重启：清内存态但 canary 仍在 localStorage
    vaultStore.lock()
    vaultStore.setEnabled(false)
    expect(vault.isVaultUnlocked.value).toBe(false)
    const after = await vault.checkVaultStatus()
    expect(after).toBe(true)
    expect(vault.isVaultEnabled.value).toBe(true)
  })
})
