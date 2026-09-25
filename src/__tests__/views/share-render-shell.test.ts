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
})