// TOC 短内容隐藏验证：短内容（不可滚）隐藏 TOC，长内容（可滚）显示
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })

  let fail = 0
  const check = (label, cond) => { console.log((cond ? 'ok  ' : 'FAIL'), label); if (!cond) fail++ }

  // 短内容（示例页：内容不超视口，无法滚动）→ TOC 应隐藏
  await page.goto('http://localhost:7800/.verify_s_new_zh.html', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(600)
  const short = await page.evaluate(() => ({
    dist: document.documentElement.scrollHeight - window.innerHeight,
    tocDisplay: getComputedStyle(document.querySelector('.toc')).display,
    tocExists: !!document.querySelector('.toc'),
  }))
  console.log('短内容:', JSON.stringify(short))
  check('短内容存在 TOC（SSR 渲染）', short.tocExists)
  check('短内容 TOC 被隐藏', short.dist < 120 && short.tocDisplay === 'none')

  // 长内容（12 章节可滚动）→ TOC 应显示
  await page.goto('http://localhost:7800/.verify_scroll_long.html', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(600)
  const long = await page.evaluate(() => ({
    dist: document.documentElement.scrollHeight - window.innerHeight,
    tocDisplay: getComputedStyle(document.querySelector('.toc')).display,
  }))
  console.log('长内容:', JSON.stringify(long))
  check('长内容 TOC 可见', long.dist >= 120 && long.tocDisplay !== 'none')

  // resize：短内容视口缩小后（可滚）TOC 应恢复显示
  await page.goto('http://localhost:7800/.verify_s_new_zh.html', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.setViewportSize({ width: 1400, height: 400 })
  await page.waitForTimeout(600)
  const resized = await page.evaluate(() => ({
    dist: document.documentElement.scrollHeight - window.innerHeight,
    tocDisplay: getComputedStyle(document.querySelector('.toc')).display,
  }))
  console.log('短内容+小视口(resize):', JSON.stringify(resized))
  check('resize 后（视口变小可滚）TOC 恢复显示', resized.dist >= 120 && resized.tocDisplay !== 'none')

  console.log('JS 错误:', errs.length ? JSON.stringify(errs) : 'none')
  console.log(fail ? `\n${fail} 项 FAIL` : '\nALL PASS')
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('SCRIPT FAIL:', e.message); process.exit(1) })
