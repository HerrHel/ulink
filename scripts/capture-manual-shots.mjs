import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0]
  if (reqPath === '/' || reqPath === '/app') reqPath = '/app.html'
  const filePath = path.join('dist', reqPath)
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath)
    const mimeMap = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png'
    }
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'text/plain' })
    res.end(fs.readFileSync(filePath))
  } else {
    res.writeHead(404)
    res.end('Not Found')
  }
})

server.listen(9128, async () => {
  try {
    const shotsDir = path.resolve('outputs/shots')
    if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true })

    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto('http://localhost:9128/app.html', { waitUntil: 'networkidle' })

    // 01 欢迎与快速引导
    await page.screenshot({ path: path.join(shotsDir, '01_welcome.png') })
    console.log('Saved 01_welcome.png')

    // 进入主界面
    const skipBtn = page.getByText('跳过，直接开始')
    if (await skipBtn.isVisible()) {
      await skipBtn.click()
      await page.waitForTimeout(500)
    }

    // 02 系统主工作台界面
    await page.screenshot({ path: path.join(shotsDir, '02_main_dashboard.png') })
    console.log('Saved 02_main_dashboard.png')

    // 03 新建书签模态框
    // 点击顶部的加号按钮展开菜单
    const addWrapBtn = page.locator('#addWrap button, button.btn-add, button.header-add-btn').first()
    if (await addWrapBtn.isVisible()) {
      await addWrapBtn.click()
      await page.waitForTimeout(300)
      const newBmBtn = page.locator('#addWrap').getByText('新建书签').first()
      if (await newBmBtn.isVisible()) {
        await newBmBtn.click()
        await page.waitForTimeout(500)
        await page.screenshot({ path: path.join(shotsDir, '03_modal_add_bookmark.png') })
        console.log('Saved 03_modal_add_bookmark.png')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(300)
      }
    }

    // 04 搜索与实时匹配
    const searchInput = page.locator('input[placeholder*="搜索"]').first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('Steam')
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(shotsDir, '04_search_filter.png') })
      console.log('Saved 04_search_filter.png')
      await searchInput.fill('')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }

    // 05 分类管理弹窗
    const manageCatBtn = page.getByText('管理分类').first()
    if (await manageCatBtn.isVisible()) {
      await manageCatBtn.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(shotsDir, '05_category_modal.png') })
      console.log('Saved 05_category_modal.png')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }

    // 06 设置面板
    const settingsBtn = page.locator('button[title*="设置"]').first()
    if (await settingsBtn.isVisible()) {
      await settingsBtn.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: path.join(shotsDir, '06_settings_panel.png') })
      console.log('Saved 06_settings_panel.png')
    }

    await browser.close()
    console.log('Finished capturing all manual shots successfully!')
  } catch (err) {
    console.error('Error:', err)
  } finally {
    server.close()
  }
})
