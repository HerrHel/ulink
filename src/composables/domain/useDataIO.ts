/**
 * useDataIO — 数据导入导出
 * 从 store actions 提取。分享与 Fork 见 useDataShare.ts。
 *
 * A3: 支持多格式导入（LinkVault JSON、Chrome HTML、Raindrop JSON、CSV）
 */
import { useDataStore } from '../../stores/data.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import * as persist from '../../stores/persist.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import { downloadFile, dateStamp } from '../../lib/download.js'
import { esc as escHtml } from '../../utils.js'

import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { AppDataSchema, BookmarkSchema, SiblingGroupSchema, CategorySchema, CustomAttributeSchema } from '../../schemas.js'
import { clearSearchCache } from '../../lib/search.js'
import { DEFAULTS } from '../../config/constants.js'
import { runMigrations } from '../../stores/migrations.js'
import { clearAllSyncOps } from '../../stores/storage.js'
import { __testPendingSync } from './syncPending.js'
import { newBookmarkId } from '../../lib/newId.js'
import { cloneDeep } from '../../lib/clone.js'
import type { AppData, Bookmark } from '../../types.js'

// ── 导出 ──

/** 仅导出未软删的活书签，供通用格式（HTML/CSV/Raindrop）使用 */
function _liveBookmarks(ds: ReturnType<typeof useDataStore>): Bookmark[] {
  return ds.bookmarks.filter(b => !b.deletedAt && b.url)
}

/** attributes → 标签名数组（用属性 name，找不到则去掉 tag_ 前缀） */
function _attrsToTags(ds: ReturnType<typeof useDataStore>, b: Bookmark): string[] {
  const tags: string[] = []
  const attrMap = ds.attributeMap
  for (const [id, on] of Object.entries(b.attributes || {})) {
    if (!on) continue
    const attr = attrMap[id]
    tags.push(attr?.name || id.replace(/^tag_/, ''))
  }
  return tags
}

/** LinkVault 完整备份（含组/分类/属性/加密元数据），其他设备恢复用 */
export function exportData() {
  const ds = useDataStore()
  try {
    downloadFile('linkvault-backup-' + dateStamp() + '.json',
      JSON.stringify(ds._dataSnapshot(), null, 2), 'application/json')
    toast('数据已导出')
  } catch (e) { console.warn('[export] JSON export failed:', e); toast('导出失败', false) }
}

/** 导出为 Netscape Bookmark HTML，可导入 Chrome/Firefox/Edge。按分类组织目录。 */
export function exportHTML() {
  const ds = useDataStore()
  try {
    const live = _liveBookmarks(ds)
    const byCat = new Map<string, Bookmark[]>()
    for (const b of live) {
      const cid = b.categoryId || CAT_UNCATEGORIZED
      if (!byCat.has(cid)) byCat.set(cid, [])
      byCat.get(cid)!.push(b)
    }
    const catMap = ds.categoryMap
    const catName = (cid: string) => catMap[cid]?.name
      || (cid === CAT_UNCATEGORIZED ? '未分类' : '其他')

    // 复用 utils.esc（含 ' 转义），避免局部实现与属性注入防护漂移
    const esc = (s: string) => escHtml(s || '')
    const lines: string[] = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      '<TITLE>LinkVault 书签导出</TITLE>',
      '<H1>LinkVault 书签</H1>',
      '<DL><p>',
    ]
    for (const [cid, bms] of byCat) {
      lines.push(`    <DT><H3>${esc(catName(cid))}</H3>`)
      lines.push('    <DL><p>')
      for (const b of bms) {
        const tags = _attrsToTags(ds, b).join(',')
        const add = b.createdAt > 0 ? Math.floor(b.createdAt / 1000) : ''
        lines.push(`        <DT><A HREF="${esc(b.url)}" ADD_DATE="${add}"${b.icon ? ` ICON="${esc(b.icon)}"` : ''}${tags ? ` TAGS="${esc(tags)}"` : ''}>${esc(b.title || b.url)}</A>`)
        if (b.notes) lines.push(`        <DD>${esc(b.notes)}`)
      }
      lines.push('    </DL><p>')
    }
    lines.push('</DL><p>')
    downloadFile('linkvault-bookmarks-' + dateStamp() + '.html', lines.join('\n'), 'text/html')
    toast(`已导出 ${live.length} 个书签（HTML）`)
  } catch (e) { console.warn('[export] failed:', e); toast('导出失败', false) }
}

/** 导出为 CSV（title,url,tags,notes,category），表格工具可读。不含账户密码。 */
export function exportCSV() {
  const ds = useDataStore()
  try {
    const live = _liveBookmarks(ds)
    const esc = (s: string) => '"' + (s || '').replace(/"/g, '""') + '"'
    const rows = [['title', 'url', 'tags', 'notes', 'category', 'icon', 'created_at']]
    for (const b of live) {
      rows.push([
        esc(b.title || b.url),
        esc(b.url),
        esc(_attrsToTags(ds, b).join(',')),
        esc(b.notes || ''),
        esc(ds.categoryMap[b.categoryId]?.name || ''),
        esc(b.icon || ''),
        b.createdAt > 0 ? new Date(b.createdAt).toISOString() : '',
      ])
    }
    downloadFile('linkvault-bookmarks-' + dateStamp() + '.csv',
      rows.map(r => r.join(',')).join('\n'), 'text/csv')
    toast(`已导出 ${live.length} 个书签（CSV）`)
  } catch (e) { console.warn('[export] failed:', e); toast('导出失败', false) }
}

/** 导出为 Raindrop.io 兼容 JSON（{ items: [...] }），与导入对称。不含账户密码。 */
export function exportRaindrop() {
  const ds = useDataStore()
  try {
    const live = _liveBookmarks(ds)
    const items = live.map(b => ({
      title: b.title || b.url,
      link: b.url,
      excerpt: b.notes || '',
      cover: b.icon || '',
      tags: _attrsToTags(ds, b),
      created: b.createdAt > 0 ? new Date(b.createdAt).toISOString() : undefined,
      lastUpdate: b.updatedAt > 0 ? new Date(b.updatedAt).toISOString() : undefined,
    }))
    downloadFile('linkvault-raindrop-' + dateStamp() + '.json',
      JSON.stringify({ items }, null, 2), 'application/json')
    toast(`已导出 ${live.length} 个书签（Raindrop JSON）`)
  } catch (e) { console.warn('[export] failed:', e); toast('导出失败', false) }
}

// ── 多格式导入入口（A3）──

export function importData(file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const content = reader.result as string
    try {
      const fmt = detectFormat(file.name, content)
      if (fmt === 'json') {
        const data = JSON.parse(content)
        // 判断是 LinkVault 原生 JSON 还是 Raindrop.io JSON
        if (validateImportData(data) === null) {
          importFromDataInternal(data, 'LinkVault')
        } else if (data.items && Array.isArray(data.items)) {
          // Raindrop.io 格式：{ items: [...] }
          const bookmarks = parseRaindropJSON(data)
          if (!bookmarks.length) { toast('Raindrop JSON 格式不正确或为空', false); return }
          importFromDataInternal({ categories: [], bookmarks, customAttributes: [], siblingGroups: [] }, 'Raindrop.io')
        } else if (Array.isArray(data) && data[0]?.link) {
          // Raindrop.io 直接数组格式：[{ title, link, ... }]
          const bookmarks = parseRaindropJSON(data)
          if (!bookmarks.length) { toast('Raindrop JSON 格式不正确或为空', false); return }
          importFromDataInternal({ categories: [], bookmarks, customAttributes: [], siblingGroups: [] }, 'Raindrop.io')
        } else {
          toast('JSON 格式不识别，请确认是 LinkVault 或 Raindrop.io 导出文件', false)
        }
      } else if (fmt === 'html') {
        const bookmarks = parseBookmarkHTML(content)
        if (!bookmarks.length) { toast('未在 HTML 中找到书签', false); return }
        importFromDataInternal({ categories: [], bookmarks, customAttributes: [], siblingGroups: [] }, '浏览器书签')
      } else if (fmt === 'csv') {
        const bookmarks = parseCSV(content)
        if (!bookmarks.length) { toast('CSV 文件为空或格式不正确', false); return }
        importFromDataInternal({ categories: [], bookmarks, customAttributes: [], siblingGroups: [] }, 'CSV')
      } else {
        toast('不支持的文件格式', false)
      }
    } catch (e) { toast('导入失败：' + (e as Error).message, false) }
  }
  reader.readAsText(file)
}

function detectFormat(filename: string, content: string): 'json' | 'html' | 'csv' | null {
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'json') return 'json'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'csv') return 'csv'
  // 按内容推断
  const trimmed = content.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (trimmed.startsWith('<')) return 'html'
  return null
}

// ── 导入内部逻辑（合并模式，不覆盖已有数据）──

type DataStore = ReturnType<typeof useDataStore>
interface MergeStats { imported: number; skipped: number }

/** 合并分类（去重：同 ID 跳过；Zod 失败计入 skipped） */
function _mergeCategories(ds: DataStore, categories: AppData['categories']): MergeStats {
  let imported = 0, skipped = 0
  for (const c of categories) {
    if (!c.id || !c.name) continue
    if (ds.categories.some(existing => existing.id === c.id)) continue
    const parsed = CategorySchema.safeParse({ id: c.id, name: c.name, icon: c.icon || 'star', color: c.color || '', updatedAt: Date.now() })
    if (!parsed.success) { skipped++; continue }
    ds.addCategory(parsed.data)
    imported++
  }
  return { imported, skipped }
}

/** 合并属性（去重：同 ID 跳过） */
function _mergeAttributes(ds: DataStore, customAttributes: AppData['customAttributes']): MergeStats {
  let imported = 0, skipped = 0
  for (const a of customAttributes) {
    if (!a.id || !a.name) continue
    if (ds.customAttributes.some(existing => existing.id === a.id)) continue
    const parsed = CustomAttributeSchema.safeParse({ id: a.id, name: a.name, type: a.type || 'boolean', updatedAt: Date.now() })
    if (!parsed.success) { skipped++; continue }
    ds.addAttribute(parsed.data)
    imported++
  }
  return { imported, skipped }
}

/** 合并书签（去重：同 ID 或同 URL 跳过） */
function _mergeBookmarks(ds: DataStore, bookmarks: AppData['bookmarks']): MergeStats {
  let imported = 0, skipped = 0
  const existingUrls = new Set(ds.bookmarks.map(b => b.url?.toLowerCase()).filter(Boolean))
  // order 基线用现存最大 order+1（而非 bookmarks.length），避免永久删缩短后新值与现存项重复
  const orderBase = ds.nextBookmarkOrder()
  for (const b of bookmarks) {
    if (!b.title || !b.url) continue
    if (ds.bookmarks.some(existing => existing.id === b.id)) continue
    if (existingUrls.has(b.url.toLowerCase())) continue
    const now = Date.now()
    const parsed = BookmarkSchema.safeParse({
      id: b.id || newBookmarkId(imported),
      title: b.title,
      url: b.url,
      username: b.username || '',
      password: b.password || '',
      notes: b.notes || '',
      icon: b.icon || '',
      categoryId: b.categoryId || CAT_UNCATEGORIZED,
      parentId: b.parentId || null,
      order: orderBase + imported,
      useCount: b.useCount || 0,
      attributes: b.attributes || {},
      isExpanded: false,
      createdAt: b.createdAt || now,
      updatedAt: b.updatedAt || now,
    })
    if (!parsed.success) { skipped++; continue }
    ds.addBookmark(parsed.data)
    existingUrls.add(b.url.toLowerCase())
    imported++
  }
  return { imported, skipped }
}

/**
 * 合并组（去重：同 ID 跳过）。
 * bookmarkIds 过滤未存活书签：导入源 id 可能指向被去重/Zod 跳过/缺 title·url 的项，
 * 原样保留会让组引用悬空 id（bookmarkMap 查不到 → 组内空卡位，推云后远端同样悬空）。
 */
function _mergeGroups(ds: DataStore, siblingGroups: AppData['siblingGroups']): MergeStats {
  let imported = 0, skipped = 0
  for (const g of siblingGroups) {
    if (!g.id || !g.name) continue
    if (ds.siblingGroups.some(existing => existing.id === g.id)) continue
    const liveBookmarkIds = (g.bookmarkIds || []).filter(bid => ds.bookmarkMap[bid])
    const parsed = SiblingGroupSchema.safeParse({
      id: g.id, name: g.name,
      categoryId: g.categoryId || CAT_UNCATEGORIZED,
      icon: g.icon || '', order: g.order || 0,
      isExpanded: g.isExpanded || false,
      attributes: g.attributes || {},
      bookmarkIds: liveBookmarkIds,
      notes: g.notes || '', updatedAt: g.updatedAt || Date.now(),
      useCount: g.useCount || 0,
      isPublic: (g as { isPublic?: boolean }).isPublic || false,
    })
    if (!parsed.success) { skipped++; continue }
    ds.addGroup(parsed.data)
    imported++
  }
  return { imported, skipped }
}

// 导出供单测覆盖组 bookmarkIds 悬空过滤逻辑（仍以 _ 风格名为私有约定）
export function importFromDataInternal(data: Partial<AppData>, source: string) {
  const ds = useDataStore()

  // 执行数据迁移（处理旧版格式）
  const result = {
    categories: [...(data.categories || [])],
    bookmarks: [...(data.bookmarks || [])],
    customAttributes: [...(data.customAttributes || [])],
    siblingGroups: [...(data.siblingGroups || [])],
  }
  runMigrations(data, result)

  const { categories, bookmarks, customAttributes, siblingGroups } = result

  try { persist.saveToLocalStorage(ds._dataSnapshot()) } catch (e) { console.warn('[import] backup before import failed:', e) }

  // 顺序固定：先 cat/attr，再 bm，最后 group（group 依赖 bm 已入库做悬空过滤）
  const cats = _mergeCategories(ds, categories)
  const attrs = _mergeAttributes(ds, customAttributes)
  const bms = _mergeBookmarks(ds, bookmarks)
  const groups = _mergeGroups(ds, siblingGroups)

  saveAppData()
  clearSearchCache()
  const total = cats.imported + bms.imported + groups.imported + attrs.imported
  const skipped = cats.skipped + bms.skipped + groups.skipped + attrs.skipped
  if (total === 0) {
    toast(`从 ${source} 导入：所有数据已存在，无新增项${skipped ? `（${skipped} 条格式错误已跳过）` : ''}`)
  } else {
    const parts: string[] = []
    if (bms.imported) parts.push(`${bms.imported} 个书签`)
    if (cats.imported) parts.push(`${cats.imported} 个分类`)
    if (groups.imported) parts.push(`${groups.imported} 个组`)
    if (attrs.imported) parts.push(`${attrs.imported} 个属性`)
    const skippedMsg = skipped ? `（${skipped} 条格式错误已跳过）` : ''
    toast(`从 ${source} 导入：${parts.join('、')}${skippedMsg}`)
  }
}

// ── Raindrop.io JSON 解析器 ──

// 导出供单测覆盖坏 tags 的防御性解析（仍以 _ 风格名为私有约定）
export function parseRaindropJSON(data: unknown): Bookmark[] {
  // Raindrop.io 导出格式：{ items: [{ title, link, tags, excerpt, cover, ... }] }
  const d = data as Record<string, unknown> | unknown[]
  const items = Array.isArray(d) ? d : (d as Record<string, unknown>)?.items ?? d
  if (!Array.isArray(items)) return []
  const now = Date.now()
  return items.filter((item: unknown) => { const r = item as Record<string, unknown>; return r.link || r.url }).map((item: unknown, i: number) => {
    const r = item as Record<string, unknown>
    return {
    id: newBookmarkId(i),
    title: (r.title as string) || (r.link as string) || '',
    url: (r.link as string) || (r.url as string) || '',
    notes: (r.excerpt as string) || (r.note as string) || '',
    icon: (r.cover as string) || '',
    categoryId: (r.collection as Record<string, unknown>)?.$id ? 'rd_' + (r.collection as Record<string, unknown>).$id : CAT_UNCATEGORIZED,
    attributes: Array.isArray(r.tags)
      // 元素可能非 string（Raindrop 偶有 number/对象 tags），.replace 会抛
      // TypeError 被外层 importData catch 吞掉致整批导入失败、后续合法项全丢。
      // 先 filter 出 string 元素再 map，单条坏数据不影响其它项。
      ? Object.fromEntries((r.tags as unknown[]).filter((t): t is string => typeof t === 'string').map((t) => ['tag_' + t.replace(/\s+/g, '_').toLowerCase(), true]))
      : {},
    createdAt: r.created ? new Date(r.created as string).getTime() : now,
    updatedAt: r.lastUpdate ? new Date(r.lastUpdate as string).getTime() : now,
    username: '', password: '', parentId: null, order: i, useCount: 0, isExpanded: false,
  }})
}

// ── 浏览器书签 HTML 解析器（Netscape Bookmark 格式）──

function parseBookmarkHTML(html: string): Bookmark[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const bookmarks: Bookmark[] = []
  let currentCategory = '导入的书签'
  const now = Date.now()

  function walk(nodes: NodeList) {
    for (const node of Array.from(nodes)) {
      if (!(node instanceof HTMLElement)) continue
      const tag = node.tagName.toUpperCase()

      if (tag === 'DL') {
        walk(node.childNodes)
      } else if (tag === 'DT') {
        const h3 = node.querySelector('h3')
        const a = node.querySelector(':scope > a')

        if (h3) {
          const parentCat = currentCategory
          currentCategory = (h3.textContent || '').trim() || '未命名'
          walk(node.childNodes)
          currentCategory = parentCat
        } else if (a) {
          const href = a.getAttribute('href')
          if (!href || href.startsWith('javascript:') || href.startsWith('data:')) continue
          const title = (a.textContent || '').trim() || href
          const addDate = parseInt(a.getAttribute('add_date') || '0', 10) || 0
          const icon = a.getAttribute('icon') || ''
          bookmarks.push({
            id: newBookmarkId(bookmarks.length),
            title, url: href,
            username: '', password: '',
            notes: currentCategory !== '导入的书签' ? `[${currentCategory}]` : '',
            icon: icon || '',
            categoryId: CAT_UNCATEGORIZED,
            parentId: null,
            order: bookmarks.length,
            useCount: 0,
            attributes: {},
            isExpanded: false,
            createdAt: addDate > 1000000000 ? addDate : addDate > 0 ? addDate * 1000 : now,
            updatedAt: now,
          })
        }
      } else if (tag === 'H3') {
        // 顶级 H3 直接出现在 DL 外
        currentCategory = (node.textContent || '').trim() || '未命名'
      }
    }
  }

  walk(doc.body.childNodes)
  return bookmarks
}

// ── CSV 解析器 ──

function parseCSV(text: string): Bookmark[] {
  const bookmarks: Bookmark[] = []
  const lines: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++
    } else {
      if (ch === '"') { inQuotes = true; i++; continue }
      if (ch === ',') { row.push(field.trim()); field = ''; i++; continue }
      if (ch === '\r' || ch === '\n') {
        row.push(field.trim()); field = ''
        if (row.some(f => f.length > 0)) lines.push(row)
        row = []
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++
        i++; continue
      }
      field += ch; i++
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(f => f.length > 0)) lines.push(row) }

  if (lines.length < 2) return []

  // 解析表头：查找 title/url/link 和 tags 列
  const headers = lines[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const titleIdx = headers.findIndex(h => h === 'title' || h === 'name')
  const urlIdx = headers.findIndex(h => h === 'url' || h === 'link' || h === 'href')
  const tagsIdx = headers.findIndex(h => h === 'tags' || h === 'tag' || h === 'labels')
  const notesIdx = headers.findIndex(h => h === 'notes' || h === 'description' || h === 'excerpt')
  if (urlIdx < 0) return []

  const now = Date.now()
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r]
    const url = (cols[urlIdx] || '').trim()
    if (!url || !url.includes('.')) continue
    const title = titleIdx >= 0 ? (cols[titleIdx] || '').trim() : url
    if (!title) continue
    const tags = tagsIdx >= 0 ? (cols[tagsIdx] || '').trim() : ''
    const notes = notesIdx >= 0 ? (cols[notesIdx] || '').trim() : ''
    const attributes: Record<string, boolean> = {}
    if (tags) {
      for (const t of tags.split(/[;|,]/)) {
        const tag = t.trim()
        if (tag) attributes['tag_' + tag.replace(/\s+/g, '_').toLowerCase()] = true
      }
    }
    bookmarks.push({
      id: newBookmarkId(r),
      title, url,
      username: '', password: '',
      notes, icon: '',
      categoryId: CAT_UNCATEGORIZED,
      parentId: null,
      order: r - 1,
      useCount: 0,
      attributes,
      isExpanded: false,
      createdAt: now,
      updatedAt: now,
    })
  }
  return bookmarks
}

// ── LinkVault 原生 JSON 验证 ──

function validateImportData(data: unknown): string | null {
  const result = AppDataSchema.safeParse(data)
  if (!result.success) {
    const first = result.error.issues[0]
    return first ? `数据格式错误 (${first.path.join('.')}: ${first.message})` : '数据格式错误'
  }
  return null
}

// ── 重置数据 ──

export async function resetToDefaults() {
  const ds = useDataStore()
  const ui = useUIStore()
  // A4-002：已登录时文案标明仅清本机，避免用户以为连云端一并清空
  let loggedIn = false
  try {
    const { useAuth } = await import('./useAuth.js')
    loggedIn = !!useAuth().isLoggedIn
  } catch { /* ignore */ }
  const msg = loggedIn
    ? '确认清除本机所有数据并恢复默认？不会删除云端数据；下次同步时云端内容可能重新合并回本机。'
    : '确认清除所有数据？将恢复为默认状态。'
  const ok = await showConfirm(msg)
  if (!ok) return
  const snapshot = {
      categories: cloneDeep(ds.categories),
      bookmarks: cloneDeep(ds.bookmarks),
      customAttributes: cloneDeep(ds.customAttributes),
      siblingGroups: cloneDeep(ds.siblingGroups),
      curCat: ui.curCat,
    }
    const d = cloneDeep(DEFAULTS)
    ds.categories = d.categories
    ds.bookmarks = d.bookmarks
    ds.customAttributes = d.customAttributes
    ds.siblingGroups = d.siblingGroups
    // A4-001：正向路径必须立即 _syncMaps，否则 map 条数相同时返回陈旧对象
    ds._syncMaps()
    // A4-002：清空脏标记 / 新建 / 删除 / 变更字段，避免旧 id 被 enqueue 推云复活
    ds._dirtyIds.clear()
    ds._newIds.clear()
    ds._deletedIds.clear()
    ds._changedFields.clear()
    ds._customCardOrder = null
    clearSearchCache()
    ds._bumpSearchVersion()
    try { await clearAllSyncOps() } catch { /* ignore */ }
    try { __testPendingSync.clear() } catch { /* ignore */ }
    ui.curCat = 'all'
    ui.focusedGroupId = null
    ui.activeAttrs = []
    ui.excludedAttrs = []
    ui.detailCards = []
    saveAppData()
    toastWithUndo('数据已重置为默认', () => {
      ds.categories = snapshot.categories
      ds.bookmarks = snapshot.bookmarks
      ds.customAttributes = snapshot.customAttributes
      ds.siblingGroups = snapshot.siblingGroups
      ui.curCat = snapshot.curCat
      // 直接替换数组引用后必须重建索引：_bmMap/_grpMap/_catMap/_attrMap/_childrenIdx 仍指向
      // 重置前的旧数组元素，撤销恢复后全部失同步——后续 bookmarkMap[id]/childrenMap 查找
      // 会 miss、过滤/排序 getter 走懒回退分支（性能退化）、_syncMaps 才能恢复正常索引。
      ds._syncMaps()
      debouncedSaveAppData()
      toast('数据已恢复')
    })
  }
