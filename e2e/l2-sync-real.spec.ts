/**
 * L2：真 Supabase 同步（默认 skip，不进 PR CI）
 *
 * 启用：
 *   LV_E2E_L2=1
 *   + 真 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（.env 或 shell）
 *   + 会话：LV_E2E_L2_SESSION_JSON 或 ACCESS/REFRESH/USER_ID(+EMAIL)
 *
 * OTP 成本高 → 不在此自动打 OTP；会话用已登录 localStorage 导出。
 * 手动 checklist 见 docs/sync-e2e-governance.md §8 Track B。
 */
import { test, expect, type Page } from '@playwright/test'
import {
  resolveL2Session,
  injectL2Session,
  triggerManualFullSync,
  type L2Session,
} from './helpers/l2Session'

const L2_FLAG = !!process.env.LV_E2E_L2
const l2 = resolveL2Session()

async function openAppAuthed(page: Page, session: L2Session) {
  await injectL2Session(page, session)
  await page.goto('/')
  await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 20000 })
}

async function expectLoggedInSettings(page: Page, email: string) {
  await page.getByTestId('lv-btn-settings').click()
  const drawer = page.getByTestId('lv-settings-drawer')
  await expect(drawer).toBeVisible({ timeout: 8000 })
  if (email) {
    await expect(drawer.getByText(email, { exact: false })).toBeVisible({ timeout: 10000 })
  }
  const syncLabel = page.getByTestId('lv-sync-label')
  await expect(syncLabel).toBeVisible({ timeout: 5000 })
  // 给 initialSync 一点时间；最终不应长期停在「同步失败」
  await expect
    .poll(async () => (await syncLabel.textContent()) || '', { timeout: 25000 })
    .not.toMatch(/同步失败/)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden({ timeout: 5000 }).catch(() => {})
}

async function addBookmark(page: Page, title: string, url: string) {
  await page.keyboard.press('Control+n')
  const modal = page.getByTestId('lv-bm-modal')
  await expect(modal).toBeVisible({ timeout: 8000 })
  await page.getByTestId('lv-bm-url').fill(url)
  await page.getByTestId('lv-bm-title').fill(title)
  await page.getByTestId('lv-bm-save').click()
  await expect(modal).toBeHidden({ timeout: 8000 })
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 })
}

test.describe('L2 真后端同步（可选）', () => {
  // 整组：无开关则 skip（默认 CI）
  test.skip(!L2_FLAG, '设 LV_E2E_L2=1 才跑；默认 CI 无 secrets')

  test('真会话：登录态 + 同步 label 非失败', async ({ page }) => {
    test.skip(!l2.ok, l2.reason || 'L2 会话未配置')
    test.setTimeout(90000)

    await openAppAuthed(page, l2.session!)
    // initialSync 可能在跑
    await page.waitForTimeout(1500)
    await expectLoggedInSettings(page, l2.email || '')
  })

  test('真会话：新建书签 → 手动 fullSync 非失败', async ({ page }) => {
    test.skip(!l2.ok, l2.reason || 'L2 会话未配置')
    test.setTimeout(120000)

    const title = `L2-push-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    await openAppAuthed(page, l2.session!)
    await page.waitForTimeout(2000)

    await addBookmark(page, title, `https://example.com/l2/${encodeURIComponent(title)}`)
    await page.waitForTimeout(400)

    await triggerManualFullSync(page)
    // push+pull 往返
    await page.waitForTimeout(2500)

    await page.getByTestId('lv-btn-settings').click()
    await expect(page.getByTestId('lv-settings-drawer')).toBeVisible({ timeout: 5000 })
    await expect
      .poll(async () => (await page.getByTestId('lv-sync-label').textContent()) || '', {
        timeout: 30000,
      })
      .not.toMatch(/同步失败/)
  })

  test('跨 context：A push → B 冷启动 pull 可见', async ({ browser }) => {
    test.skip(!l2.ok, l2.reason || 'L2 会话未配置')
    test.setTimeout(180000)

    const title = `L2-xctx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const session = l2.session!

    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    try {
      await openAppAuthed(pageA, session)
      await pageA.waitForTimeout(2500)
      await addBookmark(pageA, title, `https://example.com/l2-xctx/${encodeURIComponent(title)}`)
      await pageA.waitForTimeout(400)
      await triggerManualFullSync(pageA)
      // 等 label 脱离失败/同步中（best-effort）
      await pageA.getByTestId('lv-btn-settings').click()
      await expect(pageA.getByTestId('lv-settings-drawer')).toBeVisible({ timeout: 5000 })
      await expect
        .poll(async () => (await pageA.getByTestId('lv-sync-label').textContent()) || '', {
          timeout: 45000,
        })
        .not.toMatch(/同步失败|同步中/)
      await pageA.keyboard.press('Escape')
    } finally {
      await ctxA.close()
    }

    // B：全新存储，仅注入同一会话 → initialSync pull
    const ctxB = await browser.newContext()
    const pageB = await ctxB.newPage()
    try {
      await openAppAuthed(pageB, session)
      // initialSync + pull 可能较慢
      await expect(pageB.getByText(title).first()).toBeVisible({ timeout: 60000 })
    } finally {
      await ctxB.close()
    }
  })
})
