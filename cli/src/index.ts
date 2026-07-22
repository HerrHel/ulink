#!/usr/bin/env node

/**
 * LinkVault CLI 入口
 * 书签管理器命令行工具
 */
import { Command } from 'commander'
import { registerConfigCommand } from './commands/config.js'
import { registerAuthCommand } from './commands/auth.js'
import { registerCategoriesCommand } from './commands/categories.js'
import { registerBookmarksCommand } from './commands/bookmarks.js'
import { registerGroupsCommand } from './commands/groups.js'
import { registerSearchCommand } from './commands/search.js'
import { registerImportExportCommand } from './commands/io.js'
import { registerSyncCommand } from './commands/sync.js'
import { registerBackupCommand } from './commands/backup.js'
import { registerMaintenanceCommand } from './commands/maintenance.js'
import { registerTagsCommand } from './commands/tags.js'
import { registerShareCommand } from './commands/share.js'

const program = new Command()

program
  .name('linkvault')
  .description('LinkVault CLI - 书签管理器命令行工具')
  .version('0.1.0')

// 注册命令
registerConfigCommand(program)
registerAuthCommand(program)
registerCategoriesCommand(program)
registerBookmarksCommand(program)
registerGroupsCommand(program)
registerSearchCommand(program)
registerImportExportCommand(program)
registerSyncCommand(program)
registerBackupCommand(program)
registerMaintenanceCommand(program)
registerTagsCommand(program)
registerShareCommand(program)

// 错误处理
program.exitOverride()

try {
  await program.parseAsync(process.argv)
} catch (err) {
  if ((err as { code?: string }).code === 'commander.helpDisplayed') {
    process.exit(0)
  }
  if ((err as { code?: string }).code === 'commander.version') {
    process.exit(0)
  }
  console.error('错误:', (err as Error).message)
  process.exit(1)
}
