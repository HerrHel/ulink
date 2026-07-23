/**
 * tags 命令 - 属性标签管理
 */
import { Command } from 'commander'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { CustomAttribute, Bookmark, OutputFormat } from '../types.js'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function registerTagsCommand(program: Command): void {
  const tags = program
    .command('tags')
    .description('属性标签管理')

  tags
    .command('list')
    .description('列出所有标签')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { format: OutputFormat }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()
        const { data, error } = await supabase
          .from('custom_attributes')
          .select('*')
          .eq('user_id', user.id)
          .is('deleted_at', null)

        if (error) {
          format.error(`查询失败: ${error.message}`)
          process.exit(1)
        }

        const attrs = (data || []) as CustomAttribute[]

        // 统计每个标签的使用次数
        const { data: bookmarks } = await supabase
          .from('bookmarks')
          .select('attributes')
          .eq('user_id', user.id)
          .is('deleted_at', null)

        const usageCount: Record<string, number> = {}
        for (const bm of (bookmarks || []) as Array<{ attributes: Record<string, boolean> }>) {
          if (bm.attributes && typeof bm.attributes === 'object') {
            for (const [key, val] of Object.entries(bm.attributes)) {
              if (val) usageCount[key] = (usageCount[key] || 0) + 1
            }
          }
        }

        format.output(
          attrs.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            usedBy: usageCount[a.name] || 0,
          })),
          [
            { key: 'id', header: 'ID', width: 15 },
            { key: 'name', header: '名称', width: 20 },
            { key: 'type', header: '类型', width: 10 },
            { key: 'usedBy', header: '使用数', width: 10 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  tags
    .command('create')
    .description('创建标签')
    .requiredOption('-n, --name <name>', '标签名称')
    .action(async (opts: { name: string }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        // 检查是否已存在
        const { data: existing } = await supabase
          .from('custom_attributes')
          .select('id')
          .eq('user_id', user.id)
          .eq('name', opts.name)
          .is('deleted_at', null)

        if (existing && existing.length > 0) {
          format.error(`标签已存在: ${opts.name}`)
          process.exit(1)
        }

        const id = generateId()
        const { error } = await supabase
          .from('custom_attributes')
          .insert({
            id,
            user_id: user.id,
            name: opts.name,
            type: 'boolean',
          })

        if (error) {
          format.error(`创建失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`标签已创建: ${opts.name} (${id})`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  tags
    .command('delete <id>')
    .description('删除标签')
    .option('--hard', '硬删除')
    .action(async (id: string, opts: { hard?: boolean }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        // 获取标签名称
        const { data: attr } = await supabase
          .from('custom_attributes')
          .select('name')
          .eq('id', id)
          .eq('user_id', user.id)
          .single()

        if (!attr) {
          format.error(`标签不存在: ${id}`)
          process.exit(1)
        }

        if (opts.hard) {
          const { error } = await supabase
            .from('custom_attributes')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id)

          if (error) {
            format.error(`删除失败: ${error.message}`)
            process.exit(1)
          }
        } else {
          const { error } = await supabase
            .from('custom_attributes')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', user.id)

          if (error) {
            format.error(`删除失败: ${error.message}`)
            process.exit(1)
          }
        }

        format.success(`标签已删除: ${(attr as { name: string }).name}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  tags
    .command('assign <bookmarkId> <tagName>')
    .description('给书签添加标签')
    .action(async (bookmarkId: string, tagName: string) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        // 获取书签当前属性
        const { data: bookmark, error: fetchError } = await supabase
          .from('bookmarks')
          .select('attributes')
          .eq('id', bookmarkId)
          .eq('user_id', user.id)
          .single()

        if (fetchError || !bookmark) {
          format.error(`书签不存在: ${bookmarkId}`)
          process.exit(1)
        }

        const attrs = (bookmark as { attributes: Record<string, boolean> }).attributes || {}
        attrs[tagName] = true

        const { error } = await supabase
          .from('bookmarks')
          .update({ attributes: attrs, updated_at_num: Date.now() })
          .eq('id', bookmarkId)
          .eq('user_id', user.id)

        if (error) {
          format.error(`添加标签失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`已给书签 ${bookmarkId} 添加标签: ${tagName}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  tags
    .command('unassign <bookmarkId> <tagName>')
    .description('移除书签的标签')
    .action(async (bookmarkId: string, tagName: string) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        const { data: bookmark, error: fetchError } = await supabase
          .from('bookmarks')
          .select('attributes')
          .eq('id', bookmarkId)
          .eq('user_id', user.id)
          .single()

        if (fetchError || !bookmark) {
          format.error(`书签不存在: ${bookmarkId}`)
          process.exit(1)
        }

        const attrs = (bookmark as { attributes: Record<string, boolean> }).attributes || {}
        delete attrs[tagName]

        const { error } = await supabase
          .from('bookmarks')
          .update({ attributes: attrs, updated_at_num: Date.now() })
          .eq('id', bookmarkId)
          .eq('user_id', user.id)

        if (error) {
          format.error(`移除标签失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`已移除书签 ${bookmarkId} 的标签: ${tagName}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}
