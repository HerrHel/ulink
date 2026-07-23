/**
 * sync 命令 - 云端同步
 */
import { Command } from 'commander'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { Bookmark, SiblingGroup, Category, OutputFormat } from '../types.js'

/** 表名到类型的映射 */
const TABLE_MAP = {
  bookmarks: 'bookmarks',
  sibling_groups: 'siblingGroups',
  categories: 'categories',
} as const

export function registerSyncCommand(program: Command): void {
  const sync = program
    .command('sync')
    .description('云端同步')

  sync
    .command('status')
    .description('查看同步状态')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { format: OutputFormat }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        // 获取各表的记录数和最后更新时间
        const [bookmarks, groups, categories] = await Promise.all([
          supabase
            .from('bookmarks')
            .select('updated_at_num', { count: 'exact' })
            .eq('user_id', user.id)
            .is('deleted_at', null)
            .order('updated_at_num', { ascending: false })
            .limit(1),
          supabase
            .from('sibling_groups')
            .select('updated_at_num', { count: 'exact' })
            .eq('user_id', user.id)
            .is('deleted_at', null)
            .order('updated_at_num', { ascending: false })
            .limit(1),
          supabase
            .from('categories')
            .select('updated_at', { count: 'exact' })
            .eq('user_id', user.id)
            .is('deleted_at', null)
            .order('updated_at', { ascending: false })
            .limit(1),
        ])

        const formatTs = (ts: number | null | undefined) =>
          ts ? new Date(ts).toLocaleString('zh-CN') : '-'

        const status = [
          {
            table: '书签',
            count: bookmarks.count || 0,
            lastUpdate: formatTs(bookmarks.data?.[0]?.updated_at_num),
          },
          {
            table: '组',
            count: groups.count || 0,
            lastUpdate: formatTs(groups.data?.[0]?.updated_at_num),
          },
          {
            table: '分类',
            count: categories.count || 0,
            lastUpdate: categories.data?.[0]?.updated_at
              ? new Date(categories.data[0].updated_at).toLocaleString('zh-CN')
              : '-',
          },
        ]

        format.output(
          status,
          [
            { key: 'table', header: '类型', width: 15 },
            { key: 'count', header: '数量', width: 10 },
            { key: 'lastUpdate', header: '最后更新', width: 25 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`查询失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  sync
    .command('pull')
    .description('从云端拉取数据到本地文件')
    .option('-o, --output <file>', '输出文件路径', 'sync-pull.json')
    .action(async (opts: { output: string }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()
        format.info('正在从云端拉取数据...')

        const [bookmarksRes, groupsRes, categoriesRes] = await Promise.all([
          supabase.from('bookmarks').select('*').eq('user_id', user.id),
          supabase.from('sibling_groups').select('*').eq('user_id', user.id),
          supabase.from('categories').select('*').eq('user_id', user.id),
        ])

        if (bookmarksRes.error) throw bookmarksRes.error
        if (groupsRes.error) throw groupsRes.error
        if (categoriesRes.error) throw categoriesRes.error

        const data = {
          pulledAt: new Date().toISOString(),
          userId: user.id,
          bookmarks: bookmarksRes.data || [],
          siblingGroups: groupsRes.data || [],
          categories: categoriesRes.data || [],
        }

        const fs = await import('fs')
        const path = await import('path')
        const outputPath = path.resolve(opts.output)
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')

        format.success(`数据已拉取到: ${outputPath}`)
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
        format.error(`拉取失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  sync
    .command('push')
    .description('从本地文件推送到云端')
    .argument('<file>', '本地 JSON 文件路径')
    .option('--merge', '合并模式（保留云端数据）', false)
    .action(async (file: string, opts: { merge: boolean }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const fs = await import('fs')
        const path = await import('path')
        const filePath = path.resolve(file)

        if (!fs.existsSync(filePath)) {
          format.error(`文件不存在: ${filePath}`)
          process.exit(1)
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(content)

        if (!data.bookmarks && !data.siblingGroups && !data.categories) {
          format.error('无效的数据格式')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()
        format.info('正在推送到云端...')

        const now = Date.now()
        let pushedBookmarks = 0
        let pushedGroups = 0
        let pushedCategories = 0

        // 如果不是合并模式，先清空云端数据
        if (!opts.merge) {
          format.info('清空云端数据...')
          await Promise.all([
            supabase.from('bookmarks').delete().eq('user_id', user.id),
            supabase.from('sibling_groups').delete().eq('user_id', user.id),
            supabase.from('categories').delete().eq('user_id', user.id),
          ])
        }

        // 推送分类
        if (data.categories && Array.isArray(data.categories)) {
          for (const cat of data.categories) {
            const { error } = await supabase
              .from('categories')
              .upsert({
                ...cat,
                user_id: user.id,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'id' })

            if (!error) pushedCategories++
          }
        }

        // 推送书签
        if (data.bookmarks && Array.isArray(data.bookmarks)) {
          for (const bm of data.bookmarks) {
            const { error } = await supabase
              .from('bookmarks')
              .upsert({
                ...bm,
                user_id: user.id,
                updated_at_num: bm.updated_at_num || now,
              }, { onConflict: 'id' })

            if (!error) pushedBookmarks++
          }
        }

        // 推送组
        if (data.siblingGroups && Array.isArray(data.siblingGroups)) {
          for (const group of data.siblingGroups) {
            const { error } = await supabase
              .from('sibling_groups')
              .upsert({
                ...group,
                user_id: user.id,
                updated_at_num: group.updated_at_num || now,
              }, { onConflict: 'id' })

            if (!error) pushedGroups++
          }
        }

        format.success('推送完成！')
        format.output(
          [
            { type: '书签', count: pushedBookmarks },
            { type: '组', count: pushedGroups },
            { type: '分类', count: pushedCategories },
          ],
          [
            { key: 'type', header: '类型', width: 15 },
            { key: 'count', header: '已推送', width: 10 },
          ],
          'table'
        )
      } catch (err) {
        format.error(`推送失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  sync
    .command('conflict')
    .description('查看冲突记录')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (_opts: { format: OutputFormat }) => {
      // Phase 3 暂不实现完整的冲突检测逻辑
      format.info('冲突检测功能开发中...')
      format.info('当前建议：使用 sync pull/push 手动同步')
    })
}
