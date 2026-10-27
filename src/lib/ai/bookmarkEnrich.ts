/**
 * bookmarkEnrich.ts — 存量书签补齐层（自 cloudAiClient.ts 拆出）
 * 职责：为旧网站书签生成真实对比 Diff（标题/备注/分类/属性建议），
 * 接入全网实时网页抓取与大模型提炼，供 AI 补齐弹窗消费。
 */

import type { Category, CustomAttribute, Bookmark } from '../../types.js'
import type { AiEnrichDiff } from '../../types/ai.js'
import { domain } from '../../utils.js'
import { t } from '../../i18n/index.js'
import { getSmartPrefill } from './smartPrefill.js'
import { fetchUrlMetadataAsync } from './smartIntake.js'

/**
 * 4. 存量旧网站主动补齐：生成真实对比 Diff（基于实时网页提炼与大模型分析）
 */
export async function enrichBookmarkMetadata(
  bookmark: Bookmark,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): Promise<AiEnrichDiff> {
  const rawUrl = bookmark.url ? bookmark.url.trim() : ''
  const validUrl = rawUrl.startsWith('http') ? rawUrl : (rawUrl ? 'https://' + rawUrl : '')
  const dm = domain(validUrl || rawUrl)
  const prefill = getSmartPrefill(validUrl || rawUrl, [], categories, attributes)

  let realTitle = ''
  let realDescription = ''
  let realCategoryId: string | undefined = undefined
  let realAttrIds: string[] = []
  let isRealtime = false

  if (validUrl) {
    try {
      const res = await fetchUrlMetadataAsync(validUrl, categories, attributes)
      if (res.success) {
        if (res.title) realTitle = res.title
        if (res.notes) realDescription = res.notes
        if (res.categoryId) realCategoryId = res.categoryId
        if (res.suggestedAttrIds && res.suggestedAttrIds.length > 0) realAttrIds = res.suggestedAttrIds
        isRealtime = true
      }
    } catch {
      // 容错降级
    }
  }

  // 1. 建议地道标题 / 规范标题（去除站长 SEO 尾巴与噪声）
  let candidateTitle = realTitle || prefill.title || ''
  if (!candidateTitle && (!bookmark.title || bookmark.title.toLowerCase() === dm.toLowerCase())) {
    const capitalized = dm.replace(/^www\./, '').split('.')[0]
    candidateTitle = capitalized.charAt(0).toUpperCase() + capitalized.slice(1)
  }
  const suggestedTitle = candidateTitle && candidateTitle.trim() !== (bookmark.title || '').trim()
    ? candidateTitle.trim()
    : undefined

  // 2. 建议补充说明或 AI 生成的高质量核心摘要
  let candidateNotes = realDescription || prefill.notes || ''
  if (!candidateNotes && (!bookmark.notes || bookmark.notes.trim().length < 5)) {
    candidateNotes = t('ai.enrichFallbackNotes', { title: bookmark.title || dm })
  }
  const suggestedNotes = candidateNotes && candidateNotes.trim() !== (bookmark.notes || '').trim()
    ? candidateNotes.trim()
    : ''

  // 3. 建议分类（如果找到了合适分类且与当前分类不同）
  const candidateCatId = realCategoryId || prefill.categoryId
  let suggestedCategoryId: string | undefined = undefined
  if (candidateCatId && candidateCatId !== bookmark.categoryId && candidateCatId !== 'all') {
    suggestedCategoryId = candidateCatId
  }

  // 4. 属性标签建议：合并真实提取与 prefill，并过滤掉书签已有的属性标签
  const mergedAttrs = [...new Set([...realAttrIds, ...(prefill.suggestedAttrIds || [])])]
  const currentAttrs = bookmark.attributes || {}
  const suggestedAttrIds = mergedAttrs.filter(id => !currentAttrs[id])

  return {
    bookmarkId: bookmark.id,
    currentTitle: bookmark.title || '',
    suggestedTitle,
    currentNotes: bookmark.notes || '',
    suggestedNotes,
    currentCategoryId: bookmark.categoryId,
    suggestedCategoryId,
    suggestedAttrIds,
    reason: isRealtime ? t('ai.enrichReasonRealtime') : t('ai.enrichReasonSuggest'),
  }
}
