import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'
import { t } from '../../i18n/index.js'
import { sanitizeForPrompt } from './mimoClient.js'

/** 附件注入提示词的字段级限长（防单字段撑爆消息、防隐私全量外送） */
const MAX_ATTACH_TITLE = 80
const MAX_ATTACH_URL = 150
const MAX_ATTACH_DESC = 300
const MAX_ATTACH_NOTES = 1200
const MAX_ATTACH_TAG = 20
const MAX_ATTACH_TAGS = 10
const MAX_ATTACH_CHILDREN = 10
const MAX_ATTACH_CHILD_TITLE = 60
const MAX_ATTACH_CHILD_URL = 100
const MAX_ATTACH_CHILD_DESC = 80
/** 附件上下文块总量帽：mimo-guard 单条消息上限 4000 字（超限 413），需给用户提问留余量 */
const MAX_ATTACH_TOTAL = 2800
/** 附件卡片数量上限 */
const MAX_ATTACH_CARDS = 8

/**
 * 附件字段消毒：强消毒（去控制字符/反引号/折叠空白/截断）+ 折叠连续双引号
 * （防字段内容伪装成 """ 块定界符逃逸），供提示词注入使用。
 */
function safe(text: string | undefined, maxLen: number): string {
  return sanitizeForPrompt(text ?? '', maxLen).replace(/"{2,}/g, "'")
}

export interface ResolvedCardContext {
  type: 'bm' | 'group'
  id: string
  title: string
  url?: string
  desc?: string
  categoryName?: string
  tags?: string[]
  notes?: string
  childBookmarks?: Array<{ title: string; url: string; desc?: string }>
}

/**
 * 将富文本 HTML 转为结构清晰的纯文本/轻量 Markdown（保留段落、换行与列表，移除多余标签与实体转义）
 */
export function htmlToCleanText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|h[1-6]|tr|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 将卡片 ID 解析为结构化上下文对象（包含书签元数据或笔记全文及组内书签）
 */
export function resolveCardContext(
  type: 'bm' | 'group',
  id: string,
  stores: {
    bookmarkMap: Record<string, Bookmark>
    groupMap: Record<string, SiblingGroup>
    categories?: Category[]
    customAttributes?: CustomAttribute[]
  }
): ResolvedCardContext | null {
  const rawId = id.replace(/^group:/, '')
  const categories = stores.categories || []
  const customAttributes = stores.customAttributes || []

  if (type === 'bm') {
    const bm = stores.bookmarkMap[rawId]
    if (!bm || bm.deletedAt) return null
    const cat = categories.find((c) => c.id === bm.categoryId && !c.deletedAt)
    const tags = customAttributes
      .filter((a) => bm.attributes && bm.attributes[a.id])
      .map((a) => a.name)
    return {
      type: 'bm',
      id: bm.id,
      title: bm.title || bm.url || t('ai.unnamedBookmark'),
      url: bm.url,
      desc: bm.notes || '',
      categoryName: cat?.name,
      tags,
      notes: bm.notes || '',
    }
  } else {
    const group = stores.groupMap[rawId]
    if (!group || group.deletedAt) return null
    const cat = categories.find((c) => c.id === group.categoryId && !c.deletedAt)
    const tags = customAttributes
      .filter((a) => group.attributes && group.attributes[a.id])
      .map((a) => a.name)
    const bodyText = group.notes ? htmlToCleanText(group.notes) : ''
    const childBookmarks = (group.bookmarkIds || [])
      .map((bId) => stores.bookmarkMap[bId])
      .filter((b): b is Bookmark => !!b && !b.deletedAt)
      .map((b) => ({ title: b.title, url: b.url, desc: b.notes || '' }))
    return {
      type: 'group',
      id: group.id,
      title: group.name || t('ai.unnamedNote'),
      categoryName: cat?.name,
      tags,
      notes: bodyText,
      childBookmarks,
    }
  }
}

/**
 * 格式化已关联的卡片/笔记为深度结构化的 LLM 提示词上下文，确保模型能够完整读取全部细节
 */
export function formatAttachedCardsForPrompt(
  cards: ResolvedCardContext[],
  isZh = true
): string {
  if (!cards || cards.length === 0) return ''
  const header = isZh
    ? '【用户在对话中拖入并关联的卡片/笔记附件（请深度阅读并基于这些内容回答）】'
    : '[User Attached Cards & Notes for Reference (Please read thoroughly and ground your answer on them)]'
  // 附件块标签双语：zh 保持历史格式（模型提示锚点），en 走英文标签（文案禁单语硬编码）
  const L = {
    bmHead: (n: number, title: string) =>
      isZh ? `[附件 ${n}] 🔖 书签卡片：${title}` : `[Attachment ${n}] 🔖 Bookmark: ${title}`,
    noteHead: (n: number, title: string) =>
      isZh ? `[附件 ${n}] 📝 笔记卡片：${title}` : `[Attachment ${n}] 📝 Note: ${title}`,
    url: isZh ? '- 网址：' : '- URL: ',
    urlEmpty: isZh ? '(无网址)' : '(no URL)',
    cat: isZh ? '- 分类：' : '- Category: ',
    desc: isZh ? '- 描述：' : '- Description: ',
    tags: isZh ? '- 标签：' : '- Tags: ',
    tagSep: isZh ? '、' : ', ',
    tagsRest: (n: number) => (isZh ? `（还有 ${n} 个未列出）` : ` (and ${n} more not listed)`),
    notes: isZh ? '- 附注内容：' : '- Notes: ',
    noteBody: isZh ? '- 笔记正文内容：' : '- Note body: ',
    noteBodyEmpty: isZh ? '(笔记正文为空)' : '(empty note body)',
    noteChildren: (n: number) =>
      isZh ? `- 笔记内包含的书签（共 ${n} 个）：` : `- Bookmarks in this note (${n} total): `,
    childrenRest: (n: number) =>
      isZh ? `\n  （还有 ${n} 个组内书签未列出）` : `\n  (and ${n} more bookmarks not listed)`,
    noChildren: isZh ? '  (暂无组内书签)' : '  (no bookmarks in this note)',
    truncated: isZh ? '…（该附件内容过长已截断）' : '… (attachment truncated due to length)',
    omitted: (n: number) =>
      isZh ? `\n…（其余 ${n} 张附件因长度限制省略）` : `\n… (${n} more attachments omitted due to length limit)`,
  }

  const formatted = cards
    .slice(0, MAX_ATTACH_CARDS)
    .map((c, i) => {
      const tags = (c.tags || []).slice(0, MAX_ATTACH_TAGS)
      const tagsRest = (c.tags?.length || 0) - tags.length
      const tagLine = tags.length
        ? `${L.tags}${tags.map((tag) => safe(tag, MAX_ATTACH_TAG)).join(L.tagSep)}${tagsRest > 0 ? L.tagsRest(tagsRest) : ''}`
        : ''
      const catLine = c.categoryName ? `${L.cat}${safe(c.categoryName, MAX_ATTACH_TAG)}` : ''
      if (c.type === 'bm') {
        const parts = [
          L.bmHead(i + 1, safe(c.title, MAX_ATTACH_TITLE)),
          `${L.url}${safe(c.url, MAX_ATTACH_URL) || L.urlEmpty}`,
          catLine,
          c.desc ? `${L.desc}${safe(c.desc, MAX_ATTACH_DESC)}` : '',
          tagLine,
          c.notes ? `${L.notes}\n"""\n${safe(c.notes, MAX_ATTACH_NOTES)}\n"""` : '',
        ].filter(Boolean)
        return parts.join('\n')
      } else {
        const children = c.childBookmarks || []
        const shown = children.slice(0, MAX_ATTACH_CHILDREN)
        const bmList = children.length
          ? shown
              .map((b) => `  * ${safe(b.title, MAX_ATTACH_CHILD_TITLE)} (${safe(b.url, MAX_ATTACH_CHILD_URL)})${b.desc ? ` - ${safe(b.desc, MAX_ATTACH_CHILD_DESC)}` : ''}`)
              .join('\n') +
            (children.length > shown.length ? L.childrenRest(children.length - shown.length) : '')
          : L.noChildren
        const parts = [
          L.noteHead(i + 1, safe(c.title, MAX_ATTACH_TITLE)),
          catLine,
          tagLine,
          `${L.noteBody}\n"""\n${safe(c.notes, MAX_ATTACH_NOTES) || L.noteBodyEmpty}\n"""`,
          `${L.noteChildren(children.length)}\n${bmList}`,
        ].filter(Boolean)
        return parts.join('\n')
      }
    })

  // 总量帽：逐卡累加，超预算即截断并标注省略（防 413 / 隐私全量外送）
  const kept: string[] = []
  let used = header.length + 1
  for (let i = 0; i < formatted.length; i++) {
    const remaining = MAX_ATTACH_TOTAL - used - 2
    if (remaining <= 0) break
    const block = formatted[i]
    if (block.length > remaining) {
      kept.push(`${block.slice(0, remaining)}\n${L.truncated}`)
      break
    }
    kept.push(block)
    used += block.length + 2
  }
  const omitted = cards.length - kept.length
  const tail = omitted > 0 ? L.omitted(omitted) : ''

  return `${header}\n${kept.join('\n\n')}${tail}\n`
}

/**
 * 智能推导当用户拖入卡片但未输入自定义提问时的缺省意图提问
 */
export function getDefaultAttachedPrompt(
  cards: ResolvedCardContext[],
  isZh = true
): string {
  if (!cards.length) return ''
  if (cards.length === 1) {
    const card = cards[0]
    const title = safe(card.title, MAX_ATTACH_TITLE)
    if (card.type === 'group') {
      return isZh
        ? `请详细阅读并分析这篇笔记「${title}」的内容，总结其核心观点与要点。`
        : `Please read and analyze the note "${title}" and summarize its core takeaways.`
    } else {
      return isZh
        ? `请阅读并分析此书签「${title}」的内容与用途，概述其核心功能。`
        : `Please read and analyze the bookmark "${title}" and outline its core features and use cases.`
    }
  } else {
    return isZh
      ? `请详细阅读并分析我关联的这 ${cards.length} 张卡片与笔记的内容，提炼要点并分析它们之间的关联。`
      : `Please read and analyze the ${cards.length} attached cards and notes, extract key points, and explain their relationships.`
  }
}
