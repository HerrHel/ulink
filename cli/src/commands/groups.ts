/**
 * groups 命令 - 组管理
 */
import { Command } from 'commander'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { SiblingGroup, OutputFormat } from '../types.js'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function registerGroupsCommand(program: Command): void {
  const groups = program
    .command('groups')
    .description('组管理')

  // ── 查询命令 ──

  groups
    .command('list')
    .description('列出所有组')
    .option('-c, --cat <categoryId>', '按分类筛选')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { cat?: string; format: OutputFormat }) => {
      try {
        const supabase = await getSupabaseClient()
        let query = supabase
          .from('sibling_groups')
          .select('*')
          .is('deleted_at', null)

        if (opts.cat) {
          query = query.eq('category_id', opts.cat)
        }

        query = query.order('order', { ascending: true })

        const { data, error } = await query

        if (error) {
          format.error(`查询失败: ${error.message}`)
          process.exit(1)
        }

        const groups = (data || []) as SiblingGroup[]

        const { data: categories } = await supabase
          .from('categories')
          .select('id, name')

        const categoryMap = new Map<string, string>(
          (categories || []).map((c: { id: string; name: string }) => [c.id, c.name])
        )

        format.output(
          groups.map((g) => ({
            id: g.id,
            name: format.truncate(g.name, 25),
            category: categoryMap.get(g.category_id) || g.category_id,
            bookmarks: Array.isArray(g.bookmark_ids) ? g.bookmark_ids.length : 0,
            isPublic: g.is_public ? '✓' : '',
            useCount: g.use_count,
          })),
          [
            { key: 'id', header: 'ID', width: 15 },
            { key: 'name', header: '名称', width: 25 },
            { key: 'category', header: '分类', width: 15 },
            { key: 'bookmarks', header: '书签数', width: 10 },
            { key: 'isPublic', header: '公开', width: 8 },
            { key: 'useCount', header: '使用次数', width: 10 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  groups
    .command('get <id>')
    .description('查看组详情')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (id: string, opts: { format: OutputFormat }) => {
      try {
        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
          .from('sibling_groups')
          .select('*')
          .eq('id', id)
          .single()

        if (error) {
          if (error.code === 'PGRST116') {
            format.error(`组不存在: ${id}`)
          } else {
            format.error(`查询失败: ${error.message}`)
          }
          process.exit(1)
        }

        const group = data as SiblingGroup

        const { data: category } = await supabase
          .from('categories')
          .select('name')
          .eq('id', group.category_id)
          .single()

        const categoryName = (category as { name: string } | null)?.name || group.category_id

        const detail = [
          { key: 'ID', value: group.id },
          { key: '名称', value: group.name },
          { key: '分类', value: categoryName },
          { key: '图标', value: group.icon || '(无)' },
          { key: '备注', value: format.truncate(group.notes, 100) || '(无)' },
          { key: '属性', value: format.formatAttributes(group.attributes) || '(无)' },
          { key: '书签数', value: String(Array.isArray(group.bookmark_ids) ? group.bookmark_ids.length : 0) },
          { key: '公开', value: group.is_public ? '是' : '否' },
          { key: '使用次数', value: String(group.use_count) },
          { key: '更新时间', value: format.formatTimestamp(group.updated_at_num) },
        ]

        format.output(
          detail,
          [
            { key: 'key', header: '字段', width: 15 },
            { key: 'value', header: '值', width: 60 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  // ── 写操作命令 ──

  groups
    .command('create')
    .description('创建组')
    .requiredOption('-n, --name <name>', '组名称')
    .option('-c, --cat <categoryId>', '分类 ID', 'uncategorized')
    .option('--icon <icon>', '图标')
    .option('--notes <notes>', '备注')
    .option('--public', '设为公开')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: {
      name: string
      cat: string
      icon?: string
      notes?: string
      public?: boolean
      format: OutputFormat
    }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()
        const id = generateId()
        const now = Date.now()

        const row = {
          id,
          user_id: user.id,
          name: opts.name,
          category_id: opts.cat,
          icon: opts.icon || '',
          notes: opts.notes || '',
          is_public: opts.public || false,
          order: 0,
          is_expanded: false,
          attributes: {},
          bookmark_ids: [],
          use_count: 0,
          updated_at_num: now,
        }

        const { error } = await supabase
          .from('sibling_groups')
          .insert(row)

        if (error) {
          format.error(`创建失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`组已创建: ${id}`)

        format.output(
          [{
            id: row.id,
            name: row.name,
            category: opts.cat,
            isPublic: row.is_public ? '✓' : '',
          }],
          [
            { key: 'id', header: 'ID', width: 15 },
            { key: 'name', header: '名称', width: 25 },
            { key: 'category', header: '分类', width: 15 },
            { key: 'isPublic', header: '公开', width: 8 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  groups
    .command('update <id>')
    .description('更新组')
    .option('-n, --name <name>', '新名称')
    .option('-c, --cat <categoryId>', '新分类')
    .option('--icon <icon>', '新图标')
    .option('--notes <notes>', '新备注')
    .option('--public', '设为公开')
    .option('--private', '设为私有')
    .action(async (id: string, opts: {
      name?: string
      cat?: string
      icon?: string
      notes?: string
      public?: boolean
      private?: boolean
    }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        const updates: Record<string, unknown> = { updated_at_num: Date.now() }
        if (opts.name !== undefined) updates.name = opts.name
        if (opts.cat !== undefined) updates.category_id = opts.cat
        if (opts.icon !== undefined) updates.icon = opts.icon
        if (opts.notes !== undefined) updates.notes = opts.notes
        if (opts.public) updates.is_public = true
        if (opts.private) updates.is_public = false

        const { error } = await supabase
          .from('sibling_groups')
          .update(updates)
          .eq('id', id)
          .eq('user_id', user.id)

        if (error) {
          format.error(`更新失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`组已更新: ${id}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  groups
    .command('delete <id>')
    .description('删除组（软删除）')
    .option('--hard', '硬删除（不可恢复）')
    .action(async (id: string, opts: { hard?: boolean }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        if (opts.hard) {
          const { error } = await supabase
            .from('sibling_groups')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id)

          if (error) {
            format.error(`删除失败: ${error.message}`)
            process.exit(1)
          }
          format.success(`组已硬删除: ${id}`)
        } else {
          const { error } = await supabase
            .from('sibling_groups')
            .update({ deleted_at: new Date().toISOString(), updated_at_num: Date.now() })
            .eq('id', id)
            .eq('user_id', user.id)

          if (error) {
            format.error(`删除失败: ${error.message}`)
            process.exit(1)
          }
          format.success(`组已移至回收站: ${id}`)
        }
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  groups
    .command('add-bookmark <groupId> <bookmarkId>')
    .description('添加书签到组')
    .action(async (groupId: string, bookmarkId: string) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        // 获取当前组
        const { data: group, error: fetchError } = await supabase
          .from('sibling_groups')
          .select('bookmark_ids')
          .eq('id', groupId)
          .eq('user_id', user.id)
          .single()

        if (fetchError || !group) {
          format.error(`组不存在: ${groupId}`)
          process.exit(1)
        }

        const bookmarkIds = Array.isArray(group.bookmark_ids) ? group.bookmark_ids : []
        if (bookmarkIds.includes(bookmarkId)) {
          format.warn(`书签 ${bookmarkId} 已在组中`)
          return
        }

        bookmarkIds.push(bookmarkId)

        const { error } = await supabase
          .from('sibling_groups')
          .update({ bookmark_ids: bookmarkIds, updated_at_num: Date.now() })
          .eq('id', groupId)
          .eq('user_id', user.id)

        if (error) {
          format.error(`添加失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`书签 ${bookmarkId} 已添加到组 ${groupId}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  groups
    .command('remove-bookmark <groupId> <bookmarkId>')
    .description('从组中移除书签')
    .action(async (groupId: string, bookmarkId: string) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        const { data: group, error: fetchError } = await supabase
          .from('sibling_groups')
          .select('bookmark_ids')
          .eq('id', groupId)
          .eq('user_id', user.id)
          .single()

        if (fetchError || !group) {
          format.error(`组不存在: ${groupId}`)
          process.exit(1)
        }

        const bookmarkIds = Array.isArray(group.bookmark_ids) ? group.bookmark_ids : []
        const index = bookmarkIds.indexOf(bookmarkId)
        if (index === -1) {
          format.warn(`书签 ${bookmarkId} 不在组中`)
          return
        }

        bookmarkIds.splice(index, 1)

        const { error } = await supabase
          .from('sibling_groups')
          .update({ bookmark_ids: bookmarkIds, updated_at_num: Date.now() })
          .eq('id', groupId)
          .eq('user_id', user.id)

        if (error) {
          format.error(`移除失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`书签 ${bookmarkId} 已从组 ${groupId} 移除`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}
