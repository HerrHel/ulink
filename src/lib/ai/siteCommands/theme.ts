/**
 * siteCommands/theme.ts — 指令块 2：主题外观 (/theme, 切换深色/浅色)
 * 自 siteCommander.ts dispatchSiteCommand 纯搬运拆出，块内逻辑与返回语义逐字一致。
 * 出口路径：themeIntent 各 kind 命中 → 均返回结果；themeIntent 为 null → 返回 null 继续 fall-through。
 */

import { parseThemeIntent } from '../siteIntents.js'
import { t } from '../../../i18n/index.js'
import type { SiteCommandBlock, SiteCommandBlockCtx, SiteCommandResult } from './types.js'

// ── 2. 主题外观 (/theme, 切换深色/浅色) ──
export const themeBlock: SiteCommandBlock = (
  ctx: SiteCommandBlockCtx,
): SiteCommandResult | null => {
  const query = ctx.query
  const ui = ctx.ui
  const themeIntent = parseThemeIntent(query)
  if (themeIntent?.kind === 'slash') {
    const mode = themeIntent.mode
    if (mode === 'dark') {
      ui.setThemeColor('dark')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: t('aiCmd.stepToDark'), done: true }],
        reply: t('aiCmd.themeDarkDone'),
      }
    } else if (mode === 'light') {
      ui.setThemeColor('light')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: t('aiCmd.stepToLight'), done: true }],
        reply: t('aiCmd.themeLightDone'),
      }
    } else if (mode === 'auto') {
      if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: t('aiCmd.stepAutoTheme'), done: true }],
        reply: t('aiCmd.themeAutoDone'),
      }
    } else {
      ui.toggleTheme()
      const current = t(ui.themeColor === 'dark' ? 'aiCmd.themeNameDark' : 'aiCmd.themeNameLight')
      return {
        handled: true,
        action: 'theme',
        steps: [{ text: t('aiCmd.stepToggleTheme'), done: true }],
        reply: t('aiCmd.themeToggled', { mode: current }),
      }
    }
  }

  if (themeIntent?.kind === 'nl-dark') {
    ui.setThemeColor('dark')
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: t('aiCmd.stepToDark'), done: true }],
      reply: t('aiCmd.themeDarkDone'),
    }
  }

  if (themeIntent?.kind === 'nl-light') {
    ui.setThemeColor('light')
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: t('aiCmd.stepToLight'), done: true }],
      reply: t('aiCmd.themeLightDone'),
    }
  }

  if (themeIntent?.kind === 'nl-auto') {
    if (ui.themeMode !== 'auto') ui.toggleAutoTheme()
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: t('aiCmd.stepAutoTheme'), done: true }],
      reply: t('aiCmd.themeAutoDone'),
    }
  }

  if (themeIntent?.kind === 'nl-toggle') {
    ui.toggleTheme()
    const current = t(ui.themeColor === 'dark' ? 'aiCmd.themeNameDark' : 'aiCmd.themeNameLight')
    return {
      handled: true,
      action: 'theme',
      steps: [{ text: t('aiCmd.stepToggleTheme'), done: true }],
      reply: t('aiCmd.themeToggled', { mode: current }),
    }
  }

  return null
}
