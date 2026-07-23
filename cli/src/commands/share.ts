/**
 * share 命令 - 分享管理
 */
import { Command } from 'commander'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { SiblingGroup, OutputFormat } from '../types.js'

export function registerShareCommand(program: Command): void {
  const share = program
    .command('share')
    .description('分享管理')

  share
    .command('list')
    .description('列出已分享的组')
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
          .from('sibling_groups')
          .select('*')
          .eq('user_id', user.id)
          .eq('is_public', true)
          .is('deleted_at', null)

        if (error) {
          format.error(`查询失败: ${error.message}`)
          process.exit(1)
        }

        const groups = (data || []) as SiblingGroup[]

        if (groups.length === 0) {
          format.warn('暂无已分享的组')
          return
        }

        // 获取分类名称
        const { data: categories } = await supabase
          .from('categories')
          .select('id, name')
          .eq('user_id', user.id)

        const categoryMap = new Map<string, string>(
          (categories || []).map((c: { id: string; name: string }) => [c.id, c.name])
        )

        format.output(
          groups.map((g) => ({
            id: g.id,
            name: format.truncate(g.name, 25),
            category: categoryMap.get(g.category_id) || g.category_id,
            bookmarks: Array.isArray(g.bookmark_ids) ? g.bookmark_ids.length : 0,
            url: `/share/${g.id}`,
          })),
          [
            { key: 'id', header: 'ID', width: 15 },
            { key: 'name', header: '名称', width: 25 },
            { key: 'category', header: '分类', width: 15 },
            { key: 'bookmarks', header: '书签数', width: 10 },
            { key: 'url', header: '分享链接', width: 50 },
          ],
          opts.format
        )
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  share
    .command('enable <groupId>')
    .description('启用组分享')
    .action(async (groupId: string) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        const { data: group, error: fetchError } = await supabase
          .from('sibling_groups')
          .select('name, is_public')
          .eq('id', groupId)
          .eq('user_id', user.id)
          .single()

        if (fetchError || !group) {
          format.error(`组不存在: ${groupId}`)
          process.exit(1)
        }

        if ((group as { is_public: boolean }).is_public) {
          format.warn(`组 ${(group as { name: string }).name} 已经是公开的`)
          return
        }

        const { error } = await supabase
          .from('sibling_groups')
          .update({ is_public: true, updated_at_num: Date.now() })
          .eq('id', groupId)
          .eq('user_id', user.id)

        if (error) {
          format.error(`启用分享失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`已启用分享: ${(group as { name: string }).name}`)
        format.info(`分享链接: /share/${groupId}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  share
    .command('disable <groupId>')
    .description('禁用组分享')
    .action(async (groupId: string) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = await getSupabaseClient()

        const { data: group, error: fetchError } = await supabase
          .from('sibling_groups')
          .select('name, is_public')
          .eq('id', groupId)
          .eq('user_id', user.id)
          .single()

        if (fetchError || !group) {
          format.error(`组不存在: ${groupId}`)
          process.exit(1)
        }

        if (!(group as { is_public: boolean }).is_public) {
          format.warn(`组 ${(group as { name: string }).name} 未公开`)
          return
        }

        const { error } = await supabase
          .from('sibling_groups')
          .update({ is_public: false, updated_at_num: Date.now() })
          .eq('id', groupId)
          .eq('user_id', user.id)

        if (error) {
          format.error(`禁用分享失败: ${error.message}`)
          process.exit(1)
        }

        format.success(`已禁用分享: ${(group as { name: string }).name}`)
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}
