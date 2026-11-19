import { test, expect } from '@playwright/test'

/**
 * 移动端 Stage 2（滚动后简化头部）布局回归。
 *
 * 历史缺陷：标题与右侧按钮组都是绝对定位（标题 left:50% 居中、按钮组 right:14px 贴右），
 * 两者互不感知。未登录时按钮组多出登录入口（390px 视口实测 104→202px），左边界从
 * 272 推到 174，直接盖住居中的标题（182–208），重叠 34px。
 *
 * 修复（仅 B，保留严格居中）：Stage 2 收起登录入口，按钮组宽度回到 104~118px，
 * 居中标题（182–208）不再被盖；另加 max-width + 省略号兜底长分类名。
 * 本文件锁住三条契约：标题水平中心 ≈ 视口中心；标题与搜索切换按钮不相交；
 * Stage 2 不出现登录入口。
 */

const MOBILE = { width: 390, height: 844 }

async function enterStage2(page: import('@playwright/test').Page) {
  await page.setViewportSize(MOBILE)
  await page.goto('/app')
  await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 15000 })


  // 直接加 Stage 2 class（等价于滚动 >140px），不依赖页面实际可滚动高度
  await page.evaluate(() => {
    document.querySelector('.panel-main-inner')?.classList.add('scrolled-search', 'scrolled-header')
  })
  await page.waitForTimeout(200)
}

function intersects(
  a: { x: number; width: number } | null,
  b: { x: number; width: number } | null,
): boolean {
  if (!a || !b) return false
  return a.x < b.x + b.width && b.x < a.x + a.width
}

test.describe('移动端 Stage 2 头部', () => {
  test('未登录：标题与搜索切换按钮不相交，且标题可见', async ({ page }) => {
    await enterStage2(page)

    const title = page.locator('.panel-breadcrumb')
    const searchBtn = page.locator('#searchToggleBtn')
    await expect(title).toBeVisible()
    await expect(searchBtn).toBeVisible()

    const tb = await title.boundingBox()
    const sb = await searchBtn.boundingBox()
    expect(tb, '标题应有实际尺寸').toBeTruthy()
    expect(sb, '搜索按钮应有实际尺寸').toBeTruthy()
    expect(intersects(tb, sb), `标题 ${JSON.stringify(tb)} 与搜索按钮 ${JSON.stringify(sb)} 不应相交`).toBe(false)

    // 标题必须完整落在按钮组左侧，而不是被盖住一半
    expect(tb!.x).toBeGreaterThanOrEqual(0)
    expect(tb!.x + tb!.width).toBeLessThanOrEqual(sb!.x + 1)
  })

  test('标题严格水平居中于视口（方案 B 不改居中方式）', async ({ page }) => {
    await enterStage2(page)
    const tb = await page.locator('.panel-breadcrumb').boundingBox()
    expect(tb).toBeTruthy()
    const center = tb!.x + tb!.width / 2
    // 绝对居中 left:50% + translateX(-50%)：中心应与视口中线重合（±2px 容差取整）
    expect(Math.abs(center - MOBILE.width / 2)).toBeLessThanOrEqual(2)
  })

  test('Stage 2 不出现登录入口（未滚动时才可见）', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/app')
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 15000 })

    // 未滚动：未登录 + 移动端 → 登录入口在头部
    await expect(page.getByTestId('header-login-btn')).toBeVisible()

    await page.evaluate(() => {
      document.querySelector('.panel-main-inner')?.classList.add('scrolled-search', 'scrolled-header')
    })
    await page.waitForTimeout(200)
    // 滚动态：收起（避免挤占简化头部的横向空间）
    await expect(page.getByTestId('header-login-btn')).toBeHidden()
  })

  test('超长分类名：标题省略而不压到按钮组', async ({ page }) => {
    await enterStage2(page)

    const title = page.locator('.panel-breadcrumb')
    await title.evaluate((el) => { el.textContent = '这是一个非常非常长的分类名称用来验证省略与不重叠行为' })
    await page.waitForTimeout(120)

    const tb = await title.boundingBox()
    const sb = await page.locator('#searchToggleBtn').boundingBox()
    expect(intersects(tb, sb)).toBe(false)

    // 省略生效：内容宽度超过可视宽度
    const overflow = await title.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(overflow).toBe(true)
  })
})
