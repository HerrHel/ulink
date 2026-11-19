/**
 * CloudBase 形态 E2E 的「设备」操作辅助：开设备（独立上下文 + 登录 + 等首轮同步）、
 * 手动同步、书签增删改。与 cloudbaseMock.ts 配合，供 cloudbase-*.spec.ts 共用。
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { attachCloudBase, loginViaUi, type CbBackend } from './cloudbaseMock'

export const isProd = !!process.env.LV_E2E_PROD || process.env.npm_lifecycle_event === 'test:e2e:prod'

export interface Device {
  context: BrowserContext
  page: Page
}

/** 新开一台设备：独立上下文（独立 localStorage / IndexedDB），接同一个云端，登录并等首轮同步完成 */
export async function newDevice(browser: Browser, backend: CbBackend, label = 'A'): Promise<Device> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  await attachCloudBase(context, backend, label)
  const page = await context.newPage()
  await page.goto('/app')
  await expect(grid(page)).toBeAttached({ timeout: 15000 })
  await loginViaUi(page)
  await page.keyboard.press('Escape')
  // 首轮同步完成的可观测信号：本机示例数据已补推到云端
  await expect.poll(() => backend.live('bookmarks').length, { timeout: 20000 }).toBeGreaterThan(0)
  // 回归守卫：首次登录不得凭空出现冲突（曾因基线补推后 dirty 未释放，官网示例书签必报 4 条冲突）
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('lv-conflict-banner')).toHaveCount(0)
  return { context, page }
}

export const grid = (page: Page) => page.getByTestId('lv-card-grid')
export const card = (page: Page, title: string) => grid(page).locator('[data-id]', { hasText: title })

/** 命令面板「同步」：fullSync（先拉后推） */
export async function syncNow(page: Page) {
  await page.keyboard.press('Control+k')
  const input = page.getByTestId('lv-cmd-input')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill('同步到云端')
  // 点选命令项而非回车：「同步」可能同时匹配到书签 / AI 指令，回车执行的未必是同步命令
  // 标签须精确匹配：子串匹配会先命中「让 AI 在全网甄选『同步到云端』相关网站」这条 AI 指令
  const cmd = page.locator('.cmd-item').filter({ has: page.locator('.cmd-item-label', { hasText: /^同步到云端$/ }) })
  await expect(cmd).toHaveCount(1)
  await cmd.click()
  await expect(page.locator('.cmd-mask')).not.toHaveClass(/\bopen\b/, { timeout: 5000 })
}

export async function createBookmark(page: Page, title: string, url: string, extra: { username?: string; password?: string } = {}) {
  await page.keyboard.press('Control+n')
  const modal = page.getByTestId('lv-bm-modal')
  await expect(modal).toBeVisible({ timeout: 5000 })
  await page.getByTestId('lv-bm-url').fill(url)
  await page.getByTestId('lv-bm-title').fill(title)
  if (extra.username != null || extra.password != null) {
    const moreToggle = page.getByTestId('lv-bm-more-toggle')
    if (await moreToggle.isVisible()) {
      await moreToggle.click()
    }
  }
  if (extra.username != null) await page.locator('#bmUsername').fill(extra.username)
  if (extra.password != null) await page.locator('#bmPassword').fill(extra.password)
  await page.getByTestId('lv-bm-save').click()
  await expect(modal).toBeHidden({ timeout: 5000 })
  await expect(card(page, title)).toBeVisible()
}

export async function openCtx(page: Page, title: string) {
  const c = card(page, title).first()
  await expect(c).toBeVisible()
  await c.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 200 })
  const menu = page.locator('#ctxMenu')
  await expect(menu).toBeVisible({ timeout: 5000 })
  return menu
}

export async function renameBookmark(page: Page, oldTitle: string, newTitle: string) {
  const menu = await openCtx(page, oldTitle)
  await menu.locator('[data-action="edit"]').click()
  const modal = page.getByTestId('lv-bm-modal')
  await expect(modal).toBeVisible({ timeout: 5000 })
  await page.getByTestId('lv-bm-title').fill(newTitle)
  await page.getByTestId('lv-bm-save').click()
  await expect(modal).toBeHidden({ timeout: 5000 })
  await expect(card(page, newTitle)).toBeVisible()
}

export async function deleteBookmark(page: Page, title: string) {
  const menu = await openCtx(page, title)
  await menu.locator('[data-action="delete"]').click()
  // 部分删除路径会弹二次确认
  const confirm = page.locator('.modal-mask.open').getByRole('button', { name: /^(删除|确定|确认)$/ })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(card(page, title)).toHaveCount(0)
}

export const liveTitles = (backend: CbBackend) => backend.live('bookmarks').map((r) => r.title)
export const findLive = (backend: CbBackend, title: string) => backend.live('bookmarks').find((r) => r.title === title)
