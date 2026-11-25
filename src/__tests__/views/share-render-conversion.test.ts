// 分享页转化入口回归护栏（2026-11-25）：
// 顶栏 CTA 带链接数并走 /go 计数跳转、文末「免费开始」卡片、复制全部链接、密码门不出 CTA。
import { describe, it, expect } from 'vitest'
import {
  renderSharePage,
  renderShareCategoryPage,
  renderPasswordGate,
  shareGoUrl,
} from '../../../functions/_lib/share-render.js'

const O = 'https://ulink.ren'
const group = { id: 'grp-1', name: '前端工具集', icon: '', color: '', notes: '<p>常用工具</p>', updated_at_num: 1756620000000 }
const bm = (id: string, title: string, url: string) => ({ id, title, url, icon: '', notes: '', parent_id: null })
const bms = [bm('b1', 'Vite', 'https://vite.dev/'), bm('b2', 'Vue', 'https://vuejs.org/'), bm('b3', 'TS', 'https://www.typescriptlang.org/')]

const page = (b: unknown[], locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
  renderSharePage(group as never, b as never, `${O}/s/grp-1`, O, locale)

describe('shareGoUrl', () => {
  it('组 / 分类各自的 /go 路径，id 做 URL 编码', () => {
    expect(shareGoUrl(O, 'g', 'grp-1')).toBe(`${O}/s/grp-1/go`)
    expect(shareGoUrl(O, 'c', 'sid_1')).toBe(`${O}/s/c/sid_1/go`)
  })
})

describe('组分享转化入口', () => {
  it('顶栏 CTA：文案带链接数，经 /go?to=save 计数跳转', () => {
    const html = page(bms)
    expect(html).toContain(`<a class="cta" href="${O}/s/grp-1/go?to=save">保存这 3 个链接</a>`)
  })

  it('英文单复数', () => {
    expect(page(bms, 'en-US')).toContain('>Save these 3 links</a>')
    expect(page([bms[0]], 'en-US')).toContain('>Save this link</a>')
  })

  it('没有书签时回退为原文案并直达应用', () => {
    expect(page([])).toContain(`<a class="cta" href="${O}/app#share/grp-1">保存至我的库</a>`)
  })

  it('文末「免费开始」卡片走 /go?to=start', () => {
    const html = page(bms)
    expect(html).toContain('class="share-start"')
    expect(html).toContain(`class="share-start-btn" href="${O}/s/grp-1/go?to=start">免费开始</a>`)
  })

  it('≥2 个书签出「复制全部链接」（默认 hidden，由脚本启用）', () => {
    expect(page(bms)).toMatch(/<button type="button" class="bm-copy-all" id="bmCopyAll" hidden [^>]*>复制全部链接<\/button>/)
    expect(page([bms[0]])).not.toContain('bmCopyAll"')
  })
})

describe('子书签收进父卡片', () => {
  const withKids = [
    bm('p1', 'Vue', 'https://vuejs.org/'),
    { ...bm('k1', 'Vue Router', 'https://router.vuejs.org/'), parent_id: 'p1' },
    { ...bm('k2', 'Pinia', 'https://pinia.vuejs.org/'), parent_id: 'k1' }, // 孙书签也平铺进根卡片
    bm('p2', 'Vite', 'https://vite.dev/'),
  ]
  const html = page(withKids)

  it('不再有缩进的子卡片；父卡片改为 div + 全卡热区，子书签成底部胶囊', () => {
    expect(html).not.toContain('is-child')
    expect(html).toMatch(/<div class="bm has-kids" data-search="[^"]*router\.vuejs\.org[^"]*pinia\.vuejs\.org[^"]*">/)
    expect(html).toContain('<a class="bm-hit" href="https://vuejs.org/" target="_blank" rel="noopener nofollow" aria-label="Vue"></a>')
    expect(html).toContain('<a class="group-inline-card" href="https://router.vuejs.org/"')
    expect(html).toContain('<a class="group-inline-card" href="https://pinia.vuejs.org/"')
  })

  it('网格里只剩两张顶层卡片；没有子书签的仍是 <a class="bm">', () => {
    const grid = html.slice(html.indexOf('id="bmList"'), html.indexOf('id="bmEmptySearch"'))
    expect((grid.match(/class="bm[ "]/g) || []).length).toBe(2)
    expect(grid).toContain('<a class="bm" href="https://vite.dev/"')
  })
})

describe('分类分享转化入口', () => {
  it('CTA 与「免费开始」都走分类的 /go', () => {
    const html = renderShareCategoryPage(
      { id: 'cat-1', name: '设计', icon: '', color: '' } as never,
      [] as never,
      [{ ...bm('c1', 'Figma', 'https://figma.com/'), category_id: 'cat-1' }] as never,
      'sid-9',
      `${O}/s/c/sid-9`,
      O,
      'zh-CN',
    )
    expect(html).toContain(`<a class="cta" href="${O}/s/c/sid-9/go?to=save">保存这 1 个链接</a>`)
    expect(html).toContain(`href="${O}/s/c/sid-9/go?to=start"`)
  })
})

describe('密码门', () => {
  it('不出顶栏 CTA，也不出「免费开始」卡片', () => {
    const html = renderPasswordGate('zh-CN')
    expect(html).not.toContain('class="cta"')
    expect(html).not.toContain('class="share-start"')
  })
})
