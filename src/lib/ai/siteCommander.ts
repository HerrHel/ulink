/**
 * siteCommander.ts — 与链站内指令调度器 (In-App AI Agent / CLI)
 * 职责：
 * 1. 解析侧边栏对话框中的斜杠快捷指令与自然语言意图；
 * 2. 直接操控站内 Store / UI / 主题 / 导出 / 整理操作；
 * 3. 增强透明度：提供工具调用执行轨迹 (steps) 与行动卡片 (actionCard)；
 * 4. 增强安全性与可逆性：危险操作强制二次确认 (HITL)，支持对话式撤销 (/undo)；
 * 5. 上下文感知：感知当前浏览分类与多选状态；
 * 6. 严守克制美学：杜绝浮夸 emoji，采用纯净、温润的文字与符号排版。
 *
 * 拆分说明（只拆分、不改行为）：undo 事务栈在 siteUndoStack.ts，命令执行在 siteActions.ts，
 * HITL 确认与行动卡片构造在 siteHitl.ts，意图解析（正则/参数提取）在 siteIntents.ts；
 * siteCommands/ 目录的指令块拆分进行中（已外迁 1.帮助 / 2.主题 / 3.视图 / 4.分类 / 5.回收站 /
 * 6.查重 / 6.5.工作台 / 7.死链 / 8.导出 / 9.统计 / 9.1.体检 / 9.2.收件箱 / 15.设置面板十三块，
 * 其余 5 块暂留本文件），SiteCommandResult 定义移至 siteCommands/types.ts 并在此 re-export；
 * 本文件保留 dispatchSiteCommand 编排（意图块顺序与短路语义不变）并 re-export 原公开符号。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
import { useToastStore } from '../../stores/toast.js'
import { isOfficialBookmark } from './localClustering.js'
import { CAT_UNCATEGORIZED, CAT_ALL } from '../../config/constants.js'
import {
  askConfirm,
  buildMoveConfirmMessage,
} from './siteHitl.js'
import {
  pushUndoAction,
  popUndoAction,
  getUndoStackDepth,
} from './siteUndoStack.js'
import {
  parseBatchMoveIntent,
  parseMoveIntent,
  parseCurrentCatIntent,
  parseUndoIntent,
  parseCleanIntent,
} from './siteIntents.js'
import { helpBlock } from './siteCommands/help.js'
import { themeBlock } from './siteCommands/theme.js'
import { viewBlock } from './siteCommands/view.js'
import { catBlock } from './siteCommands/cat.js'
import { trashBlock } from './siteCommands/trash.js'
import { dedupBlock } from './siteCommands/dedup.js'
import { packBlock } from './siteCommands/pack.js'
import { deadlinkBlock } from './siteCommands/deadlink.js'
import { exportBlock } from './siteCommands/export.js'
import { statsBlock } from './siteCommands/stats.js'
import { healthBlock } from './siteCommands/health.js'
import { inboxBlock } from './siteCommands/inbox.js'
import { settingsBlock } from './siteCommands/settings.js'
import type { SiteCommandResult } from './siteCommands/types.js'
import { t, tN } from '../../i18n/index.js'
import type { Category } from '../../types.js'
import type { SiteCommanderContext } from './siteActions.js'

// ── re-export：撤销事务栈（单例在 siteUndoStack.ts） ──
export {
  pushUndoAction,
  popUndoAction,
  getUndoStackDepth,
  clearUndoStack,
  getLastUndoableAction,
  setLastUndoableAction,
} from './siteUndoStack.js'
export type { UndoableAction } from './siteUndoStack.js'

// ── re-export：命令执行层（siteActions.ts） ──
export {
  mergeDuplicateBookmarks,
  applyInboxZeroClustering,
  createTopicWorkspace,
  healDeadlink,
} from './siteActions.js'
export type {
  SiteCommanderContext,
  CreateTopicWorkspaceResult,
  HealDeadlinkResult,
} from './siteActions.js'

// ── re-export：命令结果类型（定义在 siteCommands/types.ts） ──
export type { SiteCommandResult } from './siteCommands/types.js'

/**
 * 调度站内命令与意图
 */
export async function dispatchSiteCommand(
  rawInput: string,
  context?: SiteCommanderContext,
): Promise<SiteCommandResult> {
  const query = rawInput.trim()
  if (!query) {
    return { handled: false, reply: '' }
  }

  const ds = context?.ds ?? useDataStore()
  const ui = context?.ui ?? useUIStore()
  const app = context?.app ?? useAppStore()

  // ── 1. 帮助说明 (/help, /?, 帮助) ──
  const helpResult = await helpBlock({ query, ds, ui, app })
  if (helpResult !== null) return helpResult

  // ── 2. 主题外观 (/theme, 切换深色/浅色) ──
  const themeResult = await themeBlock({ query, ds, ui, app })
  if (themeResult !== null) return themeResult

  // ── 3. 布局视图 (/view, 切换列表/网格/紧凑) ──
  const viewResult = await viewBlock({ query, ds, ui, app })
  if (viewResult !== null) return viewResult

  // ── 4. 分类管理 (/cat, 新建分类) ──
  const catResult = await catBlock({ query, ds, ui, app })
  if (catResult !== null) return catResult

  // ── 5. 回收站管理 (/trash, 清空回收站, 打开回收站) ──
  const trashResult = await trashBlock({ query, ds, ui, app, signal: context?.signal })
  if (trashResult !== null) return trashResult

  // ── 6. 查重巡检 (/dedup, 查找重复书签) ──
  const dedupResult = await dedupBlock({ query, ds, ui, app })
  if (dedupResult !== null) return dedupResult

  // ── 6.5 主题工作台生成 (/pack <主题名>, 帮我搭建XX工作台) ──
  const packResult = await packBlock({ query, ds, ui, app })
  if (packResult !== null) return packResult

  // ── 7. 死链检测与自愈 (/deadlink, 检查死链, 死链自愈) ──
  const deadlinkResult = await deadlinkBlock({ query, ds, ui, app })
  if (deadlinkResult !== null) return deadlinkResult

  // ── 8. 数据导出备份 (/export, 导出数据) ──
  const exportResult = await exportBlock({ query, ds, ui, app })
  if (exportResult !== null) return exportResult

  // ── 9. 全库统计 (/stats, 书签统计) ──
  const statsResult = await statsBlock({ query, ds, ui, app })
  if (statsResult !== null) return statsResult

  // ── 9.1 全库资产体检中心 (/health, 资产体检) ──
  const healthResult = await healthBlock({ query, ds, ui, app })
  if (healthResult !== null) return healthResult

  // ── 9.2 收件箱清零与智能归拢 (/inbox, 智能归类) ──
  const inboxResult = await inboxBlock({ query, ds, ui, app })
  if (inboxResult !== null) return inboxResult

  // ── 10. 上下文感知：批量移动选中的书签 ──
  const batchMoveIntent = parseBatchMoveIntent(query)
  if (batchMoveIntent && ui.batchMode && ui.batchSelected && ui.batchSelected.length > 0) {
    const targetName = batchMoveIntent.targetName
    const targetCat = ds.categories.find(
      (c: Category) =>
        !c.deletedAt &&
        (c.name === targetName || c.name.toLowerCase() === targetName.toLowerCase()),
    )
    if (!targetCat) {
      return {
        handled: true,
        action: 'batch_move',
        success: false,
        reply: t('aiCmd.batchMoveCatNotFound', { name: targetName }),
      }
    }

    const selectedIds = [...ui.batchSelected]
    const previousMap: Array<{ id: string; prevCatId?: string }> = []
    let movedCount = 0

    for (const id of selectedIds) {
      const bm = ds.bookmarkMap[id]
      if (bm && !bm.deletedAt) {
        previousMap.push({ id, prevCatId: bm.categoryId })
        ds.updateBookmark(id, { categoryId: targetCat.id })
        movedCount++
      }
    }

    if (movedCount > 0) {
      app.save()
      ui.batchMode = false
      ui.batchSelected = []

      pushUndoAction({
        type: 'batch_move',
        description: tN('aiCmd.undoBatchMoveDesc', movedCount, { cat: targetCat.name }),
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
        action: 'batch_move',
        success: true,
        steps: [
          { text: tN('aiCmd.stepBatchDetected', movedCount), done: true },
          { text: t('aiCmd.stepBatchMove', { cat: targetCat.name }), done: true },
        ],
        reply: tN('aiCmd.batchMoveDone', movedCount, { cat: targetCat.name }),
      }
    }
  }

  // ── 11. 批量整理未分类 (/move uncategorized <分类名>, 把未分类移动到 [分类名]) ──
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
      if (context?.signal?.aborted) {
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

  // ── 12. 上下文感知：当前分类查询 ──
  if (parseCurrentCatIntent(query)) {
    if (ui.curCat && ui.curCat !== CAT_ALL) {
      const cat = ds.categories.find((c: Category) => c.id === ui.curCat)
      const catName = cat ? cat.name : (ui.curCat === CAT_UNCATEGORIZED ? t('aiCmd.catListUncategorized') : ui.curCat)
      const count = ds.bookmarks.filter((b) => !b.deletedAt && b.categoryId === ui.curCat).length
      return {
        handled: true,
        action: 'current_cat',
        steps: [{ text: t('aiCmd.stepReadContext'), done: true }],
        reply: tN('aiCmd.currentCat', count, { name: catName }),
      }
    }
    const totalCount = ds.bookmarks.filter((b) => !b.deletedAt && !b.parentId).length
    return {
      handled: true,
      action: 'current_cat',
      steps: [{ text: t('aiCmd.stepReadGlobalContext'), done: true }],
      reply: tN('aiCmd.currentAll', totalCount),
    }
  }

  // ── 13. 对话式撤销 (/undo, 撤销操作, 恢复原样) ──
  if (parseUndoIntent(query)) {
    // 「停止生成」后不再执行撤销副作用（popUndoAction 会改状态，必须前置校验）
    if (context?.signal?.aborted) {
      return { handled: true, action: 'undo', success: false, reply: '' }
    }
    const actionToRevert = popUndoAction()
    if (actionToRevert) {
      const msg = await actionToRevert.revert()
      const remaining = getUndoStackDepth()
      const suffix = remaining > 0 ? tN('aiCmd.undoRemaining', remaining) : ''
      return {
        handled: true,
        action: 'undo',
        success: true,
        steps: [{ text: t('aiCmd.stepRevertAction', { desc: actionToRevert.description }), done: true }],
        reply: `${msg}${suffix}`,
      }
    }

    try {
      const toastStore = useToastStore()
      if (toastStore.undoToast) {
        const msg = toastStore.undoToast.msg
        toastStore.undoToast.undoFn()
        toastStore.dismissUndo()
        return {
          handled: true,
          action: 'undo',
          success: true,
          steps: [{ text: t('aiCmd.stepGlobalUndo'), done: true }],
          reply: t('aiCmd.undoGlobalDone', { msg }),
        }
      }
    } catch {
      // Pinia 未初始化
    }

    return {
      handled: true,
      action: 'undo',
      success: false,
      reply: t('aiCmd.undoNone'),
    }
  }

  // ── 14. 孤儿与无效引用自检清理 (/clean, 清理孤立数据) ──
  if (parseCleanIntent(query)) {
    let fixedGroupRefs = 0
    let fixedParentRefs = 0

    // 检查组内的失效 bookmarkIds
    for (const grp of ds.siblingGroups) {
      if (!grp.bookmarkIds || grp.bookmarkIds.length === 0) continue
      const validIds = grp.bookmarkIds.filter(
        (id: string) => !!ds.bookmarkMap[id] && !ds.bookmarkMap[id].deletedAt,
      )
      if (validIds.length !== grp.bookmarkIds.length) {
        fixedGroupRefs += grp.bookmarkIds.length - validIds.length
        ds.updateGroup(grp.id, { bookmarkIds: validIds })
      }
    }

    // 检查书签中的失效 parentId
    for (const bm of ds.bookmarks) {
      if (bm.parentId && (!ds.bookmarkMap[bm.parentId] || ds.bookmarkMap[bm.parentId].deletedAt)) {
        fixedParentRefs++
        ds.updateBookmark(bm.id, { parentId: undefined })
      }
    }

    if (fixedGroupRefs > 0 || fixedParentRefs > 0) {
      app.save()
      return {
        handled: true,
        action: 'clean_orphans',
        steps: [
          { text: t('aiCmd.stepAuditGroupRefs'), done: true },
          { text: t('aiCmd.stepFixOrphans'), done: true },
        ],
        reply: t('aiCmd.cleanFixed', { grp: fixedGroupRefs, par: fixedParentRefs }),
      }
    }

    return {
      handled: true,
      action: 'clean_orphans',
      steps: [{ text: t('aiCmd.stepConsistencyOk'), done: true }],
      reply: t('aiCmd.cleanOk'),
    }
  }

  // ── 15. 打开设置面板 (/settings, 打开设置) ──
  const settingsResult = await settingsBlock({ query, ds, ui, app })
  if (settingsResult !== null) return settingsResult

  return { handled: false, reply: '' }
}
