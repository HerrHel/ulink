// S6/S7 SSR 外壳回归护栏：类名锚定 + 双语 + CTA 路径 + SPA 自动接管（bundle 注入 / #app 挂载点）
// + 组页无独立书签列表（对齐新版"组分享 = 聚焦组形态"）+ 分类页卡片网格
import { describe, it, expect } from 'vitest'
import { renderSharePage, renderShareCategoryPage, renderNotFoundPage, extractAppAssets } from '../../functions/_lib/share-render.js'

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
    expect(catHtml).toContain('class="cat-grid"')
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
    // CSS 包含 light / dark 选择器
    expect(zh).toContain('[data-theme="light"]')
    expect(zh).toContain('[data-theme="dark"]')
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

  it('智能组名解析与首行 H1 正文去重', () => {
    // 场景 1：用户未显式设置组名（name 为空），但 notes 开头写了 <h1>123</h1>
    const untitledWithH1 = {
      id: 'grp-h1-test',
      name: '',
      icon: '',
      color: '',
      notes: '<h1>123</h1><p>待办事项与正文</p>',
      updated_at_num: 1756620000000,
    }
    const htmlH1 = renderSharePage(untitledWithH1 as never, bms as never, 'https://ulink.ren/s/grp-h1-test', 'https://ulink.ren', 'zh-CN')

    // 1. Hero 大标题和 <title> 必须为 123，绝不能出现「分享组」或「未命名组」
    expect(htmlH1).toContain('<h1 class="group-hero-title">123</h1>')
    expect(htmlH1).toContain('<title>123 - ulink</title>')
    expect(htmlH1).not.toContain('分享组')
    expect(htmlH1).not.toContain('未命名组')

    // 2. 正文笔记中已被提拔的开头 <h1>123</h1> 必须被消费，不能在正文中出现重复的大标题 123
    expect(htmlH1).toContain('<p>待办事项与正文</p>')
    expect(htmlH1).not.toContain('<div class="focus-notes"><h1')
    expect(htmlH1).toContain('<div class="group-notes-content"><div class="focus-notes"><p>待办事项与正文</p></div></div>')

    // 场景 2：用户显式设置了组名「前端工具集」，notes 开头保留 <h1>收藏</h1>
    expect(zh).toContain('<h1 class="group-hero-title">前端工具集</h1>')
    expect(zh).toContain('<title>前端工具集 - ulink</title>')
    // 显式组名时，正文中的 <h1>收藏</h1> 必须原样完整保留（带 toc id）
    expect(zh).toContain('>收藏</h1>')

    // 场景 3：无组名且 notes 纯空，回退为「未命名组」（英文「Untitled group」），绝无「分享组」
    const pureEmptyGroup = { id: 'grp-empty', name: '', icon: '', color: '', notes: '' }
    const emptyZh = renderSharePage(pureEmptyGroup as never, bms as never, 'https://ulink.ren/s/grp-empty', 'https://ulink.ren', 'zh-CN')
    const emptyEn = renderSharePage(pureEmptyGroup as never, bms as never, 'https://ulink.ren/s/grp-empty', 'https://ulink.ren', 'en-US')

    expect(emptyZh).toContain('<h1 class="group-hero-title">未命名组</h1>')
    expect(emptyZh).toContain('<title>未命名组 - ulink</title>')
    expect(emptyZh).not.toContain('分享组')

    expect(emptyEn).toContain('<h1 class="group-hero-title">Untitled group</h1>')
    expect(emptyEn).toContain('<title>Untitled group - ulink</title>')
    expect(emptyEn).not.toContain('Shared group')
  })

  it('方案 1 分类专刊画卷：Hero微光 + 章节式导读 + 快捷跳转 + 精选归拢', () => {
    const cat = { id: 'cat-fe', name: '前端开发全景', icon: '', color: '#3b82f6' }
    const groups = [
      { id: 'g1', name: '核心框架', bookmark_ids: ['b1', 'b2'], notes: '<p>主流前端单页架构</p>' },
      { id: 'g2', name: '构建工具', bookmark_ids: ['b3'], notes: '' },
    ]
    const bmsList = [
      { id: 'b1', title: 'React', url: 'https://react.dev/', icon: '', notes: 'UI 库', parent_id: null, category_id: 'cat-fe' },
      { id: 'b2', title: 'Vue.js', url: 'https://vuejs.org/', icon: '', notes: '渐进式框架', parent_id: null, category_id: 'cat-fe' },
      { id: 'b3', title: 'Vite', url: 'https://vite.dev/', icon: '', notes: '下一代前端工具', parent_id: null, category_id: 'cat-fe' },
      { id: 'b4', title: 'Tailwind CSS', url: 'https://tailwindcss.com/', icon: '', notes: '原子化样式', parent_id: null, category_id: 'cat-fe' },
      { id: 'b5', title: 'Tailwind UI', url: 'https://tailwindui.com/', icon: '', notes: '官方组件库', parent_id: 'b4', category_id: 'cat-fe' },
    ]

    const editorialZh = renderShareCategoryPage(
      cat as never,
      groups as never,
      bmsList as never,
      'cat-fe',
      'https://ulink.ren/s/c/cat-fe',
      'https://ulink.ren',
      'zh-CN',
    )
    const editorialEn = renderShareCategoryPage(
      cat as never,
      groups as never,
      bmsList as never,
      'cat-fe',
      'https://ulink.ren/s/c/cat-fe',
      'https://ulink.ren',
      'en-US',
    )

    // 1. Hero 沉浸式刊头与分类微光
    expect(editorialZh).toContain('class="cat-hero"')
    expect(editorialZh).toContain('style="--cat: #3b82f6"')
    expect(editorialZh).toContain('class="cat-hero-glow"')
    expect(editorialZh).toContain('前端开发全景')
    expect(editorialZh).toContain('分类精选专刊')
    expect(editorialEn).toContain('Curated directory')
    expect(editorialZh).not.toContain('class="cat-hero-icon"') // 无 http 图标时不出现空图标占位

    // 2. 统计与布局切换器
    expect(editorialZh).toContain('class="cat-layout-switch"')
    expect(editorialZh).toContain('5 个书签')
    expect(editorialZh).toContain('2 个组')
    expect(editorialEn).toContain('5 bookmarks')
    expect(editorialEn).toContain('2 groups')

    // 3. 搜索框与章节快捷跳转索引 (Tabs)
    expect(editorialZh).toContain('id="bmSearchInput"')
    expect(editorialZh).toContain('class="cat-tabs-nav"')
    expect(editorialZh).toContain('href="#cat-sec-0"')
    expect(editorialZh).toContain('href="#cat-sec-1"')
    expect(editorialZh).toContain('href="#cat-sec-curated"')
    expect(editorialZh).toContain('目录索引:')
    expect(editorialEn).toContain('Contents:')

    // 4. 章节流式排版 (Chapters)
    expect(editorialZh).toContain('class="cat-chapter"')
    expect(editorialZh).toContain('id="cat-sec-0"')
    expect(editorialZh).toContain('01')
    expect(editorialZh).toContain('核心框架')
    expect(editorialZh).toContain('导读笔记')
    expect(editorialZh).toContain('主流前端单页架构')
    expect(editorialEn).toContain('Editorial notes')

    // 5. 第二章无笔记时优雅降级（无导读框）
    expect(editorialZh).toContain('id="cat-sec-1"')
    expect(editorialZh).toContain('02')
    expect(editorialZh).toContain('构建工具')

    // 6. 散落精选资源章节 (Curated Loose Bookmarks)
    expect(editorialZh).toContain('id="cat-sec-curated"')
    expect(editorialZh).toContain('独立精选资源')
    expect(editorialEn).toContain('Curated links')
    expect(editorialZh).toContain('Tailwind CSS')
    expect(editorialZh).toContain('Tailwind UI')
    expect(editorialZh).toContain('1 个子书签')
    expect(editorialEn).toContain('1 sub-items')
  })
})