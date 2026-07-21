/**
 * migrations.ts — 数据迁移逻辑
 * 从 data.js load() 函数提取的迁移规则。
 * 在数据加载后执行，确保旧版数据格式兼容。
 */
import { CAT_ALL, CAT_UNCATEGORIZED, ATTR_IS_GROUP, DEFAULTS } from '../config/constants.js'
import { esc, cleanZeroWidth } from '../utils.js'
import { inlineCardHTML, groupRefCardHTML } from '../composables/useInlineCard.js'
import { safeGetItem, safeRemoveItem, safeJsonParse } from '../lib/storageSafe.js'
import type { AppData, Bookmark, SiblingGroup, CustomAttribute } from '../types.js'

// 当前 schema 迁移版本。增量更新此值以触发新迁移。
// 注意：与 persist 的 _writeSeq（写入序号）无关；勿再用 _dataVersion 混用。
export const CURRENT_SCHEMA_VERSION = 2

interface MigrationResult extends AppData {
}

/**
 * 读取用于迁移门控的 schema 版本。
 * 兼容旧盘：历史上 saveData 把进程计数写进 _dataVersion，会远大于 CURRENT。
 * 此时若无 _schemaVersion，则视为「已是当前 schema 语义未知」——仍跑幂等迁移并落 _schemaVersion。
 */
function _readSchemaVersion(d: Partial<AppData>): number {
  const schema = (d as { _schemaVersion?: number })._schemaVersion
  if (typeof schema === 'number' && Number.isFinite(schema)) return schema
  // 旧字段：仅当明显是「真实 schema 小整数」时信任；否则当 writeSeq 污染，强制再迁移
  const legacy = d._dataVersion
  if (typeof legacy === 'number' && legacy > 0 && legacy <= CURRENT_SCHEMA_VERSION) return legacy
  return 0
}

/**
 * 执行所有数据迁移
 * @param d - 原始数据对象
 * @param result - 包含 { categories, bookmarks, customAttributes, siblingGroups }
 * @returns 是否需要持久化
 */
export function runMigrations(d: Partial<AppData>, result: MigrationResult): boolean {
  const from = _readSchemaVersion(d)
  if (from >= CURRENT_SCHEMA_VERSION) {
    // 确保磁盘带上正确 schema 字段（从旧 _dataVersion 拆分后的一次回写）
    if ((d as { _schemaVersion?: number })._schemaVersion !== CURRENT_SCHEMA_VERSION) {
      ;(result as { _schemaVersion?: number })._schemaVersion = CURRENT_SCHEMA_VERSION
      return true
    }
    return false
  }
  let needsPersist = false

  // 1. 确保默认分类存在
  DEFAULTS.categories.forEach(dc => {
    if (!result.categories.find(c => c.id === dc.id)) result.categories.push(dc)
  })

  // 2. 属性去重
  const attrs = d.customAttributes || []
  const seen: Record<string, CustomAttribute> = {}
  const deduped: CustomAttribute[] = []
  attrs.forEach((a: CustomAttribute) => {
    if (seen[a.name]) {
      const keep = seen[a.name];
      (d.bookmarks || []).forEach((b: Bookmark) => {
        if (b.attributes && b.attributes[a.id]) {
          b.attributes[keep.id] = b.attributes[a.id]
          delete b.attributes[a.id]
        }
      })
    } else { seen[a.name] = a; deduped.push(a) }
  })
  result.customAttributes = deduped
  if (attrs.length !== deduped.length) needsPersist = true

  // 3. 分类迁移
  result.bookmarks.forEach(b => { if (b.categoryId === CAT_ALL) b.categoryId = CAT_UNCATEGORIZED })
  result.siblingGroups.forEach(g => {
    if (g.categoryId === CAT_ALL) g.categoryId = CAT_UNCATEGORIZED
    if (!g.attributes) g.attributes = { [ATTR_IS_GROUP]: true }
  })
  // D2-003：补齐分类 icon/color，避免旧盘缺字段在 schema 严格期整库回退
  result.categories.forEach(c => {
    if (typeof c.icon !== 'string') { (c as { icon: string }).icon = ''; needsPersist = true }
    if (typeof c.color !== 'string') { (c as { color: string }).color = ''; needsPersist = true }
  })

  // 4. 文本格式笔记 → HTML 内联卡片
  result.siblingGroups.forEach(g => {
    if (g.notes && !/<[a-z][\s\S]*>/i.test(g.notes)) {
      g.notes = _migrateTextNotes(g.notes, result.bookmarks, result.siblingGroups, g)
      needsPersist = true
    }
  })

  // 5. 展开状态迁移
  {
    const _es = safeJsonParse<Record<string, unknown>>(safeGetItem('lv_expandStates'), {})
    result.bookmarks.forEach(b => { if (_es[b.id]) b.isExpanded = true })
    result.siblingGroups.forEach(g => { if (_es[g.id]) g.isExpanded = true })
    safeRemoveItem('lv_expandStates')
  }

  // 6. 清理零宽字符 + 补充缺失字段
  result.siblingGroups.forEach(g => {
    if (g.notes) {
      const cleaned = cleanZeroWidth(g.notes)
      if (cleaned !== g.notes) { g.notes = cleaned; needsPersist = true }
    }
    if (!g.updatedAt) { g.updatedAt = Date.now(); needsPersist = true }
    if (g.useCount == null) { g.useCount = 0; needsPersist = true }
  })

  // 7. 补充 bookmark.updatedAt
  result.bookmarks.forEach(b => {
    if (!b.updatedAt) { b.updatedAt = b.createdAt || Date.now(); needsPersist = true }
  })

  // 始终写入 schema 版本（与 writeSeq 分离）
  ;(result as { _schemaVersion?: number })._schemaVersion = CURRENT_SCHEMA_VERSION
  needsPersist = true

  return needsPersist
}

function _migrateTextNotes(text: string, bookmarks: Bookmark[], siblingGroups: SiblingGroup[], group: SiblingGroup): string {
  const ids: string[] = []
  const re = /\[([^\]]+)\]\(([a-zA-Z0-9]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const bm = bookmarks.find(x => x.id === m![2])
    if (bm && ids.indexOf(m[2]) < 0) ids.push(m[2])
  }
  let html = ''
  let lastIdx = 0
  const re2 = /\[([^\]]+)\]\(([a-zA-Z0-9]+)\)|@(\S+)/g
  let m2: RegExpExecArray | null
  while ((m2 = re2.exec(text)) !== null) {
    html += esc(text.slice(lastIdx, m2.index))
    if (m2[1] !== undefined) {
      const bm2 = bookmarks.find(x => x.id === m2![2])
      if (bm2) html += inlineCardHTML(bm2)
      else html += esc(m2[0])
    } else if (m2[3] !== undefined) {
      const sg2 = siblingGroups.find(x => x.name === m2![3])
      if (sg2 && sg2.id !== group.id) html += groupRefCardHTML(sg2)
      else html += esc(m2[0])
    }
    lastIdx = re2.lastIndex
  }
  html += esc(text.slice(lastIdx))
  html = html.replace(/\n/g, '<br>')
  ids.forEach(id => { if (group.bookmarkIds.indexOf(id) < 0) group.bookmarkIds.push(id) })
  return html
}

// L13：内联卡 HTML 统一走 useInlineCard（含 esc），删除未转义的 _mig* 副本
