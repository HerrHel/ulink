/**
 * siteCommands/export.ts — 指令块 8：数据导出备份 (/export, 导出数据)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseExportIntent → HITL 二次确认（全量数据外流属危险操作，模型自主
 * 触发也强制确认）→ 确认后触发导出并返回 / 拒绝则如实返回取消；未命中 → 返回 null 继续 fall-through。
 */

import { parseExportIntent } from '../siteIntents.js'
import { askConfirm } from '../siteHitl.js'
import { exportData } from '../../../composables/domain/useDataIO.js'
import { t } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 8. 数据导出备份 (/export, 导出数据) ──
export const exportBlock: SiteCommandBlock = async (
  ctx: SiteCommandBlockCtx,
): Promise<SiteCommandResult | null> => {
  const query = ctx.query
  if (parseExportIntent(query)) {
    // 函数级 HITL：导出文件含敏感字段，必须经用户二次确认（不依赖调用方自律）
    const confirmed = await askConfirm(t('aiCmd.exportConfirm'))
    if (ctx.signal?.aborted) {
      return { handled: true, action: 'export', steps: [], reply: '' }
    }
    if (!confirmed) {
      return {
        handled: true,
        action: 'export',
        steps: [{ text: t('aiCmd.stepUserCancelExport'), done: true }],
        reply: t('aiCmd.exportCancelled'),
      }
    }
    exportData()
    return {
      handled: true,
      action: 'export',
      steps: [
        { text: t('aiCmd.stepExportSnapshot'), done: true },
        { text: t('aiCmd.stepExportDownload'), done: true },
      ],
      reply: t('aiCmd.exportDone'),
    }
  }
  return null
}
