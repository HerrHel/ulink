/**
 * chatStreamParser.ts — 对话流随文内嵌卡片切片与轻量排版解析器
 *
 * 核心功能：
 * 1. 将混排了 ```ulink-card 结构标记的正文，按出现顺序切分为「富文本段落」与「原生内嵌卡片」；
 * 2. 对普通文本段落进行轻量、无杂质的 Markdown 格式化（小标题、加粗、项目符号），消除 raw 语法符号；
 * 3. 严格使用 DOMPurify 进行 XSS 防护；
 * 4. 自动匹配用户现有的 categories 与 attributes，补全 Favicon 与元数据。
 */

import DOMPurify from 'dompurify'
import type { Category, CustomAttribute } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'
import { t } from '../../i18n/index.js'
import { getSmartPrefill } from './smartPrefill.js'
import { isPrivateUrl } from './urlGuard.js'
import { fixUrl } from '../../utils.js'

export type ChatContentSegment =
  | { type: 'text'; html: string; rawText: string }
  | { type: 'card'; candidate: AiCandidateBookmark }

/**
 * 解析表格行并按竖线拆分单元格（支持 \| 转义）
 */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return []
  let raw = trimmed
  if (raw.startsWith('|')) raw = raw.slice(1)
  if (raw.endsWith('|')) raw = raw.slice(0, -1)
  const cells: string[] = []
  let current = ''
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\' && !escaped) {
      escaped = true
      current += ch
      continue
    }
    if (ch === '|' && !escaped) {
      cells.push(current.trim().replace(/\\\|/g, '|'))
      current = ''
    } else {
      current += ch
    }
    escaped = false
  }
  cells.push(current.trim().replace(/\\\|/g, '|'))
  return cells
}

/**
 * 判断是否为表格的表头对齐分隔行 (如 |---|:---:|---:|)
 */
function isTableDelimiter(cells: string[]): boolean {
  if (cells.length === 0) return false
  return cells.every(c => /^\s*:?-{1,}:?\s*$/.test(c))
}

/**
 * 极简、安全的轻量 Markdown 格式化（消除 ## 与 **，带来原生杂志级纸质排版）
 */
export function formatLightMarkdown(raw: string): string {
  if (!raw) return ''

  // 0. 剔除 HTML 注释（如 <!-- suggestions: [...] -->），未闭合的流式注释也即刻遮盖
  let text = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/g, '')

  // 1. 转义基础 HTML 实体防注入
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 2. 标题语法 (# / ## / ###)
  text = text.replace(/^###\s+(.+)$/gm, '<h4 class="chat-flow-heading">$1</h4>')
  text = text.replace(/^##?\s+(.+)$/gm, '<h3 class="chat-flow-heading">$1</h3>')

  // 3. 加粗语法 (**text**)
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // 4. 行内代码 (`code`)
  text = text.replace(/`([^`]+)`/g, '<code class="chat-flow-code">$1</code>')

  // 5. 链接识别与清理：先识别 Markdown 链接 [text](url)，再识别单独成行的原始网址
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="chat-flow-link">$1</a>',
  )
  text = text.replace(
    /(https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+)/g,
    (match, url, offset, fullStr) => {
      // 若该 URL 已在 href="..." 中，不重复包裹
      const before = fullStr.slice(Math.max(0, offset - 10), offset)
      if (/href=["']$/.test(before)) return match
      return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="chat-flow-link">${url}</a>`
    },
  )

  // 6. 按行解析块级元素（标题、表格、列表、普通段落）
  const lines = text.split('\n')
  const blocks: string[] = []
  let textBuffer: string[] = []

  const flushTextBuffer = () => {
    if (textBuffer.length > 0) {
      const p = textBuffer.join('<br>')
      if (p.trim()) {
        blocks.push(`<p class="chat-flow-para">${p}</p>`)
      }
      textBuffer = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // 空行：冲刷段落
    if (!trimmedLine) {
      flushTextBuffer()
      i++
      continue
    }

    // 标题语法：作为独立块级元素
    if (/^<h[34]\b/.test(trimmedLine)) {
      flushTextBuffer()
      blocks.push(trimmedLine)
      i++
      continue
    }

    // 检查是否为表格起始：当前行包含竖线，且下一行为表头分隔行 (如 |---|---|)
    if (i + 1 < lines.length) {
      const headerCells = splitTableRow(line)
      const nextCells = splitTableRow(lines[i + 1])
      if (
        headerCells.length >= 2 &&
        isTableDelimiter(nextCells) &&
        Math.abs(headerCells.length - nextCells.length) <= 1
      ) {
        flushTextBuffer()

        // 解析列对齐方式
        const alignments = nextCells.map(c => {
          const trimmed = c.trim()
          if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center'
          if (trimmed.endsWith(':')) return 'right'
          if (trimmed.startsWith(':')) return 'left'
          return ''
        })

        const colCount = Math.max(headerCells.length, nextCells.length)
        const theadThs = headerCells.map((cell, cIdx) => {
          const align = alignments[cIdx] || ''
          const styleAttr = align ? ` style="text-align: ${align}"` : ''
          const alignClass = align ? ` align-${align}` : ''
          return `<th class="chat-flow-th${alignClass}"${styleAttr}>${cell}</th>`
        })
        const theadHtml = `<thead><tr>${theadThs.join('')}</tr></thead>`

        // 收集后续数据行
        i += 2
        const tbodyRows: string[] = []
        while (i < lines.length) {
          const dataLine = lines[i]
          const trimmedData = dataLine.trim()
          // 遇到空行、标题、列表项或不含竖线的行，表格结束
          if (
            !trimmedData ||
            !trimmedData.includes('|') ||
            /^<h[34]\b/.test(trimmedData) ||
            /^[*-]\s/.test(trimmedData) ||
            /^\d+\.\s/.test(trimmedData)
          ) {
            break
          }
          const rowCells = splitTableRow(dataLine)
          if (rowCells.length === 0 || isTableDelimiter(rowCells)) {
            break
          }
          const tds: string[] = []
          for (let cIdx = 0; cIdx < colCount; cIdx++) {
            const cell = rowCells[cIdx] !== undefined ? rowCells[cIdx] : ''
            const align = alignments[cIdx] || ''
            const styleAttr = align ? ` style="text-align: ${align}"` : ''
            const alignClass = align ? ` align-${align}` : ''
            tds.push(`<td class="chat-flow-td${alignClass}"${styleAttr}>${cell}</td>`)
          }
          tbodyRows.push(`<tr>${tds.join('')}</tr>`)
          i++
        }

        const tbodyHtml = `<tbody>${tbodyRows.join('')}</tbody>`
        const tableHtml = `<div class="chat-flow-table-wrap"><table class="chat-flow-table">${theadHtml}${tbodyHtml}</table></div>`
        blocks.push(tableHtml)
        continue
      }
    }

    // 无序列表行 (- item / * item)
    const listMatch = line.match(/^(\s*)[*-]\s+(.+)$/)
    if (listMatch) {
      flushTextBuffer()
      const listItems: string[] = []
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)[*-]\s+(.+)$/)
        if (!itemMatch) break
        listItems.push(`<li>${itemMatch[2]}</li>`)
        i++
      }
      blocks.push(`<ul class="chat-flow-list">${listItems.join('')}</ul>`)
      continue
    }

    // 有序列表行 (1. item)
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/)
    if (olMatch) {
      flushTextBuffer()
      const listItems: string[] = []
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)\d+\.\s+(.+)$/)
        if (!itemMatch) break
        listItems.push(`<li>${itemMatch[2]}</li>`)
        i++
      }
      blocks.push(`<ol class="chat-flow-list chat-flow-ol">${listItems.join('')}</ol>`)
      continue
    }

    // 普通文本行：加入当前段落缓冲区
    textBuffer.push(line)
    i++
  }

  flushTextBuffer()
  const finalHtml = blocks.join('')

  return DOMPurify.sanitize(finalHtml, {
    ALLOWED_TAGS: [
      'p',
      'strong',
      'em',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'code',
      'br',
      'a',
      'span',
      'div',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style', 'align'],
  })
}

/**
 * 将流式解析出的随文卡片增量合并进既有 candidates（去重保序）。
 * 流式期间每次解析都是对「已到达内容」的全量解析，需持续合并而非只取首批，
 * 否则后到的卡片不进 turn.candidates（一键全部存入/持久化会漏卡）。
 * 去重键为 url|title；既有条目优先保留（保住 isAdded 等用户操作状态）。
 * 无新增时原样返回既有数组（调用方据此跳过赋值，避免渲染期反复改写状态）。
 */
export function mergeParsedCandidates(
  existing: AiCandidateBookmark[] | undefined,
  parsed: AiCandidateBookmark[]
): AiCandidateBookmark[] | undefined {
  if (!parsed.length) return existing
  const base = existing || []
  const seen = new Set(base.map((c) => `${c.url}|${c.title}`))
  const merged = [...base]
  for (const c of parsed) {
    const key = `${c.url}|${c.title}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(c)
    }
  }
  return merged.length === base.length ? existing : merged
}

/**
 * 将整段文本按照 ```ulink-card ... ``` 切割为有序段落与卡片
 */
export function parseTurnContentSegments(
  content: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): {
  segments: ChatContentSegment[]
  allCandidates: AiCandidateBookmark[]
} {
  if (!content) {
    return { segments: [], allCandidates: [] }
  }

  const segments: ChatContentSegment[] = []
  const allCandidates: AiCandidateBookmark[] = []

  const cardBlockRegex = /```ulink-card\s*([\s\S]*?)```/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = cardBlockRegex.exec(content)) !== null) {
    // 1. 取代码块之前的普通文本
    const beforeText = content.substring(lastIndex, match.index).trim()
    if (beforeText) {
      segments.push({
        type: 'text',
        rawText: beforeText,
        html: formatLightMarkdown(beforeText),
      })
    }

    // 2. 解析代码块中的卡片 JSON
    const rawJson = match[1]?.trim()
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson)
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          if (item && item.title && item.url) {
            const rawUrl = String(item.url).trim()
            const fixedUrl = fixUrl(rawUrl)
            // 拒绝非 http/https 协议或私有/局域网内网地址
            if (!fixedUrl || isPrivateUrl(fixedUrl)) continue

            const prefill = getSmartPrefill(fixedUrl, [], categories, attributes)
            const matchedCat = categories.find(
              c => c.name === item.suggestedCategory && c.id !== 'all' && c.id !== 'uncategorized'
            )

            const candidate: AiCandidateBookmark = {
              title: String(item.title).trim(),
              url: fixedUrl,
              notes: item.notes ? String(item.notes).trim() : (prefill.notes || ''),
              categoryId: matchedCat?.id || prefill.categoryId || undefined,
              suggestedAttrIds: prefill.suggestedAttrIds?.length ? prefill.suggestedAttrIds : undefined,
              tag: item.tags?.[0] || (item.notes?.includes('开源') ? t('ai.tagOpenFree') : t('ai.tagSmartRec')),
              highlight: item.notes || item.title,
            }

            segments.push({
              type: 'card',
              candidate,
            })
            allCandidates.push(candidate)
          }
        }
      } catch (err) {
        console.warn('[chatStreamParser] Failed to parse inline ulink-card JSON:', err, rawJson)
      }
    }

    lastIndex = cardBlockRegex.lastIndex
  }

  // 3. 取最后一个代码块之后的文本（兼容流式生成中的未闭合卡片块）
  const remainingText = content.substring(lastIndex)
  const unclosedIdx = remainingText.indexOf('```')
  if (unclosedIdx !== -1) {
    const afterTicks = remainingText.substring(unclosedIdx)
    // 若命中未闭合的 ```ulink-card 或正在流式打出 ```u...，隐藏半截 JSON 避免闪烁暴露
    if (afterTicks.startsWith('```ulink-card') || '```ulink-card'.startsWith(afterTicks)) {
      const beforeUnclosed = remainingText.substring(0, unclosedIdx).trim()
      if (beforeUnclosed) {
        segments.push({
          type: 'text',
          rawText: beforeUnclosed,
          html: formatLightMarkdown(beforeUnclosed),
        })
      }
    } else {
      const trimmed = remainingText.trim()
      if (trimmed) {
        segments.push({
          type: 'text',
          rawText: trimmed,
          html: formatLightMarkdown(trimmed),
        })
      }
    }
  } else if (remainingText.trim()) {
    segments.push({
      type: 'text',
      rawText: remainingText.trim(),
      html: formatLightMarkdown(remainingText.trim()),
    })
  }

  return { segments, allCandidates }
}
