/**
 * siteCommands/help.ts — 指令块 1：帮助说明 (/help, /?, 帮助)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseHelpIntent → 返回帮助文案；未命中 → 返回 null 继续 fall-through。
 */

import { parseHelpIntent } from '../siteIntents.js'
import { t } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 1. 帮助说明 (/help, /?, 帮助) ──
export const helpBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  if (parseHelpIntent(query)) {
    return {
      handled: true,
      action: 'help',
      success: true,
      steps: [{ text: t('aiCmd.helpStep'), done: true }],
      reply: [
        t('aiCmd.helpTitle'),
        '',
        t('aiCmd.helpHealth'),
        t('aiCmd.helpHealthUsage'),
        '',
        t('aiCmd.helpInbox'),
        t('aiCmd.helpInboxUsage'),
        '',
        t('aiCmd.helpPack'),
        t('aiCmd.helpPackUsage'),
        '',
        t('aiCmd.helpTheme'),
        t('aiCmd.helpThemeUsage'),
        t('aiCmd.helpThemeHint'),
        '',
        t('aiCmd.helpView'),
        t('aiCmd.helpViewUsage'),
        t('aiCmd.helpViewHint'),
        '',
        t('aiCmd.helpCat'),
        t('aiCmd.helpCatUsage'),
        t('aiCmd.helpCatHint'),
        '',
        t('aiCmd.helpTrash'),
        t('aiCmd.helpTrashUsage'),
        t('aiCmd.helpTrashHint'),
        '',
        t('aiCmd.helpDedup'),
        t('aiCmd.helpDedupUsage'),
        '',
        t('aiCmd.helpDeadlink'),
        t('aiCmd.helpDeadlinkUsage'),
        '',
        t('aiCmd.helpExport'),
        t('aiCmd.helpExportUsage'),
        '',
        t('aiCmd.helpStats'),
        t('aiCmd.helpStatsUsage'),
        '',
        t('aiCmd.helpMove'),
        t('aiCmd.helpMoveUsage'),
        t('aiCmd.helpMoveHint'),
        '',
        t('aiCmd.helpUndo'),
        t('aiCmd.helpUndoUsage'),
        '',
        t('aiCmd.helpClean'),
        t('aiCmd.helpCleanUsage'),
        '',
        t('aiCmd.helpSettings'),
        t('aiCmd.helpSettingsUsage'),
        '',
        t('aiCmd.helpTip'),
      ].join('\n'),
    }
  }
  return null
}
