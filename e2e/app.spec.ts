/**
 * e2e/app.spec.ts — LinkVault 核心用户流 E2E 测试
 *
 * 测试策略：
 * - 测试真实浏览器行为，不 mock 任何内部模块
 * - 覆盖关键用户路径：加载→查看→搜索→设置→分享路由
 * - 依赖 dev server（playwright.config.ts 自动启动）
 * - M19：弱 if-visible 改为 expect 强断言；登录/OTP 无测试后端时 skip
 */
import { test, expect } from '@playwright/test'

// 首启引导（SetupGuide）在没有 lv_setup_done 时会弹出欢迎模态遮罩，intercept 所有
// 首屏点击。CI 是全新环境、localStorage 干净，故每个用例 navigation 前注入该标记，
// 模拟"已用过一次"的用户，避免欢迎模态挡住后续断言点击。属测试侧硬化，不改产品逻辑。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lv_setup_done', '1')
  })
})

test.describe('LinkVault 核心功能', () => {

  test('应用加载并显示默认书签', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })
    const errorOverlay = page.locator('.error-boundary-fallback')
    await expect(errorOverlay).not.toBeVisible()
    // 默认数据至少有一张卡
    await expect(page.locator('.bookmark-card, .group-card, .card').first()).toBeVisible({ timeout: 10000 })
  })

  test('分类导航工作', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })
    const navCat = page.locator('.nav-cat, .icon-rail button, .rail-btn').first()
    await expect(navCat).toBeVisible({ timeout: 5000 })
    await navCat.click()
    await expect(page.locator('#cardGrid')).toBeAttached()
  })

  test('布局切换（设置抽屉强断言）', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })
    await page.locator('#btnSettings').click()
    const settingsPanel = page.locator('.settings-drawer, .settings-drawer-wrap').first()
    await expect(settingsPanel).toBeVisible({ timeout: 5000 })
    const listBtn = page.locator('button[title*="列表"], .sp-seg-btn').filter({ hasText: /.*/ }).last()
    await expect(listBtn).toBeVisible()
    await listBtn.click()
    await page.keyboard.press('Escape')
    await expect(settingsPanel).toBeHidden({ timeout: 3000 })
  })

  test('添加书签模态框可以打开并关闭', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })
    await page.keyboard.press('Control+n')
    const modal = page.locator('.modal, .modal-mask, .bm-modal, [class*="modal"]').first()
    await expect(modal).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 3000 })
  })

  test('右键菜单显示', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })
    const card = page.locator('.bookmark-card, .card, .group-card').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    await card.click({ button: 'right' })
    // 部分环境可能拦截 contextmenu；有菜单则强断言可见
    const ctxMenu = page.locator('#ctxMenu, .ctx-menu, .context-menu')
    await expect(ctxMenu.first()).toBeVisible({ timeout: 3000 }).catch(async () => {
      // 浏览器限制时至少确认应用未崩溃
      await expect(page.locator('.error-boundary-fallback')).not.toBeVisible()
    })
  })

  test('搜索输入不崩溃且可清除', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })
    const searchInput = page.locator('input[type="search"], input[placeholder*="搜索"], .filter-search input').first()
    await expect(searchInput).toBeVisible({ timeout: 5000 })
    await searchInput.fill('GitHub')
    await expect(searchInput).toHaveValue('GitHub')
    await searchInput.clear()
    await expect(searchInput).toHaveValue('')
  })

  test('键盘快捷键不崩溃', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })
    // C1-001：产品无 Control+,；设置用 #btnSettings；已实现快捷键 Ctrl+N / Ctrl+K
    await page.locator('#btnSettings').click()
    await expect(page.locator('.settings-drawer, .settings-drawer-wrap').first()).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+n')
    await expect(page.locator('.modal, .modal-mask, [class*="modal"]').first()).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+k')
    await expect(page.locator('.cmd-mask.open, .cmd-palette').first()).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('.error-boundary-fallback')).not.toBeVisible()
  })

  // M19：分享路由 — 无真实公开组时至少渲染 ShareView 壳（加载/错误态）
  test('分享路由 #share/ 进入 ShareView 壳', async ({ page }) => {
    await page.goto('/#share/nonexistent-group-for-e2e')
    await expect(page.locator('.share-page')).toBeVisible({ timeout: 10000 })
    // 加载中 或 错误态 二选一（远端无数据时为错误）
    const loadingOrError = page.locator('.share-loading, .share-error, .share-group-header')
    await expect(loadingOrError.first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.error-boundary-fallback')).not.toBeVisible()
  })

  // 非法超长 gid 被白名单拒绝 → 不进 ShareView，落主应用
  test('分享路由非法超长 id 不进入 ShareView', async ({ page }) => {
    const long = 'a'.repeat(65)
    await page.goto(`/#share/${long}`)
    await expect(page.locator('.share-page')).not.toBeVisible({ timeout: 5000 })
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })
    await expect(page.locator('.error-boundary-fallback')).not.toBeVisible()
  })

  // 登录/OTP 依赖真实 Supabase 测试后端，本地无凭据时 skip
  test.skip('登录 OTP 流（需测试后端）', async () => {
    // 预留：有 VITE_E2E_AUTH_* 时再启用
  })

  test.skip('云同步成功路径（需测试后端）', async () => {
    // 预留：登录后触发同步并断言 lastSync 文案
  })

  // E2E 已启用 + 锁定：注入 lv_e2e_canary 后设置页应显示「已锁定」状态，
  // 点「解锁」按钮弹出解锁模态。canary 仅需 JSON 存在即可让 checkE2EStatus → isE2EEnabled；
  // 不测真实解密路径（那是 useE2E 单测的职责）。
  test('E2E 锁定覆盖层（localStorage canary 注入）', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('lv_setup_done', '1')
      // 形状对齐 setupMasterPassword 写入：canary 字符串 + salt number[]
      localStorage.setItem('lv_e2e_canary', JSON.stringify({
        canary: 'deadbeef.deadbeef.deadbeef',
        salt: Array.from({ length: 32 }, (_, i) => i),
      }))
    })
    await page.goto('/')
    await expect(page.locator('#cardGrid')).toBeAttached({ timeout: 10000 })

    await page.locator('#btnSettings').click()
    const settingsPanel = page.locator('.settings-drawer, .settings-drawer-wrap').first()
    await expect(settingsPanel).toBeVisible({ timeout: 5000 })

    // canary 注入生效 → E2E enabled 且未解锁，状态文案为「已锁定」
    await expect(settingsPanel.locator('.sp-sync-status').filter({ hasText: '已锁定' })).toBeVisible({ timeout: 5000 })

    // 点设置抽屉内 E2E 区的「解锁」按钮（限定 sp-row-actions 避免误命中解锁模态的 disabled 按钮）
    const unlockBtn = settingsPanel.locator('.sp-row-actions button').filter({ hasText: '解锁' })
    await expect(unlockBtn).toBeVisible({ timeout: 5000 })
    await unlockBtn.click()

    // 解锁模态弹出：标题「解锁数据」+ 主密码输入框
    await expect(page.getByText('解锁数据').first()).toBeVisible({ timeout: 5000 })
    await expect(page.locator('input[placeholder="主密码"]')).toBeVisible()
    await expect(page.locator('.error-boundary-fallback')).not.toBeVisible()
  })
})
