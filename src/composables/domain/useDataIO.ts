/**
 * useDataIO — 数据导入导出
 * 从 store actions 提取。分享与 Fork 见 useDataShare.ts。
 *
 * A3: 支持多格式导入（LinkVault JSON、Chrome HTML、Raindrop JSON、CSV）
 */
import { useDataStore, _cancelPendingHist } from '../../stores/data.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import * as persist from '../../stores/persist.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import { downloadFile, dateStamp } from '../../lib/download.js'
import { esc as escHtml } from '../../utils.js'

import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { BookmarkSchema, SiblingGroupSchema, CategorySchema, CustomAttributeSchema } from '../../schemas.js'
import { clearSearchCache } from '../../lib/search.js'
import { DEFAULTS } from '../../config/constants.js'
import { runMigrations } from '../../stores/migrations.js'
import { clearAllSyncOps } from '../../stores/storage.js'
import { useE2EStore } from '../../stores/e2e.js'
import { useVaultStore } from '../../stores/vault.js'
import { safeGetItem, safeSetItem, safeJsonParse } from '../../lib/storageSafe.js'
import { __testPendingSync } from './syncPending.js'
import { newBookmarkId } from '../../lib/newId.js'
import { cloneDeep } from '../../lib/clone.js'
import type { AppData, Bookmark } from '../../types.js'
import { detectFormat, parseRaindropJSON, parseBookmarkHTML, parseCSV, resolveCsvColumns, validateImportData } from '../../lib/importParse.js'
export { detectFormat, parseRaindropJSON, parseBookmarkHTML, parseCSV, resolveCsvColumns, validateImportData }
export type { CsvColumns } from '../../lib/importParse.js'

// ── E2E/保险柜 canary 元数据附带与恢复（换设备正确姿势） ──
// canaryData 仅含密钥派生参数（salt/it）与密文验证串（canary/recovery_canary），
// 不含明文业务数据或主密码——随备份导出是安全的。
// 不直接 import useE2E/useVault 模块：其依赖链（supabase/sync/useBiometric）较重，
// 数据导入导出路径不该引入；key 与 useE2E.LOCAL_CANARY_KEY（'lv_e2e_canary'）/
// useVault.LOCAL_CANARY_KEY（'lv_vault_canary'）保持一致即可。
const E2E_CANARY_KEY = 'lv_e2e_canary'
const VAULT_CANARY_KEY = 'lv_vault_canary'

function _readE2ECanary(): Record<string, unknown> | null {
  return safeJsonParse<Record<string, unknown> | null>(safeGetItem(E2E_CANARY_KEY), null)
}
function _writeE2ECanary(data: Record<string, unknown>): boolean {
  return safeSetItem(E2E_CANARY_KEY, JSON.stringify(data))
}
function _readVaultCanary(): Record<string, unknown> | null {
  return safeJsonParse<Record<string, unknown> | null>(safeGetItem(VAULT_CANARY_KEY), null)
}
function _writeVaultCanary(data: Record<string, unknown>): boolean {
  return safeSetItem(VAULT_CANARY_KEY, JSON.stringify(data))
}

// ── 导出 ──

/** 仅导出未软删的活书签，供通用格式（HTML/CSV/Raindrop）使用 */
function _liveBookmarks(ds: ReturnType<typeof useDataStore>): Bookmark[] {
  return ds.bookmarks.filter(b => !b.deletedAt && b.url)
}

/** attributes → 标签名数组（用属性 name，找不到则去掉 tag_ 前缀） */
export function _attrsToTags(ds: ReturnType<typeof useDataStore>, b: Bookmark): string[] {
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
    const snapshot = ds._dataSnapshot() as Record<string, unknown>
    // 附带 E2E/保险柜 canary 元数据：本机 canary 存 localStorage、不随数据快照走，
    // 若导出不带它，新设备导入后会引导"重新设置主密码"生成新 key → 旧主密码加密的
    // 历史数据永久解不开（换设备数据丢失）。带上后新设备导入能识别加密设置 →
    // 引导"输入原主密码解锁"，旧数据可正常解密（正确换设备姿势）。
    const e2eCanary = _readE2ECanary()
    if (e2eCanary) snapshot.__e2eCanary = e2eCanary
    const vaultCanary = _readVaultCanary()
    if (vaultCanary) snapshot.__vaultCanary = vaultCanary
    downloadFile('linkvault-backup-' + dateStamp() + '.json',
      JSON.stringify(snapshot, null, 2), 'application/json')
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


// ── 导入内部逻辑（合并模式，不覆盖已有数据）──

type DataStore = ReturnType<typeof useDataStore>
interface MergeStats { imported: number; skipped: number }

/** 合并分类（去重：同 ID 跳过；Zod 失败计入 skipped） */
export function _mergeCategories(ds: DataStore, categories: AppData['categories']): MergeStats {
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
export function _mergeAttributes(ds: DataStore, customAttributes: AppData['customAttributes']): MergeStats {
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
export function _mergeBookmarks(ds: DataStore, bookmarks: AppData['bookmarks']): MergeStats {
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
export function _mergeGroups(ds: DataStore, siblingGroups: AppData['siblingGroups']): MergeStats {
  let imported = 0, skipped = 0
  for (const g of siblingGroups) {
    if (!g.id || !g.name) continue
    if (ds.siblingGroups.some(existing => existing.id === g.id)) continue
    const liveBookmarkIds = (g.bookmarkIds || []).filter(bid => ds.bookmarkMap[bid])
    // categoryId 兜底：源 categoryId 为空 或 指向不存在分类（导出者填错/源数据被半删/
    // 同名分类被合并跳过未建 id）时，安全兜底到 CAT_UNCATEGORIZED，避免组挂悬空分类 id
    // 致分类筛选下组卡消失、侧栏分类引用悬空。仅当本地 categoryMap 真有该 id 才用之。
    const catId = g.categoryId && ds.categoryMap[g.categoryId] ? g.categoryId : CAT_UNCATEGORIZED
    const parsed = SiblingGroupSchema.safeParse({
      id: g.id, name: g.name,
      categoryId: catId,
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

  try { persist.saveToLocalStorage(ds._dataSnapshot(), useUIStore().curSpace) } catch (e) { console.warn('[import] backup before import failed:', e) }

  // 恢复 E2E/保险柜 canary（换设备正确姿势）：导出 JSON 附带的加密元数据写回本地，
  // 使导入后 checkE2EStatus 识别为"已设置主密码"→ 引导输入原主密码解锁，而非重新设置
  // 生成新 key（新 key 解不开旧主密码加密的历史密文 → 数据永久丢失）。
  // 仅当本机尚无对应 canary 时恢复，绝不覆盖已有主密码设置（本地优先，覆盖会破坏本机解锁）。
  // 直接置 store 的 enabled 标记刷新状态：不调 checkE2EStatus——它会经 useBiometric /
  // 云端查询，数据导入路径不应引入该依赖链；写回本地后 enabled=true 即让解锁引导可用。
  const importDataAny = data as Partial<AppData> & { __e2eCanary?: Record<string, unknown>; __vaultCanary?: Record<string, unknown> }
  if (importDataAny.__e2eCanary && !_readE2ECanary()) {
    _writeE2ECanary(importDataAny.__e2eCanary)
    useE2EStore().setEnabled(true)
  }
  if (importDataAny.__vaultCanary && !_readVaultCanary()) {
    _writeVaultCanary(importDataAny.__vaultCanary)
    useVaultStore().setEnabled(true)
  }

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
    // R22：清空本地历史防抖模块级 Map，避免旧定时器按旧 id 写快照到重置后数据不对应的 ID。
    _cancelPendingHist()
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
