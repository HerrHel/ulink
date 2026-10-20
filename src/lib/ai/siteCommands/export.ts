/**
 * siteCommands/export.ts — 指令块 8：数据导出备份 (/export, 导出数据)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseExportIntent → 触发导出并返回；未命中 → 返回 null 继续 fall-through。
 */

import { parseExportIntent } from '../siteIntents.js'
import { exportData } from '../../../composables/domain/useDataIO.js'
import { t } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 8. 数据导出备份 (/export, 导出数据) ──
export const exportBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  if (parseExportIntent(query)) {
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
