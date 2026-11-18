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
import { test, expect } from '@playwright/test'
import { bookmarkRow, createCloudBaseBackend } from './helpers/cloudbaseMock'
import {
  card, createBookmark, deleteBookmark, findLive, grid, isProd, liveTitles, newDevice, renameBookmark, syncNow, type Device,
} from './helpers/cloudbaseDevice'

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
