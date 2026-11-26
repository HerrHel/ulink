/**
 * 跨账号隔离 E2E（仅生产构建 = 线上 CloudBase 形态）。
 *
 * 旧缺陷：切换账号时会把切换前账号的本地书签同步进新账号。修复见 src/lib/dataOwner.ts
 *（本地数据归属账号 + 同步总闸 + 按账号整体换仓）。这里在真实 UI、真实构建产物上验证：
 *
 *  1. A 会话异常断掉（队列里还有没推上去的 op），随后在同一设备登录 B：
 *     A 的书签与遗留 op 一条都不进 B 的云端、B 看不到 A 的书签；
 *     切回 A：A 的书签原样回来，遗留 op 推给 A；B 的书签不进 A。
 *  2. 同一设备两个标签页：标签页 2 换成 B 登录后，标签页 1 自动重载到 B 的数据，
 *     标签页 1 之后的保存 / 同步不会把 A 的内存快照写进 B 的仓或 B 的云端。
 */
import { test, expect, type Page } from '@playwright/test'
import { CB_USER, createCloudBaseBackend, loginViaUi, type CbBackend, type CbUser } from './helpers/cloudbaseMock'
import {
  card, createBookmark, dropSessionAbnormally, grid, isProd, logoutViaUi, newDevice, syncNow, type Device,
} from './helpers/cloudbaseDevice'

const A: CbUser = CB_USER
const B: CbUser = { sub: 'switch-e2e-b', email: 'switch-b@example.com' }

/** LV_E2E_DEBUG=1 时打印各标签页的导航 / 认证请求 / 关键日志（带重复序号，便于并行压测时归因） */
function debugTabs(pages: Record<string, Page>) {
  if (!process.env.LV_E2E_DEBUG) return
  const tag = `r${test.info().repeatEachIndex}`
  for (const [n, p] of Object.entries(pages)) {
    p.on('load', () => console.log(`${tag}[${n}] LOAD ${Date.now() % 100000}`))
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) console.log(`${tag}[${n}] navigated ${f.url()} ${Date.now() % 100000}`) })
    p.on('request', (r) => { if (r.url().includes('/auth/v1/')) console.log(`${tag}[${n}] ${r.method()} ${new URL(r.url()).pathname.replace(/.*auth\/v1/, '')} ${Date.now() % 100000}`) })
    p.on('console', (m) => { const x = m.text(); if (/dataOwner|persist|auth\]|reload/i.test(x)) console.log(`${tag}[${n}] ${x.slice(0, 160)} ${Date.now() % 100000}`) })
  }
}

/**
 * 登录一个与本地数据归属不同的账号：会整体换仓并整页重载。
 * 必须在登录前挂好 load 监听——重载期间旧 DOM 已清空，若只等「某卡片消失」会提前放行，
 * 随后的快捷键在新页面完成初始化前按下会丢失。others 为同上下文里也应随之重载的标签页。
 */
async function loginExpectingSwap(page: Page, email: string, others: Page[] = []) {
  const loads = [page, ...others].map((p) => p.waitForEvent('load', { timeout: 30000 }))
  await loginViaUi(page, email)
  await Promise.all(loads)
  for (const p of [page, ...others]) {
    await expect(grid(p)).toBeAttached({ timeout: 20000 })
    await expect(p.getByTestId('lv-btn-settings')).toBeVisible({ timeout: 20000 })
  }
}

const titlesOf = (backend: CbBackend, u: CbUser) => backend.liveFor('bookmarks', u.sub).map((r) => String(r.title))

test.describe('CloudBase 跨账号隔离（仅 prod 构建）', () => {
  test.skip(!isProd, '同步走 CloudBase 仅在生产形态；由 LV_E2E_PROD=1 覆盖')
  test.setTimeout(180000)

  let devices: Device[] = []
  test.afterEach(async () => {
    await Promise.all(devices.map((d) => d.context.close()))
    devices = []
  })

  test('A 会话异常断掉后登录 B：A 的数据不进 B；切回 A 原样恢复并补推', async ({ browser }) => {
    const backend = createCloudBaseBackend(A, [B])
    const d = await newDevice(browser, backend, 'D', A)
    devices.push(d)
    const { page } = d
    debugTabs({ page })

    await createBookmark(page, 'A在线书签', 'https://a-online.example.com/')
    await syncNow(page)
    await expect.poll(() => titlesOf(backend, A), { timeout: 15000 }).toContain('A在线书签')

    // 云端故障期间新建：推送失败，op 留在本机队列
    backend.down = true
    await createBookmark(page, 'A遗留书签', 'https://a-pending.example.com/')
    await syncNow(page)
    await page.waitForTimeout(2000)
    backend.down = false
    expect(titlesOf(backend, A)).not.toContain('A遗留书签')

    // 会话异常断掉：不走退出登录，队列 / 本地数据 / 归属原样留着
    await dropSessionAbnormally(page)
    await expect(card(page, 'A遗留书签')).toBeVisible({ timeout: 15000 }) // 离线仍可用

    // 同一设备登录 B → 整体换仓并整页重载
    await loginExpectingSwap(page, B.email)
    // B 在本机没有分仓 → 换成真空数据（不生成示例书签），A 的书签全部消失
    await expect(card(page, 'A在线书签')).toHaveCount(0, { timeout: 20000 })
    await expect(card(page, 'A遗留书签')).toHaveCount(0)

    await createBookmark(page, 'B自己的书签', 'https://b-own.example.com/')
    await syncNow(page)
    await expect.poll(() => titlesOf(backend, B), { timeout: 15000 }).toContain('B自己的书签')
    await page.reload() // 旧缺陷：刷新后会把 A 的本地存量当「云端缺失」补推给 B
    await expect(grid(page)).toBeAttached({ timeout: 15000 })
    await syncNow(page)
    await page.waitForTimeout(2500)
    expect(titlesOf(backend, B)).not.toContain('A在线书签')
    expect(titlesOf(backend, B)).not.toContain('A遗留书签')

    // 切回 A：本地数据原样回来，遗留 op 推给 A；B 的书签不进 A
    await logoutViaUi(page)
    await loginExpectingSwap(page, A.email)
    await expect(card(page, 'A在线书签')).toBeVisible({ timeout: 20000 })
    await expect(card(page, 'A遗留书签')).toBeVisible()
    await expect(card(page, 'B自己的书签')).toHaveCount(0)
    await expect.poll(() => titlesOf(backend, A), { timeout: 20000 }).toContain('A遗留书签')
    await syncNow(page)
    await page.waitForTimeout(2000)
    expect(titlesOf(backend, A)).not.toContain('B自己的书签')
    expect(titlesOf(backend, B)).not.toContain('A遗留书签')
  })

  test('双标签页：标签页 2 换成 B 登录，标签页 1 自动重载，不把 A 的内存快照写进 B', async ({ browser }) => {
    const backend = createCloudBaseBackend(A, [B])
    const d = await newDevice(browser, backend, 'D', A)
    devices.push(d)
    const tab1 = d.page

    await createBookmark(tab1, 'A标签页书签', 'https://a-tab.example.com/')
    await syncNow(tab1)
    await expect.poll(() => titlesOf(backend, A), { timeout: 15000 }).toContain('A标签页书签')

    const tab2 = await d.context.newPage()
    debugTabs({ tab1, tab2 })
    await tab2.goto('/app')
    await expect(card(tab2, 'A标签页书签')).toBeVisible({ timeout: 15000 })

    await logoutViaUi(tab2)
    // 标签页 1 没有任何操作，应被归属变更通知触发重载
    await loginExpectingSwap(tab2, B.email, [tab1])
    await expect(card(tab2, 'A标签页书签')).toHaveCount(0, { timeout: 20000 })

    // 标签页 1 重载后换成了 B 的数据
    await expect(card(tab1, 'A标签页书签')).toHaveCount(0, { timeout: 20000 })

    // 标签页 1 现在以 B 身份工作：新建的书签进 B，A 的书签不会被它写进 B
    await createBookmark(tab1, 'B标签页书签', 'https://b-tab.example.com/')
    await syncNow(tab1)
    await expect.poll(() => titlesOf(backend, B), { timeout: 15000 }).toContain('B标签页书签')
    await syncNow(tab2)
    await expect(card(tab2, 'B标签页书签')).toBeVisible({ timeout: 15000 })
    await tab2.waitForTimeout(2000)
    expect(titlesOf(backend, B)).not.toContain('A标签页书签')
    // A 的云端数据完好，且没有混入 B 的
    expect(titlesOf(backend, A)).toContain('A标签页书签')
    expect(titlesOf(backend, A)).not.toContain('B标签页书签')
  })
})
