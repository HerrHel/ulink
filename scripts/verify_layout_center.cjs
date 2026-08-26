// 布局居中验证：1400 视口三栏（主卡严格居中 + TOC 左 + 列表右） / 1280 视口两栏回退
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch()
  let fail = 0
  const check = (label, cond, detail) => { console.log((cond ? 'ok  ' : 'FAIL'), label, detail || ''); if (!cond) fail++ }

  // 长内容页（可滚动，TOC 显示）
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto('http://localhost:7800/.verify_scroll_long.html', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(500)

  const layout = await page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), c: Math.round(b.left + b.width / 2), w: Math.round(b.width) } }
    return {
      winW: window.innerWidth,
      card: r(document.querySelector('.focus-card')),
      toc: r(document.querySelector('.toc')),
      list: r(document.querySelector('.bm-list')),
      tocPos: getComputedStyle(document.querySelector('.toc')).position,
      listPos: getComputedStyle(document.querySelector('.bm-list')).position,
    }
  })
  console.log('1400 视口布局:', JSON.stringify(layout))
  check('TOC fixed 左侧', layout.tocPos === 'fixed' && layout.toc.l === 24)
  check('列表 fixed 右侧', layout.listPos === 'fixed' && layout.list.r === layout.winW - 24)
  check('主卡严格居中（中心=视口中心）', Math.abs(layout.card.c - layout.winW / 2) <= 2, `card.c=${layout.card.c} win/2=${layout.winW / 2}`)
  check('TOC 与主卡不重叠', layout.toc.r < layout.card.l)
  check('列表与主卡不重叠', layout.list.l > layout.card.r)

  await page.screenshot({ path: '.verify_layout_1400.png' })
  await page.close()

  // 1280 视口 → 两栏回退（TOC 隐藏、列表静态、main 1000 居中）
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page2.goto('http://localhost:7800/.verify_scroll_long.html', { waitUntil: 'networkidle', timeout: 30000 })
  await page2.waitForTimeout(500)
  const layout2 = await page2.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), c: Math.round(b.left + b.width / 2), w: Math.round(b.width) } }
    return {
      winW: window.innerWidth,
      tocDisplay: getComputedStyle(document.querySelector('.toc')).display,
      listPos: getComputedStyle(document.querySelector('.bm-list')).position,
      main: r(document.querySelector('.main')),
      list: r(document.querySelector('.bm-list')),
    }
  })
  console.log('1280 视口布局:', JSON.stringify(layout2))
  check('1280 视口 TOC 隐藏', layout2.tocDisplay === 'none')
  check('1280 视口列表回归流内（main 内右侧）', layout2.listPos === 'static' && layout2.list.r <= layout2.main.r)
  check('1280 视口 main 居中', Math.abs(layout2.main.c - layout2.winW / 2) <= 2)
  await page2.screenshot({ path: '.verify_layout_1280.png' })
  await page2.close()

  console.log(fail ? `\n${fail} 项 FAIL` : '\nALL PASS')
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('SCRIPT FAIL:', e.message); process.exit(1) })
