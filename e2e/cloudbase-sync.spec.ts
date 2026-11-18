/**
 * CloudBase 同步链路 E2E（仅生产构建产物 = 线上形态）。
 *
 * 此前同步 E2E 只有 Supabase 形态（l1-sync-mock），线上实际走的 CloudBase rdb 链路
 *（syncRemotePort.cloudbase → js-sdk → PostgREST 风格网关）没有任何端到端覆盖。
 *
 * 做法：两个浏览器上下文 = 两台设备，共用 Node 侧同一个内存「云端数据库」
 *（e2e/helpers/cloudbaseMock.ts，复刻服务端墓地 / 防复活触发器），登录走真实 UI。
 *
 * 场景：
 *  1. 双设备往返：A 新建 → 云端 → B 登录拉到；B 改标题 → A 同步后看到
 *  2. 删除不复活：A 删除 → B 同步后消失，B 刷新、再同步都不会把它推回云端
 *  3. 离线编辑：断网期间新建不丢，恢复联网后自动补推
 *  4. 冲突：B 离线改、A 抢先改并同步 → B 联网后出冲突横幅，选「保留本地」后云端以 B 为准
 *  5. 云端故障：同步失败时数据留在本地队列，云端恢复后再同步即补齐
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  attachCloudBase,
  bookmarkRow,
  createCloudBaseBackend,
  loginViaUi,
  type CbBackend,
} from './helpers/cloudbaseMock'

const isProd = !!process.env.LV_E2E_PROD || process.env.npm_lifecycle_event === 'test:e2e:prod'

interface Device {
  context: BrowserContext
  page: Page
}

/** 新开一台设备：独立上下文（独立 localStorage / IndexedDB），接同一个云端，登录并等首轮同步完成 */
async function newDevice(browser: Browser, backend: CbBackend): Promise<Device> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  await attachCloudBase(context, backend)
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

const grid = (page: Page) => page.getByTestId('lv-card-grid')
const card = (page: Page, title: string) => grid(page).locator('[data-id]', { hasText: title })

/** 命令面板「同步」：fullSync（先拉后推） */
async function syncNow(page: Page) {
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

async function createBookmark(page: Page, title: string, url: string) {
  await page.keyboard.press('Control+n')
  const modal = page.getByTestId('lv-bm-modal')
  await expect(modal).toBeVisible({ timeout: 5000 })
  await page.getByTestId('lv-bm-url').fill(url)
  await page.getByTestId('lv-bm-title').fill(title)
  await page.getByTestId('lv-bm-save').click()
  await expect(modal).toBeHidden({ timeout: 5000 })
  await expect(card(page, title)).toBeVisible()
}

async function openCtx(page: Page, title: string) {
  const c = card(page, title).first()
  await expect(c).toBeVisible()
  await c.dispatchEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 200 })
  const menu = page.locator('#ctxMenu')
  await expect(menu).toBeVisible({ timeout: 5000 })
  return menu
}

async function renameBookmark(page: Page, oldTitle: string, newTitle: string) {
  const menu = await openCtx(page, oldTitle)
  await menu.locator('[data-action="edit"]').click()
  const modal = page.getByTestId('lv-bm-modal')
  await expect(modal).toBeVisible({ timeout: 5000 })
  await page.getByTestId('lv-bm-title').fill(newTitle)
  await page.getByTestId('lv-bm-save').click()
  await expect(modal).toBeHidden({ timeout: 5000 })
  await expect(card(page, newTitle)).toBeVisible()
}

async function deleteBookmark(page: Page, title: string) {
  const menu = await openCtx(page, title)
  await menu.locator('[data-action="delete"]').click()
  // 部分删除路径会弹二次确认
  const confirm = page.locator('.modal-mask.open').getByRole('button', { name: /^(删除|确定|确认)$/ })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(card(page, title)).toHaveCount(0)
}

const liveTitles = (backend: CbBackend) => backend.live('bookmarks').map((r) => r.title)
const findLive = (backend: CbBackend, title: string) => backend.live('bookmarks').find((r) => r.title === title)

test.describe('CloudBase 同步（仅 prod 构建）', () => {
  test.skip(!isProd, '同步走 CloudBase 仅在生产形态；dev 套件为 Supabase 形态，由 LV_E2E_PROD=1 覆盖')
  test.setTimeout(120000)

  let devices: Device[] = []
  test.afterEach(async () => {
    await Promise.all(devices.map((d) => d.context.close()))
    devices = []
  })

  test('双设备往返：A 新建 → B 拉到；B 改标题 → A 同步后看到', async ({ browser }) => {
    const backend = createCloudBaseBackend()
    const a = await newDevice(browser, backend)
    devices.push(a)

    await createBookmark(a.page, 'E2E甲书签', 'https://sync-a.example.com/')
    await syncNow(a.page)
    await expect.poll(() => liveTitles(backend), { timeout: 15000 }).toContain('E2E甲书签')
    const id = findLive(backend, 'E2E甲书签')!.id as string
    expect(findLive(backend, 'E2E甲书签')!.url).toBe('https://sync-a.example.com/')

    const b = await newDevice(browser, backend)
    devices.push(b)
    await expect(card(b.page, 'E2E甲书签')).toBeVisible({ timeout: 15000 })

    await renameBookmark(b.page, 'E2E甲书签', 'E2E甲书签-乙改')
    await syncNow(b.page)
    await expect.poll(() => backend.row('bookmarks', id)?.title, { timeout: 15000 }).toBe('E2E甲书签-乙改')

    await syncNow(a.page)
    await expect(card(a.page, 'E2E甲书签-乙改')).toBeVisible({ timeout: 15000 })
    await expect(card(a.page, 'E2E甲书签')).toHaveCount(1) // 只有改名后的那一张（hasText 子串匹配）
    // 同一 id，没有生成重复条目
    expect(backend.live('bookmarks').filter((r) => String(r.title).startsWith('E2E甲书签'))).toHaveLength(1)
  })

  test('删除不复活：A 删除后，B 同步、刷新、再同步都不会把它推回云端', async ({ browser }) => {
    const backend = createCloudBaseBackend()
    backend.seed('bookmarks', bookmarkRow('cloud_del', '待删书签', 'https://del.example.com/', Date.now() - 60000))
    const a = await newDevice(browser, backend)
    const b = await newDevice(browser, backend)
    devices.push(a, b)
    await expect(card(a.page, '待删书签')).toBeVisible({ timeout: 15000 })
    await expect(card(b.page, '待删书签')).toBeVisible({ timeout: 15000 })

    await deleteBookmark(a.page, '待删书签')
    await syncNow(a.page)
    await expect.poll(() => liveTitles(backend), { timeout: 15000 }).not.toContain('待删书签')

    await syncNow(b.page)
    await expect(card(b.page, '待删书签')).toHaveCount(0, { timeout: 15000 })

    // B 刷新后（重新初始化同步）再手动同步：本地不应残留，更不能补推回云端
    await b.page.reload()
    await expect(grid(b.page)).toBeAttached({ timeout: 15000 })
    await syncNow(b.page)
    await b.page.waitForTimeout(2000)
    await expect(card(b.page, '待删书签')).toHaveCount(0)
    expect(liveTitles(backend)).not.toContain('待删书签')
  })

  test('离线编辑：断网期间新建的书签不丢，恢复联网后自动补推', async ({ browser }) => {
    const backend = createCloudBaseBackend()
    const a = await newDevice(browser, backend)
    devices.push(a)

    await a.context.setOffline(true)
    await createBookmark(a.page, 'E2E离线书签', 'https://offline.example.com/')
    // 越过自动推送的防抖窗口：离线时必然推不上去
    await a.page.waitForTimeout(4500)
    expect(liveTitles(backend)).not.toContain('E2E离线书签')

    await a.context.setOffline(false) // 触发 online 事件 → 先拉后推
    await expect.poll(() => liveTitles(backend), { timeout: 20000 }).toContain('E2E离线书签')
    await expect(card(a.page, 'E2E离线书签')).toBeVisible()
  })

  test('冲突：B 离线改、A 抢先改 → B 联网出冲突横幅，保留本地后云端以 B 为准', async ({ browser }) => {
    const backend = createCloudBaseBackend()
    backend.seed('bookmarks', bookmarkRow('cf1', '冲突原题', 'https://conflict.example.com/', Date.now() - 60000))
    const a = await newDevice(browser, backend)
    const b = await newDevice(browser, backend)
    devices.push(a, b)
    await expect(card(a.page, '冲突原题')).toBeVisible({ timeout: 15000 })
    await expect(card(b.page, '冲突原题')).toBeVisible({ timeout: 15000 })

    await b.context.setOffline(true)
    await renameBookmark(b.page, '冲突原题', '冲突-乙离线改')

    await renameBookmark(a.page, '冲突原题', '冲突-甲改')
    await syncNow(a.page)
    await expect.poll(() => backend.row('bookmarks', 'cf1')?.title, { timeout: 15000 }).toBe('冲突-甲改')

    await b.context.setOffline(false)
    const banner = b.page.getByTestId('lv-conflict-banner')
    await expect(banner).toBeVisible({ timeout: 20000 })
    // 横幅出现前，B 的离线修改不得静默覆盖云端
    expect(backend.row('bookmarks', 'cf1')?.title).toBe('冲突-甲改')

    await banner.getByTestId('lv-conflict-keep-local').first().click()
    await expect(card(b.page, '冲突-乙离线改')).toBeVisible()
    await expect.poll(() => backend.row('bookmarks', 'cf1')?.title, { timeout: 20000 }).toBe('冲突-乙离线改')

    await syncNow(a.page)
    await expect(card(a.page, '冲突-乙离线改')).toBeVisible({ timeout: 15000 })
  })

  test('云端故障：同步失败时数据留在本地，云端恢复后再同步即补齐', async ({ browser }) => {
    const backend = createCloudBaseBackend()
    const a = await newDevice(browser, backend)
    devices.push(a)

    backend.down = true
    await createBookmark(a.page, 'E2E故障期书签', 'https://outage.example.com/')
    await syncNow(a.page)
    await a.page.waitForTimeout(2000)
    expect(liveTitles(backend)).not.toContain('E2E故障期书签')
    await expect(card(a.page, 'E2E故障期书签')).toBeVisible()

    backend.down = false
    await syncNow(a.page)
    await expect.poll(() => liveTitles(backend), { timeout: 20000 }).toContain('E2E故障期书签')
  })
})
