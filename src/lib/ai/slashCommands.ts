/**
 * slashCommands.ts — 斜杠命令表单一真源（命令清单与 i18n 键）。
 *
 * 命令块实现见 siteCommander.ts，帮助文案见 siteCommands/help.ts；新增命令必须三处同步。
 * 本模块只保存命令字符串与 i18n 键，不含任何命令执行逻辑，避免与 UI / composable 层形成循环导入。
 */

/** 斜杠指令项（title/desc 由 titleKey/descKey 经 t() 渲染） */
export interface SlashCommandItem {
  cmd: string
  titleKey: string
  descKey: string
}

/** AI 侧边栏斜杠指令快捷联想（与语言包 slash* 键一一对应，共 15 项） */
export const SLASH_COMMAND_KEYS: SlashCommandItem[] = [
  { cmd: '/help', titleKey: 'ai.slashHelpTitle', descKey: 'ai.slashHelpDesc' },
  { cmd: '/health', titleKey: 'ai.slashHealthTitle', descKey: 'ai.slashHealthDesc' },
  { cmd: '/inbox', titleKey: 'ai.slashInboxTitle', descKey: 'ai.slashInboxDesc' },
  { cmd: '/pack', titleKey: 'ai.slashPackTitle', descKey: 'ai.slashPackDesc' },
  { cmd: '/theme', titleKey: 'ai.slashThemeTitle', descKey: 'ai.slashThemeDesc' },
  { cmd: '/view', titleKey: 'ai.slashViewTitle', descKey: 'ai.slashViewDesc' },
  { cmd: '/cat', titleKey: 'ai.slashCatTitle', descKey: 'ai.slashCatDesc' },
  { cmd: '/trash', titleKey: 'ai.slashTrashTitle', descKey: 'ai.slashTrashDesc' },
  { cmd: '/dedup', titleKey: 'ai.slashDedupTitle', descKey: 'ai.slashDedupDesc' },
  { cmd: '/deadlink', titleKey: 'ai.slashDeadlinkTitle', descKey: 'ai.slashDeadlinkDesc' },
  { cmd: '/export', titleKey: 'ai.slashExportTitle', descKey: 'ai.slashExportDesc' },
  { cmd: '/stats', titleKey: 'ai.slashStatsTitle', descKey: 'ai.slashStatsDesc' },
  { cmd: '/undo', titleKey: 'ai.slashUndoTitle', descKey: 'ai.slashUndoDesc' },
  { cmd: '/clean', titleKey: 'ai.slashCleanTitle', descKey: 'ai.slashCleanDesc' },
  { cmd: '/clear', titleKey: 'ai.slashClearTitle', descKey: 'ai.slashClearDesc' },
]

/** 命令面板（CommandPalette）展示的斜杠命令（共 10 项，顺序与面板过滤逻辑一致） */
export const PALETTE_SLASH_CMDS: string[] = [
  '/health',
  '/inbox',
  '/pack',
  '/deadlink',
  '/dedup',
  '/theme',
  '/view',
  '/stats',
  '/undo',
  '/help',
]
