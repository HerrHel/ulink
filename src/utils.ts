/**
 * utils.js — 通用工具函数
 * 职责：ID 生成、URL/域名处理、HTML 清理、UI 辅助
 * 密码加密 → crypto.js  |  拖拽辅助 → composables/useDragDrop.js
 */
import { toast } from './lib/toast.js'
import DOMPurify from 'dompurify'
import { nanoid } from 'nanoid'
import type { Bookmark, SiblingGroup, CustomAttribute, Category } from './types.js'

interface AppStore {
  categories: Category[]
  addCategory: (cat: Category) => void
  save: () => void
}

// ── ID / URL / 域名 ──

export function gid(): string { return nanoid(12) }
export function domain(url: string): string { try { return new URL(url).hostname.replace(/^www\./, '') } catch (_) { return url } }
export function favicon(url: string, customIcon?: string): string {
  if (customIcon) return customIcon
  const dm = domain(url)
  return dm ? 'https://api.xinac.net/icon/?url=' + dm : ''
}
export function fixUrl(u: string): string { u = u.trim(); if (!u) return u; if (/^https?:\/\//i.test(u)) return u; return 'https://' + u }

// ── HTML / 文本 ──

export function esc(s: string): string { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }

const _purifyConfig = {
  ADD_TAGS: ['details', 'summary'],
  ADD_ATTR: ['contenteditable', 'draggable', 'data-bm-id', 'data-gid', 'data-group-id'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'base', 'form', 'input', 'textarea', 'select'],
  FORBID_ATTR: ['onerror', 'onload'],
}

export function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html, _purifyConfig)
}

export function cleanZeroWidth(text: string): string { return text.replace(/\u200B{2,}/g, '\u200B') }

/** \u641C\u7D22\u5173\u952E\u8BCD\u9AD8\u4EAE\uFF1A\u8F6C\u4E49 query \u2192 \u6B63\u5219\u5339\u914D \u2192 <mark class="card-hl"> \u5305\u88F9\uFF0C\u542B LRU \u7F13\u5B58 */
const _hlCache = new Map<string, string>()
const _HL_CACHE_MAX = 200

export function hlText(text: string, query: string): string {
  if (!text || !query.trim()) return esc(text)
  const key = text + '\0' + query
  const cached = _hlCache.get(key)
  if (cached) return cached

  const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(q, 'gi')
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(esc(text.slice(last, m.index)))
    parts.push('<mark class="card-hl">' + esc(m[0]) + '</mark>')
    last = m.index + m[0].length
    if (m[0].length === 0) { regex.lastIndex++; continue }
  }
  if (last < text.length) parts.push(esc(text.slice(last)))
  const result = parts.join('')

  // \u6709\u754C LRU \u5F0F\u7F13\u5B58\uFF1A\u8D85\u51FA\u4E0A\u9650\u65F6\u6DD8\u6C70\u6700\u65E9\u6761\u76EE
  if (_hlCache.size >= _HL_CACHE_MAX) {
    const firstKey = _hlCache.keys().next().value
    if (firstKey !== undefined) _hlCache.delete(firstKey)
  }
  _hlCache.set(key, result)
  return result
}

// ── UI 辅助 ──

export function swapOrder(a: { order: number }, b: { order: number }): void { if (a.order === b.order) b.order++; const t = a.order; a.order = b.order; b.order = t }

export function copyToClipboard(text: string, label?: string): void {
  if (navigator.clipboard) { navigator.clipboard.writeText(text).catch(function () {}) }
  else { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta) }
  toast((label || '') + ' 已复制')
}

/**
 * isMobile — 基于 matchMedia 的响应式检测
 *
 * 使用 matchMedia 而非 window.innerWidth，自动跟随系统/浏览器变化，
 * 无需 Vue reactivity 支撑。uiStore.isMobile 保持独立的 resize 驱动更新。
 */
const _mobileMql = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 768px)') : null
let _isMobile = _mobileMql?.matches ?? false
if (_mobileMql) {
  _mobileMql.addEventListener('change', (e: MediaQueryListEvent) => { _isMobile = e.matches })
}

export function isMobile(): boolean { return _isMobile }

export function getTagNames(item: Bookmark | SiblingGroup, customAttributes: CustomAttribute[]): string[] {
  if (!item.attributes) return []
  return customAttributes.filter(a => a.id !== 'is-group' && item.attributes[a.id]).map(a => a.name)
}

// ── 分类 ──

const CATEGORY_COLORS = ['#122E8A', '#E63948', '#d97706', '#7c3aed', '#0d9488', '#db2777', '#2563eb', '#059669']

export function createCategory(name: string): Category {
  return { id: gid(), name, icon: 'star', color: CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)] }
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