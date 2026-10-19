/**
 * bookmarkEnrich.ts — 存量书签补齐层（自 cloudAiClient.ts 拆出）
 * 职责：为旧网站书签生成真实对比 Diff（标题/备注/分类/属性建议），
 * 支持 Jina Reader 实时读取页面补充最新摘要，供 AI 补齐弹窗消费。
 */

import type { Category, CustomAttribute, Bookmark } from '../../types.js'
import type { AiEnrichDiff } from '../../types/ai.js'
import { domain } from '../../utils.js'
import { t } from '../../i18n/index.js'
import { getSmartPrefill } from './smartPrefill.js'
import { fetchPageContentViaJina } from './jinaReader.js'

/**
 * 4. 存量旧网站主动补齐：生成真实对比 Diff（支持 Jina Reader 实时内容补充）
 */
export async function enrichBookmarkMetadata(
  bookmark: Bookmark,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiEnrichDiff> {
  const dm = domain(bookmark.url)
  const prefill = getSmartPrefill(bookmark.url, [], categories, attributes)

  // 尝试真实读取页面信息以获得最新摘要
  let realDescription = ''
  let realTitle = ''

  if (bookmark.url.startsWith('http')) {
    try {
      const pageData = await fetchPageContentViaJina(bookmark.url, { timeoutMs: 4000 })
      if (pageData.success) {
        if (pageData.title) realTitle = pageData.title
        if (pageData.description) realDescription = pageData.description
      }
    } catch {
      // 容错降级
    }
  }

  // 建议补充说明（当既有备注为空或极简时）
  let suggestedNotes = bookmark.notes
  if (!suggestedNotes || suggestedNotes.trim().length < 5) {
    suggestedNotes =
      realDescription ||
      prefill.notes ||
      t('ai.enrichFallbackNotes', { title: bookmark.title || dm })
  }

  // 建议地道中文标题（当既有标题仅为裸域名时）
  let suggestedTitle = bookmark.title
  if (!suggestedTitle || suggestedTitle.toLowerCase() === dm.toLowerCase()) {
    if (realTitle) {
      suggestedTitle = realTitle
    } else if (prefill.title) {
      suggestedTitle = prefill.title
    } else {
      const capitalized = dm.replace(/^www\./, '').split('.')[0]
      suggestedTitle = capitalized.charAt(0).toUpperCase() + capitalized.slice(1)
    }
  }

  const newCatId = prefill.categoryId && prefill.categoryId !== bookmark.categoryId && prefill.categoryId !== 'all' && prefill.categoryId !== 'uncategorized'
    ? prefill.categoryId
    : undefined

  return {
    bookmarkId: bookmark.id,
    currentTitle: bookmark.title,
    suggestedTitle: suggestedTitle !== bookmark.title ? suggestedTitle : undefined,
    currentNotes: bookmark.notes || '',
    suggestedNotes,
    currentCategoryId: bookmark.categoryId,
    suggestedCategoryId: newCatId,
    suggestedAttrIds: prefill.suggestedAttrIds || [],
    reason: realDescription ? t('ai.enrichReasonRealtime') : t('ai.enrichReasonSuggest'),
  }
}
