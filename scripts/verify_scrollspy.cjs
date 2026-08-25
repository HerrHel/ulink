// scrollspy 修复验证（长文档可滚动场景）：点击导航 → 高亮正确切换、不粘连
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  const errs = []
  page.on('pageerror', e => errs.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
  await page.goto('http://localhost:7800/.verify_scroll_long.html', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(500)

  const getActive = () => page.$$eval('.toc-item', els => els.filter(e => e.classList.contains('active')).map(e => e.textContent.trim()))
  const state = () => page.evaluate(() => ({ scrollY: Math.round(window.scrollY), hash: location.hash }))

  let fail = 0
  const check = async (label, want) => {
    const act = await getActive()
    const st = await state()
    console.log(label, '→ 高亮:', JSON.stringify(act), '|', JSON.stringify(st))
    if (act.length !== 1 || act[0] !== want) { console.error('  ✗ 期望:', want); fail++ }
  }

  console.log('初始:', JSON.stringify(await getActive()), JSON.stringify(await state()))
  await page.click('.toc-item[href="#toc-1"]') // 章节 1
  await page.waitForTimeout(1500)
  await check('点击章节1', '章节 1')

  await page.click('.toc-item[href="#toc-6"]') // 章节 6
  await page.waitForTimeout(1500)
  await check('点击章节6', '章节 6')

  await page.click('.toc-item[href="#toc-12"]') // 章节 12（最后）
  await page.waitForTimeout(1500)
  await check('点击章节12', '章节 12')

  await page.click('.toc-item[href="#toc-0"]') // 总标题（顶部）
  await page.waitForTimeout(1500)
  await check('点击总标题', '总标题')

  // 手动滚动到章节 3 区域（scrollIntoView）
  await page.evaluate(() => document.getElementById('toc-3').scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(600)
  await check('滚动到章节3', '章节 3')

  // 手动滚动到章节 9 区域
  await page.evaluate(() => document.getElementById('toc-9').scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(600)
  await check('滚动到章节9', '章节 9')

  console.log('JS 错误:', errs.length ? JSON.stringify(errs) : 'none')
  console.log(fail ? `\n${fail} 项 FAIL` : '\nALL PASS')
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('SCRIPT FAIL:', e.message); process.exit(1) })
