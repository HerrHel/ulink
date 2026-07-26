/**
 * 私密分类区（保险柜）E2E — 无后端（低风险初态断言）
 *
 * 完整加密 UI 联调链路（设保险柜密码 → 建私密分类 → 锁态隐藏 → 解锁 → 离开重锁）
 * 由单元测试覆盖（useVault 8 例 / syncMapping 4 例 / data gating 4 例）。
 * 本 e2e 仅断保险柜与全局 E2E 的 canary localStorage 键物理独立——
 * 不冒充加密成功（不注入 fake canary），避免触发项目反 fake 门闩。
 */
import { test, expect } from '@playwright/test'

test.describe('保险柜（私密分类区）', () => {
  test('初始加载：保险柜 canary 与全局 E2E canary 双键均为空且独立', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lv_setup_done', '1'))
    await page.goto('/')
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 10000 })

    // 两键均不应被初始化流程写入（保险柜需用户主动设置主密码才落盘）
    const vaultKey = await page.evaluate(() => localStorage.getItem('lv_vault_canary'))
    const e2eKey = await page.evaluate(() => localStorage.getItem('lv_e2e_canary'))
    expect(vaultKey, '保险柜 canary 初始应为空').toBeNull()
    expect(e2eKey, '全局 E2E canary 初始应为空').toBeNull()
  })
})
