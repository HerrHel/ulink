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
import { AppDataSchema } from '../../schemas.js'
import { DEFAULTS } from '../../config/constants.js'
import { runMigrations } from '../../stores/migrations.js'
import type { AppData, Bookmark } from '../../types.js'

// ── 导出 ──

/** 仅导出未软删的活书签，供通用格式（HTML/CSV/Raindrop）使用 */
function _liveBookmarks(ds: ReturnType<typeof useDataStore>): Bookmark[] {
  return ds.bookmarks.filter(b => !b.deletedAt && b.url)
}

/** attributes → 标签名数组（用属性 name，找不到则去掉 tag_ 前缀） */
function _attrsToTags(ds: ReturnType<typeof useDataStore>, b: Bookmark): string[] {
  const tags: string[] = []
  for (const [id, on] of Object.entries(b.attributes || {})) {
    if (!on) continue
    const attr = ds.customAttributes.find(a => a.id === id)
    tags.push(attr?.name || id.replace(/^tag_/, ''))
  }
  return tags
}

function _download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click(); URL.revokeObjectURL(a.href)
}

const _dateStamp = () => new Date().toISOString().slice(0, 10)

/** LinkVault 完整备份（含组/分类/属性/加密元数据），其他设备恢复用 */
export function exportData() {
  const ds = useDataStore()
  try {
    _download('linkvault-backup-' + _dateStamp() + '.json',
      JSON.stringify(ds._dataSnapshot(), null, 2), 'application/json')
    toast('数据已导出')
  } catch (_) { toast('导出失败', false) }
}

/** 导出为 Netscape Bookmark HTML，可导入 Chrome/Firefox/Edge。按分类组织目录。 */
export function exportHTML() {
  const ds = useDataStore()
  try {
    const live = _liveBookmarks(ds)
    const byCat = new Map<string, Bookmark[]>()
    for (const b of live) {
      const cid = b.categoryId || 'uncategorized'
      if (!byCat.has(cid)) byCat.set(cid, [])
      byCat.get(cid)!.push(b)
    }
    const catName = (cid: string) => ds.categories.find(c => c.id === cid)?.name
      || (cid === 'uncategorized' ? '未分类' : '其他')

    const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
    _download('linkvault-bookmarks-' + _dateStamp() + '.html', lines.join('\n'), 'text/html')
    toast(`已导出 ${live.length} 个书签（HTML）`)
  } catch (_) { toast('导出失败', false) }
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
        esc(ds.categories.find(c => c.id === b.categoryId)?.name || ''),
        esc(b.icon || ''),
        b.createdAt > 0 ? new Date(b.createdAt).toISOString() : '',
      ])
    }
    _download('linkvault-bookmarks-' + _dateStamp() + '.csv',
      rows.map(r => r.join(',')).join('\n'), 'text/csv')
    toast(`已导出 ${live.length} 个书签（CSV）`)
  } catch (_) { toast('导出失败', false) }
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
    _download('linkvault-raindrop-' + _dateStamp() + '.json',
      JSON.stringify({ items }, null, 2), 'application/json')
    toast(`已导出 ${live.length} 个书签（Raindrop JSON）`)
  } catch (_) { toast('导出失败', false) }
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

function importFromDataInternal(data: Partial<AppData>, source: string) {
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
  let catImported = 0, bmImported = 0, groupImported = 0, attrImported = 0

  try { persist.saveToLocalStorage(ds._dataSnapshot()) } catch (_) { /* 备份失败不阻塞导入 */ }

  // 合并分类（去重：同 ID 跳过）
  for (const c of categories) {
    if (!c.id || !c.name) continue
    if (ds.categories.some(existing => existing.id === c.id)) continue
    ds.addCategory({ id: c.id, name: c.name, icon: c.icon || 'star', color: c.color || '', updatedAt: Date.now() })
    catImported++
  }

  // 合并属性（去重：同 ID 跳过）
  for (const a of customAttributes) {
    if (!a.id || !a.name) continue
    if (ds.customAttributes.some(existing => existing.id === a.id)) continue
    ds.addAttribute({ id: a.id, name: a.name, type: a.type || 'boolean', updatedAt: Date.now() })
    attrImported++
  }

  // 合并书签（去重：同 ID 或同 URL 跳过）
  const existingUrls = new Set(ds.bookmarks.map(b => b.url?.toLowerCase()).filter(Boolean))
  for (const b of bookmarks) {
    if (!b.title || !b.url) continue
    if (ds.bookmarks.some(existing => existing.id === b.id)) continue
    if (existingUrls.has(b.url.toLowerCase())) continue
    const now = Date.now()
    const newBm: Bookmark = {
      id: b.id || 'b' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      title: b.title,
      url: b.url,
      username: b.username || '',
      password: b.password || '',
      notes: b.notes || '',
      icon: b.icon || '',
      categoryId: b.categoryId || 'uncategorized',
      parentId: b.parentId || null,
      order: ds.bookmarks.length + bmImported,
      useCount: b.useCount || 0,
      attributes: b.attributes || {},
      isExpanded: false,
      createdAt: b.createdAt || now,
      updatedAt: b.updatedAt || now,
    }
    ds.addBookmark(newBm)
    existingUrls.add(b.url.toLowerCase())
    bmImported++
  }

  // 合并组（去重：同 ID 跳过）
  for (const g of siblingGroups) {
    if (!g.id || !g.name) continue
    if (ds.siblingGroups.some(existing => existing.id === g.id)) continue
    ds.addGroup({
      id: g.id, name: g.name,
      categoryId: g.categoryId || 'uncategorized',
      icon: g.icon || '', order: g.order || 0,
      isExpanded: g.isExpanded || false,
      attributes: g.attributes || {},
      bookmarkIds: g.bookmarkIds || [],
      notes: g.notes || '', updatedAt: g.updatedAt || Date.now(),
      useCount: g.useCount || 0,
    })
    groupImported++
  }

  saveAppData()

  const total = catImported + bmImported + groupImported + attrImported
  if (total === 0) {
    toast(`从 ${source} 导入：所有数据已存在，无新增项`)
  } else {
    const parts: string[] = []
    if (bmImported) parts.push(`${bmImported} 个书签`)
    if (catImported) parts.push(`${catImported} 个分类`)
    if (groupImported) parts.push(`${groupImported} 个组`)
    if (attrImported) parts.push(`${attrImported} 个属性`)
    toast(`从 ${source} 导入：${parts.join('、')}`)
  }
}

// ── Raindrop.io JSON 解析器 ──

function parseRaindropJSON(data: unknown): Bookmark[] {
  // Raindrop.io 导出格式：{ items: [{ title, link, tags, excerpt, cover, ... }] }
  const d = data as Record<string, unknown> | unknown[]
  const items = Array.isArray(d) ? d : (d as Record<string, unknown>)?.items ?? d
  if (!Array.isArray(items)) return []
  const now = Date.now()
  return items.filter((item: unknown) => { const r = item as Record<string, unknown>; return r.link || r.url }).map((item: unknown, i: number) => {
    const r = item as Record<string, unknown>
    return {
    id: 'b' + (now + i).toString(36) + Math.random().toString(36).slice(2, 6),
    title: (r.title as string) || (r.link as string) || '',
    url: (r.link as string) || (r.url as string) || '',
    notes: (r.excerpt as string) || (r.note as string) || '',
    icon: (r.cover as string) || '',
    categoryId: (r.collection as Record<string, unknown>)?.$id ? 'rd_' + (r.collection as Record<string, unknown>).$id : 'uncategorized',
    attributes: Array.isArray(r.tags)
      ? Object.fromEntries((r.tags as string[]).map((t: string) => ['tag_' + t.replace(/\s+/g, '_').toLowerCase(), true]))
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
            id: 'b' + now.toString(36) + Math.random().toString(36).slice(2, 6) + bookmarks.length,
            title, url: href,
            username: '', password: '',
            notes: currentCategory !== '导入的书签' ? `[${currentCategory}]` : '',
            icon: icon || '',
            categoryId: 'uncategorized',
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
      id: 'b' + now.toString(36) + Math.random().toString(36).slice(2, 6) + r,
      title, url,
      username: '', password: '',
      notes, icon: '',
      categoryId: 'uncategorized',
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
  const ok = await showConfirm('确认清除所有数据？将恢复为默认状态。')
  if (!ok) return
  const snapshot = {
      categories: JSON.parse(JSON.stringify(ds.categories)),
      bookmarks: JSON.parse(JSON.stringify(ds.bookmarks)),
      customAttributes: JSON.parse(JSON.stringify(ds.customAttributes)),
      siblingGroups: JSON.parse(JSON.stringify(ds.siblingGroups)),
      curCat: ui.curCat,
    }
    const d = JSON.parse(JSON.stringify(DEFAULTS))
    ds.categories = d.categories
    ds.bookmarks = d.bookmarks
    ds.customAttributes = d.customAttributes
    ds.siblingGroups = d.siblingGroups
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
      debouncedSaveAppData()
      toast('数据已恢复')
    })
  }
