/**
 * CloudBase 形态下的加密与私密空间 E2E（仅生产构建产物 = 线上形态）。
 *
 * 此前加密 / 私密空间只有 dev 形态的单机用例（l0-e2e-crypto / l0-vault），没有验证过
 * 「换设备」与「云端到底存了什么」。这两块出错的后果是数据泄露或数据打不开，
 * 故在共享内存云端（e2e/helpers/cloudbaseMock.ts）上直接检查云端全部表的内容。
 *
 * 场景：
 *  1. 主密码跨设备：A 开启主密码并保存带账号 / 密码的书签 → 云端任何表（含 data_history
 *     版本历史）都不出现明文 → B 登录后处于锁定态，错误主密码解不开且不改动云端，
 *     正确主密码解锁后能看到原文
 *  2. 私密空间不上云：移入私密空间的书签从云端删除且不会复活；私密空间里新建的书签
 *     从不上云；另一台设备看不到
 */
import { test, expect, type Page } from '@playwright/test'
import { createCloudBaseBackend } from './helpers/cloudbaseMock'
import {
  card, createBookmark, isProd, newDevice, openCtx, syncNow, liveTitles, type Device,
} from './helpers/cloudbaseDevice'

const MASTER_PW = 'Cb-e2e-master-pw-9x'
const VAULT_PW = 'Cb-vault-pw-7y'
const SECRET_USER = 'secret-user-Q7zK'
const SECRET_PW = 'secret-pw-W3mX'

/** 关闭设置抽屉并等关闭动画结束（动画期间 isVisible 仍为 true，紧接着再打开会误判已打开） */
async function closeSettings(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('lv-settings-drawer')).toBeHidden({ timeout: 5000 })
}

async function openAccountSettings(page: Page) {
  const drawer = page.getByTestId('lv-settings-drawer')
  if (!(await drawer.isVisible())) await page.getByTestId('lv-btn-settings').click()
  await expect(drawer).toBeVisible({ timeout: 5000 })
  await drawer.getByTestId('settings-tab-account').click()
  return drawer
}

/** 设置 → 账号 → 开启主密码（与 l0-e2e-crypto 同一 UI 链路） */
async function setupMasterPassword(page: Page) {
  await openAccountSettings(page)
  await expect(page.getByTestId('lv-e2e-status')).toHaveText('未开启', { timeout: 10000 })
  await page.getByTestId('lv-e2e-setup-btn').click()
  await expect(page.getByTestId('lv-e2e-setup-modal')).toBeVisible({ timeout: 5000 })
  await page.getByTestId('lv-e2e-setup-password').fill(MASTER_PW)
  await page.getByTestId('lv-e2e-setup-password2').fill(MASTER_PW)
  await page.getByTestId('lv-e2e-setup-next').click()
  await expect(page.getByTestId('lv-e2e-setup-confirm')).toBeVisible({ timeout: 10000 })
  await page.getByText('我已保存 Recovery Key').click()
  await page.getByTestId('lv-e2e-setup-confirm').click()
  await expect(page.getByTestId('lv-e2e-setup-done')).toBeVisible({ timeout: 30000 })
  await page.getByTestId('lv-e2e-setup-done').click()
  await openAccountSettings(page)
  await expect(page.getByTestId('lv-e2e-status')).toHaveText('已解锁', { timeout: 10000 })
  await closeSettings(page)
}

async function tryUnlock(page: Page, pw: string) {
  await openAccountSettings(page)
  await page.getByTestId('lv-e2e-unlock-btn').click()
  const input = page.getByTestId('lv-e2e-unlock-password')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(pw)
  await page.getByTestId('lv-e2e-unlock-submit').click()
}

/** 打开书签编辑框，读出表单里的账号 / 密码后关闭（不保存） */
async function readCredentials(page: Page, title: string) {
  const menu = await openCtx(page, title)
  await menu.locator('[data-action="edit"]').click()
  const modal = page.getByTestId('lv-bm-modal')
  await expect(modal).toBeVisible({ timeout: 5000 })
  const username = await page.locator('#bmUsername').inputValue()
  const password = await page.locator('#bmPassword').inputValue()
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden({ timeout: 5000 })
  return { username, password }
}

/** 云端全量文本中不得出现的敏感值形态：明文 + base64（未开启加密时的旧存储形态，只是编码不是加密） */
function leakForms(secret: string): string[] {
  return [secret, Buffer.from(secret, 'utf8').toString('base64').replace(/=+$/, '')]
}
function expectNoLeak(dump: string) {
  for (const secret of [SECRET_USER, SECRET_PW]) {
    for (const form of leakForms(secret)) expect(dump, `云端出现敏感值形态：${form}`).not.toContain(form)
  }
}

const THREE_PART = /^[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$/

test.describe('CloudBase 加密与私密空间（仅 prod 构建）', () => {
  test.skip(!isProd, '加密 / 私密空间的云端行为仅在 CloudBase 生产形态验证；dev 单机链路由 l0-* 覆盖')
  test.setTimeout(180000)

  let devices: Device[] = []
  test.afterEach(async () => {
    await Promise.all(devices.map((d) => d.context.close()))
    devices = []
  })

  test('主密码跨设备：云端无明文；B 需主密码解锁，错误密码不改动云端', async ({ browser }) => {
    const backend = createCloudBaseBackend()
    const a = await newDevice(browser, backend, 'A')
    devices.push(a)

    await setupMasterPassword(a.page)
    await expect.poll(() => backend.tables.get('user_security')?.get(backend.user.sub)?.master_canary, { timeout: 15000 }).toBeTruthy()

    await createBookmark(a.page, 'E2E加密书签', 'https://secure.example.com/', { username: SECRET_USER, password: SECRET_PW })
    await syncNow(a.page)
    await expect.poll(() => liveTitles(backend), { timeout: 15000 }).toContain('E2E加密书签')

    // 云端（所有表，含版本历史 data_history）任何位置都不得出现账号 / 密码明文
    const row = backend.live('bookmarks').find((r) => r.title === 'E2E加密书签')!
    expect(String(row.username)).toMatch(THREE_PART)
    expect(row.password).toBeTruthy()
    expectNoLeak(backend.dump())

    // B：登录后从云端拿到 canary → 处于锁定态
    const b = await newDevice(browser, backend, 'B')
    devices.push(b)
    await expect(card(b.page, 'E2E加密书签')).toBeVisible({ timeout: 15000 })
    await openAccountSettings(b.page)
    await expect(b.page.getByTestId('lv-e2e-status')).toHaveText('已锁定', { timeout: 15000 })
    await closeSettings(b.page)

    // 错误主密码：解不开、仍锁定，云端该行不被改写
    const before = JSON.stringify(backend.row('bookmarks', String(row.id)))
    await tryUnlock(b.page, 'wrong-master-pw-000')
    await expect(b.page.getByText(/主密码错误|密码错误/).first()).toBeVisible({ timeout: 30000 })
    await b.page.keyboard.press('Escape')
    await expect(b.page.getByTestId('lv-e2e-unlock-password')).toBeHidden({ timeout: 5000 })
    await openAccountSettings(b.page)
    await expect(b.page.getByTestId('lv-e2e-status')).toHaveText('已锁定')
    await closeSettings(b.page)
    expect(JSON.stringify(backend.row('bookmarks', String(row.id)))).toBe(before)

    // 正确主密码：解锁后看到原文
    await tryUnlock(b.page, MASTER_PW)
    await expect(b.page.getByTestId('lv-e2e-unlock-password')).toBeHidden({ timeout: 30000 })
    await openAccountSettings(b.page)
    await expect(b.page.getByTestId('lv-e2e-status')).toHaveText('已解锁', { timeout: 10000 })
    await closeSettings(b.page)
    expect(await readCredentials(b.page, 'E2E加密书签')).toEqual({ username: SECRET_USER, password: SECRET_PW })

    // B 解锁后再同步一轮：仍不得把明文推上云
    await syncNow(b.page)
    await b.page.waitForTimeout(2000)
    expectNoLeak(backend.dump())
  })

  test('私密空间不上云：移入的书签从云端删除且不复活，私密空间内新建的书签从不上云', async ({ browser }) => {
    const backend = createCloudBaseBackend()
    const a = await newDevice(browser, backend, 'A')
    devices.push(a)

    await createBookmark(a.page, 'E2E将移入私密', 'https://to-vault.example.com/')
    await syncNow(a.page)
    await expect.poll(() => liveTitles(backend), { timeout: 15000 }).toContain('E2E将移入私密')
    const movedId = String(backend.live('bookmarks').find((r) => r.title === 'E2E将移入私密')!.id)

    // 开启私密空间（与 l0-vault 同一 UI 链路）
    await a.page.locator('#btnManageCats').click()
    await a.page.getByTestId('btnVaultEntry').click()
    await expect(a.page.getByTestId('lv-vault-setup-modal')).toBeVisible({ timeout: 5000 })
    await a.page.getByTestId('lv-vault-setup-password').fill(VAULT_PW)
    await a.page.getByTestId('lv-vault-setup-password2').fill(VAULT_PW)
    await a.page.getByTestId('lv-vault-setup-next').click()
    await expect(a.page.locator('.recovery-key-box')).toBeVisible({ timeout: 5000 })
    await a.page.locator('.check-chip').filter({ hasText: '我已保存 Recovery Key' }).click()
    await a.page.getByTestId('lv-vault-setup-confirm').click()
    await expect(a.page.getByTestId('lv-vault-setup-done')).toBeVisible({ timeout: 30000 })
    await a.page.getByTestId('lv-vault-setup-done').click()
    await expect(a.page.getByTestId('lv-vault-setup-modal')).toBeHidden({ timeout: 5000 })
    await expect.poll(() => backend.tables.get('user_security')?.get(backend.user.sub)?.vault_canary, { timeout: 15000 }).toBeTruthy()
    await a.page.keyboard.press('Escape')

    // 右键「移到私密空间」
    const menu = await openCtx(a.page, 'E2E将移入私密')
    await menu.locator('[data-action="moveToSpace"]').click()
    await expect(card(a.page, 'E2E将移入私密')).toHaveCount(0, { timeout: 10000 })
    await syncNow(a.page)
    await expect.poll(() => backend.row('bookmarks', movedId), { timeout: 15000 }).toBeUndefined()

    // 进入私密空间：移入的书签在，再新建一条
    await a.page.locator('#btnManageCats').click()
    await a.page.getByTestId('btnVaultEntry').click()
    const unlock = a.page.getByTestId('lv-vault-unlock-password')
    if (await unlock.isVisible({ timeout: 3000 }).catch(() => false)) {
      await unlock.fill(VAULT_PW)
      await a.page.getByTestId('lv-vault-unlock-submit').click()
    }
    await expect(a.page.getByTestId('btnBackToMain')).toBeVisible({ timeout: 15000 })
    await expect(card(a.page, 'E2E将移入私密')).toBeVisible({ timeout: 10000 })
    await createBookmark(a.page, 'E2E私密内新建', 'https://vault-only.example.com/')
    // 越过自动推送防抖窗口；私密空间内的编辑不得触发任何上云
    await a.page.waitForTimeout(5000)

    // 回主页再手动同步一轮
    await a.page.getByTestId('btnBackToMain').click()
    await expect(a.page.locator('#btnManageCats')).toBeVisible({ timeout: 10000 })
    await syncNow(a.page)
    await a.page.waitForTimeout(2000)

    expect(backend.dump()).not.toContain('E2E私密内新建')
    expect(backend.dump()).not.toContain('vault-only.example.com')
    expect(backend.row('bookmarks', movedId)).toBeUndefined()
    expect(liveTitles(backend)).not.toContain('E2E将移入私密')

    // B：看不到移入私密空间的书签，也看不到私密空间内新建的
    const b = await newDevice(browser, backend, 'B')
    devices.push(b)
    await syncNow(b.page)
    await b.page.waitForTimeout(2000)
    await expect(card(b.page, 'E2E将移入私密')).toHaveCount(0)
    await expect(card(b.page, 'E2E私密内新建')).toHaveCount(0)
    expect(backend.row('bookmarks', movedId)).toBeUndefined()
  })
})
