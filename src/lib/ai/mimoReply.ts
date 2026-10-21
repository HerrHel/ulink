/**
 * mimoReply.ts — 模型回复解析层（自 mimoClient.ts 拆出）
 * 职责：从回复文本中提炼 ```ulink-card``` 结构化候选卡片（整块与随文嵌入格式通吃），
 * 并对 URL 做协议/内网地址安全校验（防提示词注入伪造钓鱼或 SSRF 内网探针）。
 * 提示词组装见 mimoPrompt.ts，传输见 mimoStream.ts，公开导出统一经 mimoClient.ts Facade。
 */

import type { Category, CustomAttribute } from '../../types.js'
import type { AiCandidateBookmark } from '../../types/ai.js'
import { t } from '../../i18n/index.js'
import { getSmartPrefill } from './smartPrefill.js'
import { isPrivateUrl } from './urlGuard.js'
import { fixUrl } from '../../utils.js'
import { FENCE } from './mimoPrompt.js'

/**
 * 从模型回复中解析候选卡片（向前兼容整块与随文嵌入格式）
 */
export function parseMiMoReply(
  replyText: string,
  categories: Category[] = [],
  attributes: CustomAttribute[] = []
): { cleanText: string; candidates: AiCandidateBookmark[]; suggestedReplies?: string[] } {
  const cardRegex = new RegExp(FENCE + 'ulink-card\\s*([\\s\\S]*?)' + FENCE, 'gi')
  const candidates: AiCandidateBookmark[] = []

  // 提取预判回复小按钮：<!-- suggestions: ["选项1", "选项2"] -->
  const suggestRegex = /<!--\s*suggestions:\s*(\[[\s\S]*?\])\s*-->/i
  let suggestedReplies: string[] | undefined
  const suggestMatch = replyText.match(suggestRegex)
  if (suggestMatch && suggestMatch[1]) {
    try {
      const parsed = JSON.parse(suggestMatch[1])
      if (Array.isArray(parsed) && parsed.length > 0) {
        suggestedReplies = parsed.map(s => String(s).trim()).filter(Boolean)
      }
    } catch (e) {
      console.warn('[mimoReply] Failed to parse suggestions comment:', e)
    }
  }

  let match: RegExpExecArray | null
  while ((match = cardRegex.exec(replyText)) !== null) {
    const rawJson = match[1]?.trim()
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson)
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          if (item && item.title && item.url) {
            const rawUrl = String(item.url).trim()
            const fixedUrl = fixUrl(rawUrl)
            // 拒绝非 http/https 协议或私有/局域网内网地址（防范提示词注入伪造钓鱼或 SSRF 内网探针）
            if (!fixedUrl || isPrivateUrl(fixedUrl)) continue

            const prefill = getSmartPrefill(fixedUrl, [], categories, attributes)
            const matchedCat = categories.find(
              c => c.name === item.suggestedCategory && c.id !== 'all' && c.id !== 'uncategorized'
            )
            // 低置信度的本地启发式不得冒充推荐语——fallback 级 prefill 只用于分类/属性建议
            const fallbackNotes = prefill.confidence !== 'fallback' ? (prefill.notes || '') : ''

            candidates.push({
              title: String(item.title).trim(),
              url: fixedUrl,
              notes: item.notes ? String(item.notes).trim() : fallbackNotes,
              categoryId: matchedCat?.id || prefill.categoryId || undefined,
              suggestedAttrIds: prefill.suggestedAttrIds?.length ? prefill.suggestedAttrIds : undefined,
              tag: item.tags?.[0] || (item.notes?.includes('开源') ? t('ai.tagOpenFree') : t('ai.tagSmartRec')),
              highlight: item.notes || item.title,
            })
          }
        }
      } catch (err) {
        console.warn('[mimoClient] Failed to parse ulink-card JSON:', err, rawJson)
      }
    }
  }

  const cleanText = replyText.replace(cardRegex, '').replace(suggestRegex, '').trim()
  return { cleanText, candidates, suggestedReplies }
}
