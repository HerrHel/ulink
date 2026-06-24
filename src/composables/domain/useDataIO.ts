/**
 * useDataIO — 数据导入导出与分享
 * 从 store actions 提取，使 store 聚焦于数据 + CRUD。
 *
 * A3: 支持多格式导入（LinkVault JSON、Chrome HTML、Raindrop JSON、CSV）
 * A4: 公开分享链接（#share/<id>）
 * A5: 导入他人公开分享（fork 公开组）
 */
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import { DEFAULTS } from '../../config/constants.js'
import { copyToClipboard } from '../../utils.js'
import { supabase } from '../../lib/supabase.js'
import { runMigrations } from '../../stores/migrations.js'
import { useCloudSync } from './useCloudSync.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, AppData } from '../../types.js'

// ── 导出 ──

export function exportData() {
  const store = useAppStore()
  try {
    const blob = new Blob([JSON.stringify(store._dataSnapshot(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'linkvault-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    a.click(); URL.revokeObjectURL(a.href)
    toast('数据已导出')
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
  const store = useAppStore()
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

  try { store._backupBeforeImport() } catch (_) { /* 备份失败不阻塞导入 */ }

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

  store.save()

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

function validateImportData(data: Partial<AppData>): string | null {
  if (!Array.isArray(data.categories) || !Array.isArray(data.bookmarks) ||
      !Array.isArray(data.customAttributes) || !Array.isArray(data.siblingGroups)) return '数据结构错误：缺少必需的数组字段'
  for (let i = 0; i < data.categories.length; i++) {
    const c = data.categories[i]; if (!c.id || !c.name) return '分类 #' + i + ' 缺少 id 或 name'
  }
  for (let i = 0; i < data.bookmarks.length; i++) {
    const b = data.bookmarks[i]; if (!b.id || !b.title || !b.url) return '书签 #' + i + ' 缺少 id、title 或 url'
  }
  for (let i = 0; i < data.customAttributes.length; i++) {
    const a = data.customAttributes[i]; if (!a.id || !a.name) return '属性 #' + i + ' 缺少 id 或 name'
  }
  for (let i = 0; i < data.siblingGroups.length; i++) {
    const g = data.siblingGroups[i]; if (!g.id || !g.name) return '组 #' + i + ' 缺少 id 或 name'
    if (g.bookmarkIds && !Array.isArray(g.bookmarkIds)) return '组 #' + i + ' 的 bookmarkIds 不是数组'
  }
  return null
}

// ── 重置数据 ──

export function resetToDefaults() {
  const store = useAppStore()
  const ds = useDataStore()
  showConfirm('确认清除所有数据？将恢复为默认状态。', () => {
    const snapshot = {
      categories: JSON.parse(JSON.stringify(ds.categories)),
      bookmarks: JSON.parse(JSON.stringify(ds.bookmarks)),
      customAttributes: JSON.parse(JSON.stringify(ds.customAttributes)),
      siblingGroups: JSON.parse(JSON.stringify(ds.siblingGroups)),
      curCat: store.curCat,
    }
    const d = JSON.parse(JSON.stringify(DEFAULTS))
    ds.categories = d.categories
    ds.bookmarks = d.bookmarks
    ds.customAttributes = d.customAttributes
    ds.siblingGroups = d.siblingGroups
    store.curCat = 'all'
    store.focusedGroupId = null
    store.activeAttrs = []
    store.excludedAttrs = []
    store.detailCards = []
    store.save()
    toastWithUndo('数据已重置为默认', () => {
      ds.categories = snapshot.categories
      ds.bookmarks = snapshot.bookmarks
      ds.customAttributes = snapshot.customAttributes
      ds.siblingGroups = snapshot.siblingGroups
      store.curCat = snapshot.curCat
      store.debouncedSave()
      toast('数据已恢复')
    })
  })
}

// ── 分享组（A4: 公开分享链接，升级为数据库持久化 + URL 路由）──

export async function shareGroup(gid: string) {
  const store = useAppStore()
  const sg = store.groupMap[gid]
  if (!sg) { toast('组不存在', false); return }

  const sync = useCloudSync()

  // 尝试设置为公开
  if (!sg.isPublic) {
    const ok = await sync.setGroupPublic(gid, true)
    if (!ok) {
      // 未登录或失败，降级为旧版 base64 方式
      _shareGroupLegacy(gid)
      return
    }
  }

  const url = location.origin + location.pathname + '#share/' + gid
  copyToClipboard(url, '分享链接')
}

function _shareGroupLegacy(gid: string) {
  const store = useAppStore()
  const sg = store.groupMap[gid]
  if (!sg) return
  const bms = sg.bookmarkIds.map(bid => store.bookmarkMap[bid]).filter(Boolean).map(b => {
    const { password: _, username: __, ...safe } = b; return safe
  })
  const payload = { v: 1, group: { ...sg }, bookmarks: bms }
  const json = JSON.stringify(payload)
  const b64 = btoa(unescape(encodeURIComponent(json)))
  if (b64.length > 30000) { toast('组内容过大，无法生成分享链接', false); return }
  const url = location.origin + location.pathname + '#share=' + b64
  copyToClipboard(url, '分享链接')
}

// ── 从 URL 导入分享数据（A4: 支持两种格式）──

export function detectShareRoute(): string | null {
  const hash = location.hash
  if (!hash) return null
  // 新格式：#share/<id>
  const match = hash.match(/^#share\/([a-zA-Z0-9_-]+)$/)
  if (match) return match[1]
  return null
}

export function importFromURL(): boolean {
  const store = useAppStore()
  const hash = location.hash
  if (!hash || !hash.startsWith('#share=')) return false
  try {
    const json = decodeURIComponent(escape(atob(hash.slice(7))))
    const payload = JSON.parse(json)
    if (!payload.group?.id) { toast('分享数据格式错误', false); return true }
    let imported = 0
    const existingUrls = new Set(store.bookmarks.map(b => b.url?.toLowerCase()).filter(Boolean))
    const bookmarks = Array.isArray(payload.bookmarks) ? payload.bookmarks : []
    for (const b of bookmarks) {
      if (!b.id || !b.url) continue
      if (store.bookmarkMap[b.id]) continue
      if (b.url && existingUrls.has(b.url.toLowerCase())) continue
      store.addBookmark({
        id: b.id,
        title: b.title || '',
        url: b.url,
        username: b.username || '',
        password: b.password || '',
        notes: b.notes || '',
        icon: b.icon || '',
        categoryId: b.categoryId || 'uncategorized',
        parentId: b.parentId || null,
        order: b.order || 0,
        useCount: b.useCount || 0,
        attributes: b.attributes || {},
        isExpanded: false,
        createdAt: b.createdAt || Date.now(),
        updatedAt: b.updatedAt || Date.now(),
      } as Bookmark)
      imported++
    }
    const existing = store.groupMap[payload.group.id]
    if (existing) {
      const newBookmarkIds = [...existing.bookmarkIds]
      for (const bid of payload.group.bookmarkIds) {
        if (!newBookmarkIds.includes(bid)) newBookmarkIds.push(bid)
      }
      const changes: Partial<SiblingGroup> = { bookmarkIds: newBookmarkIds }
      if (payload.group.notes && !existing.notes) changes.notes = payload.group.notes
      store.updateGroup(payload.group.id, changes)
      toast('已更新组「' + (existing.name || '未命名') + '」（新增 ' + imported + ' 个书签）')
    } else {
      store.addGroup(payload.group)
      toast('已导入组「' + (payload.group.name || '未命名') + '」（' + (payload.bookmarks || []).length + ' 个书签）')
    }
    store.save()
    history.replaceState(null, '', location.pathname + location.search)
    return true
  } catch (_) { toast('分享链接解析失败', false); return true }
}

// ── Fork 公开组到自己库（A5）──

export async function forkPublicGroup(group: SiblingGroup, bookmarks: Bookmark[]) {
  const store = useAppStore()
  const ds = useDataStore()
  const now = Date.now()

  // 为所有书签和组生成新 ID（复制模式）
  const idMap = new Map<string, string>()

  const newGroupId = 'g' + now.toString(36) + Math.random().toString(36).slice(2, 6)
  idMap.set(group.id, newGroupId)

  const newBookmarks: Bookmark[] = []
  for (const b of bookmarks) {
    const newId = 'b' + now.toString(36) + Math.random().toString(36).slice(2, 6) + newBookmarks.length
    idMap.set(b.id, newId)
    newBookmarks.push({
      ...b,
      id: newId,
      password: '',  // 不复制密码
      username: '',  // 不复制用户名
      createdAt: now,
      updatedAt: now,
    })
  }

  // 更新组内的 bookmarkIds
  const newBookmarkIds = group.bookmarkIds.map(bid => idMap.get(bid) || bid)

  const newGroup: SiblingGroup = {
    ...group,
    id: newGroupId,
    bookmarkIds: newBookmarkIds,
    isPublic: false,
    updatedAt: now,
    useCount: 0,
  }

  // 写入本地
  for (const b of newBookmarks) {
    if (!ds.bookmarks.some(e => e.url?.toLowerCase() === b.url?.toLowerCase())) {
      ds.addBookmark(b)
    }
  }
  ds.addGroup(newGroup)
  store.save()

  // 尝试写入远端
  try {
    const userId = (await supabase.auth.getSession()).data.session?.user?.id
    if (userId) {
      const bRows = newBookmarks.map(b => ({
        id: b.id, user_id: userId, title: b.title, url: b.url,
        username: b.username, password: '', notes: b.notes, icon: b.icon,
        category_id: b.categoryId, parent_id: b.parentId,
        "order": b.order, use_count: b.useCount,
        attributes: b.attributes, is_expanded: b.isExpanded,
        created_at_num: b.createdAt, updated_at_num: b.updatedAt,
      }))
      const gRow = {
        id: newGroup.id, user_id: userId, name: newGroup.name,
        category_id: newGroup.categoryId, icon: newGroup.icon,
        "order": newGroup.order, is_expanded: newGroup.isExpanded,
        attributes: newGroup.attributes, bookmark_ids: newGroup.bookmarkIds,
        notes: newGroup.notes, use_count: newGroup.useCount,
        updated_at_num: newGroup.updatedAt, is_public: false,
      }
      if (bRows.length) await supabase.from('bookmarks').upsert(bRows, { onConflict: 'id' })
      await supabase.from('sibling_groups').upsert(gRow, { onConflict: 'id' })
    }
  } catch (e) { console.warn('[fork] cloud sync failed:', e) }

  toast(`已复制「${group.name}」到你的库（${newBookmarks.length} 个书签）`)
}
