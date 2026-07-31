import { esc } from '../../utils.js'

/**
 * 按已编译 regex 高亮 text，返回带 <mark> 的 HTML（转义在前）。
 *
 * 纯函数：仅依赖入参 text + regex + 已测的 esc。复制 regex 防 lastIndex 共享污染、
 * 零长匹配 lastIndex++ 防死循环。返回串注入模板 v-html，故所有非匹配段必须经 esc 转义——
 * 回归一处漏转义即 XSS 面（见护栏 BookmarkCard.highlight.test.ts）。
 *
 * 注意：依赖 regex 带 g flag——exec 靠 lastIndex 推进，无 g flag 会死循环
 * （无 g 时 exec 恒返首匹配、last 不推进、parts 无限 push 撑爆 heap）。
 * 生产 hlRegex 形如 `new RegExp(escaped_q, 'gi')` 恒带 gi，故无 g 形态生产不可达。
 */
export function highlight(text: string, regex: RegExp): string {
  if (!text) return ''
  const re = new RegExp(regex.source, regex.flags) // 复制避免 lastIndex 共享污染
  re.lastIndex = 0
  const parts: string[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(esc(text.slice(last, m.index)))
    parts.push('<mark class="card-hl">' + esc(m[0]) + '</mark>')
    last = m.index + m[0].length
    if (m[0].length === 0) { re.lastIndex++; continue }
  }
  if (last < text.length) parts.push(esc(text.slice(last)))
  return parts.join('')
}
