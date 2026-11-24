/**
 * e2e/landing.spec.ts — 站点首页与宣传页（/about）E2E 测试
 *
 * 2026-11-25 起：/ 与 /app 都直接是应用主体（app.html；生产里 / 是构建副本 index.html），
 * 宣传页搬到 /about（about.html），landing.js 不再做任何跳转。
 * 覆盖：
 * - / 直接出应用、URL 不跳转；任务参数（扩展保存 / 旧 #share/）在 / 上由应用直接处理
 * - /about：真实截图加载、老用户（有本地数据）也不被跳走；CTA 指向 /app
 * - 登录按钮 /app?login=1 直开认证弹窗；PRO 按钮 /app?upgrade=1 直开购买弹窗
 * - 定价区不写具体价格与额度（真源 plans 表）
 * - 双语切换：EN ⇄ 中文即时切换（文案 + 截图）
 * 依赖 dev server（playwright.config.ts 自动启动）。
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
  test('定价区：免费 / PRO 定性对比，不写具体价格与额度', async ({ page }) => {
    await page.goto('/about')
    const pricing = page.locator('#pricing')
    await expect(pricing).toBeVisible()
    // 只有免费 + PRO 两张方案卡
    await expect(pricing.locator('.plan')).toHaveCount(2)
    // 价格与额度真源是 plans 表（应用内购买弹窗实时读取），宣传页手抄必然落后——锁死不再出现
    const plans = pricing.locator('.plans')
    await expect(plans).not.toContainText('¥')
    await expect(pricing.locator('del')).toHaveCount(0)
    expect(await plans.innerText()).not.toMatch(/\d+\s*(次|天|万字)/)
    // 加密口径：只说「仅账号字段」
    await expect(plans).toContainText('仅账号字段端到端加密')
    // PRO 按钮直达应用内购买弹窗
    await expect(pricing.locator('a[href="/app?upgrade=1"]')).toHaveCount(1)
    // 退款政策链接可达（支付经营审核需要）
    await expect(pricing.locator('a[href="/legal/refund-policy.html"]')).toBeAttached()
  })

  test('定价区「查看价格并升级」→ /app?upgrade=1 直开购买弹窗', async ({ page }) => {
    await page.goto('/about')
    await page.locator('#pricing a[href="/app?upgrade=1"]').click()
    await page.waitForURL(/\/app/)
    // App.vue 读 upgrade 参数后打开购买弹窗并清 query（H8）
    await page.waitForURL((u) => u.search === '', { timeout: 15000 })
    await expect(page.locator('.modal-mask.open').first()).toBeVisible({ timeout: 15000 })
  })

  test('加密口径：页面任意处不得出现无限定的「端到端加密」裸宣称', async ({ page }) => {
    await page.goto('/about')
    // 合规修订：所有「端到端加密」字样都必须带「仅账号字段」限定；
    // 剔除如实限定后不得再残留裸宣称（含 >端到端加密< 一类裸文本节点）。
    const html = await page.content()
    expect(html.split('仅账号字段端到端加密').join('')).not.toContain('端到端加密')
  })

  test('直接访问 /：就是应用本身，不发生跳转', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 15000 })
    expect(new URL(page.url()).pathname).toBe('/')
    // 首页底部备案号：书签列表末尾居中展示
    await expect(page.getByTestId('site-beian')).toContainText('ICP备')
  })

  test('/about：首屏标题与真实应用截图', async ({ page }) => {
    await page.goto('/about')
    await expect(page.locator('h1')).toContainText('把散落的链接')
    await expect(page.locator('.hero .hero-cta a[href="/app"]')).toHaveCount(1)
    // 首屏主画面是真实应用截图（scripts/capture-landing.mjs 生成），必须能加载出来
    const shot = page.locator('.frame-desk img')
    await expect.poll(() => shot.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    // 页脚备案号静态可见
    await expect(page.locator('#foot-beian')).toContainText('ICP备')
  })

  test('点击「开始使用」进入应用主体', async ({ page }) => {
    await page.goto('/about')
    await page.locator('.hero .hero-cta a[href="/app"]').click()
    await page.waitForURL(/\/app$/)
    // 应用挂载完成（此处只验证入口打通）
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
  })

  test('顶栏「登录」→ /app?login=1 直开认证弹窗', async ({ page }) => {
    await page.goto('/about')
    await page.locator('a[href="/app?login=1"]').click()
    await page.waitForURL(/\/app/)
    // App.vue 读 login 参数后打开认证弹窗并清 query（H8）
    await expect(page.locator('.modal-mask.open').first()).toBeVisible({ timeout: 15000 })
  })

  test('老用户（有本地数据）访问 /about 不会被跳走', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('linkvault_v2', '{}')
      localStorage.setItem('lv_setup_done', '1')
    })
    await page.goto('/about')
    await expect(page.locator('h1')).toContainText('把散落的链接')
    expect(new URL(page.url()).pathname).toBe('/about')
  })

  test('扩展保存参数在 / 上由应用直接处理', async ({ page }) => {
    await page.goto('/?ext_save=1&ext_save_url=https%3A%2F%2Fexample.com%2Fpage&ext_save_title=%E6%B5%8B%E8%AF%95')
    // 应用按 H8 隐私设计读参后立即清 query，最终 URL 是干净的 /
    await page.waitForURL((u) => u.pathname === '/' && u.search === '', { timeout: 10000 })
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
  })

  test('旧 #share/ 兜底链接在 / 上由应用接管', async ({ page }) => {
    await page.goto('/#share/nonexistent-group-for-e2e')
    // 应用接管分享路由（不存在的组 → 分享错误占位，同 app.spec 的 #share 用例）
    await expect(page.locator('.share-state').first()).toBeVisible({ timeout: 15000 })
  })

  test('语言切换：中文 ⇄ English（文案、标题与截图一起切换）', async ({ page }) => {
    await page.goto('/about')
    await expect(page.locator('h1')).toContainText('把散落的链接')
    // 切到英文（原地替换，无 reload）
    await page.locator('#lang-toggle').click()
    await expect(page.locator('h1')).toContainText('Turn scattered links')
    await expect(page).toHaveTitle(/ulink — turn scattered links/)
    // 截图换成英文界面版本
    await expect(page.locator('.frame-desk img')).toHaveAttribute('src', '/landing/hero-app-en.webp')
    // 英文下加密口径同样带限定
    await expect(page.locator('.plans')).toContainText('only the account field is end-to-end encrypted')
    // 切回中文（整页还原）
    await page.locator('#lang-toggle').click()
    await expect(page.locator('h1')).toContainText('把散落的链接')
    await expect(page.locator('#lang-toggle')).toHaveText('EN')
  })

  test('「诺」与常见问题：承诺清单与付费相关问答都在', async ({ page }) => {
    await page.goto('/about#promise')
    await expect(page.locator('.pledges li')).toHaveCount(5)
    await expect(page.locator('.pledges')).toContainText('不自动续费')
    const faq = page.locator('.faq details')
    await expect(faq).toHaveCount(6)
    // 付费相关问答：到期与退款
    await faq.filter({ hasText: 'PRO 到期后' }).locator('summary').click()
    await expect(faq.filter({ hasText: 'PRO 到期后' }).locator('p')).toContainText('回到免费版')
    await expect(faq.filter({ hasText: '退款' }).locator('a[href="/legal/refund-policy.html"]')).toBeAttached()
  })
})
