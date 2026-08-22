/**
 * head.test.ts — src/lib/head.ts 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setTitle, setMetaByAttr, setCanonical, setJsonLd, cleanupInjectedHead } from '../lib/head.js'

describe('head.ts', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
  })

  it('setTitle 设置 document.title', () => {
    setTitle('测试标题')
    expect(document.title).toBe('测试标题')
  })

  it('setMetaByAttr 新建 meta 并幂等更新', () => {
    setMetaByAttr('property', 'og:title', 'A')
    setMetaByAttr('property', 'og:title', 'B')
    const metas = document.head.querySelectorAll('meta[property="og:title"]')
    expect(metas.length).toBe(1)
    expect(metas[0].getAttribute('content')).toBe('B')
    expect(metas[0].hasAttribute('data-lv-head')).toBe(true)
  })

  it('setMetaByAttr 按 name 也能去重', () => {
    setMetaByAttr('name', 'description', 'desc1')
    setMetaByAttr('name', 'description', 'desc2')
    const metas = document.head.querySelectorAll('meta[name="description"]')
    expect(metas.length).toBe(1)
    expect(metas[0].getAttribute('content')).toBe('desc2')
  })

  it('setCanonical 新建 link 并幂等覆盖', () => {
    setCanonical('https://x.com/s/abc')
    setCanonical('https://x.com/s/def')
    const links = document.head.querySelectorAll('link[rel="canonical"]')
    expect(links.length).toBe(1)
    expect(links[0].getAttribute('href')).toBe('https://x.com/s/def')
  })

  it('setJsonLd 注入 script 且内容可解析', () => {
    setJsonLd('shareItemList', { '@type': 'ItemList', name: '组', numberOfItems: 3 })
    const s = document.head.querySelector('script[type="application/ld+json"][data-lv-jsonld="shareItemList"]')
    expect(s).not.toBeNull()
    const parsed = JSON.parse(s!.textContent!)
    expect(parsed['@type']).toBe('ItemList')
    expect(parsed.numberOfItems).toBe(3)
  })

  it('setJsonLd 幂等覆盖不堆叠', () => {
    setJsonLd('shareItemList', { a: 1 })
    setJsonLd('shareItemList', { b: 2 })
    const scripts = document.head.querySelectorAll('script[type="application/ld+json"][data-lv-jsonld="shareItemList"]')
    expect(scripts.length).toBe(1)
    expect(JSON.parse(scripts[0].textContent!).b).toBe(2)
  })

  it('cleanupInjectedHead 移除所有带标记的节点，不动未标记静态节点', () => {
    // 模拟 index.html 静态节点（不带标记）
    const staticMeta = document.createElement('meta')
    staticMeta.setAttribute('name', 'description')
    staticMeta.setAttribute('content', '静态')
    document.head.appendChild(staticMeta)

    const staticJsonLd = document.createElement('script')
    staticJsonLd.setAttribute('type', 'application/ld+json')
    staticJsonLd.setAttribute('data-lv-jsonld', 'app')
    staticJsonLd.textContent = '{"@type":"WebApplication"}'
    document.head.appendChild(staticJsonLd)

    // 动态注入
    setMetaByAttr('property', 'og:title', '动态')
    setJsonLd('shareItemList', { '@type': 'ItemList' })

    cleanupInjectedHead()

    // 动态节点被清理
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull()
    expect(document.head.querySelector('script[data-lv-jsonld="shareItemList"]')).toBeNull()
    // 静态节点保留
    expect(document.head.querySelector('meta[name="description"]')).not.toBeNull()
    expect(document.head.querySelector('script[data-lv-jsonld="app"]')).not.toBeNull()
    expect(document.head.querySelectorAll('[data-lv-head]').length).toBe(0)
  })

  // E2-002：覆盖静态 meta + setTitle 后 cleanup 须还原
  it('cleanup 还原被覆盖的静态 meta 与 title (E2-002)', () => {
    document.title = '与链 — 个人书签管理器'
    const staticMeta = document.createElement('meta')
    staticMeta.setAttribute('name', 'description')
    staticMeta.setAttribute('content', '静态描述')
    document.head.appendChild(staticMeta)
    const og = document.createElement('meta')
    og.setAttribute('property', 'og:title')
    og.setAttribute('content', '静态 OG')
    document.head.appendChild(og)

    setTitle('分享组 - ulink 分享')
    setMetaByAttr('name', 'description', '分享描述')
    setMetaByAttr('property', 'og:title', '分享 OG')
    setMetaByAttr('property', 'og:type', 'article') // 新建动态节点

    expect(document.title).toBe('分享组 - ulink 分享')
    expect(staticMeta.getAttribute('content')).toBe('分享描述')
    expect(og.getAttribute('content')).toBe('分享 OG')

    cleanupInjectedHead()

    expect(document.title).toBe('与链 — 个人书签管理器')
    expect(staticMeta.getAttribute('content')).toBe('静态描述')
    expect(og.getAttribute('content')).toBe('静态 OG')
    // 纯动态 meta 应被移除
    expect(document.head.querySelector('meta[property="og:type"]')).toBeNull()
  })

  // 连续覆盖仅首次备份守卫（d1-58）：setTitle 的 `if (_titleBackup === null)` 与
  // setMetaByAttr 的 `if (!_staticMetaBackup.has(key))` 守卫决定连续多次覆盖只记
  // 首个原值、cleanup 回首启值而非末次覆盖值。line 17/88 只测单次覆盖，
  // 「连续覆盖仅首次备份」此前零断言靠源码 line 30/52 实现口头维护——
  // 任一守卫被误删（改为每次覆盖都备份）会让 cleanup 回到末次覆盖值而非首启原值。
  it('连续 setTitle 仅首次备份，cleanup 回首启原值非末次值 (d1-58)', () => {
    document.title = '原始标题'
    setTitle('动态A')
    setTitle('动态B')
    expect(document.title).toBe('动态B')
    cleanupInjectedHead()
    // 回首启原值 '原始标题'，不是 '动态A'（中间过桥值）也不是 '动态B'（末次覆盖值）
    expect(document.title).toBe('原始标题')
  })

  it('连续 setMetaByAttr 覆盖静态 meta 仅首次备份，cleanup 回首启原值 (d1-58)', () => {
    const staticMeta = document.createElement('meta')
    staticMeta.setAttribute('name', 'description')
    staticMeta.setAttribute('content', '原始描述')
    document.head.appendChild(staticMeta)
    setMetaByAttr('name', 'description', '动态X')
    setMetaByAttr('name', 'description', '动态Y')
    expect(staticMeta.getAttribute('content')).toBe('动态Y')
    cleanupInjectedHead()
    // 回首启静态原值 '原始描述'，不是 '动态X'（中间过桥值）也不是 '动态Y'（末次覆盖值）
    expect(staticMeta.getAttribute('content')).toBe('原始描述')
  })

  it('setMetaByAttr 复用动态创建的带 MARK meta 不进备份，cleanup 移除而非还原 (d1-58)', () => {
    setMetaByAttr('property', 'og:title', '动态A') // 新建带 MARK 动态 meta（无静态原值）
    setMetaByAttr('property', 'og:title', '动态B') // 复用同一动态节点
    const el = document.head.querySelector<HTMLMetaElement>('meta[property="og:title"]')
    expect(el?.getAttribute('content')).toBe('动态B')
    expect(el?.hasAttribute('data-lv-head')).toBe(true)
    cleanupInjectedHead()
    // 动态 meta 被移除（has MARK），不存在「还原到不存在」语义
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull()
  })

  it('cleanup 后模块 _titleBackup 复位，连续 cleanup 走 DEFAULT_TITLE 不重复 restore (d1-58)', () => {
    document.title = '原始标题'
    setTitle('动态')
    cleanupInjectedHead()
    expect(document.title).toBe('原始标题')
    // 第二次 cleanup:_titleBackup 已被首发 cleanup 置 null → 走 DEFAULT_TITLE 分支（line 119）
    document.title = '被改'
    cleanupInjectedHead()
    expect(document.title).toBe('与链 — 个人书签管理器')
  })

  it('cleanup 后再 setTitle 备份新原值，不沿用旧 _titleBackup (d1-58)', () => {
    document.title = '第一组原值'
    setTitle('动态一')
    cleanupInjectedHead()
    expect(document.title).toBe('第一组原值')
    // cleanup 复位 _titleBackup=null 后，新setTitle 备份的是当前 '第一组原值' 而非旧备份
    document.title = '第二组原值'
    setTitle('动态二')
    cleanupInjectedHead()
    expect(document.title).toBe('第二组原值')
  })
})
