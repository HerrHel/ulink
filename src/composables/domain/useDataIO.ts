/**
 * useDataIO — 数据导入导出
 * 从 store actions 提取。分享与 Fork 见 useDataShare.ts。
 *
 * A3: 支持多格式导入（LinkVault JSON、Chrome HTML、Raindrop JSON、CSV）
 */
import { useDataStore, _cancelPendingHist, DGM_KEY, DAM_KEY } from '../../stores/data.js'
import { saveAppData, debouncedSaveAppData } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import * as persist from '../../stores/persist.js'
import { toast, toastWithUndo, showConfirm } from '../../lib/toast.js'
import { t, tN } from '../../i18n/index.js'
import { downloadFile, dateStamp } from '../../lib/download.js'
import { esc as escHtml } from '../../utils.js'

import { CAT_UNCATEGORIZED } from '../../config/constants.js'
import { AppDataSchema, BookmarkSchema, SiblingGroupSchema, CategorySchema, CustomAttributeSchema } from '../../schemas.js'
import { clearSearchCache } from '../../lib/search.js'
import { buildSeedDefaults } from '../../config/constants.js'
import { runMigrations } from '../../stores/migrations.js'
import { clearAllSyncOps } from '../../stores/storage.js'
import { useE2EStore } from '../../stores/e2e.js'
import { useVaultStore } from '../../stores/vault.js'
import { useUndoStore } from '../../stores/undo.js'
import { safeGetItem, safeSetItem, safeJsonParse } from '../../lib/storageSafe.js'
import { __testPendingSync } from './syncPending.js'
import { normalizeSyncUrl } from './syncDedup.js' // 缺陷11：导入与同步共用同一 URL 内容键
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

/**
 * 缺陷5：导入 canary 的最小结构校验。canary 是随备份附带的主密码离线验证器
 * （canary + KDF salt + it），伪造/畸形值写回本地会把解锁入口永久锁死
 * （checkE2EStatus 判为「已设置」→ 引导输入原主密码 → 永远验不过）。
 * 只认：canary 非空字符串、salt 为有限数数组、it 若提供必须是有限数
 *（旧备份可能无 it，缺失时容忍以兼容现网）。
 */
function _isValidCanaryShape(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (typeof o.canary !== 'string' || !o.canary) return false
  if (!Array.isArray(o.salt) || o.salt.length === 0 || !o.salt.every(n => typeof n === 'number' && Number.isFinite(n))) return false
  if (o.it !== undefined && (typeof o.it !== 'number' || !Number.isFinite(o.it))) return false
  return true
}

/** 缺陷5：恢复导入备份里的 canary；结构不合法则跳过并提示，防伪造 canary 锁死解锁入口 */
function _restoreCanary(raw: unknown, label: string, opts: {
  read: () => Record<string, unknown> | null
  write: (o: Record<string, unknown>) => boolean
  enable: () => void
}): void {
  if (raw == null) return
  if (!_isValidCanaryShape(raw)) {
    console.warn(`[import] ${label} 结构非法，跳过恢复以防伪造 canary 锁死入口`)
    toast(t('msg.jsonFormatUnrecognized'), false)
    return
  }
  // 仅当本机尚无对应 canary 时恢复，绝不覆盖已有主密码设置（本地优先）
  if (!opts.read()) {
    opts.write(raw as Record<string, unknown>)
    opts.enable()
  }
}

// ── 导出 ──

/**
 * 导出是否保留敏感内容（username/password）的本地开关。
 * 默认 false：分类导出/通用导出不含账户密码。仅本机偏好，不参与云同步。
 */
const EXPORT_SENSITIVE_KEY = 'lv_exportKeepSensitive'

/** 读导出敏感开关（默认不保留） */
export function getExportKeepSensitive(): boolean {
  return safeGetItem(EXPORT_SENSITIVE_KEY) === '1'
}

/** 写导出敏感开关 */
export function setExportKeepSensitive(v: boolean): void {
  safeSetItem(EXPORT_SENSITIVE_KEY, v ? '1' : '0')
}

/** 按开关清洗书签敏感字段：关闭时 username/password 一律置空（含 E2E 加密密码对象）；
 *  alsoNotes=true 时连 notes 一并剔除（完整备份：E2E 解锁后 notes 也是明文）。 */
function _stripSensitive<T extends { username?: unknown; password?: unknown; notes?: unknown }>(b: T, alsoNotes = false): T {
  if (!getExportKeepSensitive()) {
    const out: T = { ...b, username: '', password: '' }
    // 缺陷1：完整备份关闭开关时也剔除 notes 明文
    if (alsoNotes) Object.assign(out, { notes: '' })
    return out
  }
  return b
}

/** 仅导出未软删的活书签，供通用格式（HTML/CSV/Raindrop）使用 */
function _liveBookmarks(ds: ReturnType<typeof useDataStore>): Bookmark[] {
  return ds.bookmarks.filter(b => !b.deletedAt && b.url)
}

/**
 * 单独导出「一个分类及其全部书签与组」（LinkVault JSON，可再导入）。
 *
 * 内容：
 * - categories：仅该分类（未软删）
 * - bookmarks：该分类下所有书签（含子书签，子书签 categoryId 与父一致）；
 *   另补全本分类组引用的、归属其他分类的书签（避免导入后组内悬空引用）
 * - siblingGroups：该分类下所有组（未软删）
 * - customAttributes：以上书签/组实际用到的属性定义（去重）
 *
 * 敏感内容：默认剔除（username/password 置空）；设置面板「导出保留敏感内容」
 * 开启后原样保留（password 可能为 E2E 加密对象）。
 */
export function exportCategory(catId: string) {
  const ds = useDataStore()
  const cat = ds.categoryMap[catId]
  try {
    if (!cat || cat.deletedAt) { toast(t('msg.categoryNotExist'), false); return }
    const catBookmarks = ds.bookmarks.filter(b => !b.deletedAt && b.categoryId === catId)
    const catGroups = ds.siblingGroups.filter(g => !g.deletedAt && g.categoryId === catId)
    // 组引用的书签补全：即使归属其他分类也带上，保证组导入后不悬空
    const refIds = new Set<string>()
    for (const g of catGroups) for (const bid of g.bookmarkIds || []) refIds.add(bid)
    const refBookmarks = ds.bookmarks.filter(b => !b.deletedAt && refIds.has(b.id) && b.categoryId !== catId)

    // 缺陷1：显式箭头调用，避免 map 把 index 当作 _stripSensitive 的 alsoNotes 参数
    const bookmarks = [...catBookmarks, ...refBookmarks].map(b => _stripSensitive(b))
    const groups = catGroups.map(g => ({ ...g }))
    // 用到的属性（去重、按 id 保序）
    const attrIds = new Set<string>()
    for (const b of bookmarks) for (const k of Object.keys(b.attributes || {})) attrIds.add(k)
    for (const g of groups) for (const k of Object.keys(g.attributes || {})) attrIds.add(k)
    const customAttributes = ds.customAttributes.filter(a => !a.deletedAt && attrIds.has(a.id))

    const payload = {
      categories: [{ ...cat }],
      bookmarks,
      siblingGroups: groups,
      customAttributes,
      _schemaVersion: 2,
      _dataVersion: 2,
    }
    const slug = (cat.name || 'category').trim().replace(/[^\p{L}\p{N}\-_]+/gu, '-').replace(/^-+|-+$/g, '') || 'category'
    downloadFile(`ulink-category-${slug}-${dateStamp()}.json`,
      JSON.stringify(payload, null, 2), 'application/json')
    toast(tN('msg.exportedCategory', bookmarks.length, { name: cat.name, groups: groups.length }))
  } catch (e) { console.warn('[export] category export failed:', e); toast(t('msg.exportFailed'), false) }
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
    const keepSensitive = getExportKeepSensitive()
    // 缺陷1：E2E 解锁后内存里 username/notes 是明文、password 是 EncryptedPassword 对象，
    // 默认开关关闭时沿用 _stripSensitive 把三者一并剔除，避免明文账号信息随备份外泄。
    if (!keepSensitive && Array.isArray(snapshot.bookmarks)) {
      snapshot.bookmarks = (snapshot.bookmarks as Bookmark[]).map(b => _stripSensitive(b, true))
    }
    // 缺陷1：canary（含 KDF salt/it 的主密码离线验证器，可被离线字典爆破）只在用户
    // 显式选择「保留敏感内容」时附带；否则不写，默认备份不再携带该验证器。
    if (keepSensitive) {
      const e2eCanary = _readE2ECanary()
      if (e2eCanary) snapshot.__e2eCanary = e2eCanary
      const vaultCanary = _readVaultCanary()
      if (vaultCanary) snapshot.__vaultCanary = vaultCanary
      // 缺陷1：备份确含明文敏感字段时，导出前用现有 i18n 键明确提示妥善保管
      //（放在 downloadFile 之前，保持「数据已导出」为最后一次 toast）。
      const bms = snapshot.bookmarks as Bookmark[] | undefined
      if (bms?.some(b => b.username || b.password || b.notes)) {
        toast(t('settings.exportKeepSensitiveHint'), false)
      }
    }
    downloadFile('linkvault-backup-' + dateStamp() + '.json',
      JSON.stringify(snapshot, null, 2), 'application/json')
    toast(t('msg.dataExported'))
  } catch (e) { console.warn('[export] JSON export failed:', e); toast(t('msg.exportFailed'), false) }
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
      || (cid === CAT_UNCATEGORIZED ? t('cat.uncategorized') : t('msg.otherCategory'))

    // 复用 utils.esc（含 ' 转义），避免局部实现与属性注入防护漂移
    const esc = (s: string) => escHtml(s || '')
    const lines: string[] = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      `<TITLE>${esc(t('msg.exportHtmlTitle'))}</TITLE>`,
      `<H1>${esc(t('msg.exportHtmlH1'))}</H1>`,
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
    downloadFile('ulink-bookmarks-' + dateStamp() + '.html', lines.join('\n'), 'text/html')
    toast(tN('msg.exportedBookmarks', live.length, { format: 'HTML' }))
  } catch (e) { console.warn('[export] failed:', e); toast(t('msg.exportFailed'), false) }
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
    toast(tN('msg.exportedBookmarks', live.length, { format: 'CSV' }))
  } catch (e) { console.warn('[export] failed:', e); toast(t('msg.exportFailed'), false) }
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
    toast(tN('msg.exportedBookmarks', live.length, { format: 'Raindrop JSON' }))
  } catch (e) { console.warn('[export] failed:', e); toast(t('msg.exportFailed'), false) }
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
        // 判断是与链（ulink）原生 JSON 还是 Raindrop.io JSON
        if (validateImportData(data) === null) {
          // 缺陷5：校验通过后由 importFromDataInternal 以 AppDataSchema.safeParse(data).data
          // 作为合并输入（此处仍传原始 data 以保留 __e2eCanary 等非 schema 元数据，
          // 该函数内部会单独校验并恢复 canary）。
          importFromDataInternal(data, t('app.fullName'))
        } else if (data.items && Array.isArray(data.items)) {
          // Raindrop.io 格式：{ items: [...] }
          const bookmarks = parseRaindropJSON(data)
          if (!bookmarks.length) { toast(t('msg.raindropInvalid'), false); return }
          importFromDataInternal({ categories: [], bookmarks, customAttributes: [], siblingGroups: [] }, 'Raindrop.io')
        } else if (Array.isArray(data) && data[0]?.link) {
          // Raindrop.io 直接数组格式：[{ title, link, ... }]
          const bookmarks = parseRaindropJSON(data)
          if (!bookmarks.length) { toast(t('msg.raindropInvalid'), false); return }
          importFromDataInternal({ categories: [], bookmarks, customAttributes: [], siblingGroups: [] }, 'Raindrop.io')
        } else {
          toast(t('msg.jsonFormatUnrecognized'), false)
        }
      } else if (fmt === 'html') {
        const bookmarks = parseBookmarkHTML(content)
        if (!bookmarks.length) { toast(t('msg.noBookmarksInHtml'), false); return }
        importFromDataInternal({ categories: [], bookmarks, customAttributes: [], siblingGroups: [] }, t('settings.exportHtml'))
      } else if (fmt === 'csv') {
        const bookmarks = parseCSV(content)
        if (!bookmarks.length) { toast(t('msg.csvInvalid'), false); return }
        importFromDataInternal({ categories: [], bookmarks, customAttributes: [], siblingGroups: [] }, 'CSV')
      } else {
        toast(t('msg.unsupportedFormat'), false)
      }
    } catch (e) { toast(t('msg.importFailed', { msg: (e as Error).message }), false) }
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
  // 缺陷11：与同步去重（syncDedup.normalizeSyncUrl）共用同一 URL 内容键，
  // 避免导入按 toLowerCase、同步按 URL 归一化去尾斜杠导致同一内容两套判据。
  const existingUrls = new Set(ds.bookmarks.filter(b => !b.deletedAt).map(b => normalizeSyncUrl(b.url || '')).filter(Boolean))
  // order 基线用现存最大 order+1（而非 bookmarks.length），避免永久删缩短后新值与现存项重复
  const orderBase = ds.nextBookmarkOrder()
  for (const b of bookmarks) {
    if (!b.title || !b.url) continue
    if (ds.bookmarks.some(existing => existing.id === b.id)) continue
    const urlKey = normalizeSyncUrl(b.url)
    if (existingUrls.has(urlKey)) continue
    const now = Date.now()
    const parsed = BookmarkSchema.safeParse({
      id: b.id || newBookmarkId(imported),
      title: b.title,
      url: b.url,
      username: b.username || '',
      password: b.password || '',
      notes: b.notes || '',
      icon: b.icon || '',
      categoryId: b.categoryId && ds.categoryMap[b.categoryId] ? b.categoryId : CAT_UNCATEGORIZED,
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
    existingUrls.add(urlKey)
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

  // 缺陷5：canary 是 AppDataSchema 未声明的附带字段（safeParse 会 strip），必须在
  // 换成校验后数据之前先从原始 data 取出校验并写回本地；不合法结构跳过并提示，
  // 避免伪造 canary 写回后把解锁入口永久锁死。仅本机尚无对应 canary 时恢复（本地优先）。
  const importDataAny = data as Partial<AppData> & { __e2eCanary?: unknown; __vaultCanary?: unknown }
  _restoreCanary(importDataAny.__e2eCanary, '__e2eCanary', {
    read: _readE2ECanary, write: _writeE2ECanary, enable: () => useE2EStore().setEnabled(true),
  })
  _restoreCanary(importDataAny.__vaultCanary, '__vaultCanary', {
    read: _readVaultCanary, write: _writeVaultCanary, enable: () => useVaultStore().setEnabled(true),
  })

  // 缺陷5：以 Zod 校验后的数据作为合并/迁移输入，令 AppDataSchema 的 strip/coerce
  // 真正生效（旧实现只判 safeParse.success 却继续用原始 data，畸形/多余字段原样入库）。
  // 非 LinkVault 格式（Raindrop/HTML/CSV）元素可能不满足严格 schema，解析失败时回退
  // 原始 data，保持既有兼容行为。
  const parsed = AppDataSchema.safeParse(data)
  const effective: Partial<AppData> = parsed.success ? parsed.data : data
  // 执行数据迁移（处理旧版格式）
  const result = {
    categories: [...(effective.categories || [])],
    bookmarks: [...(effective.bookmarks || [])],
    customAttributes: [...(effective.customAttributes || [])],
    siblingGroups: [...(effective.siblingGroups || [])],
  }
  runMigrations(effective, result)

  const { categories, bookmarks, customAttributes, siblingGroups } = result

  try { persist.saveToLocalStorage(ds._dataSnapshot(), useUIStore().curSpace) } catch (e) { console.warn('[import] backup before import failed:', e) }

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
    toast(t('msg.importAllExists', { source }) + (skipped ? tN('msg.importSkippedSuffix', skipped) : ''))
  } else {
    const parts: string[] = []
    if (bms.imported) parts.push(tN('msg.importedBookmarks', bms.imported))
    if (cats.imported) parts.push(tN('msg.importedCategories', cats.imported))
    if (groups.imported) parts.push(tN('msg.importedGroups', groups.imported))
    if (attrs.imported) parts.push(tN('msg.importedAttributes', attrs.imported))
    const skippedMsg = skipped ? tN('msg.importSkippedSuffix', skipped) : ''
    toast(t('msg.importSummary', { source, list: parts.join(t('msg.listSeparator')) }) + skippedMsg)
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
    ? t('msg.resetAllConfirmLoggedIn')
    : t('msg.resetAllConfirm')
  const ok = await showConfirm(msg)
  if (!ok) return
  const damSnapshot = new Map<string, Array<{ entityId: string; kind: 'bookmark' | 'group' }>>()
  for (const [k, v] of ds._deletedAttrMemberships) damSnapshot.set(k, v.map(m => ({ ...m })))
  const dgmSnapshot = new Map<string, string[]>()
  for (const [k, v] of ds._deletedGroupMemberships) dgmSnapshot.set(k, [...v])
  const snapshot = {
      categories: cloneDeep(ds.categories),
      bookmarks: cloneDeep(ds.bookmarks),
      customAttributes: cloneDeep(ds.customAttributes),
      siblingGroups: cloneDeep(ds.siblingGroups),
      curCat: ui.curCat,
    }
    const d = cloneDeep(buildSeedDefaults())
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
    ds._deletedGroupMemberships.clear()
    ds._deletedAttrMemberships.clear()
    safeSetItem(DGM_KEY, '[]')
    safeSetItem(DAM_KEY, '[]')
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
    useUndoStore().clearAllStacks()
    saveAppData()
    toastWithUndo(t('msg.dataResetToDefault'), () => {
      ds.categories = snapshot.categories
      ds.bookmarks = snapshot.bookmarks
      ds.customAttributes = snapshot.customAttributes
      ds.siblingGroups = snapshot.siblingGroups
      ui.curCat = snapshot.curCat
      ds._deletedGroupMemberships = dgmSnapshot
      ds._deletedAttrMemberships = damSnapshot
      ds._persistDeletedGroupMemberships()
      ds._persistDeletedAttrMemberships()
      // 直接替换数组引用后必须重建索引：_bmMap/_grpMap/_catMap/_attrMap/_childrenIdx 仍指向
      // 重置前的旧数组元素，撤销恢复后全部失同步——后续 bookmarkMap[id]/childrenMap 查找
      // 会 miss、过滤/排序 getter 走懒回退分支（性能退化）、_syncMaps 才能恢复正常索引。
      ds._syncMaps()
      debouncedSaveAppData()
      toast(t('msg.dataRestored'))
    })
  }
