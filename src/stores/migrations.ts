/**
 * migrations.ts — 数据迁移逻辑
 * 从 data.js load() 函数提取的迁移规则。
 * 在数据加载后执行，确保旧版数据格式兼容。
 */
import { CAT_ALL, CAT_UNCATEGORIZED, ATTR_IS_GROUP, DEFAULTS } from '../config/constants.js'
import { esc, cleanZeroWidth, favicon } from '../utils.js'
import type { AppData, Bookmark, SiblingGroup } from '../types.js'

interface MigrationResult extends AppData {
  _masterCanary?: any
}

/**
 * 执行所有数据迁移
 * @param d - 原始数据对象
 * @param result - 包含 { categories, bookmarks, customAttributes, siblingGroups }
 * @returns 是否需要持久化
 */
export function runMigrations(d: any, result: MigrationResult): boolean {
  let needsPersist = false

  // 1. 确保默认分类存在
  DEFAULTS.categories.forEach(dc => {
    if (!result.categories.find(c => c.id === dc.id)) result.categories.push(dc)
  })

  // 2. 属性去重
  const attrs = d.customAttributes || []
  const seen: Record<string, any> = {}
  const deduped: any[] = []
  attrs.forEach((a: any) => {
    if (seen[a.name]) {
      const keep = seen[a.name];
      (d.bookmarks || []).forEach((b: any) => {
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

  // 4. 文本格式笔记 → HTML 内联卡片
  result.siblingGroups.forEach(g => {
    if (g.notes && !/<[a-z][\s\S]*>/i.test(g.notes)) {
      g.notes = _migrateTextNotes(g.notes, result.bookmarks, result.siblingGroups, g)
      ;(g as any)._migrated = true
    }
  })

  // 5. 展开状态迁移
  try {
    const _es = JSON.parse(localStorage.getItem('lv_expandStates') || '{}')
    result.bookmarks.forEach(b => { if (_es[b.id]) b.isExpanded = true })
    result.siblingGroups.forEach(g => { if (_es[g.id]) g.isExpanded = true })
    localStorage.removeItem('lv_expandStates')
  } catch (e) { console.warn('[Migration] expand state error:', (e as Error).message) }

  // 6. 清理零宽字符 + 补充缺失字段
  result.siblingGroups.forEach(g => {
    if (g.notes) {
      const cleaned = cleanZeroWidth(g.notes)
      if (cleaned !== g.notes) { g.notes = cleaned; (g as any)._migrated = true }
    }
    if (!g.updatedAt) { g.updatedAt = Date.now(); (g as any)._migrated = true }
    if (g.useCount == null) { g.useCount = 0; (g as any)._migrated = true }
  })

  result.siblingGroups.forEach(g => { if ((g as any)._migrated) needsPersist = true })

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
      if (bm2) html += _migInlineCardHTML(bm2)
      else html += esc(m2[0])
    } else if (m2[3] !== undefined) {
      const sg2 = siblingGroups.find(x => x.name === m2![3])
      if (sg2 && sg2.id !== group.id) html += _migGroupRefCardHTML(sg2)
      else html += esc(m2[0])
    }
    lastIdx = re2.lastIndex
  }
  html += esc(text.slice(lastIdx))
  html = html.replace(/\n/g, '<br>')
  ids.forEach(id => { if (group.bookmarkIds.indexOf(id) < 0) group.bookmarkIds.push(id) })
  return html
}

function _migInlineCardHTML(bm: Bookmark): string {
  const dm = (u => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } })(bm.url)
  return '<span class="group-inline-card" contenteditable="false" data-bm-id="' + bm.id + '" draggable="true"><img src="' + favicon(bm.url, bm.icon) + '" alt=""><span class="gic-name">' + esc(bm.title) + '</span><span class="gic-domain">' + dm + '</span><span class="gic-btn">详</span></span>'
}

function _migGroupRefCardHTML(g: SiblingGroup): string {
  return '<span class="group-inline-card group-ref-card" contenteditable="false" data-bm-id="ref:' + g.id + '" draggable="true"><span class="gic-name">' + esc(g.name || '未命名组') + '</span><span class="gic-count">' + g.bookmarkIds.length + '个书签</span><span class="gic-btn">详</span></span>'
}
