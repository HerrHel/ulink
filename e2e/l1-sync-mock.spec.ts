/**
 * L1：page.route mock Supabase — 默认 CI 无真实出站
 *
 * 1. 假 session → 设置页显示登录态 + 同步 label
 * 2. 命令面板「同步到云端」→ 非「同步失败」（REST mock happy）
 * 3. DEV 钩子注入 conflict → banner + 按钮可见
 */
import { test, expect } from '@playwright/test'
import { installSupabaseMock, injectConflictViaTestHook, L1_EMAIL } from './helpers/supabaseMock'

test.describe('L1 同步 mock', () => {
  test('假 session + 手动同步 happy path', async ({ page }) => {
    test.setTimeout(60000)
    const { stats } = await installSupabaseMock(page)

    await page.goto('/')
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 15000 })

    // 设置抽屉：已登录 + 同步状态文案非「同步失败」
    await page.getByTestId('lv-btn-settings').click()
    const drawer = page.getByTestId('lv-settings-drawer')
    await expect(drawer).toBeVisible({ timeout: 5000 })
    await expect(drawer.getByText(L1_EMAIL)).toBeVisible({ timeout: 5000 })
    const syncLabel = page.getByTestId('lv-sync-label')
    await expect(syncLabel).toBeVisible()
    await expect(syncLabel).not.toHaveText(/同步失败/)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden({ timeout: 3000 })

    // 命令面板手动 fullSync（避 debounced 3s flaky）
    await page.keyboard.press('Control+k')
    const cmdInput = page.getByTestId('lv-cmd-input')
    await expect(cmdInput).toBeVisible({ timeout: 5000 })
    await cmdInput.fill('同步')
    await page.keyboard.press('Enter')

    // 允许 push/pull 完成
    await page.waitForTimeout(1500)

    await page.getByTestId('lv-btn-settings').click()
    await expect(page.getByTestId('lv-settings-drawer')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('lv-sync-label')).not.toHaveText(/同步失败/)
    // mock 至少应吃到 REST（initialSync 和/或 fullSync）
    expect(stats.restGets + stats.restWrites).toBeGreaterThan(0)
  })

  test('冲突横幅 UI（testid + 操作按钮）', async ({ page }) => {
    await installSupabaseMock(page)

    await page.goto('/')
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 15000 })

    // 等 DEV 钩子挂上
    await page.waitForFunction(
      () => !!(window as unknown as { __LV_E2E__?: { addConflict?: unknown } }).__LV_E2E__?.addConflict,
      { timeout: 10000 },
    )

    const injected = await injectConflictViaTestHook(page, {
      id: 'l1-conflict-bm',
      type: 'bookmark',
      local: { title: 'L1 本地' },
      remote: { title: 'L1 云端' },
    })
    expect(injected).toBe(true)

    const banner = page.getByTestId('lv-conflict-banner')
    await expect(banner).toBeVisible({ timeout: 5000 })
    await expect(banner.getByText(/同步冲突/)).toBeVisible()
    await expect(page.getByTestId('lv-conflict-keep-local').first()).toBeVisible()
    await expect(page.getByTestId('lv-conflict-use-remote').first()).toBeVisible()

    // 点保留本地 → 冲突清掉、横幅消失
    await page.getByTestId('lv-conflict-keep-local').first().click()
    await expect(banner).toBeHidden({ timeout: 5000 })
  })
})
