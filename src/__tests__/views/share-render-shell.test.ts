// S6 方案 B 骨架近似：SSR 首屏外壳回归护栏（类名锚定 + 中英文案 + CTA 路径）
import { describe, it, expect } from 'vitest'
import { renderSharePage, renderShareCategoryPage, renderNotFoundPage } from '../../functions/_lib/share-render.js'

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

describe('S6 SSR 外壳骨架（方案 B）', () => {
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
    expect(zh).toContain('class="grp-list"')
  })
  it('组页移除旧布局类名（FALLBACK_JS 自动失效）', () => {
    expect(zh).not.toContain('class="layout"')
    expect(zh).not.toContain('class="bm-list"')
    expect(zh).not.toContain('class="page"')
  })
  it('组页 CTA 指向 SPA 分享路由 + 双语只读 chip', () => {
    expect(zh).toContain('#share/grp-demo-001')
    expect(zh).toContain('公开分享')
    expect(en).toContain('Public share')
    expect(en).toContain('Open in ulink')
  })
  it('分类页含外壳且无旧类名', () => {
    expect(catHtml).toContain('class="app"')
    expect(catHtml).toContain('class="cat-hero"')
    expect(catHtml).toContain('cat-grid')
    expect(catHtml).not.toContain('class="page"')
  })
  it('404 页含外壳', () => {
    const nf = renderNotFoundPage('zh-CN')
    expect(nf).toContain('class="app"')
    expect(nf).toContain('该分享不存在')
    expect(nf).not.toContain('class="page"')
  })
})