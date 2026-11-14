/**
 * prod 产物后端形态守卫（#58）。
 *
 * 背景：prod e2e 白名单此前只有 app.spec.ts / landing.spec.ts 两个纯 UI 文件，
 * 认证 / 同步 / 后端形态从未在「生产构建产物」上被覆盖。生产构建按
 * .env.production 注入 VITE_BACKEND=cloudbase，前端应初始化 CloudBase 形态，
 * 而非默认套件（dev）里的 Supabase 形态。
 *
 * 为何不复用 e2e/l1-sync-mock.spec.ts：它用 Supabase 形态的假会话注入
 * （linkvault_auth / credentials_* 键），在 LV_E2E_PROD=1 的 CloudBase 产物上
 * 实测登录态无法恢复（设置页不显示假用户邮箱），与 prod 不兼容（审计 #58 提醒点）。
 * 本 spec **不注入任何登录态 / REST mock**，与 prod 产物天然兼容：只记录页面
 * 真实发出的后端请求，断言走 CloudBase 基址、不出现 Supabase Edge Function 特征。
 * 零凭据、零真实数据依赖；即便 CI 无外网，请求发出即被 page.on('request') 捕获。
 *
 * 仅对 LV_E2E_PROD=1 生效；dev（Supabase 形态）下整组按形态门控跳过，
 * 同步链路改由 e2e/l1-sync-mock.spec.ts 在默认 dev 套件覆盖，不用空 skip 占位。
 */
import { test, expect } from '@playwright/test'

const isProd = !!process.env.LV_E2E_PROD || process.env.npm_lifecycle_event === 'test:e2e:prod'

test.describe('生产产物后端形态守卫（仅 prod 构建）', () => {
  test.skip(!isProd, '仅对 LV_E2E_PROD=1 的 CloudBase 生产产物生效；dev 形态由 L1 mock 覆盖')

  test('分享链路请求走 CloudBase 基址，且不出现 Supabase Edge Function 请求', async ({ page }) => {
    const backendUrls: string[] = []
    page.on('request', (req) => {
      const u = req.url()
      // 只收集后端请求：排除 preview 本地资源与页面静态资源
      if (u.startsWith('http://localhost')) return
      if (/\.(js|css|png|jpe?g|svg|gif|webp|woff2?|ico|map)(\?|$)/.test(u)) return
      backendUrls.push(u)
    })

    // 分享路由会触发 shareStore.enter → 向后端发 get_share_secret / RPC 请求；
    // 远端无数据只影响分享内容，不影响「请求形态」这一断言。
    await page.goto('/app#share/prod-shape-probe')
    await expect(page.locator('#app').first()).toBeAttached({ timeout: 15000 })
    await expect.poll(() => backendUrls.length, { timeout: 15000 }).toBeGreaterThan(0)

    const cbHits = backendUrls.filter((u) => /tcloudbasegateway|ulink\.ren/.test(u))
    const sbHits = backendUrls.filter((u) => /supabase\.co|\/functions\/v1\//.test(u))
    expect(cbHits.length, `未捕获到 CloudBase 后端请求，实际请求：${backendUrls.join(' | ')}`).toBeGreaterThan(0)
    expect(sbHits, `生产产物不应发出 Supabase 形态请求：${sbHits.join(' | ')}`).toHaveLength(0)
  })
})
