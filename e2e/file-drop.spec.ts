/**
 * 从系统拖入文件 e2e（真实浏览器 DataTransfer + 真实组件冒泡链）
 *
 * 1. 主界面：拖入浏览器导出的书签 HTML → 出现投放提示 → 松手弹确认 → 确认后书签落库
 * 2. 主界面：拖入不可导入的文件 → 提示格式，不弹确认、不离开网站
 * 3. AI 页：拖入文件 → 作为附件引用到对话
 * 4. 右侧 AI 栏：拖到输入框上 → 同一文件只出现一次
 *
 * Playwright 不能把真实系统文件拖进页面，这里在页面里构造带 File 的 DataTransfer，
 * 再按浏览器顺序派发 dragenter / dragover / drop，走与真实拖放相同的事件处理链。
 */
import { test, expect, type Page } from '@playwright/test'
import { installSupabaseMock } from './helpers/supabaseMock'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lv_locale', 'zh-CN')
  })
  await installSupabaseMock(page)
})

const BOOKMARK_HTML = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><A HREF="https://drop-import-e2e.example.com/">拖入导入测试站</A>
</DL><p>`

/** 在 selector 元素上依次派发拖放事件；release 为 false 时只派发到 dragover（不松手） */
async function dropFiles(
  page: Page,
  selector: string,
  files: Array<{ name: string; type: string; content: string }>,
  opts: { release?: boolean } = {},
) {
  const dt = await page.evaluateHandle((list) => {
    const d = new DataTransfer()
    for (const f of list) d.items.add(new File([f.content], f.name, { type: f.type }))
    return d
  }, files)
  await page.dispatchEvent(selector, 'dragenter', { dataTransfer: dt })
  await page.dispatchEvent(selector, 'dragover', { dataTransfer: dt })
  if (opts.release !== false) await page.dispatchEvent(selector, 'drop', { dataTransfer: dt })
}

async function ready(page: Page) {
  await page.goto('/app')
  await page.getByTestId('lv-card-grid').waitFor({ state: 'attached', timeout: 15000 })
}

test.describe('从系统拖入文件', () => {
  test('主界面拖入书签 HTML：投放提示 → 确认 → 导入落库', async ({ page }) => {
    await ready(page)
    const file = { name: 'bookmarks.html', type: 'text/html', content: BOOKMARK_HTML }

    await dropFiles(page, '[data-testid="lv-card-grid"]', [file], { release: false })
    const overlay = page.getByTestId('lv-file-drop-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText('松开以导入书签')

    await dropFiles(page, '[data-testid="lv-card-grid"]', [file])
    await expect(overlay).toBeHidden()
    const confirm = page.locator('.modal-mask.open .confirm-msg')
    await expect(confirm).toContainText('bookmarks.html')
    await page.locator('.modal-mask.open .btn-danger').click()

    await page.waitForFunction(
      () => (localStorage.getItem('linkvault_v2') || '').includes('drop-import-e2e.example.com'),
      undefined,
      { timeout: 8000 },
    )
    expect(page.url()).toContain('/app')
  })

  test('主界面拖入不可导入的文件：提示格式，不弹确认、不离开网站', async ({ page }) => {
    await ready(page)
    await dropFiles(page, '[data-testid="lv-card-grid"]', [{ name: 'photo.png', type: 'image/png', content: 'x' }])
    await expect(page.getByText('无法导入该文件，请使用 HTML、JSON 或 CSV 格式')).toBeVisible()
    await expect(page.locator('.modal-mask.open')).toHaveCount(0)
    expect(page.url()).toContain('/app')
  })

  test('AI 页拖入文件：作为附件引用到对话', async ({ page }) => {
    await ready(page)
    await page.getByTestId('rail-item-ai').click()
    await expect(page.locator('#aiWorkspace')).toBeVisible()

    await dropFiles(page, '#aiWorkspace', [{ name: 'report.txt', type: 'text/plain', content: '季度总结' }])
    await expect(page.locator('#aiWorkspace .ai-attach-pill.file')).toHaveCount(1)
    await expect(page.locator('#aiWorkspace .ai-attach-pill.file')).toContainText('report.txt')
    // AI 页内不出现导入提示与确认
    await expect(page.getByTestId('lv-file-drop-overlay')).toHaveCount(0)
    await expect(page.locator('.modal-mask.open')).toHaveCount(0)
  })

  test('右侧 AI 栏拖到输入框上：同一文件只出现一次', async ({ page }) => {
    await ready(page)
    await page.locator('#btnToggleDetail').click()
    await expect(page.locator('.chat-textarea')).toBeVisible({ timeout: 5000 })

    await dropFiles(page, '.chat-input-dock', [{ name: 'notes.txt', type: 'text/plain', content: '会议记录' }])
    await expect(page.getByText('已添加附件「notes.txt」')).toBeVisible()
    // 等第二次（重复）解析有机会落地，再断言只有一个附件
    await page.waitForTimeout(300)
    await expect(page.locator('#detailPanel .chat-input-dock .chat-attached-chip')).toHaveCount(1)
    await expect(page.locator('.modal-mask.open')).toHaveCount(0)
  })
})
