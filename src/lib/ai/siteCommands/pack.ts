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
    const candidates = await searchWebsitesByIntent(topicName, [], ds.categories, ds.customAttributes)
    const previewList = candidates.slice(0, 5)

    const lines = [
      tN('aiCmd.packPlan', candidates.length, { topic: topicName }),
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
        { text: tN('aiCmd.stepPackSelect', candidates.length, { topic: topicName }), done: true },
        { text: t('aiCmd.stepPackPlan'), done: true },
      ],
      reply: lines.join('\n'),
      actionCard: buildPackActionCard({ cleanTopic, candidates }),
    }
  }

  return null
}
