/**
 * preview.ts — 卡片备注/内容的统一纯文本摘要
 *
 * 列表模式与小宫格共享此函数。组遍历 bookmarkIds，把成员（书签或嵌套组）
 * 渲染成【名字】拼接；书签直接取 notes 纯文本。富文本 HTML 先抽 textContent。
 */
import { useDataStore } from '../stores/data.js'
import { sanitizeHTML } from '../utils.js'
import type { Bookmark, SiblingGroup } from '../types.js'

/** 纯文本摘要字符上限（超出省略号），约四行小宫格所见 */
const PREVIEW_MAX = 160

/** 把 HTML 富文本抽成单行纯文本 */
function htmlToText(html: string): string {
  if (!html) return ''
  const tmp = document.createElement('div')
  tmp.innerHTML = sanitizeHTML(html)
  tmp.querySelectorAll('.gic-btn, .gic-remove, .gic-domain').forEach(el => el.remove())
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim()
}

function truncate(s: string): string {
  if (!s) return ''
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) + '…' : s
}

/** 书签摘要：notes 纯文本（截断） */
export function bookmarkPreview(bm: Bookmark): string {
  return truncate(htmlToText(bm.notes || ''))
}

/** 组摘要：notes 纯文本 + 组内成员【名字】拼接 */
export function groupPreview(grp: SiblingGroup): string {
  const ds = useDataStore()
  const parts: string[] = []
  const notesText = htmlToText(grp.notes || '')
  if (notesText) parts.push(notesText)
  const ids = grp.bookmarkIds || []
  if (ids.length) {
    const names = ids.map(id => {
      const g = ds.groupMap[id]
      if (g) return `【${g.name || '未命名组'}】`
      const b = ds.bookmarkMap[id]
      if (b) return `【${b.title || b.url || ''}】`
      return ''
    }).filter(Boolean)
    if (names.length) parts.push(names.join(' '))
  }
  return truncate(parts.join(' ').trim())
}