import { esc } from '../../utils.js'
import { match } from 'pinyin-pro'

/**
 * 将字符下标合并为不重叠且按顺序递增的闭区间 [start, end]
 */
function _indicesToRanges(indices: number[]): [number, number][] {
  if (!indices || !indices.length) return []
  const sorted = Array.from(new Set(indices)).sort((a, b) => a - b)
  const ranges: [number, number][] = []
  let rangeStart = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]
    if (curr === prev + 1) {
      prev = curr
    } else {
      ranges.push([rangeStart, prev])
      rangeStart = curr
      prev = curr
    }
  }
  ranges.push([rangeStart, prev])
  return ranges
}

/**
 * 按下标闭区间高亮 text，返回带 <mark class="card-hl"> 的 HTML（转义在前）。
 */
function _highlightByRanges(text: string, ranges: [number, number][]): string {
  if (!text) return ''
  if (!ranges.length) return esc(text)

  const parts: string[] = []
  let last = 0
  for (const [start, end] of ranges) {
    if (start < 0 || start >= text.length) continue
    const safeEnd = Math.min(end, text.length - 1)
    if (start > last) {
      parts.push(esc(text.slice(last, start)))
    }
    parts.push('<mark class="card-hl">' + esc(text.slice(start, safeEnd + 1)) + '</mark>')
    last = safeEnd + 1
  }
  if (last < text.length) {
    parts.push(esc(text.slice(last)))
  }
  return parts.join('')
}

/**
 * 按已编译 regex 或搜索词高亮 text，返回带 <mark> 的 HTML（转义在前）。
 *
 * 优先采用精确 regex 匹配；当字面量未命中时，自动按拼音首字母（如 'sj'）或拼音全拼/前缀
 * （如 'sheji' / 'she'）匹配汉字并高亮对应字符。
 *
 * 纯函数：复制 regex 防 lastIndex 共享污染、零长匹配推进防死循环。
 * 输出串注入模板 v-html，所有非标签字符必须经 esc 转义（XSS 护栏）。
 */
export function highlight(text: string, queryOrRegex: RegExp | string, rawQuery?: string): string {
  if (!text) return ''

  // 1. 若为 RegExp，优先执行字面量正则匹配
  if (queryOrRegex instanceof RegExp) {
    const re = new RegExp(queryOrRegex.source, queryOrRegex.flags) // 复制避免 lastIndex 共享污染
    re.lastIndex = 0
    const parts: string[] = []
    let last = 0
    let m: RegExpExecArray | null
    let hasMatch = false

    while ((m = re.exec(text)) !== null) {
      hasMatch = true
      if (m.index > last) parts.push(esc(text.slice(last, m.index)))
      parts.push('<mark class="card-hl">' + esc(m[0]) + '</mark>')
      last = m.index + m[0].length
      if (m[0].length === 0) { re.lastIndex++; continue }
    }

    if (hasMatch) {
      if (last < text.length) parts.push(esc(text.slice(last)))
      return parts.join('')
    }
  }

  // 2. 字面量未命中，提取搜索 query 进行拼音匹配（支持拼音首字母简拼与全拼/前缀）
  let q = rawQuery
  if (q === undefined) {
    if (typeof queryOrRegex === 'string') {
      q = queryOrRegex
    } else {
      q = queryOrRegex.source.replace(/\\(.)/g, '$1')
    }
  }
  q = (q || '').trim()
  if (!q) return esc(text)

  // 3. 拼音匹配（优先连续匹配，其次离散匹配）
  let matchedIndices: number[] | null = null
  try {
    matchedIndices = match(text, q, { continuous: true })
    if (!matchedIndices || !matchedIndices.length) {
      matchedIndices = match(text, q)
    }
  } catch {
    matchedIndices = null
  }

  if (matchedIndices && matchedIndices.length > 0) {
    const ranges = _indicesToRanges(matchedIndices)
    return _highlightByRanges(text, ranges)
  }

  return esc(text)
}
