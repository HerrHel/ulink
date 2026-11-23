/**
 * 购买流程 E2E（仅生产构建产物，CloudBase 形态）。
 *
 * 为什么只在 prod 跑：usePayment 只在 isCloudBaseBackend() 时下单，dev 套件是 Supabase 形态
 * （下单直接 not_configured）。prod 产物按 .env.production 构建，与线上形态一致。
 *
 * 全程零真实出站：page.route 拦截 CloudBase 网关（*.tcloudbasegateway.com：登录 + rdb RPC）
 * 与同域云函数 https://ulink.ren/pay，按用例返回固定响应。登录走真实 UI（密码登录），
 * 由 js-sdk 发起 /auth/v1/signin → /auth/v1/user/me，顺带覆盖 CloudBase 登录链路。
 *
 * 覆盖（含「出错不出假二维码」守卫）：
 *  1. 微信扫码：选月付 → 下单 → 出二维码 → 轮询到 paid → 成功页 → 会员权益刷新
 *  2. 下单失败（渠道错误）→ 错误态 + 重试 → 重试成功出码
 *  3. 未登录点订阅 → 不发下单请求，弹出登录框
 *  4. 切换支付宝 → 以 alipay 渠道重新下单，展示收银台跳转链接
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const isProd = !!process.env.LV_E2E_PROD || process.env.npm_lifecycle_event === 'test:e2e:prod'

const USER = { sub: 'pay-e2e-uid', email: 'pay-e2e@example.com' }

const PLANS = [
  { planId: 'free', name: '免费版', priceCents: 0, currency: 'CNY', periodDays: 0, features: { 'ai.requests.daily': 20 } },
  { planId: 'plus_monthly', name: 'PRO 月付', priceCents: 1500, currency: 'CNY', periodDays: 30, features: { 'ai.requests.daily': 100 } },
  { planId: 'pro_quarterly', name: 'PRO 季付', priceCents: 3600, currency: 'CNY', periodDays: 90, features: { 'ai.requests.daily': 100 } },
  { planId: 'plus_yearly', name: 'PRO 年付', priceCents: 10800, currency: 'CNY', periodDays: 365, features: { 'ai.requests.daily': 100 } },
]

type PayBody = { action?: string; planId?: string; channel?: string; orderId?: string }

interface PayMockOptions {
  /** 第 N 次 create 返回的结果；缺省为成功 */
  createResponses?: Array<{ status: number; body: Record<string, unknown> }>
  /** 第几次 status 查询起返回 paid（从 1 计）；缺省 1，即首次轮询即到账 */
  paidAfterPolls?: number
}

interface Backend {
  payRequests: PayBody[]
  paid: boolean
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

/** 安装 CloudBase 网关 + /pay 云函数的全量 mock，返回可观测的后端状态 */
async function installBackend(page: Page, opts: PayMockOptions = {}): Promise<Backend> {
  const backend: Backend = { payRequests: [], paid: false }
  let createCount = 0
  let statusCount = 0
  const paidAfter = opts.paidAfterPolls ?? 1

  await page.addInitScript(() => {
    localStorage.setItem('lv_setup_done', '1')
    localStorage.setItem('lv_locale', 'zh-CN')
  })

  // CloudBase 网关：登录 + rdb
  await page.route((u) => u.hostname.endsWith('tcloudbasegateway.com'), async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const path = new URL(req.url()).pathname
    if (path.endsWith('/auth/v1/signin')) {
      return json(route, {
        token_type: 'Bearer', access_token: 'pay-e2e-at', refresh_token: 'pay-e2e-rt',
        expires_in: 7200, scope: 'user', sub: USER.sub,
      })
    }
    if (path.includes('/auth/v1/user/me')) {
      return json(route, { sub: USER.sub, email: USER.email, name: 'pay-e2e', groups: [], created_at: new Date().toISOString() })
    }
    if (path.endsWith('/rpc/list_purchase_plans')) return json(route, PLANS)
    if (path.endsWith('/rpc/my_entitlement')) {
      return json(route, backend.paid
        ? { plan_id: 'plus_monthly', plan_name: 'PRO 月付', status: 'active', expires_at: new Date(Date.now() + 30 * 864e5).toISOString(), features: PLANS[1].features }
        : { plan_id: 'free', plan_name: '免费版', status: 'active', expires_at: null, features: PLANS[0].features })
    }
    if (path.includes('/rdb/rest/rpc/')) return json(route, null)
    // 同步表读写：空库
    return req.method() === 'GET' ? json(route, []) : json(route, null, 201)
  })

  // 同域 HTTP 云函数 /pay（网关路由 https://ulink.ren/pay）
  await page.route((u) => u.hostname === 'ulink.ren' && u.pathname === '/pay', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = (req.postDataJSON() ?? {}) as PayBody
    backend.payRequests.push(body)

    if (body.action === 'plans') return json(route, { ok: true, plans: PLANS })

    if (body.action === 'create') {
      const preset = opts.createResponses?.[createCount]
      createCount++
      if (preset) return json(route, preset.body, preset.status)
      const orderId = `ord_e2e_${createCount}`
      return json(route, {
        ok: true,
        orderId,
        planId: body.planId,
        amountCents: PLANS.find((p) => p.planId === body.planId)?.priceCents ?? 0,
        channel: body.channel,
        status: 'pending',
        qrCode: body.channel === 'alipay' ? 'https://qr.alipay.com/e2e-test' : 'weixin://wxpay/bizpayurl?pr=e2etest',
        payUrl: body.channel === 'alipay' ? 'https://openapi.alipay.com/gateway.do?e2e=1' : null,
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      })
    }

    if (body.action === 'status') {
      statusCount++
      const nowPaid = statusCount >= paidAfter
      if (nowPaid) backend.paid = true
      return json(route, {
        ok: true,
        order: { orderId: body.orderId, planId: 'plus_monthly', amountCents: 1500, channel: 'wechat', status: nowPaid ? 'paid' : 'pending', qrCode: null, expiresAt: null },
      })
    }

    return json(route, { ok: false, error: 'unknown' }, 400)
  })

  return backend
}

/** 打开应用并等 Vue 挂载完成（与 app.spec 一致：卡片网格出现即就绪，过早点击会落在挂载前的静态壳上） */
async function gotoApp(page: Page) {
  await page.goto('/app')
  await expect(page.getByTestId('lv-card-grid')).toBeAttached({ timeout: 15000 })
}

async function openSettings(page: Page) {
  const drawer = page.getByTestId('lv-settings-drawer')
  if (!(await drawer.isVisible())) await page.getByTestId('lv-btn-settings').click()
  await expect(drawer).toBeVisible({ timeout: 10000 })
  return drawer
}

/** 经真实 UI 用密码登录（网关已 mock） */
async function login(page: Page) {
  await openSettings(page)
  await page.getByRole('button', { name: '登录 / 注册' }).click()
  const modal = page.locator('.modal-mask.open')
  await modal.getByText('密码登录').click()
  await modal.locator('input[type=email]:visible').fill(USER.email)
  await modal.locator('input[type=password]:visible').fill('Passw0rd123')
  await modal.locator('button:visible', { hasText: /^登录$/ }).click()
  await expect(page.locator('.modal-mask.open')).toHaveCount(0, { timeout: 15000 })
}

/** 设置 → 账号与会员 → 升级，打开收银台 */
async function openPurchase(page: Page) {
  const drawer = await openSettings(page)
  await drawer.getByTestId('settings-tab-account').click()
  await drawer.getByTestId('lv-upgrade-btn').click()
  const modal = page.locator('.pur-modal')
  await expect(modal).toBeVisible()
  // 等套餐加载完（卡片出现），再切到「月付」标签——默认周期是年付，月付卡片会被过滤
  await expect(modal.locator('.pur-tier-card').first()).toBeVisible({ timeout: 15000 })
  await modal.locator('.pur-cycle-tab').first().click()
  await expect(modal.getByTestId('plan-plus_monthly')).toBeVisible()
  return modal
}

async function subscribeMonthly(modal: ReturnType<Page['locator']>) {
  await modal.getByTestId('plan-plus_monthly').locator('.pur-card-btn').click()
}

test.describe('购买流程（仅 prod 构建，CloudBase 形态）', () => {
  test.skip(!isProd, '支付仅在 CloudBase 形态下单；dev 套件为 Supabase 形态，由 LV_E2E_PROD=1 覆盖')
  test.setTimeout(90000)

  test('微信扫码：下单 → 出码 → 轮询到账 → 成功页，会员权益刷新为 PRO', async ({ page }) => {
    const backend = await installBackend(page, { paidAfterPolls: 2 })
    await gotoApp(page)
    await login(page)
    const modal = await openPurchase(page)

    await subscribeMonthly(modal)

    // 下单请求契约：月付 + 默认微信渠道
    await expect.poll(() => backend.payRequests.find((r) => r.action === 'create')).toMatchObject({
      action: 'create', planId: 'plus_monthly', channel: 'wechat',
    })
    // 二维码渲染（qrcode 库已懒加载）
    await expect(modal.locator('.pur-qr-frame img')).toBeVisible()
    await expect(modal.getByTestId('qr-brand-wechat')).toBeVisible()

    // 轮询：第 2 次查单返回 paid → 成功页
    await expect(page.getByTestId('purchase-done')).toBeVisible({ timeout: 30000 })
    expect(backend.payRequests.filter((r) => r.action === 'status').length).toBeGreaterThanOrEqual(2)
    expect(backend.payRequests.every((r) => r.action !== 'status' || r.orderId === 'ord_e2e_1')).toBe(true)

    // 关闭后权益已刷新：再打开收银台，月付按钮文案变为「续费」
    await page.getByTestId('purchase-done').click()
    await expect(modal).toBeHidden()
    const again = await openPurchase(page)
    await expect(again.getByTestId('plan-plus_monthly').locator('.pur-card-btn')).toContainText('续费')
  })

  test('下单失败：展示错误态，点击重试后重新下单并出码', async ({ page }) => {
    const backend = await installBackend(page, {
      createResponses: [{ status: 502, body: { ok: false, error: 'channel_error' } }],
      paidAfterPolls: 999,
    })
    await gotoApp(page)
    await login(page)
    const modal = await openPurchase(page)

    await subscribeMonthly(modal)
    const errorState = modal.locator('.pur-qr-error-state')
    await expect(errorState).toBeVisible()
    await expect(modal.locator('.pur-qr-frame img')).toHaveCount(0)
    // 出错时不得提供「演示支付」假二维码（曾指向 /pay/test，线上用户会误以为在付款）
    await expect(modal.getByText('体验演示支付')).toHaveCount(0)

    await errorState.locator('.pur-btn-retry').click()
    await expect(modal.locator('.pur-qr-frame img')).toBeVisible()
    expect(backend.payRequests.filter((r) => r.action === 'create')).toHaveLength(2)
  })

  test('下单失败后切换渠道：按新渠道真实下单，不渲染假二维码', async ({ page }) => {
    const backend = await installBackend(page, {
      createResponses: [{ status: 502, body: { ok: false, error: 'channel_error' } }],
      paidAfterPolls: 999,
    })
    await gotoApp(page)
    await login(page)
    const modal = await openPurchase(page)

    await subscribeMonthly(modal)
    await expect(modal.locator('.pur-qr-error-state')).toBeVisible()

    await modal.getByTestId('channel-alipay').click()
    await expect.poll(() => backend.payRequests.filter((r) => r.action === 'create').map((r) => r.channel)).toEqual(['wechat', 'alipay'])
    await expect(modal.getByTestId('qr-brand-alipay')).toBeVisible()
    await expect(modal.locator('a[href="https://openapi.alipay.com/gateway.do?e2e=1"]')).toBeVisible()
  })

  test('未登录点订阅：不发下单请求，弹出登录框', async ({ page }) => {
    const backend = await installBackend(page)
    await gotoApp(page)
    const modal = await openPurchase(page)

    await subscribeMonthly(modal)
    await expect(page.locator('.modal-mask.open[aria-label="登录"]')).toBeVisible()
    expect(backend.payRequests.filter((r) => r.action === 'create')).toHaveLength(0)
  })

  test('切换支付宝：以 alipay 渠道重新下单，展示收银台跳转链接', async ({ page }) => {
    const backend = await installBackend(page, { paidAfterPolls: 999 })
    await gotoApp(page)
    await login(page)
    const modal = await openPurchase(page)

    await subscribeMonthly(modal)
    await expect(modal.locator('.pur-qr-frame img')).toBeVisible()

    await modal.getByTestId('channel-alipay').click()
    await expect.poll(() => backend.payRequests.filter((r) => r.action === 'create').map((r) => r.channel)).toEqual(['wechat', 'alipay'])
    await expect(modal.getByTestId('qr-brand-alipay')).toBeVisible()
    await expect(modal.locator('a[href="https://openapi.alipay.com/gateway.do?e2e=1"]')).toBeVisible()
  })
})
