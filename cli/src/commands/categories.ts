/**
 * categories 命令 - 分类管理
 */
import { Command } from 'commander'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { Category, OutputFormat } from '../types.js'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function registerCategoriesCommand(program: Command): void {
  const categories = program
    .command('categories')
    .description('分类管理')

  // ── 查询命令 ──

  categories
    .command('list')
    .description('列出所有分类')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { format: OutputFormat }) => {
      try {
        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
          .from('categories')
          .select('*')
          .is('deleted_at', null)
          .order('order', { ascending: true })

        if (error) {
          format.error(`查询失败: ${error.message}`)
          process.exit(1)
        }

        const categories = (data || []) as Category[]

        format.output(
          categories.map((c) => ({
            id: c.id,
            name: c.name,
            icon: c.icon || '',
            color: c.color || '',
            order: c.order,
          })),
          [
            { key: 'id', header: 'ID', width: 20 },
            { key: 'name', header: '名称', width: 20 },
            { key: 'icon', header: '图标', width: 10 },
            { key: 'color', header: '颜色', width: 10 },
            { key: 'order', header: '排序', width: 8 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  // ── 写操作命令 ──

  categories
    .command('create')
    .description('创建分类')
    .requiredOption('-n, --name <name>', '分类名称')
    .option('--icon <icon>', '图标')
    .option('--color <color>', '颜色')
    .option('--order <order>', '排序顺序', '0')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: {
      name: string
      icon?: string
      color?: string
      order: string
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

        const row = {
          id,
          user_id: user.id,
          name: opts.name,
          icon: opts.icon || '',
          color: opts.color || '',
          order: parseInt(opts.order, 10) || 0,
        }

        const { error } = await supabase
          .from('categories')
          .insert(row)

        if (error) {
          format.error(`创建失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`分类已创建: ${id}`)

        format.output(
          [{
            id: row.id,
            name: row.name,
            icon: row.icon,
            color: row.color,
            order: row.order,
          }],
          [
            { key: 'id', header: 'ID', width: 20 },
            { key: 'name', header: '名称', width: 20 },
            { key: 'icon', header: '图标', width: 10 },
            { key: 'color', header: '颜色', width: 10 },
            { key: 'order', header: '排序', width: 8 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  categories
    .command('update <id>')
    .description('更新分类')
    .option('-n, --name <name>', '新名称')
    .option('--icon <icon>', '新图标')
    .option('--color <color>', '新颜色')
    .option('--order <order>', '新排序顺序')
    .action(async (id: string, opts: {
      name?: string
      icon?: string
      color?: string
      order?: string
    }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (opts.name !== undefined) updates.name = opts.name
        if (opts.icon !== undefined) updates.icon = opts.icon
        if (opts.color !== undefined) updates.color = opts.color
        if (opts.order !== undefined) updates.order = parseInt(opts.order, 10) || 0

        const { error } = await supabase
          .from('categories')
          .update(updates)
          .eq('id', id)
          .eq('user_id', user.id)

        if (error) {
          format.error(`更新失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`分类已更新: ${id}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  categories
    .command('delete <id>')
    .description('删除分类（软删除）')
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
            .from('categories')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id)

          if (error) {
            format.error(`删除失败: ${error.message}`)
            process.exit(1)
          }
          format.success(`分类已硬删除: ${id}`)
        } else {
          const { error } = await supabase
            .from('categories')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', user.id)

          if (error) {
            format.error(`删除失败: ${error.message}`)
            process.exit(1)
          }
          format.success(`分类已移至回收站: ${id}`)
        }
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}
