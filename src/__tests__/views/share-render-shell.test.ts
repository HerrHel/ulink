// S6/S7 SSR 外壳回归护栏：类名锚定 + 双语 + CTA 路径 + SPA 自动接管（bundle 注入 / #app 挂载点）
// + 组页无独立书签列表（对齐新版"组分享 = 聚焦组形态"）+ 分类页骨架占位
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

  it('组页含主应用外壳', () => {
    expect(zh).toContain('class="app"')
    expect(zh).toContain('class="rail"')
    expect(zh).toContain('class="panel-hdr"')
    expect(zh).toContain('class="focus-card"')
  })
  it('组页无独立书签列表（对齐新版聚焦组形态）', () => {
    expect(zh).not.toContain('class="grp-list"')
    expect(zh).not.toContain('class="bm-list"')
  })
  it('组页移除旧布局类名（FALLBACK_JS 自动失效）', () => {
    expect(zh).not.toContain('class="layout"')
    expect(zh).not.toContain('class="page"')
  })
  it('组页 CTA 指向 SPA 分享路由 + 双语只读 chip + 新 CTA 文案', () => {
    expect(zh).toContain('#share/grp-demo-001')
    expect(zh).toContain('公开分享')
    expect(en).toContain('Public share')
    expect(zh).toContain('保存至我的库')
    expect(en).toContain('Save to my library')
    // 旧 CTA 文案彻底移除
    expect(zh).not.toContain('在与链中打开')
    expect(zh).not.toContain('复制到我的库')
    expect(en).not.toContain('Open in ulink')
  })
  it('分类页含外壳 + 骨架占位（无真实卡片网格）', () => {
    expect(catHtml).toContain('class="app"')
    expect(catHtml).toContain('class="cat-hero"')
    expect(catHtml).toContain('cat-skel')
    expect(catHtml).not.toContain('class="page"')
  })
  it('404 页含外壳', () => {
    const nf = renderNotFoundPage('zh-CN')
    expect(nf).toContain('class="app"')
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
})