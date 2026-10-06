// S6/S7 SSR 外壳回归护栏：类名锚定 + 双语 + CTA 路径 + SPA 自动接管（bundle 注入 / #app 挂载点）
// + 组页无独立书签列表（对齐新版"组分享 = 聚焦组形态"）+ 分类页卡片网格
import { describe, it, expect } from 'vitest'
import { renderSharePage, renderShareCategoryPage, renderNotFoundPage, extractAppAssets, resolveGroupTitle, stripTags } from '../../functions/_lib/share-render.js'

const group = {
  id: 'grp-demo-001',
  name: '前端工具集',
  icon: '',
  color: '',
  notes: '<h1>收藏</h1><p>常用前端工具与链接。</p>',
  updated_at_num: 1756620000000,
}
const bms = [
  { id: 'b1', title: 'Vite 官方文档', url: 'https://vite.dev/', icon: '', notes: '', parent_id: null },
  { id: 'b2', title: 'Vue.js 文档', url: 'https://vuejs.org/', icon: '', notes: '', parent_id: null },
  { id: 'b3', title: 'TypeScript 手册', url: 'https://www.typescriptlang.org/', icon: '', notes: '', parent_id: null },
]

const APP_ASSETS =
  '<link rel="stylesheet" href="/assets/index-Demo123.css">' +
  '<link rel="modulepreload" crossorigin href="/assets/vue-vendor-Demo456.js">' +
  '<script type="module" crossorigin src="/assets/index-Demo789.js"></script>'

describe('S6/S7 SSR 外壳骨架', () => {
  const zh = renderSharePage(group as never, bms as never, 'https://ulink.ren/s/grp-demo-001', 'https://ulink.ren', 'zh-CN')
  const en = renderSharePage(group as never, bms as never, 'https://ulink.ren/s/grp-demo-001', 'https://ulink.ren', 'en-US')
  const catHtml = renderShareCategoryPage(
    { id: 'cat-share-9', name: '设计资源', icon: '', color: '#0d7a6f' } as never,
    [] as never,
    [
      { id: 'c1', title: 'Figma', url: 'https://www.figma.com/', icon: '', notes: '', parent_id: null, category_id: 'cat-share-9' },
      { id: 'c2', title: 'unDraw', url: 'https://undraw.co/', icon: '', notes: '', parent_id: null, category_id: 'cat-share-9' },
    ] as never,
    'cat-share-9',
    'https://ulink.ren/s/c/cat-share-9',
    'https://ulink.ren',
    'zh-CN',
  )

  it('组页含专栏画卷外壳（移除原后台侧边栏）', () => {
    expect(zh).toContain('class="share-app"')
    expect(zh).toContain('class="share-bar"')
    expect(zh).toContain('class="share-container"')
    expect(zh).toContain('class="group-hero"')
    expect(zh).not.toContain('class="rail"')
  })
  it('组页展示收录书签网格', () => {
    expect(zh).toContain('class="group-bookmarks-section"')
    expect(zh).toContain('class="bm-grid"')
    expect(zh).toContain('Vite 官方文档')
    expect(zh).toContain('Vue.js 文档')
    expect(zh).not.toContain('class="grp-list"')
  })
  it('组页移除旧布局类名（FALLBACK_JS 自动失效）', () => {
    expect(zh).not.toContain('class="layout"')
    expect(zh).not.toContain('class="page"')
  })
  it('组页 CTA 指向 SPA 分享路由 + 双语只读 chip + 新 CTA 文案', () => {
    expect(zh).toContain('#share/grp-demo-001')
    expect(zh).toContain('私有链接分享')
    expect(en).toContain('Private share')
    expect(zh).toContain('保存至我的库')
    expect(en).toContain('Save to my library')
    // 旧 CTA 文案彻底移除
    expect(zh).not.toContain('在与链中打开')
    expect(zh).not.toContain('复制到我的库')
    expect(en).not.toContain('Open in ulink')
  })
  it('分类页含外壳 + 真实卡片网格', () => {
    expect(catHtml).toContain('class="share-app"')
    expect(catHtml).toContain('class="cat-hero"')
    expect(catHtml).toContain('cat-grid')
    expect(catHtml).toContain('card-grid')
    expect(catHtml).toContain('Figma')
    expect(catHtml).toContain('unDraw')
    expect(catHtml).not.toContain('class="page"')
  })
  it('404 页含外壳', () => {
    const nf = renderNotFoundPage('zh-CN')
    expect(nf).toContain('class="share-app"')
    expect(nf).toContain('该分享不存在')
    expect(nf).not.toContain('class="page"')
  })
  it('SPA 自动接管：注入 appAssets 且含 #app 挂载点', () => {
    const withAssets = renderSharePage(group as never, bms as never, 'https://ulink.ren/s/grp-demo-001', 'https://ulink.ren', 'zh-CN', APP_ASSETS)
    expect(withAssets).toContain('<div id="app">')
    expect(withAssets).toContain('<script type="module" crossorigin src="/assets/index-Demo789.js"></script>')
    expect(withAssets).toContain('<link rel="stylesheet" href="/assets/index-Demo123.css">')
  })
  it('extractAppAssets 提取主应用 bundle 标签', () => {
    const indexHtml = [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<link rel="icon" href="/favicon.ico">',
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet">',
      '<link rel="stylesheet" href="/assets/index-ABC123.css">',
      '<link rel="modulepreload" crossorigin href="/assets/vue-vendor-DEF456.js">',
      '</head>',
      '<body>',
      '<div id="app"></div>',
      '<script type="module" crossorigin src="/assets/index-GHI789.js"></script>',
      '</body>',
      '</html>',
    ].join('\n')
    const assets = extractAppAssets(indexHtml)
    expect(assets).toContain('<link rel="stylesheet" href="/assets/index-ABC123.css">')
    expect(assets).toContain('<link rel="modulepreload" crossorigin href="/assets/vue-vendor-DEF456.js">')
    expect(assets).toContain('<script type="module" crossorigin src="/assets/index-GHI789.js"></script>')
    // 外链字体/预连接/favicon 不提取
    expect(assets).not.toContain('fonts.googleapis')
    expect(assets).not.toContain('preconnect')
    expect(assets).not.toContain('favicon')
  })
  it('含深浅色主题切换按钮与首屏防闪烁脚本', () => {
    // 组页
    expect(zh).toContain('id="themeToggle"')
    expect(zh).toContain('class="share-theme-btn"')
    expect(zh).toContain('lv_theme')
    expect(zh).toContain('data-theme')
    expect(en).toContain('Toggle light/dark theme')
    // 分类页
    expect(catHtml).toContain('id="themeToggle"')
    expect(catHtml).toContain('lv_theme')
    // CSS 包含 light / dark 选择器与品牌 Logo 双色响应
    expect(zh).toContain('[data-theme="light"]')
    expect(zh).toContain('[data-theme="dark"]')
    expect(zh).toContain('--brand-logo-blue: #122E8A')
    expect(zh).toContain('--brand-logo-green: #10B981')
    expect(zh).toContain('--brand-logo-blue: #F04A8A')
    expect(zh).toContain('--brand-logo-green: #E2E7BF')
    // Logo SVG 采用 CSS 变量与统一 class 驱动，无硬编码死锁内联 style
    expect(zh).toContain('class="brand-logo-blue s-b"')
    expect(zh).toContain('class="brand-logo-green s-g"')
    expect(zh).toContain('stroke="var(--brand-logo-blue')
    expect(zh).toContain('stroke="var(--brand-logo-green')
    expect(zh).not.toContain('<style>.s-b{stroke:#122E8A}')
    // 质感排版：加载顶级字体与 display 字体栈
    expect(zh).toContain('/fonts/fonts.css')
    expect(zh).toContain("'Clash Display'")
    expect(zh).toContain("'Satoshi'")
  })
  it('内联书签卡片放行站内图标路径并挂载防错降级，任务清单对勾采用中心对齐矢量 SVG', () => {
    const groupWithInline = {
      id: 'grp-demo-inline',
      name: '测试组',
      icon: '',
      color: '',
      notes: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p><span class="group-inline-card" data-bm-id="b1"><img src="/logo.svg" alt=""><span class="gic-name">Vite</span><span class="gic-domain">vite.dev</span></span></p></li></ul>',
      updated_at_num: 1756620000000,
    }
    const html = renderSharePage(groupWithInline as never, bms as never, 'https://ulink.ren/s/grp-demo-inline', 'https://ulink.ren', 'zh-CN')
    // 验证 /logo.svg 未被粗暴拦截，保留作为 src
    expect(html).toContain('src="/logo.svg"')
    expect(html).toContain('data-fb')
    expect(html).toContain('img-err')
    // 验证 taskItem 对勾采用中心对齐的矢量 SVG
    expect(html).toContain("background-position: center")
    expect(html).toContain("background-size: 11px 11px")
  })
  it('方案 B 策展级单体画卷特性', () => {
    // 存在笔记与书签时渲染一体化画卷（上文下签流式排版，无生硬分栏与多余套娃）
    expect(zh).toContain('class="group-canvas"')
    expect(zh).toContain('class="group-notes-section"')
    expect(zh).toContain('class="group-bookmarks-section"')
    expect(zh).toContain('class="canvas-divider"')
    expect(zh).toContain('class="bm-grid"')
    expect(zh).toContain('data-search=')

    // 彻底移除旧版与方案 A 繁冗元素与无用头像方块
    expect(zh).not.toContain('class="group-split-view"')
    expect(zh).not.toContain('class="group-sticky-side"')
    expect(zh).not.toContain('class="group-hero-accent"')
    expect(zh).not.toContain('class="group-quick-nav"')
    expect(zh).not.toContain('class="side-toc-card"')
    expect(zh).not.toContain('class="group-hero-icon"')

    // 仅有书签时的画卷结构：直接呈现书签区，无笔记与多余分割线
    const bmsOnlyGroup = { ...group, notes: '' }
    const bmsOnlyHtml = renderSharePage(bmsOnlyGroup as never, bms as never, 'https://ulink.ren/s/grp-demo-001', 'https://ulink.ren', 'zh-CN')
    expect(bmsOnlyHtml).toContain('class="group-canvas"')
    expect(bmsOnlyHtml).toContain('class="group-bookmarks-section"')
    expect(bmsOnlyHtml).toContain('class="bm-grid"')
    expect(bmsOnlyHtml).not.toContain('class="group-notes-section"')
    expect(bmsOnlyHtml).not.toContain('class="canvas-divider"')
  })

  it('未设置组名时直接回退「未命名」（英文「Untitled」），不从笔记提取内容', () => {
    // 场景 1：用户未显式设置组名（name 为空），notes 开头写了 <h1>123</h1>
    const untitledWithH1 = {
      id: 'grp-h1-test',
      name: '',
      icon: '',
      color: '',
      notes: '<h1>123</h1><p>待办事项与正文</p>',
      updated_at_num: 1756620000000,
    }
    const htmlH1 = renderSharePage(untitledWithH1 as never, bms as never, 'https://ulink.ren/s/grp-h1-test', 'https://ulink.ren', 'zh-CN')

    // 大标题和 <title> 直接为「未命名」，绝不从 notes 提取
    expect(htmlH1).toContain('<h1 class="group-hero-title">未命名</h1>')
    expect(htmlH1).toContain('<title>未命名 - ulink</title>')
    expect(htmlH1).not.toContain('分享组')

    // 场景 2：用户显式设置了组名「前端工具集」
    expect(zh).toContain('<h1 class="group-hero-title">前端工具集</h1>')
    expect(zh).toContain('<title>前端工具集 - ulink</title>')

    // 场景 3：无组名且 notes 纯空，回退为「未命名」（英文「Untitled」）
    const pureEmptyGroup = { id: 'grp-empty', name: '', icon: '', color: '', notes: '' }
    const emptyZh = renderSharePage(pureEmptyGroup as never, bms as never, 'https://ulink.ren/s/grp-empty', 'https://ulink.ren', 'zh-CN')
    const emptyEn = renderSharePage(pureEmptyGroup as never, bms as never, 'https://ulink.ren/s/grp-empty', 'https://ulink.ren', 'en-US')

    expect(emptyZh).toContain('<h1 class="group-hero-title">未命名</h1>')
    expect(emptyZh).toContain('<title>未命名 - ulink</title>')
    expect(emptyZh).not.toContain('分享组')

    expect(emptyEn).toContain('<h1 class="group-hero-title">Untitled</h1>')
    expect(emptyEn).toContain('<title>Untitled - ulink</title>')
    expect(emptyEn).not.toContain('Shared group')
  })

  it('分类页图标与首字母共存时首字母被隐藏，防首字母跟随 bug', () => {
    // 存在 favicon 时生成 card-logo-fallback
    expect(catHtml).toContain('class="card-logo-fallback card-logo-fb"')
    // CSS 规则双保险隐藏首字母
    expect(catHtml).toContain('.card-logo img ~ .card-logo-fallback')
    expect(catHtml).toContain('.card-logo:has(img:not(.img-err):not(.card-logo-img-err)) .card-logo-fallback')
    expect(catHtml).toContain('display: none !important')
  })

  it('列表模式卡片填满整行（width 100% + align-items stretch）', () => {
    expect(catHtml).toContain('.card-grid.list-view')
    expect(catHtml).toContain('align-items: stretch !important')
    expect(catHtml).toContain('.card-grid.list-view .card-list-inner')
    expect(catHtml).toContain('.card-grid.list-view .card,')
    expect(catHtml).toContain('width: 100% !important')
    expect(catHtml).toContain('box-sizing: border-box !important')
  })

  it('移动端默认列表布局防闪烁规则与内联脚本守卫', () => {
    expect(catHtml).toContain('share-mobile-list')
    expect(catHtml).toContain('.share-mobile-list .cat-grid:not(.mini-grid-view)')
    expect(catHtml).toContain('.share-mobile-list .cat-layout-btn[data-layout="grid"]')
    expect(catHtml).toContain('.share-mobile-list .cat-layout-btn[data-layout="list"]')
    expect(catHtml).toContain('display: none !important')
  })

  it('分享只读态单书签卡片不展示累计点击次数（纯净轻量）', () => {
    expect(catHtml).not.toContain('次点击')
    expect(catHtml).not.toContain('clicks')
    expect(catHtml).not.toContain('1 click')
  })

  it('未命名组第一行为内联书签卡片时，页面标题与 H1 直接显示「未命名」，绝不泄漏卡片噪音', () => {
    const inlineCardNotes =
      '<p><span class="group-inline-card" contenteditable="false" data-bm-id="b1" draggable="false">' +
      '<img src="https://favicon.splitbee.io/?url=vite.dev" alt="">' +
      '<span class="gic-name">Vite 官方文档</span>' +
      '<span class="gic-domain">vite.dev</span>' +
      '<span class="gic-btn">详</span>' +
      '</span></p>' +
      '<p>这是第二行正文说明</p>'

    const cardGroup = {
      id: 'grp-card-demo',
      name: '',
      icon: '',
      color: '',
      notes: inlineCardNotes,
      updated_at_num: 1756620000000,
    }

    const htmlZh = renderSharePage(cardGroup as never, bms as never, 'https://ulink.ren/s/grp-card-demo', 'https://ulink.ren', 'zh-CN')

    // 页面标题与 hero 标题中必须直接为「未命名」，绝不带卡片任何文字，绝不带域名和「详」
    expect(htmlZh).toContain('<h1 class="group-hero-title">未命名</h1>')
    expect(htmlZh).toContain('<title>未命名 - ulink</title>')
    expect(htmlZh).not.toContain('Vite 官方文档vite.dev详')

    // 验证底层纯函数 stripTags 与 resolveGroupTitle
    expect(stripTags(inlineCardNotes)).toBe('Vite 官方文档\n这是第二行正文说明')
    expect(resolveGroupTitle({ defaultGroupName: '未命名', cipherPlaceholder: '' } as any, cardGroup as any)).toEqual({
      name: '未命名',
      promotedH1: false,
    })
  })
})