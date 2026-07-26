/**
 * 私密空间（保险柜）E2E — 完整加密 UI 链路
 *
 * 测试策略：
 * - 真实 WebCrypto（PBKDF2 600K + AES-256-GCM），不注入 fake canary
 * - 单 test 串行跑完整链路（setup 昂贵，状态需跨步骤保留）
 * - 断言三层：UI 可见元素 + localStorage 键 + Pinia Store 状态
 *
 * 链路：初始独立 → 设置主密码 → 错密码拒绝 → 解锁进私密空间 → 返回主页重锁 → 存储隔离
 */
import { test, expect } from '@playwright/test'

const VAULT_PW = 'test-vault-pw-88' // ≥8 位

/** 读 Pinia store 状态（通过 Vue app 实例） */
async function getStoreState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const app = (document.querySelector('#app') as any)?.__vue_app__
    if (!app) return null
    const pinia = app.config.globalProperties.$pinia
    if (!pinia) return null
    const ui = pinia._s.get('ui')
    const vault = pinia._s.get('vault')
    const data = pinia._s.get('data')
    return {
      curSpace: ui?.curSpace ?? null,
      isVaultEnabled: vault?.isVaultEnabled ?? null,
      isVaultUnlocked: vault?.isVaultUnlocked ?? null,
      bookmarkCount: data?.bookmarks?.length ?? null,
      categoryCount: data?.categories?.length ?? null,
    }
  })
}

test.beforeEach(async ({ page }) => {
  // 跳过首启引导模态（与 app.spec.ts 一致）
  await page.addInitScript(() => {
    localStorage.setItem('lv_setup_done', '1')
  })
})

test('保险柜完整链路：设置 → 解锁 → 切换 → 返回 → 存储隔离', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 10000 })

  // ── Step 1：初始状态 ──
  const vaultCanary0 = await page.evaluate(() => localStorage.getItem('lv_vault_canary'))
  const e2eCanary0 = await page.evaluate(() => localStorage.getItem('lv_e2e_canary'))
  expect(vaultCanary0, '保险柜 canary 初始应为空').toBeNull()
  expect(e2eCanary0, '全局 E2E canary 初始应为空').toBeNull()

  await expect(page.getByTestId('btnVaultEntry')).toBeVisible()
  const state0 = await getStoreState(page)
  expect(state0?.curSpace).toBe('main')
  expect(state0?.isVaultEnabled).toBe(false)
  expect(state0?.isVaultUnlocked).toBe(false)

  // ── Step 2：设置保险柜主密码 ──
  await page.getByTestId('btnVaultEntry').click()
  const setupModal = page.getByTestId('lv-vault-setup-modal')
  await expect(setupModal).toBeVisible({ timeout: 5000 })

  // Step 2a：输入密码（≥8 位）
  await page.getByTestId('lv-vault-setup-password').fill(VAULT_PW)
  await page.getByTestId('lv-vault-setup-password2').fill(VAULT_PW)
  await page.getByTestId('lv-vault-setup-next').click()

  // 等待切换到 Step 2（Recovery Key 页面）
  await expect(page.locator('.recovery-key-box')).toBeVisible({ timeout: 5000 })

  // Step 2b：勾选"已保存 Recovery Key" → 确认开启（触发 PBKDF2 600K）
  // checkbox input 被 CSS 隐藏（appearance:none;width:0），点击 label 容器触发
  await page.locator('.check-chip').filter({ hasText: '我已保存 Recovery Key' }).click()
  await page.getByTestId('lv-vault-setup-confirm').click()

  // Step 2c：完成页可见
  await expect(page.getByTestId('lv-vault-setup-done')).toBeVisible({ timeout: 15000 })

  // canary 落盘
  const vaultCanary1 = await page.evaluate(() => localStorage.getItem('lv_vault_canary'))
  expect(vaultCanary1, '设置后 lv_vault_canary 应非空').not.toBeNull()

  // 全局 E2E canary 仍为空（保险柜与全局 E2E 完全独立）
  const e2eCanary1 = await page.evaluate(() => localStorage.getItem('lv_e2e_canary'))
  expect(e2eCanary1, '保险柜设置不应写入 lv_e2e_canary').toBeNull()

  // Store：isVaultEnabled=true
  const state1 = await getStoreState(page)
  expect(state1?.isVaultEnabled).toBe(true)

  // 关闭设置模态
  await page.getByTestId('lv-vault-setup-done').click()

  // setup 完成后 vaultStore 已 isVaultUnlocked=true，需手动锁定以模拟"下次进入"场景
  await page.evaluate(() => {
    const app = (document.querySelector('#app') as any).__vue_app__
    const pinia = app.config.globalProperties.$pinia
    pinia._s.get('vault').lock()
  })

  // ── Step 3：解锁失败（错密码）→ 仍锁态 + 错误提示 ──
  await page.getByTestId('btnVaultEntry').click()
  const unlockModal = page.getByTestId('lv-vault-unlock-password')
  await expect(unlockModal).toBeVisible({ timeout: 5000 })

  await unlockModal.fill('wrong-password-999')
  await page.getByTestId('lv-vault-unlock-submit').click()

  // 错误提示可见（PBKDF2 验证后返回 false）
  await expect(page.locator('.e2e-error').filter({ hasText: /主密码错误/ })).toBeVisible({ timeout: 10000 })

  const state2 = await getStoreState(page)
  expect(state2?.isVaultUnlocked).toBe(false)
  expect(state2?.curSpace).toBe('main')

  // 关闭错误模态(通过 aria-label 定位到解锁模态框,避免多个"取消"按钮冲突)
  await page.getByLabel('进入私密空间').getByRole('button', { name: '取消' }).click()
  await expect(page.getByTestId('lv-vault-unlock-password')).not.toBeVisible({ timeout: 3000 })

  // ── Step 4：解锁成功 → 切到私密空间 + 数据集为空 ──
  await page.getByTestId('btnVaultEntry').click()
  await page.getByTestId('lv-vault-unlock-password').fill(VAULT_PW)
  await page.getByTestId('lv-vault-unlock-submit').click()

  // 解锁成功 → switchSpace('vault') → curSpace=vault + btnBackToMain 可见
  await expect(page.getByTestId('btnBackToMain')).toBeVisible({ timeout: 15000 })

  const state3 = await getStoreState(page)
  expect(state3?.curSpace).toBe('vault')
  expect(state3?.isVaultUnlocked).toBe(true)
  // 私密空间首进：无示例书签（仅基础分类 CAT_ALL/CAT_UNCATEGORIZED 等）
  expect(state3?.bookmarkCount).toBe(0)
  expect(state3?.categoryCount).toBeGreaterThanOrEqual(2) // all + uncategorized

  // ── Step 5：返回主页 → 重锁 + 数据集还原 ──
  await page.getByTestId('btnBackToMain').click()

  // 重锁 + curSpace=main + 入口按钮恢复
  await expect(page.getByTestId('btnVaultEntry')).toBeVisible({ timeout: 5000 })

  const state4 = await getStoreState(page)
  expect(state4?.curSpace).toBe('main')
  expect(state4?.isVaultUnlocked).toBe(false)
  // 主页示例数据还原（DEFAULTS 含 7 个书签）
  expect(state4?.bookmarkCount).toBeGreaterThanOrEqual(7)

  // ── Step 6：存储键物理隔离 ──
  const mainKey = await page.evaluate(() => localStorage.getItem('linkvault_v2'))
  expect(mainKey, '主页 linkvault_v2 应有数据').not.toBeNull()

  // 私密空间数据集键（首次进入后可能已写入空数据集）
  const vaultKey = await page.evaluate(() => localStorage.getItem('linkvault_vault_v1'))
  if (vaultKey !== null) {
    expect(vaultKey, '主页与私密空间数据集键不应相同').not.toBe(mainKey)
  }

  // canary 键隔离
  const vaultCanary2 = await page.evaluate(() => localStorage.getItem('lv_vault_canary'))
  const e2eCanary2 = await page.evaluate(() => localStorage.getItem('lv_e2e_canary'))
  expect(vaultCanary2).not.toBeNull()
  expect(e2eCanary2).toBeNull()
})
