/**
 * L0：本地持久化 — 无后端
 * 唯一 title 加书签 → reload 仍在（IndexedDB/localStorage 路径）
 */
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lv_setup_done', '1')
  })
})

test.describe('L0 持久化', () => {
  test('新建书签后刷新仍可见', async ({ page }) => {
    const uniqueTitle = `L0-persist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await page.goto('/')
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 10000 })

    await page.keyboard.press('Control+n')
    const modal = page.getByTestId('lv-bm-modal')
    await expect(modal).toBeVisible({ timeout: 5000 })

    await page.getByTestId('lv-bm-url').fill('https://example.com/l0-persist')
    await page.getByTestId('lv-bm-title').fill(uniqueTitle)
    await page.getByTestId('lv-bm-save').click()

    // 保存后模态关闭，卡片出现
    await expect(modal).toBeHidden({ timeout: 5000 })
    await expect(page.getByText(uniqueTitle).first()).toBeVisible({ timeout: 8000 })

    // 给 saveAppData / IDB 落盘留窗口（saveBm 会同步调 saveAppData）
    await page.waitForTimeout(400)

    await page.reload()
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 10000 })
    await expect(page.getByText(uniqueTitle).first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.error-boundary-fallback')).not.toBeVisible()
  })
})
