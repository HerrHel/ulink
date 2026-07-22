/**
 * search 命令 - 搜索书签/组
 */
import { Command } from 'commander'
import { getSupabaseClient } from '../lib/supabase.js'
import * as format from '../lib/format.js'
import type { Bookmark, SiblingGroup, OutputFormat } from '../types.js'

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('搜索书签和组')
    .option('-l, --limit <n>', '每个类型限制数量', '20')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (query: string, opts: { limit: string; format: OutputFormat }) => {
      try {
        const supabase = getSupabaseClient()
        const limit = parseInt(opts.limit, 10) || 20
        const searchTerm = `%${query}%`

        // 搜索书签
        const { data: bookmarksData, error: bookmarksError } = await supabase
          .from('bookmarks')
          .select('*')
          .is('deleted_at', null)
          .or(`title.ilike.${searchTerm},url.ilike.${searchTerm},notes.ilike.${searchTerm}`)
          .order('use_count', { ascending: false })
          .limit(limit)

        if (bookmarksError) {
          format.error(`搜索书签失败: ${bookmarksError.message}`)
          process.exit(1)
        }

        // 搜索组
        const { data: groupsData, error: groupsError } = await supabase
          .from('sibling_groups')
          .select('*')
          .is('deleted_at', null)
          .or(`name.ilike.${searchTerm},notes.ilike.${searchTerm}`)
          .order('use_count', { ascending: false })
          .limit(limit)

        if (groupsError) {
          format.error(`搜索组失败: ${groupsError.message}`)
          process.exit(1)
        }

        const bookmarks = (bookmarksData || []) as Bookmark[]
        const groups = (groupsData || []) as SiblingGroup[]

        // 获取分类名称映射
        const { data: categories } = await supabase
          .from('categories')
          .select('id, name')

        const categoryMap = new Map<string, string>(
          (categories || []).map((c: { id: string; name: string }) => [c.id, c.name])
        )

        if (opts.format === 'json') {
          console.log(JSON.stringify({
            query,
            bookmarks: bookmarks.map((b) => ({
              id: b.id,
              title: b.title,
              url: b.url,
              category: categoryMap.get(b.category_id) || b.category_id,
            })),
            groups: groups.map((g) => ({
              id: g.id,
              name: g.name,
              category: categoryMap.get(g.category_id) || g.category_id,
            })),
          }, null, 2))
          return
        }

        // 表格输出
        if (bookmarks.length === 0 && groups.length === 0) {
          format.warn(`未找到与 "${query}" 相关的结果`)
          return
        }

        if (bookmarks.length > 0) {
          console.log(format.truncate(`\n📚 书签 (${bookmarks.length})`, 50))
          format.output(
            bookmarks.map((b) => ({
              id: b.id,
              title: format.truncate(b.title, 30),
              url: format.truncate(b.url, 40),
              category: categoryMap.get(b.category_id) || b.category_id,
            })),
            [
              { key: 'id', header: 'ID', width: 15 },
              { key: 'title', header: '标题', width: 30 },
              { key: 'url', header: 'URL', width: 40 },
              { key: 'category', header: '分类', width: 15 },
            ],
            'table'
          )
        }

        if (groups.length > 0) {
          console.log(format.truncate(`\n📁 组 (${groups.length})`, 50))
          format.output(
            groups.map((g) => ({
              id: g.id,
              name: format.truncate(g.name, 25),
              category: categoryMap.get(g.category_id) || g.category_id,
              bookmarks: Array.isArray(g.bookmark_ids) ? g.bookmark_ids.length : 0,
            })),
            [
              { key: 'id', header: 'ID', width: 15 },
              { key: 'name', header: '名称', width: 25 },
              { key: 'category', header: '分类', width: 15 },
              { key: 'bookmarks', header: '书签数', width: 10 },
            ],
            'table'
          )
        }
      } catch (err) {
        format.error(`请求失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}
