/**
 * siteCommands/move.ts — 指令块 11：批量整理未分类 (/move uncategorized <分类名>)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：targetCategoryRaw 真值后，分类不存在 → 返回失败；无未分类 → 返回空结果；
 * 数量 > 5 经 HITL 二次确认（确认后经 ctx.signal 校验「停止生成」，取消/中止均返回）；
 * 确认通过 → 批量移动、撤销入栈后返回成功。intent 未命中或 targetCategoryRaw 为空 →
 * 返回 null 继续 fall-through（该 fall-through 路径无任何副作用）。
 *
 * 11.2 定向移动的额外出口：目标分类名「不像名称」（整句口语 / 复合意图）→ 返回 null
 * 交回大模型语义理解，避免把「合适的分类去」当分类名查库后武断报错。
 */

import {
  parseMoveIntent,
  parseSpecificMoveIntent,
  parsePronounMoveIntent,
  looksLikeCategoryName,
} from '../siteIntents.js'
import { askConfirm, buildMoveConfirmMessage } from '../siteHitl.js'
import { isOfficialBookmark } from '../localClustering.js'
import { CAT_UNCATEGORIZED } from '../../../config/constants.js'
import { pushUndoAction } from '../siteUndoStack.js'
import { t, tN } from '../../../i18n/index.js'
import type { Bookmark, Category } from '../../../types.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 11. 批量整理未分类 (/move uncategorized <分类名>, 把未分类移动到 [分类名]) ──
export const moveBlock: SiteCommandBlock = async (
  ctx: SiteCommandBlockCtx,
): Promise<SiteCommandResult | null> => {
  const query = ctx.query
  const ds = ctx.ds
  const app = ctx.app
  const moveIntent = parseMoveIntent(query)
  const targetCategoryRaw = moveIntent ? moveIntent.targetCategoryRaw : null

  if (targetCategoryRaw) {
    const targetCat = ds.categories.find(
      (c: Category) =>
        !c.deletedAt &&
        (c.name === targetCategoryRaw || c.name.toLowerCase() === targetCategoryRaw.toLowerCase()),
    )
    if (!targetCat) {
      return {
        handled: true,
        action: 'move_uncategorized',
        success: false,
        reply: t('aiCmd.moveCatNotFound', { name: targetCategoryRaw }),
      }
    }

    const uncatBms = ds.bookmarks.filter(
      (b) =>
        !b.deletedAt &&
        (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) &&
        !b.parentId &&
        !isOfficialBookmark(b),
    )

    if (uncatBms.length === 0) {
      return {
        handled: true,
        action: 'move_uncategorized',
        success: true,
        reply: t('aiCmd.moveNone'),
      }
    }

    // 若未分类数量较大（例如 > 5 个），进行二次确认保护
    if (uncatBms.length > 5) {
      const confirmed = await askConfirm(
        buildMoveConfirmMessage(uncatBms.length, targetCat.name),
      )
      if (ctx.signal?.aborted) {
        return { handled: true, action: 'move_uncategorized', success: false, reply: '' }
      }
      if (!confirmed) {
        return {
          handled: true,
          action: 'move_uncategorized',
          success: false,
          steps: [{ text: t('aiCmd.stepUserCancelMove'), done: true }],
          reply: t('aiCmd.moveCancelled'),
        }
      }
    }

    const previousMap = uncatBms.map((b) => ({ id: b.id, prevCatId: b.categoryId }))
    for (const b of uncatBms) {
      ds.updateBookmark(b.id, { categoryId: targetCat.id })
    }
    app.save()

    pushUndoAction({
      type: 'move_uncategorized',
      description: tN('aiCmd.undoMoveUncatDesc', uncatBms.length, { cat: targetCat.name }),
      revert: () => {
        for (const item of previousMap) {
          ds.updateBookmark(item.id, { categoryId: item.prevCatId })
        }
        app.save()
        return tN('aiCmd.undoMoveRevert', previousMap.length)
      },
    })

    return {
      handled: true,
      action: 'move_uncategorized',
      success: true,
      steps: [
        { text: tN('aiCmd.stepFilterUncat', uncatBms.length), done: true },
        { text: t('aiCmd.stepMoveUncat', { cat: targetCat.name }), done: true },
      ],
      reply: tN('aiCmd.moveDone', uncatBms.length, { cat: targetCat.name }),
    }
  }

  // 11.2 具体书签定向移动：把 [XX] 移动到 [YY] (分类)
  const specMove = parseSpecificMoveIntent(query)
  if (specMove) {
    const { itemQuery, targetCategoryName } = specMove
    // 1. 查找目标分类（支持严格匹配与模糊包含）
    const targetCat = findCategoryByName(ds.categories, targetCategoryName)
    if (!targetCat) {
      // 防御（双保险）：解析器已挡掉不像分类名的目标，这里再判一次。
      // 「像名称但库里没有」→ 明确提示打错字（对用户最有用的反馈）；
      // 「根本不像名称」→ 不武断下结论，fall through 让大模型接管语义理解。
      if (!looksLikeCategoryName(targetCategoryName)) return null
      return {
        handled: true,
        action: 'move_bookmark',
        success: false,
        reply: t('aiCmd.moveBmCatNotFound', { name: targetCategoryName }),
        suggestedReplies: [t('aiCmd.suggestCreateCat'), t('aiCmd.suggestListCats')],
      }
    }

    // 2. 查找匹配的书签（按标题、URL 与备注精准匹配未删除且未嵌套项）
    const qLower = itemQuery.toLowerCase()
    const matchedBms = ds.bookmarks.filter(
      (b: Bookmark) =>
        !b.deletedAt &&
        !b.parentId &&
        (b.title.toLowerCase().includes(qLower) ||
          b.url.toLowerCase().includes(qLower) ||
          (b.notes && b.notes.toLowerCase().includes(qLower))),
    )
    if (matchedBms.length === 0) {
      return {
        handled: true,
        action: 'move_bookmark',
        success: false,
        reply: t('aiCmd.moveBmNoBookmark', { q: itemQuery }),
        suggestedReplies: [t('aiCmd.suggestSimilarTools'), t('aiCmd.suggestSearchVault')],
      }
    }

    applyMoveToCategory(matchedBms, targetCat, ds, app)
    return buildMoveSuccessResult(matchedBms, targetCat)
  }

  // 11.3 指代性定向移动：「把此书签 / 这张 / 它 移到 [YY 分类]」
  // 主体的真实指向只能来自本轮附加卡片（提交时槽位已清空，由 dispatch 透传）。
  // 卡片数量不为 1（含歧义）或目标分类不存在时 fall through，交大模型处理。
  const pronounMove = parsePronounMoveIntent(query)
  if (pronounMove) {
    const attachedBmIds = [
      ...new Set(
        (ctx.attachedCards ?? []).filter((c) => c.type === 'bm').map((c) => c.id),
      ),
    ]
    if (attachedBmIds.length === 1) {
      const targetCat = findCategoryByName(ds.categories, pronounMove.targetCategoryName)
      const targetBm = ds.bookmarkMap[attachedBmIds[0]!]
      if (targetCat && targetBm && !targetBm.deletedAt) {
        applyMoveToCategory([targetBm], targetCat, ds, app)
        return buildMoveSuccessResult([targetBm], targetCat)
      }
    }
  }

  return null
}

/** 按名称查分类（严格匹配优先于模糊包含，均忽略大小写与首尾空白）。 */
function findCategoryByName(
  categories: Category[],
  name: string,
): Category | undefined {
  const target = name.trim().toLowerCase()
  if (!target) return undefined
  const norm = (c: Category) => (c.deletedAt ? null : c.name.trim().toLowerCase())
  return (
    categories.find((c) => norm(c) === target) ??
    categories.find((c) => !!norm(c)?.includes(target))
  )
}

/** 执行「把若干书签移入某分类」：改字段 + save + 登记撤销事务。 */
function applyMoveToCategory(
  bms: Bookmark[],
  cat: Category,
  ds: SiteCommandBlockCtx['ds'],
  app: SiteCommandBlockCtx['app'],
): void {
  const previousMap = bms.map((b) => ({ id: b.id, prevCatId: b.categoryId }))
  for (const b of bms) {
    ds.updateBookmark(b.id, { categoryId: cat.id })
  }
  app.save()

  pushUndoAction({
    type: 'move_bookmark',
    description: tN('aiCmd.undoMoveBmDesc', bms.length, { cat: cat.name }),
    revert: () => {
      for (const item of previousMap) {
        ds.updateBookmark(item.id, { categoryId: item.prevCatId })
      }
      app.save()
      return t('aiCmd.undoMoveBmRevert')
    },
  })
}

/** 定向移动成功结果（11.2 与 11.3 共用，保证两种入口的反馈逐字一致）。 */
function buildMoveSuccessResult(bms: Bookmark[], cat: Category): SiteCommandResult {
  const titleSep = t('aiCmd.moveBmTitleSep')
  const titleList = bms
    .slice(0, 3)
    .map((b) => t('aiCmd.moveBmTitleItem', { title: b.title }))
    .join(titleSep)
  const moreText = bms.length > 3 ? t('aiCmd.moveBmMore', { n: bms.length }) : ''
  return {
    handled: true,
    action: 'move_bookmark',
    success: true,
    steps: [
      { text: tN('aiCmd.stepMoveBmFound', bms.length), done: true },
      { text: t('aiCmd.stepMoveBmTarget', { cat: cat.name }), done: true },
    ],
    reply: t('aiCmd.moveBmDone', {
      titles: titleList,
      more: moreText,
      cat: cat.name,
    }),
    suggestedReplies: [t('aiCmd.suggestUndoMove'), t('aiCmd.suggestContinueOrganize')],
  }
}
