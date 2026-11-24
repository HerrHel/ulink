#!/usr/bin/env node
/**
 * capture-landing.mjs — 从真实应用截取宣传页（/about）用的产品画面，中英各一套
 *
 * 为什么：旧宣传页的画面是手绘 canvas，界面一改就过时。这里用 Playwright 打开真实应用
 * （全新浏览器上下文 = 新用户首次打开看到的默认示例数据），按剧本截图；界面改了重跑即可。
 *
 * 用法：先 `npm run dev`（或已有 dev server 在 5173），再
 *   node scripts/capture-landing.mjs [baseURL]
 * 产物：public/landing/<名称>.webp（中文）与 <名称>-en.webp（英文）。原始 PNG 只落系统临时目录，
 *       再由 ImageMagick（magick，可用环境变量 MAGICK 指定路径）转 webp，public/ 下不放 MB 级原图。
 *
 * 注意：「用」那张的 AI 回答是演示脚本（拦截 mimo-chat 返回固定 SSE，与 e2e/ai-chat.spec.ts
 * 同法），界面为真实渲染；宣传页图注必须如实写明这一点。
 */
import { chromium } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const BASE = process.argv[2] || 'http://localhost:5173'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const OUT = path.join(os.tmpdir(), 'ulink-landing-shots')
const DEST = path.join(ROOT, 'public', 'landing')
const SHOTS = ['hero-app', 'hero-mobile', 'collect-add', 'organize-sub', 'organize-note', 'use-chat']

/** 每种语言下剧本里用到的文案（应用自带示例数据的名称 + 演示用的提问与回答） */
const COPY = {
  'zh-CN': {
    suffix: '',
    guide: '上手指南',
    ask: '帮我找几个免费的在线画图工具',
    lead: '这几个都免费、打开就能用：',
    tail: '想存哪个，点一下就进你的书签。',
    cards: [
      { title: 'Excalidraw', url: 'https://excalidraw.com', notes: '开源手绘风白板，打开即画', tags: ['开源'] },
      { title: 'tldraw', url: 'https://www.tldraw.com', notes: '无限画布白板，适合草图与讨论', tags: ['免费'] },
      { title: 'Figma', url: 'https://www.figma.com', notes: '协作设计与 FigJam 白板，个人可免费使用', tags: ['免费'] },
    ],
  },
  'en-US': {
    suffix: '-en',
    guide: 'Getting Started',
    ask: 'Find me a few free online drawing tools',
    lead: 'These are all free and open right in the browser:',
    tail: 'Tap one to save it to your bookmarks.',
    cards: [
      { title: 'Excalidraw', url: 'https://excalidraw.com', notes: 'Open-source hand-drawn style whiteboard', tags: ['Open source'] },
      { title: 'tldraw', url: 'https://www.tldraw.com', notes: 'Infinite canvas for sketches and discussion', tags: ['Free'] },
      { title: 'Figma', url: 'https://www.figma.com', notes: 'Collaborative design and FigJam boards, free for individuals', tags: ['Free'] },
    ],
  },
}

/** PNG → webp */
function toWebp(name) {
  const bin = process.env.MAGICK || 'magick'
  const r = spawnSync(bin, [path.join(OUT, name + '.png'), '-quality', '82', '-define', 'webp:method=6', path.join(DEST, name + '.webp')], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('magick 转换失败：' + name)
}

/** 新用户首次打开：锁定语言 + 跳过首次引导，其余全部是应用自带的默认示例数据 */
async function newPage(browser, { width, height, locale }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'light', locale })
  await ctx.addInitScript((loc) => {
    localStorage.setItem('lv_setup_done', '1')
    localStorage.setItem('lv_locale', loc)
  }, locale)
  const page = await ctx.newPage()
  return { ctx, page }
}

async function openApp(page) {
  // 不等 load：第三方 favicon 服务偶尔很慢，会把 load 事件拖到超时
  await page.goto(BASE + '/app', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('lv-card-grid').waitFor({ state: 'attached', timeout: 20000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1200)
}

async function captureLocale(browser, locale) {
  const c = COPY[locale]
  const file = (name) => path.join(OUT, name + c.suffix + '.png')

  // 1. 首屏主画面：桌面端完整应用
  {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, locale })
    await openApp(page)
    await page.screenshot({ path: file('hero-app') })
    await ctx.close()
  }
  // 2. 手机端应用画面
  {
    const { ctx, page } = await newPage(browser, { width: 390, height: 844, locale })
    await openApp(page)
    await page.screenshot({ path: file('hero-mobile') })
    await ctx.close()
  }
  // 3. 「收」：新建书签弹窗，只填网址，其余交给应用自动识别
  {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, locale })
    await openApp(page)
    await page.keyboard.press('Control+n')
    await page.waitForTimeout(800)
    await page.keyboard.type('https://www.figma.com', { delay: 25 })
    await page.keyboard.press('Tab')
    await page.waitForTimeout(7000)
    await page.locator('.modal-mask.open .modal').first().screenshot({ path: file('collect-add') })
    await ctx.close()
  }
  // 4. 「理」a：带子书签的书签卡（默认示例里的 DeepSeek）
  {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, locale })
    await openApp(page)
    const card = page.locator('.card:not(.group-card)', { hasText: 'deepseek.com' }).first()
    await card.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await card.screenshot({ path: file('organize-sub') })
    await ctx.close()
  }
  // 5. 「理」b：笔记全屏聚焦（默认的上手指南：富文本 + 正文里内嵌的书签卡片）
  {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 900, locale })
    await openApp(page)
    await page.getByText(c.guide, { exact: true }).first().click()
    await page.waitForTimeout(1500)
    const pm = page.locator('.ProseMirror').first()
    const h1 = await pm.locator('h1').first().boundingBox()
    const last = await pm.locator('p').last().boundingBox()
    if (!h1 || !last) throw new Error('笔记聚焦页结构变了，更新本脚本的选择器')
    // 左侧留白但不带进编辑区的描边
    const y = h1.y - 32
    // 英文行更长，按正文里最宽一行定宽，避免右侧被截断
    const textRight = await pm.evaluate((el) => {
      // 只量文本节点本身的宽度（块级元素的盒子是整行宽，量它没意义）
      let right = 0
      const walker = document.createTreeWalker(el, window.NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        right = Math.max(right, range.getBoundingClientRect().right)
      }
      return right
    })
    const width = Math.min(1100, Math.max(700, Math.ceil(textRight - (h1.x - 16) + 24)))
    await page.screenshot({ path: file('organize-note'), clip: { x: h1.x - 16, y, width, height: last.y + last.height + 32 - y } })
    await ctx.close()
  }
  // 6. 「用」：AI 对话面板（视口加高，让整段对话一屏放下）
  {
    const { ctx, page } = await newPage(browser, { width: 1440, height: 1600, locale })
    const FENCE = '```'
    const sse = (parts) => parts.map((t) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n').join('') + 'data: [DONE]\n\n'
    await page.route((u) => /\/(functions\/v1\/)?mimo-chat$/.test(u.pathname), (route) => route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      body: sse([c.lead, '\n' + FENCE + 'ulink-card\n' + JSON.stringify(c.cards) + '\n' + FENCE + '\n', c.tail]),
    }))
    await openApp(page)
    await page.locator('#btnToggleDetail').click()
    await page.locator('.chat-textarea').waitFor({ timeout: 8000 })
    await page.locator('.chat-textarea').fill(c.ask)
    await page.locator('.chat-send-btn').click()
    await page.locator('.ai-inline-card').nth(2).waitFor({ timeout: 15000 })
    await page.locator('.ai-inline-card').first().locator('.inline-save-btn').click()
    await page.waitForTimeout(1200)
    // 点「存入」会把页面整体滚下去一截（根容器比视口高）；面板内是平滑滚动，必须 instant 并等一拍
    await page.locator('.detail-panel').evaluate((el) => {
      el.querySelectorAll('*').forEach((n) => {
        if (n.scrollHeight <= n.clientHeight + 4) return
        // column-reverse 容器的 scrollTop 以底部为 0、向上为负
        const rev = getComputedStyle(n).flexDirection === 'column-reverse'
        n.scrollTo({ top: rev ? -n.scrollHeight : 0, behavior: 'instant' })
      })
      for (let n = el; n; n = n.parentElement) n.scrollTop = 0
      window.scrollTo(0, 0)
    })
    await page.waitForTimeout(600)
    const clip = await page.locator('.detail-panel').evaluate((el) => {
      const r = el.getBoundingClientRect()
      // 截到「AI 生成」免责提示为止：下面的行动建议卡与快捷回复在英文界面里仍有未翻译的中文
      // （应用侧 i18n 缺口），宣传页两种语言统一不带这一段
      const action = el.querySelector('.chat-action-card')
      const items = el.querySelectorAll('.chat-turn-item')
      const end = action ? action.getBoundingClientRect().top - 4
        : (items.length ? items[items.length - 1].getBoundingClientRect().bottom + 28 : r.bottom)
      return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, end - r.y) }
    })
    await page.screenshot({ path: file('use-chat'), clip })
    await ctx.close()
  }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  await mkdir(DEST, { recursive: true })
  const browser = await chromium.launch()
  try {
    for (const locale of Object.keys(COPY)) await captureLocale(browser, locale)
  } finally {
    await browser.close()
  }
  const names = []
  for (const locale of Object.keys(COPY)) for (const s of SHOTS) names.push(s + COPY[locale].suffix)
  names.forEach(toWebp)
  await rm(OUT, { recursive: true, force: true })
  console.log('完成 →', names.length, '张，public/landing/')
}

main().catch((e) => { console.error(e); process.exit(1) })
