/**
 * utils.js — 通用工具函数
 * 职责：ID 生成、URL/域名处理、HTML 清理、UI 辅助
 * 密码加密 → crypto.js  |  拖拽辅助 → composables/useDragDrop.js
 */
import { toast } from './lib/toast.js'
import DOMPurify from 'dompurify'
import { nanoid } from 'nanoid'
import type { Bookmark, SiblingGroup, CustomAttribute, Category } from './types.js'
import { ATTR_IS_GROUP } from './config/constants.js'
import { FAVICON_PROVIDER_URL } from './config/urls.js'
import { isThreePartCipher } from './crypto.js'

interface AppStore {
  categories: Category[]
  addCategory: (cat: Category) => void
  save: () => void
}

// ── ID / URL / 域名 ──

export function gid(): string { return nanoid(12) }

// 分享组 id 白名单（默认拒绝）。合法：[A-Za-z0-9_-] 长度 2–64。
// 覆盖 createGroup('sg_'+nanoid)、fork('g'+ts36+rand)、示例 sg_welcome。
const SHARE_GID_RE = /^[a-zA-Z0-9_-]{2,64}$/
export function isValidShareGroupId(gid: string | null | undefined): gid is string {
  return typeof gid === 'string' && SHARE_GID_RE.test(gid)
}
export function domain(url: string): string {
  // 先按合法 URL 解析：https://a.b.c（三段域名）正常返回 hostname，不受下方密文判定影响。
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    // new URL 解析失败（非合法 URL）时：三段密文（未解锁/解不开的 E2E 密文 url）返空兜底，
    // 统一让所有 domain(url) 调用点（卡片域名/搜索建议/提及/死链/组内联卡）不把密文乱码吐给 UI。
    // 数据层保留密文（见 useE2E 解密护栏）；其它非法串返原串，保持旧语义。
    return isThreePartCipher(url) ? '' : url
  }
}
/** A5-006：自定义 icon 仅允许 http(s) 或相对路径，拒绝 javascript:/data: 等 */
export function safeIconUrl(icon?: string | null): string {
  if (!icon) return ''
  const t = icon.trim()
  if (!t) return ''
  if (/^https?:\/\//i.test(t)) return t
  // 相对路径：/path、./x、../x，或无 scheme 的文件名/路径（custom.png、icons/a.svg）
  if (t.startsWith('/') || t.startsWith('./') || t.startsWith('../')) return t
  // 拒绝一切其它 scheme（javascript: data: vbscript: 等）
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/i.test(t)) return ''
  // 无 scheme 的相对资源名
  return t
}

/**
 * E2E 密文展示兜底：三段 salt.iv.data 密文（未解锁 / 解锁失败保留）显示空串，明文原样。
 * 与 domain() 的密文检测同源——数据层解密失败保留原文不置空（见 useE2E.decryptItem /
 * decryptStoreItems），渲染层用本函数兜底不把密文乱码吐给 UI。解锁成功后字段被解密为
 * 明文，isThreePartCipher=false，自动恢复正常显示。
 */
export function displayText(value: string | null | undefined): string {
  return typeof value === 'string' && isThreePartCipher(value) ? '' : (value ?? '')
}

export function favicon(url: string, customIcon?: string): string {
  const safe = safeIconUrl(customIcon)
  if (safe) return safe
  const dm = domain(url)
  return dm ? FAVICON_PROVIDER_URL + dm : ''
}

/**
 * 首字母占位图标（本地降级）。当远程 favicon 加载失败或为空时使用，避免破图、
 * 避免强依赖第三方（隐私）、零网络请求。返回内联 SVG data URI。
 * @param name 取首字符（通常传书签标题 / 域名首字母）
 */
export function faviconInitials(name: string | null | undefined): string {
  const ch = ((name || '').toString().trim().charAt(0) || '?').toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#6e7681"/><text x="16" y="16" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#ffffff">${ch}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}
export function fixUrl(u: string): string {
  // S1：协议白名单。仅放行 http/https；其余带 scheme（javascript:/data:/vbscript: 等）
  // 一律视为无效并返回空串，避免拼接 https:// 后又把 javascript: 当相对路径导航。
  const trimmed = u.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  // 命中其它可导航 scheme（scheme:... 形态）一律拒绝，杜绝 javascript:alert(1) 等 XSS
  if (/^[a-zA-Z][a-zA-Z0-9+.\-]*:/i.test(trimmed)) return ''
  return 'https://' + trimmed
}

// ── HTML / 文本 ──

// S1：esc 同时转义 & < > " '，使其在「属性值（双引号/单引号）」与「文本节点」两种
// 上下文都安全 —— 调用方会把结果拼进 src="..." / HREF="..." 等属性，仅转义 & < > 不足以
// 阻断引号闭合后的属性注入（如 bm.url = 'x" onerror=...'）。
// 显式映射，不依赖 textContent→innerHTML 的引号转义行为（各运行时实现可能不一致）。
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// S5：DOMPurify 改为白名单策略。notes 经 v-html 渲染（DetailPanel/GroupCard），
// 且 group.notes 来自跨用户公开数据（fetchPublicGroup），必须白名单清洗，杜绝
// <details ontoggle>、<a href="javascript:">、<img src="data:"> 等事件/协议注入。
const _purifyConfig = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'a', 'code', 'pre', 'hr', 'span'],
  ALLOWED_ATTR: ['class', 'href', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^https?:\/\//i,
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'svg', 'math'],
}

// S5-readonly (AUDIT-R34)：只读展示变体白名单，用于 GroupCard 折叠态/详情态只读笔记、
// ShareView 公开分享视图经 v-html 渲染的 notes。相对编辑态 _purifyConfig 额外放行：
//   · <img> + src/alt —— inlineCard 的 favicon 当前被整删不显示；img 不在事件/协议白名单，
//     src 受 ALLOWED_URI_REGEXP 限 https?（data:/javascript:/blob: 全剥），onerror 等事件属性
//     不入 ALLOWED_ATTR，无脚本注入面。
//   · 已知 data-* 属性（data-bm-id/data-group-id/data-type/data-checked 等）—— inlineCard 的
//     data-bm-id（只读点击看详情依赖）、data-group-id（gid 定位）、taskList 的 data-type/data-checked
//     （清单语义）当前被剥致只读视图 inlineCard 点击失效 + task 语义丢失。data-* 无事件 handler 可挂、
//     无协议可跳转，唯一利用面是 CSS attribute selector 做信息外泄露（如 [data-bm-id^="x"]{background:
//     url(...)}），但 style/script 均在 FORBID_TAGS 堵死 CSS 注入面，故 data-* 放行在当前白名单下无可见
//     注入面。注：DOMPurify 的 ALLOWED_ATTR 对 data- 前缀按整族放行（列任一 data-x 即放行所有 data-*），
//     此处显式列清单意图是文档化「应保留的 data-* 语义」而非真收窄——真收窄需 afterSanitizeAttributes
//     hook 删白名单外 data-*，但 inlineCard 语义稳定且 CSS 注入面已堵，过度收窄反成维护负担，故接受整族放行。
// 不放行：contenteditable/draggable（只读视图不需编辑/拖拽，剥除正合适）、input/label
// （taskList 勾选态用 CSS 呈现，不引入表单控件加载面）。仍走同一 afterSanitizeAttributes 钩子
// 强制 <a> 安全 rel/target，最大化复用既有安全屏障。
const _purifyReadonlyConfig = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'a', 'code', 'pre', 'hr', 'span', 'img'],
  ALLOWED_ATTR: ['class', 'href', 'target', 'rel', 'src', 'alt', 'data-bm-id', 'data-group-id', 'data-type', 'data-checked'],
  ALLOWED_URI_REGEXP: /^https?:\/\//i,
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'svg', 'math'],
}

// S5：afterSanitizeAttributes 钩子，对所有 <a> 强制注入安全 rel 与 target，
// 阻断 javascript:/data: 经 href 注入，并防止 tab-opener 攻击。
// 幂等注册：先移除再添加，避免 HMR 重复加载导致 hook 叠加。
DOMPurify.removeAllHooks()
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName.toLowerCase() === 'a') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer nofollow')
    // 若 href 被 ALLOWED_URI_REGEXP 过滤为空，移除 href 本身防点击空锚
    if (!node.getAttribute('href')) node.removeAttribute('href')
  }
  // S5-readonly：img 强制剥除潜在残留事件属性（ALLOWED_ATTR 已挡，双保险）+ 协议检查后空 src 剥除
  if (node.nodeName.toLowerCase() === 'img') {
    if (!node.getAttribute('src')) node.removeAttribute('src')
  }
})

export function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html, _purifyConfig)
}

/** AUDIT-R34：只读展示变体，放行 img + 已知 data-* 以保留 inlineCard favicon / 只读点击 / taskList 语义 */
export function sanitizeReadonlyHTML(html: string): string {
  return DOMPurify.sanitize(html, _purifyReadonlyConfig)
}

export function cleanZeroWidth(text: string): string { return text.replace(/\u200B{2,}/g, '\u200B') }

// ── UI 辅助 ──

export function swapOrder(a: { order: number }, b: { order: number }): void { if (a.order === b.order) b.order++; const t = a.order; a.order = b.order; b.order = t }

/** D2-005：仅在真正写入剪贴板成功后 toast「已复制」 */
export function copyToClipboard(text: string, label?: string): void {
  const okMsg = (label || '') + ' 已复制'
  const failMsg = (label || '内容') + ' 复制失败'
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast(okMsg),
      () => toast(failMsg, false),
    )
    return
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    toast(ok ? okMsg : failMsg, ok)
  } catch {
    toast(failMsg, false)
  }
}

/**
 * isMobile — 基于 matchMedia 的响应式检测
 *
 * 使用 matchMedia 而非 window.innerWidth，自动跟随系统/浏览器变化，
 * 无需 Vue reactivity 支撑。uiStore.isMobile 保持独立的 resize 驱动更新。
 * HMR 环境下通过 removeEventListener 避免重复监听器。
 */
const _mobileMql = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 768px)') : null
let _isMobile = _mobileMql?.matches ?? false

function _onMediaChange(e: MediaQueryListEvent) { _isMobile = e.matches }

if (_mobileMql) {
  _mobileMql.addEventListener('change', _onMediaChange)
  // HMR 兜底：模块被替换时移除旧监听器（import.meta.hot 仅在 Vite dev 存在）
  if (typeof import.meta !== 'undefined' && import.meta.hot) {
    import.meta.hot.dispose(() => _mobileMql?.removeEventListener('change', _onMediaChange))
  }
}

export function isMobile(): boolean { return _isMobile }

export function getTagNames(item: Bookmark | SiblingGroup, customAttributes: CustomAttribute[]): string[] {
  if (!item.attributes) return []
  // 排除软删定义 + 内置 is-group，避免回收站属性仍出现在卡片 tag 上
  return customAttributes
    .filter(a => !a.deletedAt && a.id !== ATTR_IS_GROUP && item.attributes[a.id])
    .map(a => a.name)
}

// ── 分类 ──

export const CATEGORY_COLORS = ['#122E8A', '#E63948', '#d97706', '#7c3aed', '#0d9488', '#db2777', '#2563eb', '#059669']

export function createCategory(name: string): Category {
  return {
    id: gid(),
    name,
    icon: 'star',
    color: CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)],
    // B-12：order 是序号语义（升序排序），由 addNewCategory 按当前分类数赋值。
    // 历史 bug：这里曾用 Date.now() 当 order——毫秒戳 13 位超出远端 categories.order
    // INTEGER 上限(2147483647)，同步必报 "value out of range for type integer"。
    order: 0,
  }
}

export function addNewCategory(name: string, store: AppStore): Category | null {
  const trimmed = name.trim()
  if (!trimmed) { toast('请输入分类名称', false); return null }
  if (store.categories.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) { toast('分类名称已存在', false); return null }
  const cat = createCategory(trimmed)
  // B-12：序号语义——新分类排最后（非软删分类计数），勿用毫秒时间戳（溢出远端 INTEGER order 列）
  cat.order = store.categories.filter(c => !c.deletedAt).length
  store.addCategory(cat)
  store.save()
  toast('分类已添加')
  return cat
}

export function stripEntranceAnim(el: HTMLElement | null): (() => void) | null {
  if (!el) return null
  const onEnd = (e: AnimationEvent) => {
    if (e.animationName === 'listExpandIn') {
      el.style.animationName = el.style.animationName.replace(/listExpandIn\s*,?\s*/, '').trim() || 'none'
      return
    }
    if (e.animationName === 'listCardIn') {
      el.style.animationName = 'none'
      el.removeEventListener('animationend', onEnd)
    }
  }
  el.addEventListener('animationend', onEnd)
  return () => el.removeEventListener('animationend', onEnd)
}