/**
 * e2e/landing.spec.ts — 站点首页与宣传页（/about）E2E 测试
 *
 * 2026-11-25 起：/ 与 /app 都直接是应用主体（app.html；生产里 / 是构建副本 index.html），
 * 宣传页搬到 /about（about.html），landing.js 不再做任何跳转。
 * 覆盖：
 * - / 直接出应用、URL 不跳转；任务参数（扩展保存 / 旧 #share/）在 / 上由应用直接处理
 * - /about：老用户（有本地数据）也不被跳走；CTA 指向 /app
 * - 登录按钮：/app?login=1 直开认证弹窗
 * - 双语切换：EN ⇄ 中文即时切换
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
  test('定价区：展示免费与 PRO 三档价格及权益对比', async ({ page }) => {
    await page.goto('/about')
    const pricing = page.locator('#pricing')
    await expect(pricing).toBeVisible()
    // 档位卡数量（免费 + 月付 + 季付 + 年付）
    await expect(pricing.locator('.price-card')).toHaveCount(4)
    // 关键价格
    await expect(pricing).toContainText('¥15')
    await expect(pricing).toContainText('¥108')
    // 划线价只能等于「按月订满同周期」的真实支出：季付 ¥45（=15×3）、年付 ¥180（=15×12），
    // 月付为基准价故无划线价。虚构更高的"原价"属价格欺诈，此处锁死。
    await expect(pricing.locator('del')).toHaveCount(2)
    await expect(pricing.locator('.price-featured del')).toHaveText('¥180')
    // 合规修订：徽标改为中性表述，省额注明「较按月订阅同周期合计省」
    await expect(pricing.locator('.price-featured .price-badge')).toContainText('订阅期内价格锁定 · 较按月订阅同周期合计省 ¥72')
    await expect(pricing).toContainText('进阶特惠 · 较按月订阅同周期合计省 ¥9')
    // 权益对比表的关键差异行（免费 200MB / PRO 5GB，且免费不支持全库巡检）
    // 合规修订：加密口径改为「仅账号字段端到端加密同步」，不再用无限定措辞
    await expect(pricing.locator('.price-compare')).toContainText('仅账号字段端到端加密同步')
    // 与 plans 表对齐：AI 为 PRO 专属（免费仅终身试用）、云端历史分档；已撤下的存储空间不得再展示
    await expect(pricing.locator('.price-compare')).toContainText('试用 30 次（累计）')
    await expect(pricing.locator('.price-compare')).toContainText('365 天')
    await expect(pricing.locator('.price-compare')).not.toContainText('5 GB')
    await expect(pricing.locator('.price-compare')).toContainText('每周巡检')
    // 退款政策链接可达（支付经营审核需要）
    await expect(pricing.locator('a[href="/legal/refund-policy.html"]')).toBeVisible()
  })

  test('加密口径：页面任意处不得出现无限定的「端到端加密」裸宣称', async ({ page }) => {
    await page.goto('/about')
    // 合规修订：所有「端到端加密」字样都必须带「仅账号字段」限定；
    // 剔除如实限定后不得再残留裸宣称（含 >端到端加密< 一类裸文本节点）。
    // sync.d2 是「加密范围如实说明」，本身不含该字样，不在此列。
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

  test('/about：正常展示宣传页与星链画布', async ({ page }) => {
    await page.goto('/about')
    await expect(page.locator('h1')).toContainText('随时随地')
    await expect(page.locator('.hero-ctas a[href="/app"]')).toHaveCount(1)
    const canvas = page.locator('#constellation')
    await expect(canvas).toBeAttached()
    await expect.poll(async () =>
      canvas.evaluate((el) => (el as HTMLCanvasElement).width)
    ).toBeGreaterThan(0)
  })

  test('点击「开始使用」进入应用主体', async ({ page }) => {
    await page.goto('/about')
    await page.locator('.hero-ctas a[href="/app"]').click()
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
    await expect(page.locator('h1')).toContainText('随时随地')
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

  test('语言切换：中文 ⇄ English', async ({ page }) => {
    await page.goto('/about')
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
    await page.goto('/about#looks')
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

    // 1. 切到深色模式：暗色效率主题色变为 #4A90F7（精工烤蓝黄金点，主站 tokens.css）
    await modeDark.click()
    await expect(modeDark).toHaveAttribute('aria-pressed', 'true')
    await expect(looks).toHaveAttribute('data-mode', 'dark')
    await expect.poll(async () =>
      gliders.first().evaluate(el => getComputedStyle(el).backgroundColor)
    ).toBe('rgb(74, 144, 247)')

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

  test('创作与分享：轻松分享区块呈现', async ({ page }) => {
    await page.goto('/about#create')
    const createSec = page.locator('#create')
    await expect(createSec).toBeVisible()
    await expect(page.locator('[data-i18n="create.title"]')).toBeVisible()
  })

  test('更多细节：拖拽卡片与双语呈现', async ({ page }) => {
    await page.goto('/about#extras')
    const extras = page.locator('#extras')
    await expect(extras).toBeVisible()

    const dragTitle = page.locator('[data-i18n="x5.t"]')
    await expect(dragTitle).toBeVisible()
    await expect(dragTitle).toHaveText('拖拽排序与归类')

    const cards = page.locator('.extra')
    await expect(cards).toHaveCount(5)

    // 测试英文呈现
    await page.locator('#lang-toggle').click()
    await expect(dragTitle).toHaveText('Drag to sort & file')

    // 切回中文
    await page.locator('#lang-toggle').click()
    await expect(dragTitle).toHaveText('拖拽排序与归类')
  })
})


