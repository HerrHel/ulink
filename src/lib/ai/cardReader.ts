import type { Bookmark, SiblingGroup, Category, CustomAttribute } from '../../types.js'

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
      title: bm.title || bm.url || '未命名书签',
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
      title: group.name || '未命名笔记',
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

  const formatted = cards
    .map((c, i) => {
      if (c.type === 'bm') {
        const parts = [
          `[附件 ${i + 1}] 🔖 书签卡片：${c.title}`,
          `- 网址：${c.url || '(无网址)'}`,
          c.categoryName ? `- 分类：${c.categoryName}` : '',
          c.desc ? `- 描述：${c.desc}` : '',
          c.tags && c.tags.length ? `- 标签：${c.tags.join('、')}` : '',
          c.notes ? `- 附注内容：\n"""\n${c.notes}\n"""` : '',
        ].filter(Boolean)
        return parts.join('\n')
      } else {
        const bmList = c.childBookmarks && c.childBookmarks.length
          ? c.childBookmarks
              .map((b) => `  * ${b.title} (${b.url})${b.desc ? ` - ${b.desc}` : ''}`)
              .join('\n')
          : '  (暂无组内书签)'
        const parts = [
          `[附件 ${i + 1}] 📝 笔记卡片：${c.title}`,
          c.categoryName ? `- 分类：${c.categoryName}` : '',
          c.tags && c.tags.length ? `- 标签：${c.tags.join('、')}` : '',
          `- 笔记正文内容：\n"""\n${c.notes || '(笔记正文为空)'}\n"""`,
          `- 笔记内包含的书签（共 ${c.childBookmarks?.length || 0} 个）：\n${bmList}`,
        ].filter(Boolean)
        return parts.join('\n')
      }
    })
    .join('\n\n')

  return `${header}\n${formatted}\n`
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
    if (card.type === 'group') {
      return isZh
        ? `请详细阅读并分析这篇笔记「${card.title}」的内容，总结其核心观点与要点。`
        : `Please read and analyze the note "${card.title}" and summarize its core takeaways.`
    } else {
      return isZh
        ? `请阅读并分析此书签「${card.title}」的内容与用途，概述其核心功能。`
        : `Please read and analyze the bookmark "${card.title}" and outline its core features and use cases.`
    }
  } else {
    return isZh
      ? `请详细阅读并分析我关联的这 ${cards.length} 张卡片与笔记的内容，提炼要点并分析它们之间的关联。`
      : `Please read and analyze the ${cards.length} attached cards and notes, extract key points, and explain their relationships.`
  }
}
