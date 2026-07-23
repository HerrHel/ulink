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
export function domain(url: string): string { try { return new URL(url).hostname.replace(/^www\./, '') } catch (_) { return url } }
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

export function favicon(url: string, customIcon?: string): string {
  const safe = safeIconUrl(customIcon)
  if (safe) return safe
  const dm = domain(url)
  return dm ? 'https://api.xinac.net/icon/?url=' + dm : ''
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
})

export function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html, _purifyConfig)
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

const CATEGORY_COLORS = ['#122E8A', '#E63948', '#d97706', '#7c3aed', '#0d9488', '#db2777', '#2563eb', '#059669']

export function createCategory(name: string): Category {
  return {
    id: gid(),
    name,
    icon: 'star',
    color: CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)],
    order: Date.now(),
  }
}

export function addNewCategory(name: string, store: AppStore): Category | null {
  const trimmed = name.trim()
  if (!trimmed) { toast('请输入分类名称', false); return null }
  if (store.categories.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) { toast('分类名称已存在', false); return null }
  const cat = createCategory(trimmed)
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