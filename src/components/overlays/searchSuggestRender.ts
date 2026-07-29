import type { HighlightSegment } from '../../lib/search.js'

// 搜索建议项高亮渲染：把搜索命中段包成 <mark>，其余文本经 esc 转义防 v-html 注入。
// 从 SearchSuggest.vue 抽出为独立纯模块以便直接测试（与 typeLabel.ts/getPreview.ts/highlight.ts 同口径），
// 函数体逐字保留零行为变化。

/** 用 DOM textContent→innerHTML 的方式转义 HTML 特殊字符，防 v-html 注入。 */
export function esc(s: string): string { const d = document.createElement('div'); d.textContent = s; return d.innerHTML }

/**
 * 渲染单行搜索建议项的可见文本：
 * - highlights 未命中 key / 命中但为空数组 → 渲染转义后的 fallback
 * - 命中段 s.highlight=true → `<mark class="ss-hl">` + 转义后的 s.text + `</mark>`
 * - 命中段 s.highlight=false → 仅转义后的 s.text
 * 输出经模板 v-html 注入，故全部文本段必须经 esc 转义防 XSS。
 */
export function renderHighlight(highlights: Record<string, HighlightSegment[]> | undefined, key: string, fallback: string): string {
  const segs = highlights?.[key]
  if (!segs || !segs.length) return esc(fallback)
  return segs.map(s => s.highlight ? `<mark class="ss-hl">${esc(s.text)}</mark>` : esc(s.text)).join('')
}
