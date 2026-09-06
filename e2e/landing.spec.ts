/**
 * e2e/landing.spec.ts — 宣传落地页（/）E2E 测试
 *
 * 双入口结构：/ = 落地页（index.html 静态），/app = 应用主体（app.html）。
 * 覆盖关键分流行为：
 * - 新访客：留在落地页，CTA 指向 /app
 * - 返客（localStorage 有应用痕迹）：落地页脚本秒跳 /app，无感迁移
 * - 关键参数直通：扩展保存 / 旧 #share/ 兜底链接不落宣传页
 * - 双语切换：EN ⇄ 中文即时切换
 * 依赖 dev server（playwright.config.ts 自动启动）；landing.js 的跳转规则
 * 与 public/landing.js 保持同步。
 */
import { test, expect } from '@playwright/test'

// 与 app.spec.ts 同款测试侧硬化：CI 无头浏览器 navigator.language 默认 en-US，
// 落地页会按设计渲染英文。锁定 lv_locale=zh-CN 使断言以中文静态默认文案为准。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lv_locale', 'zh-CN')
  })
})

test.describe('宣传落地页', () => {
  test('新访客看到落地页与星图画布，不跳转', async ({ page }) => {
    await page.goto('/')
    // 干净环境下 landing.js 不应触发跳转
    await page.waitForURL('/')
    await expect(page.locator('h1')).toContainText('把收藏')
    await expect(page.getByRole('link', { name: '免费开始使用' })).toHaveAttribute('href', '/app')
    // 星图 canvas 已被 hero-visual.js 初始化（有实际像素尺寸）
    const canvas = page.locator('#constellation')
    await expect(canvas).toBeAttached()
    await expect.poll(async () =>
      canvas.evaluate((el) => (el as HTMLCanvasElement).width)
    ).toBeGreaterThan(0)
  })

  test('点击「免费开始使用」进入应用主体', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: '免费开始使用' }).click()
    await page.waitForURL(/\/app$/)
    // 应用挂载完成（进入应用内首启引导属正常路径，此处只验证入口打通）
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
  })

  test('返客（已有应用数据）自动跳转 /app', async ({ page }) => {
    // persist.ts 每次保存都写 linkvault_v2 缓存；注入即模拟老用户
    await page.addInitScript(() => {
      localStorage.setItem('linkvault_v2', '{}')
    })
    await page.goto('/')
    await page.waitForURL(/\/app/, { timeout: 10000 })
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
  })

  test('扩展保存参数直通应用，不落宣传页', async ({ page }) => {
    await page.goto('/?ext_save=1&ext_save_url=https%3A%2F%2Fexample.com%2Fpage&ext_save_title=%E6%B5%8B%E8%AF%95')
    // 落地页透传 ?ext_save=... → /app；应用按 H8 隐私设计读参后立即清 query，
    // 故最终 URL 是干净的 /app，且扩展保存的书签已入库
    await page.waitForURL(/\/app$/, { timeout: 10000 })
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
  })

  test('旧 #share/ 兜底链接直通应用', async ({ page }) => {
    await page.goto('/#share/nonexistent-group-for-e2e')
    await page.waitForURL(/\/app#share\//, { timeout: 10000 })
    // 应用接管分享路由（不存在的组 → 分享错误占位，同 app.spec 的 #share 用例）
    await expect(page.locator('.share-state').first()).toBeVisible({ timeout: 15000 })
  })

  test('语言切换：中文 ⇄ English', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('把收藏')
    // 切到英文（原地替换，无 reload）
    await page.locator('#lang-toggle').click()
    await expect(page.locator('h1')).toContainText('Your bookmarks')
    await expect(page).toHaveTitle(/ulink — a local-first bookmark manager/)
    // 切回中文（整页还原）
    await page.locator('#lang-toggle').click()
    await expect(page.locator('h1')).toContainText('把收藏')
    await expect(page.locator('#lang-toggle')).toHaveText('EN')
  })
})
