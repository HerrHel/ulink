/**
 * e2e/landing.spec.ts — 宣传落地页（/）E2E 测试
 *
 * 双入口结构：/ = 落地页（index.html 静态），/app = 应用主体（app.html）。
 * 覆盖关键分流行为：
 * - 新访客：留在落地页，CTA 指向 /app
 * - 返客（localStorage 有应用痕迹）：首次曝光一次（落 seen 标记），之后秒跳 /app
 * - 关键参数直通：扩展保存 / 旧 #share/ 兜底链接不落宣传页
 * - 登录按钮：/app?login=1 直开认证弹窗
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
  test('新访客看到落地页与星链画布，不跳转', async ({ page }) => {
    await page.goto('/')
    // 干净环境下 landing.js 不应触发跳转
    await page.waitForURL('/')
    await expect(page.locator('h1')).toContainText('随时随地')
    await expect(page.locator('.hero-ctas a[href="/app"]')).toHaveCount(1)
    // 星链 canvas 已被 hero-visual.js 初始化（有实际像素尺寸）
    const canvas = page.locator('#constellation')
    await expect(canvas).toBeAttached()
    await expect.poll(async () =>
      canvas.evaluate((el) => (el as HTMLCanvasElement).width)
    ).toBeGreaterThan(0)
  })

  test('点击「开始使用」进入应用主体', async ({ page }) => {
    await page.goto('/')
    await page.locator('.hero-ctas a[href="/app"]').click()
    await page.waitForURL(/\/app$/)
    // 应用挂载完成（进入应用内首启引导属正常路径，此处只验证入口打通）
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
  })

  test('顶栏「登录」→ /app?login=1 直开认证弹窗', async ({ page }) => {
    await page.goto('/')
    await page.locator('a[href="/app?login=1"]').click()
    await page.waitForURL(/\/app/)
    // App.vue 读 login 参数后打开认证弹窗并清 query（H8）
    await expect(page.locator('.modal-mask.open').first()).toBeVisible({ timeout: 15000 })
  })

  test('返客首次到访：曝光一次落地页并落标记，再次到访秒跳 /app', async ({ page }) => {
    // persist.ts 每次保存都写 linkvault_v2 缓存；注入即模拟老用户
    await page.addInitScript(() => {
      localStorage.setItem('linkvault_v2', '{}')
    })
    await page.goto('/')
    // 无 seen 标记 → 首次到访曝光落地页（一次性曝光策略），并写入标记
    await page.waitForURL('/')
    await expect(page.locator('h1')).toContainText('随时随地')
    expect(await page.evaluate(() => localStorage.getItem('lv_landing_seen_v1'))).toBe('1')
    // 再次到访 → 恢复秒跳
    await page.goto('/')
    await page.waitForURL(/\/app/, { timeout: 10000 })
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
  })

  test('?stay=1 豁免秒跳（官网书签/手动分享链接场景）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('linkvault_v2', '{}')
      localStorage.setItem('lv_landing_seen_v1', '1')
    })
    await page.goto('/?stay=1')
    // 未被秒跳：URL 仍带 stay 参数，落地页正常渲染
    await expect(page).toHaveURL(/stay=1/)
    await expect(page.locator('h1')).toContainText('随时随地')
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
    await expect(page.locator('h1')).toContainText('随时随地')
    // 切到英文（原地替换，无 reload）
    await page.locator('#lang-toggle').click()
    await expect(page.locator('h1')).toContainText('Save, organize')
    await expect(page).toHaveTitle(/ulink — collect, organize & share/)
    // 切回中文（整页还原）
    await page.locator('#lang-toggle').click()
    await expect(page.locator('h1')).toContainText('随时随地')
    await expect(page.locator('#lang-toggle')).toHaveText('EN')
  })

  test('主题风格与深浅模式演示：丝滑滑块指示器与四套主题色同步', async ({ page }) => {
    await page.goto('/?stay=1#looks')
    const looks = page.locator('#looks')
    await expect(looks).toBeVisible()

    const styleEff = page.locator('[data-demo-style="eff"]')
    const styleComfort = page.locator('[data-demo-style="comfort"]')
    const modeLight = page.locator('[data-demo-mode="light"]')
    const modeDark = page.locator('[data-demo-mode="dark"]')
    const gliders = page.locator('.seg-glider')

    await expect(gliders).toHaveCount(2)

    // 初始状态：效率 · 浅色（#122E8A）
    await expect(styleEff).toHaveAttribute('aria-pressed', 'true')
    await expect(modeLight).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () =>
      gliders.first().evaluate(el => getComputedStyle(el).backgroundColor)
    ).toBe('rgb(18, 46, 138)')

    // 1. 切到深色模式：暗色效率主题色变为 #F04A8A（品红玫瑰粉，主站 tokens.css）
    await modeDark.click()
    await expect(modeDark).toHaveAttribute('aria-pressed', 'true')
    await expect(looks).toHaveAttribute('data-mode', 'dark')
    await expect.poll(async () =>
      gliders.first().evaluate(el => getComputedStyle(el).backgroundColor)
    ).toBe('rgb(240, 74, 138)')

    // 2. 切到舒适模式：舒适深色主题色变为 #E2E7BF（米白奶油色，主站 tokens.css），字色为深色高对比
    await styleComfort.click()
    await expect(styleComfort).toHaveAttribute('aria-pressed', 'true')
    await expect(looks).toHaveAttribute('data-style', 'comfort')
    await expect.poll(async () =>
      gliders.first().evaluate(el => getComputedStyle(el).backgroundColor)
    ).toBe('rgb(226, 231, 191)')
    await expect.poll(async () =>
      styleComfort.evaluate(el => getComputedStyle(el).color)
    ).toBe('rgb(37, 43, 56)')

    // 3. 切回浅色模式：舒适浅色主题色变为 #2C9678（翡翠绿，主站 tokens.css）
    await modeLight.click()
    await expect(modeLight).toHaveAttribute('aria-pressed', 'true')
    await expect(looks).toHaveAttribute('data-mode', 'light')
    await expect.poll(async () =>
      gliders.first().evaluate(el => getComputedStyle(el).backgroundColor)
    ).toBe('rgb(44, 150, 120)')

    // 4. 切回效率模式：回到 #122E8A
    await styleEff.click()
    await expect(styleEff).toHaveAttribute('aria-pressed', 'true')
    await expect(looks).toHaveAttribute('data-style', 'eff')
    await expect.poll(async () =>
      gliders.first().evaluate(el => getComputedStyle(el).backgroundColor)
    ).toBe('rgb(18, 46, 138)')
  })

  test('创作与分享：知识生命之树与用户分叉共生网络交互', async ({ page }) => {
    await page.goto('/?stay=1#create')
    const createSec = page.locator('#create')
    await expect(createSec).toBeVisible()

    const canvas = page.locator('#share-canvas')
    await expect(canvas).toBeVisible()

    // 截取初始状态
    await page.waitForTimeout(600)
    await createSec.screenshot({
      path: 'C:/Users/h2629/.gemini/antigravity/brain/454c6000-d16a-41ca-a4e8-11ffc771cffa/live_share_tree_initial.png'
    })

    // 点击画布右侧，触发顺势生长出新用户分支
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (box) {
      await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.45)
      await page.waitForTimeout(1000)
      await createSec.screenshot({
        path: 'C:/Users/h2629/.gemini/antigravity/brain/454c6000-d16a-41ca-a4e8-11ffc771cffa/live_share_tree_sprouted.png'
      })
    }
  })

  test('更多贴心细节：自由拖拽卡片与双语呈现', async ({ page }) => {
    await page.goto('/?stay=1#extras')
    const extras = page.locator('#extras')
    await expect(extras).toBeVisible()

    const dragTitle = page.locator('[data-i18n="x5.t"]')
    await expect(dragTitle).toBeVisible()
    await expect(dragTitle).toHaveText('自由拖拽，随心而动')

    const cards = page.locator('.extra')
    await expect(cards).toHaveCount(5)

    // 截取桌面端 5 列卡片效果
    await page.waitForTimeout(500)
    await extras.screenshot({
      path: 'C:/Users/h2629/.gemini/antigravity/brain/454c6000-d16a-41ca-a4e8-11ffc771cffa/extras_desktop.png'
    })

    // 测试英文呈现
    await page.locator('#lang-toggle').click()
    await expect(dragTitle).toHaveText('Fluid Drag & Drop')

    // 截取平板端响应式（800px 宽度，2 列 + 底部居中）
    await page.setViewportSize({ width: 800, height: 900 })
    await page.locator('#lang-toggle').click() // 切回中文
    await extras.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await extras.screenshot({
      path: 'C:/Users/h2629/.gemini/antigravity/brain/454c6000-d16a-41ca-a4e8-11ffc771cffa/extras_tablet.png'
    })
  })
})


