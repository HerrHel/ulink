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
import { getLocale } from '../i18n/index.js'
import { getWelcomeNotes } from '../config/welcome-data.js'

// 当前 schema 迁移版本。增量更新此值以触发新迁移。
// 注意：与 persist 的 _writeSeq（写入序号）无关；勿再用 _dataVersion 混用。
export const CURRENT_SCHEMA_VERSION = 4

interface MigrationResult extends AppData {
}

/**
 * 读取用于迁移门控的 schema 版本。
 * 兼容旧盘：历史上 saveData 把进程计数写进 _dataVersion，会远大于 CURRENT。
 * 此时若无 _schemaVersion，则视为「已是当前 schema 语义未知」——仍跑幂等迁移并落 _schemaVersion。
 */
// 仅 export 供护栏单测直测版本门控四分支（D1-30），纯加测试零逻辑改动同 _migrateTextNotes 口径
export function _readSchemaVersion(d: Partial<AppData>): number {
  const schema = (d as { _schemaVersion?: number })._schemaVersion
  if (typeof schema === 'number' && Number.isFinite(schema)) return schema
  // 旧字段 _dataVersion 历史上承载的是写入序号（writeSeq），小整数（如 3）同样可能是
  // 序号而非真实 schema 版本。把它当 schema 版本会让迁移在 from>=CURRENT 处整体早退，
  // 默认分类补种/笔记转 HTML/属性 id 重写等清洗被永久跳过且无提示。
  // 缺 _schemaVersion 时一律视为 0，跑完全部幂等迁移（各步骤均可重复执行）。
  return 0
}

/**
 * 执行所有数据迁移
 * @param d - 原始数据对象
 * @param result - 包含 { categories, bookmarks, customAttributes, siblingGroups }
 * @returns 是否需要持久化
 */
/**
 * 历代官方「上手指南」正文（去标签、压空白后）的 FNV-1a 哈希，由 git 历史中 welcome-data.ts 各版本算出。
 * 用户笔记与其中任一完全一致 = 没动过，可安全换成当前版本；改过一个字就不碰。
 * 不含当前版本；以后改指南文案时，把改前版本的哈希追加进来。
 */
const OLD_GUIDE_HASHES = new Set([
  '1u99euv', 'yuciku', 'sn7ewv', '1t615x5', '1s7142a', '86sex1', '1z0s2ct', '1jyv2lv',
  '1z02pcm', 'rao7u5', '98hhn3', 'hwl9v1', 'rsjtsq', '19y4yqb', '1lv4jb0',
  '15gp490', 'ad637m', // 2026-11-25 加「看看宣传页」卡片前的中 / 英版
])
function guideTextHash(html: string): string {
  const s = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}
export function isUneditedOldGuide(html: string): boolean {
  return OLD_GUIDE_HASHES.has(guideTextHash(html))
}

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

  if (!Array.isArray(result.categories)) result.categories = DEFAULTS.categories.slice()
  if (!Array.isArray(result.bookmarks)) result.bookmarks = []
  if (!Array.isArray(result.siblingGroups)) result.siblingGroups = []
  if (!Array.isArray(result.customAttributes)) result.customAttributes = []

  // 1. 确保默认分类存在
  DEFAULTS.categories.forEach(dc => {
    if (!result.categories.find(c => c.id === dc.id)) result.categories.push(dc)
  })

  // 2. 属性去重
  const attrs = d.customAttributes || []
  // 缺陷4：用 Map 而非 {} 作去重索引，避免 a.name 为 '__proto__'/'constructor'/'toString'
  // 等原型链键时命中原型、赋值污染数据（keep.id=undefined）；并对 name 做字符串型
  // 与黑名单校验，畸形名不参与索引（按无 name 保留，绝不写进索引）。
  const seen = new Map<string, CustomAttribute>()
  const UNSAFE_ATTR_NAMES = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'])
  const deduped: CustomAttribute[] = []
  attrs.forEach((a: CustomAttribute) => {
    if (!a || typeof a !== 'object' || !a.id) return
    if (typeof a.name !== 'string' || !a.name || UNSAFE_ATTR_NAMES.has(a.name)) { deduped.push(a); return }
    const keep = seen.get(a.name)
    if (keep) {
      // 审计 R6：步骤2 属性去重只重写 bookmark 的 attributes，group 残留旧 attr id。
      // dedup 后 customAttributes 删旧 id，组的 g.attributes 旧 id 永久失联
      // （attributeMap[旧id]=undefined → 组标签消失）。这里对 siblingGroups
      // 做与 bookmark 完全对称的 attr id 重写。
      const bms = result.bookmarks || d.bookmarks || [];
      bms.forEach((b: Bookmark) => {
        if (b.attributes && b.attributes[a.id]) {
          b.attributes[keep.id] = b.attributes[a.id]
          delete b.attributes[a.id]
        }
      });
      const grps = result.siblingGroups || d.siblingGroups || [];
      grps.forEach((g: SiblingGroup) => {
        if (g.attributes && g.attributes[a.id]) {
          g.attributes[keep.id] = g.attributes[a.id]
          delete g.attributes[a.id]
        }
      })
    } else { seen.set(a.name, a); deduped.push(a) }
  })
  result.customAttributes = deduped
  if (attrs.length !== deduped.length) needsPersist = true

  // 确保内置「笔记」属性在存在时非旧名「组」，且未软删
  const legacyGroupAttr = result.customAttributes.find(a => a.id === ATTR_IS_GROUP && a.name === '组')
  if (legacyGroupAttr) {
    legacyGroupAttr.name = '笔记'
    needsPersist = true
  }
  const deletedGroupAttr = result.customAttributes.find(a => a.id === ATTR_IS_GROUP && a.deletedAt)
  if (deletedGroupAttr) {
    delete deletedGroupAttr.deletedAt
    needsPersist = true
  }

  // 3. 分类迁移
  result.bookmarks.forEach(b => { if (b.categoryId === CAT_ALL) b.categoryId = CAT_UNCATEGORIZED })
  result.siblingGroups.forEach(g => {
    if (g.categoryId === CAT_ALL) g.categoryId = CAT_UNCATEGORIZED
    if (!g.attributes) g.attributes = { [ATTR_IS_GROUP]: true }
    if (!Array.isArray(g.bookmarkIds)) { (g as { bookmarkIds: string[] }).bookmarkIds = []; needsPersist = true }
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
    const rawEs = safeJsonParse<Record<string, unknown>>(safeGetItem('lv_expandStates'), {})
    const _es = rawEs && typeof rawEs === 'object' && !Array.isArray(rawEs) ? rawEs : {}
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

  // 8. 内置 AI 属性改名「Ai」→「AI」（v3）：早期种子大小写不规范，卡片徽章显示为 typo。
  //    幂等：仅当 id='ai' 且 name 恰为 'Ai' 时改写；用户自定义同 id 改过名的（如「AI 工具」）不受影响。
  const aiAttr = result.customAttributes.find(a => a.id === 'ai')
  if (aiAttr && aiAttr.name === 'Ai') {
    aiAttr.name = 'AI'
    needsPersist = true
  }

  // 9. 更新过时的「上手指南」引导笔记（v4）：清理历史版本遗留的过时文案（如「侧边栏底部导入导出」「点详按钮」等）
  const welcomeGroup = result.siblingGroups.find(g => g.id === 'sg_welcome')
  if (welcomeGroup && typeof welcomeGroup.notes === 'string') {
    const n = welcomeGroup.notes
    if (
      isUneditedOldGuide(n) ||
      n.includes('导入导出在侧边栏底部') ||
      n.includes('点详按钮') ||
      n.includes('组功能详解') ||
      n.includes('storage usage shown in the sidebar') ||
      n.includes('Click the <u>i</u> on a bookmark') ||
      n.includes('Group features in detail')
    ) {
      welcomeGroup.notes = getWelcomeNotes(getLocale())
      needsPersist = true
    }
  }

  // 始终写入 schema 版本（与 writeSeq 分离）
  ;(result as { _schemaVersion?: number })._schemaVersion = CURRENT_SCHEMA_VERSION
  needsPersist = true

  return needsPersist
}

// 仅 export 供护栏单测直测（D1-13），纯加测试零逻辑改动同 D2-4 同文件口径
export function _migrateTextNotes(text: string, bookmarks: Bookmark[], siblingGroups: SiblingGroup[], group: SiblingGroup): string {
  const ids: string[] = []
  const re = /\[([^\]]+)\]\(([a-zA-Z0-9]+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const bm = bookmarks.find(x => x.id === m![2])
    if (bm && ids.indexOf(m[2]) < 0) ids.push(m[2])
  }
  let html = ''
  let lastIdx = 0
  const re2 = /\[([^\]]+)\]\(([a-zA-Z0-9]+)\)|(?<=^|\s)@([^\s@]+)/g
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
  if (!Array.isArray(group.bookmarkIds)) (group as { bookmarkIds: string[] }).bookmarkIds = []
  ids.forEach(id => { if (group.bookmarkIds.indexOf(id) < 0) group.bookmarkIds.push(id) })
  return html
}

// L13：内联卡 HTML 统一走 useInlineCard（含 esc），删除未转义的 _mig* 副本
