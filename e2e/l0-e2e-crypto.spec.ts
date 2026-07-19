/**
 * L0：E2E 加密真路径 — 无后端
 *
 * 经设置 UI 设置主密码（WebCrypto canary），锁定 → 刷新 → 真实解锁。
 * 禁止仅注入 fake canary 冒充加密成功（fake 门闩见 e2e/app.spec.ts 同名用例）。
 *
 * Playwright 每用例独立 browser context，localStorage 默认干净，
 * 故只需注入 lv_setup_done，勿在 initScript 里 remove canary（reload 会误清）。
 */
import { test, expect } from '@playwright/test'

const MASTER_PW = 'L0-crypto-test-pw-9x'

test.describe('L0 E2E 真加密路径', () => {
  test('设置主密码 → 锁定 → 刷新 → 解锁', async ({ page }) => {
    // PBKDF2 600K 可能较慢
    test.setTimeout(90000)

    await page.addInitScript(() => {
      localStorage.setItem('lv_setup_done', '1')
    })

    await page.goto('/')
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 10000 })

    await page.getByTestId('lv-btn-settings').click()
    const drawer = page.getByTestId('lv-settings-drawer')
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('lv-e2e-status')).toHaveText('未开启', { timeout: 5000 })

    await page.getByTestId('lv-e2e-setup-btn').click()
    await expect(page.getByTestId('lv-e2e-setup-modal')).toBeVisible({ timeout: 5000 })

    await page.getByTestId('lv-e2e-setup-password').fill(MASTER_PW)
    await page.getByTestId('lv-e2e-setup-password2').fill(MASTER_PW)
    await page.getByTestId('lv-e2e-setup-next').click()

    // step 2：Recovery Key + 确认已保存（原生 checkbox 可能被样式藏出视口，点文案 label）
    await expect(page.getByTestId('lv-e2e-setup-confirm')).toBeVisible({ timeout: 10000 })
    await page.getByText('我已保存 Recovery Key').click()
    await page.getByTestId('lv-e2e-setup-confirm').click()

    // step 3：完成
    await expect(page.getByTestId('lv-e2e-setup-done')).toBeVisible({ timeout: 30000 })
    await page.getByTestId('lv-e2e-setup-done').click()

    // canary 必须是真 WebCrypto 三段，而非 app.spec 的 fake deadbeef
    const canaryRaw = await page.evaluate(() => localStorage.getItem('lv_e2e_canary'))
    expect(canaryRaw, 'setup 后应写入 lv_e2e_canary').toBeTruthy()
    const canaryData = JSON.parse(canaryRaw!) as { canary?: string; salt?: number[] }
    expect(canaryData.canary).toBeTruthy()
    expect(canaryData.canary!.split('.').length).toBe(3)
    expect(canaryData.canary).not.toContain('deadbeef')
    expect(Array.isArray(canaryData.salt) && canaryData.salt.length >= 16).toBe(true)

    // 再开设置：应显示已解锁
    await page.getByTestId('lv-btn-settings').click()
    await expect(page.getByTestId('lv-settings-drawer')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('lv-e2e-status')).toHaveText('已解锁', { timeout: 5000 })

    await page.getByTestId('lv-e2e-lock-btn').click()
    await expect(page.getByTestId('lv-e2e-status')).toHaveText('已锁定', { timeout: 5000 })
    await page.keyboard.press('Escape')

    // 刷新后仍锁定（内存 key 已清，canary 仍在）
    await page.reload()
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 10000 })
    await page.getByTestId('lv-btn-settings').click()
    await expect(page.getByTestId('lv-e2e-status')).toHaveText('已锁定', { timeout: 5000 })

    await page.getByTestId('lv-e2e-unlock-btn').click()
    await expect(page.getByTestId('lv-e2e-unlock-password')).toBeVisible({ timeout: 5000 })
    await page.getByTestId('lv-e2e-unlock-password').fill(MASTER_PW)
    await page.getByTestId('lv-e2e-unlock-submit').click()

    // 解锁成功后模态关闭；设置抽屉可能已关，再开确认状态
    await expect(page.getByTestId('lv-e2e-unlock-password')).toBeHidden({ timeout: 30000 })
    await page.getByTestId('lv-btn-settings').click()
    await expect(page.getByTestId('lv-e2e-status')).toHaveText('已解锁', { timeout: 10000 })
    await expect(page.locator('.error-boundary-fallback')).not.toBeVisible()
  })
})
