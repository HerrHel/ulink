// JS 动态布局验证：任意视口主卡永远居中，两侧按 5:8 比例缩放（窄屏隐藏）
const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  let fail = 0
  const check = (label, cond, detail) => { console.log((cond ? 'ok  ' : 'FAIL'), label, detail || ''); if (!cond) fail++ }

  await page.goto('http://localhost:7800/.verify_scroll_long.html', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(500)

  const measure = () => page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), c: Math.round(b.left + b.width / 2), w: Math.round(b.width) } }
    return {
      winW: window.innerWidth,
      card: r(document.querySelector('.focus-card')),
      toc: r(document.querySelector('.toc')),
      list: r(document.querySelector('.bm-list')),
      tocD: getComputedStyle(document.querySelector('.toc')).display,
      listD: getComputedStyle(document.querySelector('.bm-list')).display,
    }
  })

  const WIDTHS = [1920, 1400, 1280, 1100, 800]
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.waitForTimeout(400)
    const m = await measure()
    const centered = Math.abs(m.card.c - m.winW / 2) <= 2
    console.log(`W=${w}: card.c=${m.card.c} win/2=${m.winW / 2} toc=[${m.toc.w}px,${m.tocD}] list=[${m.list.w}px,${m.listD}]`)
    check(`${w}px 主卡居中`, centered)
    if (m.tocD !== 'none') check(`${w}px TOC 不与主卡重叠`, m.toc.r <= m.card.l)
    if (m.listD !== 'none') check(`${w}px 列表不与主卡重叠且不溢出`, m.list.l >= m.card.r && m.list.r <= m.winW)
  }

  // resize 动态：1400 → 1000 → 1400 主卡始终居中（dl 重算）
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForTimeout(300)
  const m1 = await measure()
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.waitForTimeout(400)
  const m2 = await measure()
  check('resize 1400→1000 主卡仍居中', Math.abs(m2.card.c - m2.winW / 2) <= 2, `c=${m2.card.c} win/2=${m2.winW / 2}`)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.waitForTimeout(400)
  const m3 = await measure()
  check('resize 1000→1400 主卡仍居中', Math.abs(m3.card.c - m3.winW / 2) <= 2, `c=${m3.card.c}`)

  await page.screenshot({ path: '.verify_dyn_1400.png' })
  console.log(fail ? `\n${fail} 项 FAIL` : '\nALL PASS')
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('SCRIPT FAIL:', e.message); process.exit(1) })
