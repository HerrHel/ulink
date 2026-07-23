/**
 * bookmarks 命令 - 书签管理
 */
import { Command } from 'commander'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { Bookmark, OutputFormat, SortMode } from '../types.js'

/** 生成随机 ID */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function registerBookmarksCommand(program: Command): void {
  const bookmarks = program
    .command('bookmarks')
    .description('书签管理')

  // ── 查询命令 ──

  bookmarks
    .command('list')
    .description('列出书签')
    .option('-c, --cat <categoryId>', '按分类筛选')
    .option('--parent <parentId>', '列出指定父书签的子书签')
    .option('--roots', '仅列出顶级书签（无父书签）')
    .option('-s, --sort <mode>', '排序方式 (alpha|use|date|order)', 'order')
    .option('-l, --limit <n>', '限制数量', '100')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { cat?: string; parent?: string; roots?: boolean; sort: SortMode; limit: string; format: OutputFormat }) => {
      try {
        const supabase = await getSupabaseClient()
        let query = supabase
          .from('bookmarks')
          .select('*')
          .is('deleted_at', null)

        if (opts.cat) {
          query = query.eq('category_id', opts.cat)
        }

        if (opts.parent) {
          query = query.eq('parent_id', opts.parent)
        } else if (opts.roots) {
          query = query.is('parent_id', null)
        }

        const orderMap: Record<SortMode, { column: string; ascending: boolean }> = {
          alpha: { column: 'title', ascending: true },
          use: { column: 'use_count', ascending: false },
          date: { column: 'updated_at_num', ascending: false },
          order: { column: 'order', ascending: true },
        }
        const order = orderMap[opts.sort] || orderMap.order
        query = query.order(order.column, { ascending: order.ascending })

        const limit = parseInt(opts.limit, 10)
        if (!isNaN(limit) && limit > 0) {
          query = query.limit(limit)
        }

        const { data, error } = await query

        if (error) {
          format.error(`查询失败: ${error.message}`)
          process.exit(1)
        }

        const bookmarks = (data || []) as Bookmark[]

        const { data: categories } = await supabase
          .from('categories')
          .select('id, name')

        const categoryMap = new Map<string, string>(
          (categories || []).map((c: { id: string; name: string }) => [c.id, c.name])
        )

        format.output(
          bookmarks.map((b) => ({
            id: b.id,
            title: (b.parent_id ? '  └ ' : '') + format.truncate(b.title, 30),
            url: format.truncate(b.url, 40),
            category: categoryMap.get(b.category_id) || b.category_id,
            parent: b.parent_id || '-',
            useCount: b.use_count,
            password: format.formatPassword(b.password),
          })),
          [
            { key: 'id', header: 'ID', width: 15 },
            { key: 'title', header: '标题', width: 30 },
            { key: 'url', header: 'URL', width: 40 },
            { key: 'category', header: '分类', width: 15 },
            { key: 'parent', header: '父书签', width: 15 },
            { key: 'useCount', header: '使用次数', width: 10 },
            { key: 'password', header: '密码', width: 15 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  bookmarks
    .command('get <id>')
    .description('查看书签详情')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (id: string, opts: { format: OutputFormat }) => {
      try {
        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
          .from('bookmarks')
          .select('*')
          .eq('id', id)
          .single()

        if (error) {
          if (error.code === 'PGRST116') {
            format.error(`书签不存在: ${id}`)
          } else {
            format.error(`查询失败: ${error.message}`)
          }
          process.exit(1)
        }

        const bookmark = data as Bookmark

        const { data: category } = await supabase
          .from('categories')
          .select('name')
          .eq('id', bookmark.category_id)
          .single()

        const categoryName = (category as { name: string } | null)?.name || bookmark.category_id

        const detail = [
          { key: 'ID', value: bookmark.id },
          { key: '标题', value: bookmark.title },
          { key: 'URL', value: bookmark.url },
          { key: '用户名', value: bookmark.username || '(无)' },
          { key: '密码', value: format.formatPassword(bookmark.password) },
          { key: '分类', value: categoryName },
          { key: '图标', value: bookmark.icon || '(无)' },
          { key: '备注', value: format.truncate(bookmark.notes, 100) || '(无)' },
          { key: '属性', value: format.formatAttributes(bookmark.attributes) || '(无)' },
          { key: '使用次数', value: String(bookmark.use_count) },
          { key: '创建时间', value: format.formatTimestamp(bookmark.created_at_num) },
          { key: '更新时间', value: format.formatTimestamp(bookmark.updated_at_num) },
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

  bookmarks
    .command('add')
    .description('添加书签')
    .requiredOption('-t, --title <title>', '书签标题')
    .requiredOption('-u, --url <url>', '书签 URL')
    .option('-c, --cat <categoryId>', '分类 ID', 'uncategorized')
    .option('-p, --parent <parentId>', '父书签 ID（创建子书签）')
    .option('-n, --notes <notes>', '备注')
    .option('--icon <icon>', '图标')
    .option('--username <username>', '用户名')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: {
      title: string
      url: string
      cat: string
      parent?: string
      notes?: string
      icon?: string
      username?: string
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

        // 如果指定了父书签，验证父书签存在且属于当前用户
        if (opts.parent) {
          const { data: parentBm, error: parentError } = await supabase
            .from('bookmarks')
            .select('id, category_id')
            .eq('id', opts.parent)
            .eq('user_id', user.id)
            .single()

          if (parentError || !parentBm) {
            format.error(`父书签不存在: ${opts.parent}`)
            process.exit(1)
          }

          // 继承父书签的分类
          if (opts.cat === 'uncategorized') {
            opts.cat = (parentBm as { category_id: string }).category_id
          }
        }

        const row = {
          id,
          user_id: user.id,
          title: opts.title,
          url: opts.url,
          category_id: opts.cat,
          notes: opts.notes || '',
          icon: opts.icon || '',
          username: opts.username || '',
          password: '""',
          parent_id: opts.parent || null,
          order: 0,
          use_count: 0,
          attributes: {},
          is_expanded: false,
          created_at_num: now,
          updated_at_num: now,
        }

        const { error } = await supabase
          .from('bookmarks')
          .insert(row)

        if (error) {
          format.error(`添加失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`书签已添加: ${id}`)

        // 显示添加的书签
        format.output(
          [{
            id: row.id,
            title: row.title,
            url: row.url,
            category: opts.cat,
          }],
          [
            { key: 'id', header: 'ID', width: 15 },
            { key: 'title', header: '标题', width: 30 },
            { key: 'url', header: 'URL', width: 40 },
            { key: 'category', header: '分类', width: 15 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  bookmarks
    .command('update <id>')
    .description('更新书签')
    .option('-t, --title <title>', '新标题')
    .option('-u, --url <url>', '新 URL')
    .option('-c, --cat <categoryId>', '新分类')
    .option('-n, --notes <notes>', '新备注')
    .option('--icon <icon>', '新图标')
    .option('--username <username>', '新用户名')
    .action(async (id: string, opts: {
      title?: string
      url?: string
      cat?: string
      notes?: string
      icon?: string
      username?: string
    }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        // 构建更新对象
        const updates: Record<string, unknown> = { updated_at_num: Date.now() }
        if (opts.title !== undefined) updates.title = opts.title
        if (opts.url !== undefined) updates.url = opts.url
        if (opts.cat !== undefined) updates.category_id = opts.cat
        if (opts.notes !== undefined) updates.notes = opts.notes
        if (opts.icon !== undefined) updates.icon = opts.icon
        if (opts.username !== undefined) updates.username = opts.username

        const { error } = await supabase
          .from('bookmarks')
          .update(updates)
          .eq('id', id)
          .eq('user_id', user.id)

        if (error) {
          format.error(`更新失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`书签已更新: ${id}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  bookmarks
    .command('delete <id>')
    .description('删除书签（软删除）')
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
            .from('bookmarks')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id)

          if (error) {
            format.error(`删除失败: ${error.message}`)
            process.exit(1)
          }
          format.success(`书签已硬删除: ${id}`)
        } else {
          const { error } = await supabase
            .from('bookmarks')
            .update({ deleted_at: new Date().toISOString(), updated_at_num: Date.now() })
            .eq('id', id)
            .eq('user_id', user.id)

          if (error) {
            format.error(`删除失败: ${error.message}`)
            process.exit(1)
          }
          format.success(`书签已移至回收站: ${id}`)
        }
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  bookmarks
    .command('move <id>')
    .description('移动书签到新分类')
    .requiredOption('-c, --cat <categoryId>', '目标分类 ID')
    .action(async (id: string, opts: { cat: string }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()
        const { error } = await supabase
          .from('bookmarks')
          .update({ category_id: opts.cat, updated_at_num: Date.now() })
          .eq('id', id)
          .eq('user_id', user.id)

        if (error) {
          format.error(`移动失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`书签 ${id} 已移动到分类 ${opts.cat}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}
