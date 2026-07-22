/**
 * head.ts — 客户端 <head> 动态注入工具（无 SSR 场景）
 *
 * 简洁的同步函数签名，纯原生 DOM 操作，不引入 unhead/@vueuse/head 依赖。
 * 幂等：按已有节点复用更新（meta[name=..] / meta[property=..] / link[rel=canonical] /
 *      script[data-lv-jsonld=id]），重复调用不堆叠。
 * 可清理：动态创建的节点统一标记 data-lv-head，cleanupInjectedHead() 精确移除，
 *         并对覆盖过的静态 meta / title 写回原值（E2-002）。
 *
 * 局限（无 SSR）：爬虫首次拿到静态 index.html 时仍是默认 meta；此处注入仅对
 * Googlebot 二次 JS 渲染抓取与已加载用户生效。社交 OG 预览器不执行 JS，
 * 首次预览仍是 LinkVault 默认值——彻底解决需后续 SSR/Functions 轮。
 */

/** 标记本模块动态注入的节点，cleanupInjectedHead 据此精确清理 */
const MARK = 'data-lv-head'

/** 站点默认 title（与 index.html 对齐） */
const DEFAULT_TITLE = 'LinkVault — 个人书签管理器'

/** 覆盖静态 meta 前缓存的原 content，key = `${attrName}:${attrValue}` */
const _staticMetaBackup = new Map<string, string>()

/** setTitle 前缓存的原 title，cleanup 时写回 */
let _titleBackup: string | null = null

/** 设置/更新 <title> */
export function setTitle(t: string): void {
  if (typeof document === 'undefined') return
  // E2-002：首次改写前备份，cleanup 可还原
  if (_titleBackup === null) _titleBackup = document.title
  document.title = t
}

/**
 * 设置/更新单个 <meta>。
 * 按 `meta[attrName="attrValue"]` 选择器复用已有节点、更新 content，保证幂等。
 * 用于既存的静态 meta（index.html 已有 og:title 等）覆盖，也用于新增。
 * 复用静态节点时备份原 content，cleanup 写回。
 */
export function setMetaByAttr(attrName: 'name' | 'property', attrValue: string, content: string): void {
  if (typeof document === 'undefined') return
  const sel = `meta[${attrName}="${attrValue}"]`
  let el = document.head.querySelector<HTMLMetaElement>(sel)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attrName, attrValue)
    el.setAttribute(MARK, '')
    document.head.appendChild(el)
  } else if (!el.hasAttribute(MARK)) {
    // E2-002：覆盖静态节点前备份原 content（幂等多次 set 只备份第一次）
    const key = `${attrName}:${attrValue}`
    if (!_staticMetaBackup.has(key)) {
      _staticMetaBackup.set(key, el.getAttribute('content') || '')
    }
  }
  el.setAttribute('content', content)
}

/** 设置/更新 <link rel="canonical">。复用 index.html 静态 canonical（不带标记） */
export function setCanonical(href: string): void {
  if (typeof document === 'undefined') return
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    el.setAttribute(MARK, '')
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/**
 * 注入/覆盖 JSON-LD <script type="application/ld+json">（按 data-lv-jsonld=id 去重）。
 * 动态创建的 script 同时带 data-lv-head 标记，使 cleanupInjectedHead 能清理；
 * index.html 里手写的 data-lv-jsonld="app" 节点不带标记、保留。
 */
export function setJsonLd(id: string, data: unknown): void {
  if (typeof document === 'undefined') return
  const sel = `script[type="application/ld+json"][data-lv-jsonld="${id}"]`
  let el = document.head.querySelector<HTMLScriptElement>(sel)
  if (!el) {
    el = document.createElement('script')
    el.setAttribute('type', 'application/ld+json')
    el.setAttribute('data-lv-jsonld', id)
    el.setAttribute(MARK, '')
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

/**
 * 清理本模块动态注入的全部节点（meta/og/twitter/canonical 动态节点/JSON-LD），
 * 并还原被覆盖的静态 meta 与 document.title（E2-002）。
 * ShareView 卸载时调用；canonical 若复用静态节点需调用方 setCanonical 写回首页。
 */
export function cleanupInjectedHead(): void {
  if (typeof document === 'undefined') return
  document.head.querySelectorAll(`[${MARK}]`).forEach(el => {
    el.parentNode?.removeChild(el)
  })
  // 还原覆盖过的静态 meta
  for (const [key, content] of _staticMetaBackup) {
    const colon = key.indexOf(':')
    if (colon < 0) continue
    const attrName = key.slice(0, colon)
    const attrValue = key.slice(colon + 1)
    const el = document.head.querySelector<HTMLMetaElement>(`meta[${attrName}="${attrValue}"]`)
    if (el && !el.hasAttribute(MARK)) {
      el.setAttribute('content', content)
    }
  }
  _staticMetaBackup.clear()
  // 还原 title
  if (_titleBackup !== null) {
    document.title = _titleBackup
    _titleBackup = null
  } else {
    document.title = DEFAULT_TITLE
  }
}
