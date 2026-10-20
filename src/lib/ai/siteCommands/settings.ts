/**
 * siteCommands/settings.ts — 指令块 15：打开设置面板 (/settings, 打开设置)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：命中 parseSettingsIntent → 返回结果；未命中 → 返回 null 继续 fall-through。
 */

import { parseSettingsIntent } from '../siteIntents.js'
import { t } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 15. 打开设置面板 (/settings, 打开设置) ──
export const settingsBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ui = ctx.ui
  if (parseSettingsIntent(query)) {
    ui.panels.settings = true
    return {
      handled: true,
      action: 'settings',
      steps: [{ text: t('aiCmd.stepOpenSettings'), done: true }],
      reply: t('aiCmd.settingsOpened'),
    }
  }
  return null
}
