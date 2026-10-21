/**
 * siteCommands/pack.ts — 指令块 6.5：主题工作台生成 (/pack <主题名>, 帮我搭建XX工作台)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 packIntent → 块内 2 条路径均返回（缺主题名给用法提示 / 云端候选装配工作台计划）；
 * 未命中 → 返回 null 继续 fall-through。
 */

import { parsePackIntent } from '../siteIntents.js'
import { searchWebsitesByIntent } from '../cloudAiClient.js'
import { buildPackActionCard } from '../siteHitl.js'
import { normalizeWorkspaceTopic } from '../siteActions.js'
import { t, tN } from '../../../i18n/index.js'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../../config/constants.js'
import type { Bookmark, Category } from '../../../types.js'
import type { AiCandidateBookmark } from '../../../types/ai.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 6.5 主题工作台生成 (/pack <主题名>, 帮我搭建XX工作台) ──
export const packBlock: SiteCommandBlock = async (
  ctx: SiteCommandBlockCtx,
): Promise<SiteCommandResult | null> => {
  const query = ctx.query
  const ds = ctx.ds
  const packIntent = parsePackIntent(query)
  if (packIntent) {
    const rawTopic = packIntent.rawTopic
    if (!rawTopic) {
      return {
        handled: true,
        action: 'pack_workspace',
        steps: [{ text: t('aiCmd.stepPackHint'), done: true }],
        reply: [
          t('aiCmd.packHelpTitle'),
          '',
          t('aiCmd.packHelpUsage'),
          t('aiCmd.packHelpExamplesLabel'),
          t('aiCmd.packHelpExample1'),
          t('aiCmd.packHelpExample2'),
          t('aiCmd.packHelpExample3'),
          '',
          t('aiCmd.packHelpDesc'),
        ].join('\n'),
      }
    }

    const topicName = rawTopic

    // 优先从库内检索已匹配分类或相关书签，避免无视本地收藏而盲目检索外网
    let candidates: AiCandidateBookmark[] = []
    let isFromVault = false
    let matchedCategory: Category | undefined

    // 1. 尝试匹配用户已有分类
    matchedCategory = (ds.categories || []).find(
      (c: Category) =>
        !c.deletedAt &&
        c.id !== CAT_ALL &&
        c.id !== CAT_UNCATEGORIZED &&
        (c.name.trim().toLowerCase() === topicName.trim().toLowerCase() ||
          topicName.trim().toLowerCase().includes(c.name.trim().toLowerCase()) ||
          c.name.trim().toLowerCase().includes(topicName.trim().toLowerCase())),
    )

    if (matchedCategory) {
      const existingBms = (ds.bookmarks || []).filter(
        (b: Bookmark) => !b.deletedAt && !b.parentId && b.categoryId === matchedCategory!.id,
      )
      if (existingBms.length > 0) {
        isFromVault = true
        const sorted = [...existingBms].sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
        candidates = sorted.slice(0, 8).map((b) => ({
          title: b.title,
          url: b.url,
          notes: b.notes || b.url,
          tag: matchedCategory!.name,
          highlight: b.notes || b.title,
          categoryId: matchedCategory!.id,
        }))
      }
    }

    // 2. 若未匹配分类或该分类下无书签，尝试在全库检索标题/备注包含该主题的书签
    if (candidates.length === 0) {
      const q = topicName.trim().toLowerCase()
      const matchingBms = (ds.bookmarks || []).filter((b: Bookmark) => {
        if (b.deletedAt || b.parentId) return false
        const text = `${b.title} ${b.notes || ''}`.toLowerCase()
        return text.includes(q)
      })
      if (matchingBms.length >= 2) {
        isFromVault = true
        const sorted = [...matchingBms].sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
        candidates = sorted.slice(0, 8).map((b) => {
          const cat = (ds.categories || []).find((c: Category) => c.id === b.categoryId && !c.deletedAt)
          return {
            title: b.title,
            url: b.url,
            notes: b.notes || b.url,
            tag: cat?.name || topicName,
            highlight: b.notes || b.title,
            categoryId: b.categoryId,
          }
        })
      }
    }

    // 3. 库内完全无相关资产时，平滑降级为根据意图检索外部精选/平替工具
    if (candidates.length === 0) {
      candidates = await searchWebsitesByIntent(topicName, [], ds.categories, ds.customAttributes)
    }

    const previewList = candidates.slice(0, 5)

    const lines = [
      isFromVault
        ? (matchedCategory
            ? tN('aiCmd.packPlanFromCat', candidates.length, { topic: topicName, cat: matchedCategory.name })
            : tN('aiCmd.packPlanFromVault', candidates.length, { topic: topicName }))
        : tN('aiCmd.packPlan', candidates.length, { topic: topicName }),
      '',
    ]
    for (let i = 0; i < previewList.length; i++) {
      const c = previewList[i]
      lines.push(t('aiCmd.packItem', { i: i + 1, title: c.title, desc: c.notes || c.url }))
    }
    if (candidates.length > 5) {
      lines.push(tN('aiCmd.packMore', candidates.length - 5))
    }
    lines.push('')
    lines.push(t('aiCmd.packCta'))

    const cleanTopic = normalizeWorkspaceTopic(topicName)

    return {
      handled: true,
      action: 'pack_workspace',
      steps: [
        {
          text: isFromVault
            ? (matchedCategory
                ? tN('aiCmd.stepPackSelectFromCat', candidates.length, { topic: topicName, cat: matchedCategory.name })
                : tN('aiCmd.stepPackSelectFromVault', candidates.length, { topic: topicName }))
            : tN('aiCmd.stepPackSelect', candidates.length, { topic: topicName }),
          done: true,
        },
        { text: t('aiCmd.stepPackPlan'), done: true },
      ],
      reply: lines.join('\n'),
      actionCard: buildPackActionCard({
        cleanTopic,
        candidates,
        targetCatId: matchedCategory?.id,
      }),
    }
  }

  return null
}
