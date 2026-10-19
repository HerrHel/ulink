/**
 * siteHitl.ts — HITL 确认与行动卡片构造层（自 siteCommander.ts 纯搬运拆出）
 * 职责：
 * 1. 统一收敛所有危险操作的 showConfirm 二次确认入口（Human-in-the-Loop）；
 * 2. 统一收敛所有 ChatActionCard 行动卡片构造（查重合并卡 / 回收站卡 / 主题工作台卡 /
 *    死链修复卡 / 体检卡 / 收件箱应用卡等），文案参数由调用方注入；
 * 3. 纯构造 + 确认封装，不含任何命令执行副作用。
 * 行为与拆分前逐字一致，UI 文案与 i18n key 禁止改动。
 */

import { showConfirm } from '../toast.js'
import { t, tN } from '../../i18n/index.js'
import type { AiCandidateBookmark } from '../../types/ai.js'
import type { ChatActionCard } from './chatSessions.js'

/**
 * 危险操作统一二次确认入口（包装 showConfirm，供命令执行层与调度层依赖调用）
 */
export function askConfirm(message: string): Promise<boolean> {
  return showConfirm(message)
}

// ── 确认对话文案构造 ──

/** 查重合并确认文案 */
export function buildMergeConfirmMessage(totalDupCount: number, groups: number): string {
  return tN('aiCmd.mergeConfirm', totalDupCount, { groups, count: totalDupCount })
}

/** 收件箱清零确认文案（批量归类 + 子页嵌套分行拼接） */
export function buildInboxZeroConfirmMessage(totalMoveCount: number, relationsCount: number): string {
  const confirmLines: string[] = []
  if (totalMoveCount > 0) {
    confirmLines.push(tN('aiCmd.inboxConfirm', totalMoveCount, { count: totalMoveCount }))
  }
  if (relationsCount > 0) {
    confirmLines.push(tN('aiCmd.inboxNestConfirm', relationsCount, { count: relationsCount }))
  }
  return confirmLines.join('\n')
}

/** 死链平替自愈确认文案 */
export function buildHealConfirmMessage(title: string, alt: string): string {
  return t('aiCmd.healConfirm', { title, alt })
}

/** 清空回收站确认文案 */
export function buildTrashClearConfirmMessage(total: number, bm: number, grp: number, cat: number): string {
  return tN('aiCmd.trashClearConfirm', total, { total, bm, grp, cat })
}

/** 未分类批量归类确认文案 */
export function buildMoveConfirmMessage(count: number, catName: string): string {
  return tN('aiCmd.moveConfirm', count, { cat: catName })
}

// ── 行动卡片（ChatActionCard）构造 ──

/** 回收站行动卡片（清空回收站入口） */
export function buildTrashActionCard(params: { total: number; bm: number; grp: number }): ChatActionCard {
  const { total, bm, grp } = params
  return {
    type: 'trash',
    title: t('aiCmd.trashCardTitle'),
    desc: tN('aiCmd.trashCardDesc', total, { total, bm, grp }),
    buttonText: t('aiCmd.trashCardButton'),
    actionName: 'trash_clear',
  }
}

/** 查重合并行动卡片 */
export function buildDedupActionCard(params: { dupCount: number; groups: number }): ChatActionCard {
  const { dupCount, groups } = params
  return {
    type: 'dedup',
    title: t('aiCmd.dedupCardTitle'),
    desc: tN('aiCmd.dedupCardDesc', dupCount, { groups, count: dupCount }),
    buttonText: t('aiCmd.dedupCardButton'),
    actionName: 'merge_dedup',
  }
}

/** 主题工作台装配行动卡片 */
export function buildPackActionCard(params: {
  cleanTopic: string
  candidates: AiCandidateBookmark[]
}): ChatActionCard {
  const { cleanTopic, candidates } = params
  return {
    type: 'custom',
    actionName: 'create_topic_workspace',
    title: t('aiCmd.packCardTitle', { name: cleanTopic }),
    desc: tN('aiCmd.packCardDesc', candidates.length),
    buttonText: t('aiCmd.packCardButton'),
    payload: {
      topic: cleanTopic,
      candidates,
    },
  }
}

/** 死链平替自愈行动卡片 */
export function buildHealDeadlinkCard(params: {
  deadBmId: string
  fromTitle: string
  toTitle: string
  replacement: AiCandidateBookmark
}): ChatActionCard {
  const { deadBmId, fromTitle, toTitle, replacement } = params
  return {
    type: 'custom',
    actionName: 'heal_deadlink',
    title: t('aiCmd.healCardTitle', { from: fromTitle, to: toTitle }),
    desc: t('aiCmd.healCardDesc', { alt: toTitle }),
    buttonText: t('aiCmd.healCardButton'),
    payload: {
      deadBmId,
      replacement,
    },
  }
}

/** 体检卡：待整理未分类优先 → 收件箱清零入口 */
export function buildHealthInboxCard(uncategorizedCount: number): ChatActionCard {
  return {
    type: 'custom',
    actionName: 'inbox_zero',
    title: tN('aiCmd.healthInboxCardTitle', uncategorizedCount),
    desc: t('aiCmd.healthInboxCardDesc'),
    buttonText: t('aiCmd.healthInboxCardButton'),
  }
}

/** 体检卡：重复链接优先 → 查重合并入口 */
export function buildHealthDedupCard(duplicateCount: number): ChatActionCard {
  return {
    type: 'dedup',
    actionName: 'merge_dedup',
    title: tN('aiCmd.healthDedupCardTitle', duplicateCount),
    desc: t('aiCmd.healthDedupCardDesc'),
    buttonText: t('aiCmd.healthDedupCardButton'),
  }
}

/** 体检卡：回收站堆积优先 → 清空回收站入口 */
export function buildHealthTrashCard(trashCount: number): ChatActionCard {
  return {
    type: 'trash',
    actionName: 'trash_clear',
    title: tN('aiCmd.healthTrashCardTitle', trashCount),
    desc: t('aiCmd.healthTrashCardDesc'),
    buttonText: t('aiCmd.healthTrashCardButton'),
  }
}

/** 收件箱清零应用卡（应用聚类方案） */
export function buildInboxZeroActionCard(totalCount: number): ChatActionCard {
  return {
    type: 'custom',
    actionName: 'apply_inbox_zero',
    title: tN('aiCmd.inboxCardTitle', totalCount),
    desc: t('aiCmd.inboxCardDesc'),
    buttonText: t('aiCmd.inboxCardButton'),
  }
}
