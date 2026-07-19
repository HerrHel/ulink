/**
 * L2：真 Supabase 同步（默认 skip，不进 PR CI）
 *
 * 启用：LV_E2E_L2=1 且环境已配置真 VITE_SUPABASE_* + 可登录会话。
 * OTP 成本高时用手动 checklist，勿默认开启。
 */
import { test, expect } from '@playwright/test'

const L2 = !!process.env.LV_E2E_L2

test.describe('L2 真后端同步（可选）', () => {
  test.skip(!L2, '设 LV_E2E_L2=1 才跑；默认 CI 无 secrets')

  test('占位：真会话 pull/push 冒烟', async ({ page }) => {
    // 真路径需预置会话或 OTP；此处仅保证开关打开时入口可达，避免 silent 空文件。
    // 完整跨上下文同步 checklist 见 docs/sync-e2e-governance.md §8。
    await page.goto('/')
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
    test.info().annotations.push({
      type: 'note',
      description: 'L2 完整用例待 secrets 与测试账号就绪后扩展',
    })
  })
})
