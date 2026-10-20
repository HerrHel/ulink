/**
 * siteCommands/cat.ts — 指令块 4：分类管理 (/cat list, 新建分类)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：kind 'list' → 返回分类清单；kind 'add' 且 catName 真值 → 块内 4 条路径均返回
 * （空名/重名/创建成功/创建失败）；其余（intent 为 null 或 add 且 name 空）→ 返回 null 继续 fall-through
 * （该 fall-through 路径无任何副作用）。
 */

import { addNewCategory } from '../../../utils.js'
import { CAT_UNCATEGORIZED } from '../../../config/constants.js'
import { pushUndoAction } from '../siteUndoStack.js'
import { parseCatIntent } from '../siteIntents.js'
import { t, tN } from '../../../i18n/index.js'
import type { Category } from '../../../types.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 4. 分类管理 (/cat, 新建分类) ──
export const catBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ds = ctx.ds
  const app = ctx.app
  const catIntent = parseCatIntent(query)
  if (catIntent?.kind === 'list') {
    const activeCats = ds.categories.filter((c: Category) => !c.deletedAt)
    const lines = [t('aiCmd.catListHeader'), '']
    for (const cat of activeCats) {
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === cat.id).length
      lines.push(tN('aiCmd.catListLine', count, { name: cat.name }))
    }
    const uncatCount = ds.bookmarks.filter(
      (b) => !b.deletedAt && (!b.categoryId || b.categoryId === CAT_UNCATEGORIZED) && !b.parentId,
    ).length
    lines.push(tN('aiCmd.catListLine', uncatCount, { name: t('aiCmd.catListUncategorized') }))
    return {
      handled: true,
      action: 'category_list',
      steps: [{ text: t('aiCmd.stepReadCats'), done: true }],
      reply: lines.join('\n'),
    }
  }

  const catName = catIntent?.kind === 'add' ? catIntent.name : null
  if (catName) {
    const trimmed = catName.trim()
    if (!trimmed) {
      return { handled: true, action: 'category_add', success: false, reply: t('aiCmd.catNameEmpty') }
    }
    const exists = ds.categories.some(
      (c: Category) => !c.deletedAt && c.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (exists) {
      return {
        handled: true,
        action: 'category_add',
        success: false,
        steps: [{ text: t('aiCmd.stepCheckCatExists', { name: trimmed }), done: true }],
        reply: t('aiCmd.catExists', { name: trimmed }),
      }
    }
    const created = addNewCategory(trimmed, app)
    if (created) {
      pushUndoAction({
        type: 'category_add',
        description: t('aiCmd.undoCatDesc', { name: trimmed }),
        revert: () => {
          ds.deleteCategory(created.id)
          app.save()
          return t('aiCmd.undoCatRevert', { name: trimmed })
        },
      })
      return {
        handled: true,
        action: 'category_add',
        success: true,
        steps: [
          { text: t('aiCmd.stepValidateCat'), done: true },
          { text: t('aiCmd.stepCreateCat', { name: trimmed }), done: true },
        ],
        reply: t('aiCmd.catCreated', { name: trimmed }),
      }
    }
    return { handled: true, action: 'category_add', success: false, reply: t('aiCmd.catCreateFailed') }
  }

  return null
}
