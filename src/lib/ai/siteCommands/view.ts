/**
 * siteCommands/view.ts — 指令块 3：布局视图 (/view, 切换列表/网格/紧凑)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：viewIntent 各 kind 命中 → 均返回结果；viewIntent 为 null → 返回 null 继续 fall-through。
 */

import { parseViewIntent } from '../siteIntents.js'
import { t } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 3. 布局视图 (/view, 切换列表/网格/紧凑) ──
export const viewBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ui = ctx.ui
  const viewIntent = parseViewIntent(query)
  if (viewIntent?.kind === 'slash') {
    const rawMode = viewIntent.mode || 'grid'
    const targetMode = rawMode === 'compact' ? 'mini-grid' : (rawMode as 'grid' | 'list' | 'mini-grid')
    ui.layoutMode = targetMode
    ui.saveUIState?.()
    const nameMap: Record<'grid' | 'list' | 'mini-grid', string> = {
      grid: t('aiCmd.viewNameGrid'),
      list: t('aiCmd.viewNameList'),
      'mini-grid': t('aiCmd.viewNameCompact'),
    }
    return {
      handled: true,
      action: 'view',
      steps: [{ text: t('aiCmd.stepToView', { name: nameMap[targetMode] }), done: true }],
      reply: t('aiCmd.viewDone', { name: nameMap[targetMode] }),
    }
  }

  if (viewIntent?.kind === 'list') {
    ui.layoutMode = 'list'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: t('aiCmd.stepToView', { name: t('aiCmd.viewNameList') }), done: true }],
      reply: t('aiCmd.viewDone', { name: t('aiCmd.viewNameList') }),
    }
  }

  if (viewIntent?.kind === 'grid') {
    ui.layoutMode = 'grid'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: t('aiCmd.stepToView', { name: t('aiCmd.viewNameGrid') }), done: true }],
      reply: t('aiCmd.viewDone', { name: t('aiCmd.viewNameGrid') }),
    }
  }

  if (viewIntent?.kind === 'compact') {
    ui.layoutMode = 'mini-grid'
    ui.saveUIState?.()
    return {
      handled: true,
      action: 'view',
      steps: [{ text: t('aiCmd.stepToView', { name: t('aiCmd.viewNameCompact') }), done: true }],
      reply: t('aiCmd.viewDone', { name: t('aiCmd.viewNameCompact') }),
    }
  }

  return null
}
