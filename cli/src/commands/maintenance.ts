/**
 * maintenance 命令 - 维护与诊断
 */
import { Command } from 'commander'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { Bookmark, SiblingGroup, OutputFormat } from '../types.js'

export function registerMaintenanceCommand(program: Command): void {
  const maintenance = program
    .command('maintenance')
    .description('维护与诊断')

  // ── 死链检测 ──

  maintenance
    .command('check-links')
    .description('检测死链')
    .option('--fix', '自动删除死链书签')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { fix?: boolean; format: OutputFormat }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = getSupabaseClient()
        format.info('正在检测链接...')

        const { data: bookmarks, error } = await supabase
          .from('bookmarks')
          .select('id, title, url')
          .eq('user_id', user.id)
          .is('deleted_at', null)

        if (error) throw error

        const results: Array<{ id: string; title: string; url: string; status: string }> = []
        const deadLinks: string[] = []

        // 逐个检测链接
        for (const bm of (bookmarks || []) as Array<{ id: string; title: string; url: string }>) {
          if (!bm.url) {
            results.push({ ...bm, status: '无 URL' })
            continue
          }

          try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 10000)

            const response = await fetch(bm.url, {
              method: 'HEAD',
              signal: controller.signal,
              headers: { 'User-Agent': 'LinkVault-CLI/1.0' },
            })

            clearTimeout(timeout)

            if (response.ok) {
              results.push({ ...bm, status: '✓' })
            } else {
              results.push({ ...bm, status: `${response.status}` })
              deadLinks.push(bm.id)
            }
          } catch {
            results.push({ ...bm, status: '无法访问' })
            deadLinks.push(bm.id)
          }
        }

        // 输出结果
        const deadCount = deadLinks.length
        const total = results.length

        format.output(
          results.filter((r) => r.status !== '✓'),
          [
            { key: 'id', header: 'ID', width: 15 },
            { key: 'title', header: '标题', width: 30 },
            { key: 'url', header: 'URL', width: 40 },
            { key: 'status', header: '状态', width: 12 },
          ],
          opts.format
        )

        format.info(`检测完成: ${total - deadCount}/${total} 个链接正常`)

        // 如果有 --fix 选项，删除死链
        if (opts.fix && deadLinks.length > 0) {
          format.info(`正在删除 ${deadLinks.length} 个死链...`)

          for (const id of deadLinks) {
            await supabase
              .from('bookmarks')
              .update({ deleted_at: new Date().toISOString() })
              .eq('id', id)
              .eq('user_id', user.id)
          }

          format.success(`已删除 ${deadLinks.length} 个死链书签`)
        } else if (deadLinks.length > 0) {
          format.warn(`使用 --fix 选项自动删除死链`)
        }
      } catch (err) {
        format.error(`检测失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  // ── 数据校验 ──

  maintenance
    .command('validate')
    .description('校验数据完整性')
    .option('--fix', '自动修复问题')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { fix?: boolean; format: OutputFormat }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = getSupabaseClient()
        format.info('正在校验数据...')

        const issues: Array<{ type: string; id: string; issue: string; fixed: boolean }> = []

        // 获取所有数据
        const [bookmarksRes, groupsRes, categoriesRes] = await Promise.all([
          supabase.from('bookmarks').select('*').eq('user_id', user.id),
          supabase.from('sibling_groups').select('*').eq('user_id', user.id),
          supabase.from('categories').select('*').eq('user_id', user.id),
        ])

        const bookmarks = (bookmarksRes.data || []) as Bookmark[]
        const groups = (groupsRes.data || []) as SiblingGroup[]
        const categories = categoriesRes.data || []

        const categoryIds = new Set(categories.map((c: { id: string }) => c.id))
        const bookmarkIds = new Set(bookmarks.map((b) => b.id))

        // 检查书签的分类引用
        for (const bm of bookmarks) {
          if (bm.category_id && !categoryIds.has(bm.category_id)) {
            issues.push({
              type: '书签',
              id: bm.id,
              issue: `分类 ${bm.category_id} 不存在`,
              fixed: false,
            })

            if (opts.fix) {
              await supabase
                .from('bookmarks')
                .update({ category_id: 'uncategorized' })
                .eq('id', bm.id)
                .eq('user_id', user.id)
              issues[issues.length - 1].fixed = true
            }
          }

          if (!bm.title && !bm.url) {
            issues.push({
              type: '书签',
              id: bm.id,
              issue: '标题和 URL 均为空',
              fixed: false,
            })
          }
        }

        // 检查组的书签引用
        for (const group of groups) {
          if (group.bookmark_ids && Array.isArray(group.bookmark_ids)) {
            for (const bmId of group.bookmark_ids) {
              if (!bookmarkIds.has(bmId)) {
                issues.push({
                  type: '组',
                  id: group.id,
                  issue: `引用的书签 ${bmId} 不存在`,
                  fixed: false,
                })

                if (opts.fix) {
                  const newIds = group.bookmark_ids.filter((id: string) => id !== bmId)
                  await supabase
                    .from('sibling_groups')
                    .update({ bookmark_ids: newIds })
                    .eq('id', group.id)
                    .eq('user_id', user.id)
                  issues[issues.length - 1].fixed = true
                }
              }
            }
          }
        }

        // 输出结果
        if (issues.length === 0) {
          format.success('数据校验通过，未发现问题')
        } else {
          format.output(
            issues,
            [
              { key: 'type', header: '类型', width: 10 },
              { key: 'id', header: 'ID', width: 15 },
              { key: 'issue', header: '问题', width: 40 },
              { key: 'fixed', header: '已修复', width: 10 },
            ],
            opts.format
          )

          const fixedCount = issues.filter((i) => i.fixed).length
          if (opts.fix) {
            format.success(`已修复 ${fixedCount}/${issues.length} 个问题`)
          } else {
            format.warn(`发现 ${issues.length} 个问题，使用 --fix 选项自动修复`)
          }
        }
      } catch (err) {
        format.error(`校验失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  // ── 统计信息 ──

  maintenance
    .command('stats')
    .description('显示统计信息')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { format: OutputFormat }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = getSupabaseClient()

        // 并行获取统计
        const [
          bookmarksTotal,
          bookmarksDeleted,
          groupsTotal,
          groupsDeleted,
          categoriesTotal,
          topBookmarks,
          topCategories,
        ] = await Promise.all([
          supabase.from('bookmarks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('deleted_at', null),
          supabase.from('bookmarks').select('id', { count: 'exact', head: true }).eq('user_id', user.id).not('deleted_at', 'is', null),
          supabase.from('sibling_groups').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('deleted_at', null),
          supabase.from('sibling_groups').select('id', { count: 'exact', head: true }).eq('user_id', user.id).not('deleted_at', 'is', null),
          supabase.from('categories').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('deleted_at', null),
          supabase.from('bookmarks').select('title, use_count').eq('user_id', user.id).is('deleted_at', null).order('use_count', { ascending: false }).limit(5),
          supabase.from('bookmarks').select('category_id', { count: 'exact' }).eq('user_id', user.id).is('deleted_at', null),
        ])

        // 按分类统计
        const categoryCount: Record<string, number> = {}
        for (const bm of (topCategories.data || []) as Array<{ category_id: string }>) {
          categoryCount[bm.category_id] = (categoryCount[bm.category_id] || 0) + 1
        }

        const stats = [
          { label: '书签总数', value: String(bookmarksTotal.count || 0) },
          { label: '已删除书签', value: String(bookmarksDeleted.count || 0) },
          { label: '组总数', value: String(groupsTotal.count || 0) },
          { label: '已删除组', value: String(groupsDeleted.count || 0) },
          { label: '分类数', value: String(categoriesTotal.count || 0) },
        ]

        format.output(
          stats,
          [
            { key: 'label', header: '指标', width: 20 },
            { key: 'value', header: '值', width: 15 },
          ],
          opts.format
        )

        // 显示最常用书签
        if (topBookmarks.data && topBookmarks.data.length > 0) {
          console.log('\n📚 最常用书签:')
          format.output(
            (topBookmarks.data as Array<{ title: string; use_count: number }>).map((bm, i) => ({
              rank: i + 1,
              title: format.truncate(bm.title, 30),
              useCount: bm.use_count,
            })),
            [
              { key: 'rank', header: '#', width: 5 },
              { key: 'title', header: '标题', width: 30 },
              { key: 'useCount', header: '使用次数', width: 10 },
            ],
            opts.format
          )
        }
      } catch (err) {
        format.error(`获取统计失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  // ── 存储信息 ──

  maintenance
    .command('storage')
    .description('显示存储信息')
    .option('-f, --format <format>', '输出格式 (table|json)', 'table')
    .action(async (opts: { format: OutputFormat }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = getSupabaseClient()
        format.info('正在计算存储...')

        // 获取所有数据
        const [bookmarksRes, groupsRes, categoriesRes] = await Promise.all([
          supabase.from('bookmarks').select('*').eq('user_id', user.id),
          supabase.from('sibling_groups').select('*').eq('user_id', user.id),
          supabase.from('categories').select('*').eq('user_id', user.id),
        ])

        const bookmarks = bookmarksRes.data || []
        const groups = groupsRes.data || []
        const categories = categoriesRes.data || []

        // 估算大小
        const bookmarksSize = JSON.stringify(bookmarks).length
        const groupsSize = JSON.stringify(groups).length
        const categoriesSize = JSON.stringify(categories).length
        const totalSize = bookmarksSize + groupsSize + categoriesSize

        const formatSize = (bytes: number) => {
          if (bytes < 1024) return `${bytes} B`
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
          return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        }

        const storage = [
          { type: '书签', count: bookmarks.length, size: formatSize(bookmarksSize) },
          { type: '组', count: groups.length, size: formatSize(groupsSize) },
          { type: '分类', count: categories.length, size: formatSize(categoriesSize) },
          { type: '总计', count: bookmarks.length + groups.length + categories.length, size: formatSize(totalSize) },
        ]

        format.output(
          storage,
          [
            { key: 'type', header: '类型', width: 15 },
            { key: 'count', header: '数量', width: 10 },
            { key: 'size', header: '大小', width: 15 },
          ],
          opts.format
        )

        // Supabase 免费额度提示
        const FREE_LIMIT_MB = 500
        const usagePercent = ((totalSize / (FREE_LIMIT_MB * 1024 * 1024)) * 100).toFixed(2)
        format.info(`Supabase 免费额度使用: ${usagePercent}% (${formatSize(totalSize)} / ${FREE_LIMIT_MB} MB)`)
      } catch (err) {
        format.error(`获取存储信息失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}
