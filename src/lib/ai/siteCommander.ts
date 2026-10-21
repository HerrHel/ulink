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
 * 拆分说明（只拆分、不改行为，拆分已完成）：undo 事务栈在 siteUndoStack.ts，命令执行在
 * siteActions.ts，HITL 确认与行动卡片构造在 siteHitl.ts，意图解析（正则/参数提取）在
 * siteIntents.ts；18 个编号意图块的处理器在 siteCommands/ 目录（与意图编号一一对应，统一
 * SiteCommandBlock 契约：返回 null = 未命中继续 fall-through，返回 SiteCommandResult 即短路），
 * SiteCommandResult 定义移至 siteCommands/types.ts 并在此 re-export；本文件保留
 * dispatchSiteCommand 纯编排（构造 ctx → 按序短路调用全部 block → 尾部 fallback，
 * 意图块顺序与短路语义不变）并 re-export 原公开符号。
 */

import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useAppStore } from '../../stores/app.js'
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
import { batchMoveBlock } from './siteCommands/batchMove.js'
import { moveBlock } from './siteCommands/move.js'
import { currentCatBlock } from './siteCommands/currentCat.js'
import { undoBlock } from './siteCommands/undo.js'
import { cleanBlock } from './siteCommands/clean.js'
import { settingsBlock } from './siteCommands/settings.js'
import { parseSimilarSiteIntent } from './siteIntents.js'
import { findSimilarWebsites } from './cloudAiClient.js'
import type { SiteCommandResult } from './siteCommands/types.js'
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
  batchTagBookmarks,
} from './siteActions.js'
export type {
  SiteCommanderContext,
  CreateTopicWorkspaceResult,
  HealDeadlinkResult,
  BatchTagBookmarksResult,
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
  const batchMoveResult = await batchMoveBlock({ query, ds, ui, app })
  if (batchMoveResult !== null) return batchMoveResult

  // ── 11. 批量整理未分类 (/move uncategorized <分类名>, 把未分类移动到 [分类名]) ──
  const moveResult = await moveBlock({ query, ds, ui, app, signal: context?.signal })
  if (moveResult !== null) return moveResult

  // ── 12. 上下文感知：当前分类查询 ──
  const currentCatResult = await currentCatBlock({ query, ds, ui, app })
  if (currentCatResult !== null) return currentCatResult

  // ── 13. 对话式撤销 (/undo, 撤销操作, 恢复原样) ──
  const undoResult = await undoBlock({ query, ds, ui, app, signal: context?.signal })
  if (undoResult !== null) return undoResult

  // ── 14. 孤儿与无效引用自检清理 (/clean, 清理孤立数据) ──
  const cleanResult = await cleanBlock({ query, ds, ui, app })
  if (cleanResult !== null) return cleanResult

  // ── 15. 打开设置面板 (/settings, 打开设置) ──
  const settingsResult = await settingsBlock({ query, ds, ui, app })
  if (settingsResult !== null) return settingsResult

  // ── 16. 找类似网站与平替挖掘（大白话零门槛直达）──
  const similarIntent = parseSimilarSiteIntent(query)
  if (similarIntent) {
    const target = similarIntent.target
    const existingBm = ds.bookmarks.find(
      (b) =>
        !b.deletedAt &&
        (b.title.toLowerCase().includes(target.toLowerCase()) ||
          b.url.toLowerCase().includes(target.toLowerCase())),
    )
    const targetUrl = existingBm?.url || target
    const candidates = await findSimilarWebsites(targetUrl, target, [], ds.categories, ds.customAttributes)
    if (candidates.length > 0) {
      const lines = [
        `为您甄选到以下 ${candidates.length} 个类似「${target}」的平替与精选同类工具：`,
        '',
      ]
      candidates.forEach((c, idx) => {
        lines.push(`${idx + 1}. **${c.title}** (${c.url}) — ${c.notes || c.highlight || ''}`)
      })
      return {
        handled: true,
        action: 'find_similar',
        success: true,
        reply: lines.join('\n'),
        steps: [{ text: `甄选「${target}」同类与平替工具`, done: true }],
        suggestedReplies: ['📥 全部一键加入收藏', '🇨🇳 只要国内免翻直连的', '💡 还有其他同类吗？'],
      }
    }
  }

  return { handled: false, reply: '' }
}
