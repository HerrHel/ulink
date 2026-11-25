/**
 * siteRecall.ts — 「本站回想」纯函数：当前网页所在网站，你曾经存过哪些书签
 *
 * 用于扩展侧边栏的当前页卡片（2.0.x「认」层，见 docs/EXTENSION_ROADMAP.md）。
 * 只做匹配与排序，不碰 DOM / Store。
 *
 * 匹配口径：主机名去掉 www. 后相同，或一方是另一方的子域名（docs.github.com ↔ github.com）。
 * 不做「同一父域的兄弟子域」匹配：a.github.io 与 b.github.io 是两个人的站，不能互相回想。
 */
import type { Bookmark } from '../types.js'

/** 取 http(s) 网址的主机名（小写、去 www.）；非 http(s) 或解析失败返回 ''（含未解锁的 E2E 密文网址） */
export function siteHost(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  } catch {
    return ''
  }
}

/** 两个主机名是否属于同一网站：相同，或一方是另一方的子域名（按点号边界，且短的一方至少两段） */
export function isSameSite(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (!short.includes('.')) return false
  return long.endsWith('.' + short)
}

/** 备注摘要：去 HTML 标签、合并空白、截断 */
export function notesSnippet(notes: string | null | undefined, max = 80): string {
  if (!notes) return ''
  const text = notes
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? Array.from(text).slice(0, max).join('') + '…' : text
}

/**
 * 当前网址所在网站存过的书签（不含已删除、不含 excludeId 本身）。
 * 排序：置顶优先 → 常用优先 → 最近更新优先。
 */
export function findSiteBookmarks(
  bookmarks: readonly Bookmark[],
  url: string | null | undefined,
  excludeId?: string | null,
): Bookmark[] {
  const host = siteHost(url)
  if (!host) return []
  const hits = bookmarks.filter(b => !b.deletedAt && b.id !== excludeId && isSameSite(host, siteHost(b.url)))
  return hits.sort((x, y) =>
    (y.pinnedAt || 0) - (x.pinnedAt || 0)
    || (y.useCount || 0) - (x.useCount || 0)
    || (y.updatedAt || 0) - (x.updatedAt || 0),
  )
}
