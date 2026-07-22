/**
 * import/export 命令 - 数据导入导出
 */
import { Command } from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import { getSupabaseClient } from '../lib/supabase.js'
import { getCurrentUser } from '../lib/auth.js'
import * as format from '../lib/format.js'
import type { Bookmark, SiblingGroup, Category } from '../types.js'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export function registerImportExportCommand(program: Command): void {
  // ── 导出命令 ──

  const exportCmd = program
    .command('export')
    .description('导出数据')

  exportCmd
    .command('json')
    .description('导出为 JSON 格式')
    .option('-o, --output <file>', '输出文件路径', 'linkvault-export.json')
    .action(async (opts: { output: string }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = getSupabaseClient()
        format.info('正在导出数据...')

        // 并行获取所有数据
        const [bookmarksRes, groupsRes, categoriesRes] = await Promise.all([
          supabase.from('bookmarks').select('*').eq('user_id', user.id).is('deleted_at', null),
          supabase.from('sibling_groups').select('*').eq('user_id', user.id).is('deleted_at', null),
          supabase.from('categories').select('*').eq('user_id', user.id).is('deleted_at', null),
        ])

        if (bookmarksRes.error) throw bookmarksRes.error
        if (groupsRes.error) throw groupsRes.error
        if (categoriesRes.error) throw categoriesRes.error

        const data = {
          version: '1.0.0',
          exportedAt: new Date().toISOString(),
          bookmarks: bookmarksRes.data || [],
          siblingGroups: groupsRes.data || [],
          categories: categoriesRes.data || [],
        }

        const outputPath = path.resolve(opts.output)
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')

        format.success(`数据已导出到: ${outputPath}`)
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
        format.error(`导出失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  exportCmd
    .command('csv')
    .description('导出书签为 CSV 格式')
    .option('-o, --output <file>', '输出文件路径', 'linkvault-bookmarks.csv')
    .action(async (opts: { output: string }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const supabase = getSupabaseClient()
        format.info('正在导出书签...')

        const { data: bookmarks, error } = await supabase
          .from('bookmarks')
          .select('*')
          .eq('user_id', user.id)
          .is('deleted_at', null)

        if (error) throw error

        // 获取分类名称
        const { data: categories } = await supabase
          .from('categories')
          .select('id, name')
          .eq('user_id', user.id)

        const categoryMap = new Map<string, string>(
          (categories || []).map((c: { id: string; name: string }) => [c.id, c.name])
        )

        // CSV 表头
        const headers = ['id', 'title', 'url', 'category', 'username', 'notes', 'use_count']
        const csvRows = [headers.join(',')]

        for (const b of (bookmarks || []) as Bookmark[]) {
          const row = [
            escapeCsv(b.id),
            escapeCsv(b.title),
            escapeCsv(b.url),
            escapeCsv(categoryMap.get(b.category_id) || b.category_id),
            escapeCsv(b.username || ''),
            escapeCsv(b.notes || ''),
            String(b.use_count),
          ]
          csvRows.push(row.join(','))
        }

        const outputPath = path.resolve(opts.output)
        fs.writeFileSync(outputPath, csvRows.join('\n'), 'utf-8')

        format.success(`书签已导出到: ${outputPath}`)
        console.log(format.truncate(`共 ${(bookmarks || []).length} 条书签`, 50))
      } catch (err) {
        format.error(`导出失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  // ── 导入命令 ──

  const importCmd = program
    .command('import')
    .description('导入数据')

  importCmd
    .command('json')
    .description('从 JSON 文件导入')
    .argument('<file>', 'JSON 文件路径')
    .option('--skip-dupes', '跳过重复书签（基于 title+url）', true)
    .action(async (file: string, opts: { skipDupes: boolean }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const filePath = path.resolve(file)
        if (!fs.existsSync(filePath)) {
          format.error(`文件不存在: ${filePath}`)
          process.exit(1)
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(content)

        if (!data.bookmarks && !data.siblingGroups && !data.categories) {
          format.error('无效的 JSON 格式：缺少 bookmarks/siblingGroups/categories 字段')
          process.exit(1)
        }

        const supabase = getSupabaseClient()
        format.info('正在导入数据...')

        // 获取现有数据（用于去重）
        const { data: existingBookmarks } = await supabase
          .from('bookmarks')
          .select('title, url')
          .eq('user_id', user.id)

        const existingSet = new Set(
          (existingBookmarks || []).map((b: { title: string; url: string }) =>
            `${b.title}|||${b.url}`
          )
        )

        const now = Date.now()
        let importedBookmarks = 0
        let skippedBookmarks = 0
        let importedGroups = 0
        let importedCategories = 0

        // 导入分类
        if (data.categories && Array.isArray(data.categories)) {
          for (const cat of data.categories) {
            const { error } = await supabase
              .from('categories')
              .upsert({
                id: cat.id || generateId(),
                user_id: user.id,
                name: cat.name,
                icon: cat.icon || '',
                color: cat.color || '',
                order: cat.order || 0,
              }, { onConflict: 'id' })

            if (!error) importedCategories++
          }
        }

        // 导入书签
        if (data.bookmarks && Array.isArray(data.bookmarks)) {
          for (const bm of data.bookmarks) {
            const key = `${bm.title}|||${bm.url}`
            if (opts.skipDupes && existingSet.has(key)) {
              skippedBookmarks++
              continue
            }

            const { error } = await supabase
              .from('bookmarks')
              .upsert({
                id: bm.id || generateId(),
                user_id: user.id,
                title: bm.title || '',
                url: bm.url || '',
                category_id: bm.category_id || 'uncategorized',
                username: bm.username || '',
                password: bm.password || '""',
                notes: bm.notes || '',
                icon: bm.icon || '',
                parent_id: bm.parent_id || null,
                order: bm.order || 0,
                use_count: bm.use_count || 0,
                attributes: bm.attributes || {},
                is_expanded: bm.is_expanded || false,
                created_at_num: bm.created_at_num || now,
                updated_at_num: bm.updated_at_num || now,
              }, { onConflict: 'id' })

            if (!error) importedBookmarks++
          }
        }

        // 导入组
        if (data.siblingGroups && Array.isArray(data.siblingGroups)) {
          for (const group of data.siblingGroups) {
            const { error } = await supabase
              .from('sibling_groups')
              .upsert({
                id: group.id || generateId(),
                user_id: user.id,
                name: group.name || '',
                category_id: group.category_id || 'uncategorized',
                icon: group.icon || '',
                notes: group.notes || '',
                is_public: group.is_public || false,
                order: group.order || 0,
                is_expanded: group.is_expanded || false,
                attributes: group.attributes || {},
                bookmark_ids: group.bookmark_ids || [],
                use_count: group.use_count || 0,
                updated_at_num: group.updated_at_num || now,
              }, { onConflict: 'id' })

            if (!error) importedGroups++
          }
        }

        format.success('导入完成！')
        format.output(
          [
            { type: '书签', imported: importedBookmarks, skipped: skippedBookmarks },
            { type: '组', imported: importedGroups, skipped: 0 },
            { type: '分类', imported: importedCategories, skipped: 0 },
          ],
          [
            { key: 'type', header: '类型', width: 15 },
            { key: 'imported', header: '已导入', width: 10 },
            { key: 'skipped', header: '跳过', width: 10 },
          ],
          'table'
        )
      } catch (err) {
        format.error(`导入失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })

  importCmd
    .command('csv')
    .description('从 CSV 文件导入书签')
    .argument('<file>', 'CSV 文件路径')
    .option('-c, --cat <categoryId>', '默认分类', 'uncategorized')
    .action(async (file: string, opts: { cat: string }) => {
      try {
        const user = await getCurrentUser()
        if (!user) {
          format.error('请先登录: linkvault auth login <email>')
          process.exit(1)
        }

        const filePath = path.resolve(file)
        if (!fs.existsSync(filePath)) {
          format.error(`文件不存在: ${filePath}`)
          process.exit(1)
        }

        const content = fs.readFileSync(filePath, 'utf-8')
        const lines = content.split('\n').filter((line) => line.trim())

        if (lines.length < 2) {
          format.error('CSV 文件为空或缺少数据行')
          process.exit(1)
        }

        const supabase = getSupabaseClient()
        format.info('正在导入书签...')

        const now = Date.now()
        let imported = 0
        let errors = 0

        // 跳过表头
        for (let i = 1; i < lines.length; i++) {
          const fields = parseCsvLine(lines[i])
          if (fields.length < 3) {
            errors++
            continue
          }

          const [title, url, category, username, notes] = fields

          const { error } = await supabase
            .from('bookmarks')
            .insert({
              id: generateId(),
              user_id: user.id,
              title: title || '',
              url: url || '',
              category_id: category || opts.cat,
              username: username || '',
              password: '""',
              notes: notes || '',
              icon: '',
              parent_id: null,
              order: 0,
              use_count: 0,
              attributes: {},
              is_expanded: false,
              created_at_num: now,
              updated_at_num: now,
            })

          if (error) {
            errors++
          } else {
            imported++
          }
        }

        format.success(`导入完成！已导入 ${imported} 条书签`)
        if (errors > 0) {
          format.warn(`${errors} 条记录导入失败`)
        }
      } catch (err) {
        format.error(`导入失败: ${(err as Error).message}`)
        process.exit(1)
      }
    })
}

/** 转义 CSV 字段 */
function escapeCsv(field: string): string {
  if (!field) return ''
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

/** 解析 CSV 行 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        fields.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }

  fields.push(current.trim())
  return fields
}
