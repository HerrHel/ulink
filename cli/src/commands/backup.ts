/**
 * backup 命令 - 本地备份管理
 */
import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { OutputFormat } from '../types.js'

const BACKUP_DIR = path.join(os.homedir(), '.linkvault', 'backups')

/** 确保备份目录存在 */
function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true })
  }
}

/** 生成备份文件名 */
function generateBackupName(): string {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `backup-${timestamp}.json`
}

export function registerBackupCommand(program: Command): void {
  const backup = program
    .command('backup')
    .description('本地备份管理')

  backup
    .command('create')
    .description('创建本地备份')
    .action(async () => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()
        format.info('正在创建备份...')

        // 获取所有数据（包括软删除的）
        const [bookmarksRes, groupsRes, categoriesRes] = await Promise.all([
          supabase.from('bookmarks').select('*').eq('user_id', user.id),
          supabase.from('sibling_groups').select('*').eq('user_id', user.id),
          supabase.from('categories').select('*').eq('user_id', user.id),
        ])

        if (bookmarksRes.error) throw bookmarksRes.error
        if (groupsRes.error) throw groupsRes.error
        if (categoriesRes.error) throw categoriesRes.error

        const data = {
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          userId: user.id,
          bookmarks: bookmarksRes.data || [],
          siblingGroups: groupsRes.data || [],
          categories: categoriesRes.data || [],
        }

        ensureBackupDir()
        const filename = generateBackupName()
        const filepath = path.join(BACKUP_DIR, filename)
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8')

        format.success(`备份已创建: ${filepath}`)
        format.output(
          [
            { type: '书签', count: data.bookmarks.length },
            { type: '组', count: data.siblingGroups.length },
            { type: '分类', count: data.categories.length },
          ],
          [
            { key: 'type', header: '类型', width: 15 },
            { key: 'count', header: '数量', width: 10 },
          ],
          'table'
        )
      } catch (err) {
        format.error(`备份失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  backup
    .command('list')
    .description('列出本地备份')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action((opts: { format: OutputFormat }) => {
      try {
        ensureBackupDir()

        const files = fs.readdirSync(BACKUP_DIR)
          .filter((f) => f.endsWith('.json'))
          .sort()
          .reverse()

        if (files.length === 0) {
          format.warn('暂无备份文件')
          return
        }

        const backups = files.map((filename) => {
          const filepath = path.join(BACKUP_DIR, filename)
          const stats = fs.statSync(filepath)
          const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'))

          return {
            filename,
            size: `${(stats.size / 1024).toFixed(1)} KB`,
            createdAt: content.createdAt || stats.birthtime.toLocaleString('zh-CN'),
            bookmarks: content.bookmarks?.length || 0,
            groups: content.siblingGroups?.length || 0,
          }
        })

        format.output(
          backups,
          [
            { key: 'filename', header: '文件名', width: 35 },
            { key: 'size', header: '大小', width: 12 },
            { key: 'createdAt', header: '创建时间', width: 25 },
            { key: 'bookmarks', header: '书签', width: 8 },
            { key: 'groups', header: '组', width: 8 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`列出备份失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  backup
    .command('restore')
    .description('从备份恢复')
    .argument('<filename>', '备份文件名')
    .option('--merge', '合并模式（保留云端数据）', false)
    .action(async (filename: string, opts: { merge: boolean }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        ensureBackupDir()
        const filepath = path.join(BACKUP_DIR, filename)

        if (!fs.existsSync(filepath)) {
          format.error(`备份文件不存在: ${filename}`)
          format.info('运行 linkvault backup list 查看可用备份')
          process.exit(1)
        }

        const content = fs.readFileSync(filepath, 'utf-8')
        const data = JSON.parse(content)

        if (!data.bookmarks && !data.siblingGroups && !data.categories) {
          format.error('无效的备份文件格式')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()
        format.info(`正在从备份恢复: ${filename}`)

        // 如果不是合并模式，先清空云端数据
        if (!opts.merge) {
          format.info('清空云端数据...')
          await Promise.all([
            supabase.from('bookmarks').delete().eq('user_id', user.id),
            supabase.from('sibling_groups').delete().eq('user_id', user.id),
            supabase.from('categories').delete().eq('user_id', user.id),
          ])
        }

        let restoredBookmarks = 0
        let restoredGroups = 0
        let restoredCategories = 0

        // 恢复分类
        if (data.categories && Array.isArray(data.categories)) {
          for (const cat of data.categories) {
            const { error } = await supabase
              .from('categories')
              .upsert({
                ...cat,
                user_id: user.id,
                deleted_at: cat.deleted_at || null,
              }, { onConflict: 'id' })

            if (!error) restoredCategories++
          }
        }

        // 恢复书签
        if (data.bookmarks && Array.isArray(data.bookmarks)) {
          for (const bm of data.bookmarks) {
            const { error } = await supabase
              .from('bookmarks')
              .upsert({
                ...bm,
                user_id: user.id,
                deleted_at: bm.deleted_at || null,
              }, { onConflict: 'id' })

            if (!error) restoredBookmarks++
          }
        }

        // 恢复组
        if (data.siblingGroups && Array.isArray(data.siblingGroups)) {
          for (const group of data.siblingGroups) {
            const { error } = await supabase
              .from('sibling_groups')
              .upsert({
                ...group,
                user_id: user.id,
                deleted_at: group.deleted_at || null,
              }, { onConflict: 'id' })

            if (!error) restoredGroups++
          }
        }

        format.success('恢复完成！')
        format.output(
          [
            { type: '书签', count: restoredBookmarks },
            { type: '组', count: restoredGroups },
            { type: '分类', count: restoredCategories },
          ],
          [
            { key: 'type', header: '类型', width: 15 },
            { key: 'count', header: '已恢复', width: 10 },
          ],
          'table'
        )
      } catch (err) {
        format.error(`恢复失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  backup
    .command('delete')
    .description('删除备份文件')
    .argument('<filename>', '备份文件名')
    .action((filename: string) => {
      try {
        ensureBackupDir()
        const filepath = path.join(BACKUP_DIR, filename)

        if (!fs.existsSync(filepath)) {
          format.error(`备份文件不存在: ${filename}`)
          process.exit(1)
        }

        fs.unlinkSync(filepath)
        format.success(`备份已删除: ${filename}`)
      } catch (err) {
        format.error(`删除失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  backup
    .command('dir')
    .description('显示备份目录路径')
    .action(() => {
      ensureBackupDir()
      format.info(`备份目录: ${BACKUP_DIR}`)
    })
}
