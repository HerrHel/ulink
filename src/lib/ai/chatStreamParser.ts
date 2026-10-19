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

export type ChatContentSegment =
  | { type: 'text'; html: string; rawText: string }
  | { type: 'card'; candidate: AiCandidateBookmark }

/**
 * 极简、安全的轻量 Markdown 格式化（消除 ## 与 **，带来原生杂志级纸质排版）
 */
export function formatLightMarkdown(raw: string): string {
  if (!raw) return ''

  // 1. 转义基础 HTML 实体防注入
  let text = raw
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

  // 5. 链接识别与清理：若有单独成行的加粗网址 **https://...**，已转为 strong，可点化
  //    URL 段用 ASCII 白名单：URL 后紧贴的中文是叙述文字，吞进 href 会 404
  text = text.replace(/(https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&*+,;=%]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-flow-link">$1</a>')

  // 6. 无序列表行 (- item / * item)
  const lines = text.split('\n')
  const formattedLines: string[] = []
  let inList = false

  for (const line of lines) {
    const listMatch = line.match(/^(\s*)[*-]\s+(.+)$/)
    if (listMatch) {
      if (!inList) {
        formattedLines.push('<ul class="chat-flow-list">')
        inList = true
      }
      formattedLines.push(`<li>${listMatch[2]}</li>`)
    } else {
      if (inList) {
        formattedLines.push('</ul>')
        inList = false
      }
      formattedLines.push(line)
    }
  }
  if (inList) {
    formattedLines.push('</ul>')
  }

  // 7. 段落换行（双换行分段，单换行保留 break）
  let finalHtml = formattedLines.join('\n')
  // 将非标签包裹的单纯换行换为 <br>
  finalHtml = finalHtml
    .split(/\n{2,}/)
    .map(para => {
      const p = para.trim()
      if (!p) return ''
      if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<li')) return p
      return `<p class="chat-flow-para">${p.replace(/\n/g, '<br>')}</p>`
    })
    .join('')

  return DOMPurify.sanitize(finalHtml, {
    ALLOWED_TAGS: ['p', 'strong', 'em', 'h3', 'h4', 'ul', 'li', 'code', 'br', 'a', 'span'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
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
            const prefill = getSmartPrefill(item.url, [], categories, attributes)
            const matchedCat = categories.find(
              c => c.name === item.suggestedCategory && c.id !== 'all' && c.id !== 'uncategorized'
            )

            const candidate: AiCandidateBookmark = {
              title: String(item.title).trim(),
              url: String(item.url).trim(),
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
