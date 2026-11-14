/**
 * L1：page.route mock Supabase — 默认 CI 无真实出站
 *
 * 1. 假 session → 设置页显示登录态 + 同步 label
 * 2. 命令面板「同步到云端」→ 非「同步失败」（REST mock happy）
 * 3. DEV 钩子注入 conflict → banner + 按钮可见
 */
import { test, expect } from '@playwright/test'
import { installSupabaseMock, injectConflictViaTestHook, L1_EMAIL } from './helpers/supabaseMock'

// 生产构建模式（test:e2e:prod）：__LV_E2E__ 注入钩子仅 DEV 挂载（src/main.ts，生产构建 tree-shake），
// 无生产注入通道，prod 模式下依赖该钩子的用例如实跳过，由默认 dev 模式覆盖。
const isProd = !!process.env.LV_E2E_PROD || process.env.npm_lifecycle_event === 'test:e2e:prod'

// 锁定 zh-CN：CI 浏览器默认 en-US，i18n 会渲染英文导致「同步冲突」等中文断言失配
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lv_locale', 'zh-CN')
  })
})

test.describe('L1 同步 mock', () => {
  // 2026-10-22 曾 test.fixme：CloudBase 形态下 js-sdk 假 session 注入待适配。
  // 现已不成立：① playwright.config 把 L1/dev 钉死 VITE_BACKEND=''（Supabase 形态，
  // 假 session 写 linkvault_auth 即可被 supabase-js 读回）；② supabaseMock 本身已支持
  // backend:'cloudbase' 分流（写 credentials_*/tcb_* 键）。永久 fixme 会让同步 happy path
  // 零覆盖（审计 #27），解除后由本用例真实执行；若再切形态失败，会红而不是静默跳过。
  test('假 session + 手动同步 happy path', async ({ page }) => {
    test.setTimeout(60000)
    const { stats } = await installSupabaseMock(page)

    await page.goto('/app')
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
    test.skip(isProd, '依赖 DEV-only __LV_E2E__ 注入钩子（生产构建不含），由默认 dev 模式覆盖')
    await installSupabaseMock(page)

    await page.goto('/app')
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 15000 })

    // 等 DEV 钩子挂上
    await page.waitForFunction(
      () => !!(window as unknown as { __LV_E2E__?: { addConflict?: unknown } }).__LV_E2E__?.addConflict,
      { timeout: 10000 },
    )

    const banner = page.getByTestId('lv-conflict-banner')

    // 注入一条可识别的冲突，并**按行定位**断言：
    // 断言目标是「这一条冲突点『保留本地』后从横幅里消失」，不是「横幅整体消失」。
    // 后者之前偶发失败：初始 pull 与本地示例数据（Edge扩展 / 与链ulink / 宣传页）之间
    // 也会产生冲突，数量取决于 mock 时序；整横幅断言会把「别人的冲突还在」当成失败，
    // 而那不是本用例要验的行为。（先清理再注入的做法也是竞态的：横幅此刻不可见≠之后不会出现。）
    const injected = await injectConflictViaTestHook(page, {
      id: 'l1-conflict-bm',
      type: 'bookmark',
      local: { title: 'L1 本地' },
      remote: { title: 'L1 云端' },
    })
    expect(injected).toBe(true)

    await expect(banner).toBeVisible({ timeout: 5000 })
    await expect(banner.getByText(/同步冲突/)).toBeVisible()

    const row = banner.locator('.conflict-item', { hasText: 'L1 本地' })
    await expect(row).toHaveCount(1, { timeout: 5000 })
    const keepLocal = row.getByTestId('lv-conflict-keep-local')
    const useRemote = row.getByTestId('lv-conflict-use-remote')
    await expect(keepLocal).toBeVisible()
    await expect(useRemote).toBeVisible()

    // 点这一行的「保留本地」→ 该行消失（其余历史冲突若有，不影响本断言）
    await keepLocal.click()
    await expect(row).toHaveCount(0, { timeout: 5000 })

    // 若这是最后一条冲突，横幅也该收起
    const left = await banner.getByTestId('lv-conflict-keep-local').count()
    if (left === 0) await expect(banner).toBeHidden({ timeout: 5000 })
  })
})
