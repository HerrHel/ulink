/**
 * useDataIO — 数据导入导出与分享
 * 从 store actions 提取，使 store 聚焦于数据 + CRUD。
 */
import { useAppStore } from '../../stores/app.js'
import { useDataStore } from '../../stores/data.js'
import { toast, showConfirm } from '../../lib/toast.js'
import { DEFAULTS } from '../../config/constants.js'
import { copyToClipboard } from '../../utils.js'

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

export function importData(file) {
  const store = useAppStore()
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result)
      const err = validateImportData(data)
      if (err) { toast(err, false); return }
      try { store._backupBeforeImport() } catch (_) { /* 备份失败不阻塞导入 */ }
      store.importFromData(data)
      toast('数据已导入 (' + store.bookmarks.length + ' 个书签)')
    } catch (e) { toast('导入失败：' + e.message, false) }
  }
  reader.readAsText(file)
}

function validateImportData(data) {
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

export function resetToDefaults() {
  const store = useAppStore()
  const ds = useDataStore()
  showConfirm('确认清除所有数据？这将恢复为默认状态，且不可撤销。', () => {
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
    toast('数据已重置为默认')
  })
}

export function shareGroup(gid) {
  const store = useAppStore()
  const sg = store.groupMap[gid]
  if (!sg) { toast('组不存在', false); return }
  const bms = sg.bookmarkIds.map(bid => store.bookmarkMap[bid]).filter(Boolean).map(b => {
    const safe = { ...b }
    delete safe.password
    delete safe.username
    return safe
  })
  const payload = { v: 1, group: { ...sg }, bookmarks: bms }
  const json = JSON.stringify(payload)
  const b64 = btoa(unescape(encodeURIComponent(json)))
  if (b64.length > 30000) { toast('组内容过大，无法生成分享链接', false); return }
  const url = location.origin + location.pathname + '#share=' + b64
  copyToClipboard(url, '分享链接')
}

export function importFromURL() {
  const store = useAppStore()
  const hash = location.hash
  if (!hash || !hash.startsWith('#share=')) return false
  try {
    const json = decodeURIComponent(escape(atob(hash.slice(7))))
    const payload = JSON.parse(json)
    if (!payload.group?.id) { toast('分享数据格式错误', false); return true }
    let imported = 0
    for (const b of payload.bookmarks || []) {
      if (!store.bookmarkMap[b.id]) { store.bookmarks.push(b); imported++ }
    }
    const existing = store.groupMap[payload.group.id]
    if (existing) {
      for (const bid of payload.group.bookmarkIds) {
        if (!existing.bookmarkIds.includes(bid)) existing.bookmarkIds.push(bid)
      }
      if (payload.group.notes && !existing.notes) existing.notes = payload.group.notes
      toast('已更新组「' + (existing.name || '未命名') + '」（新增 ' + imported + ' 个书签）')
    } else {
      store.siblingGroups.push(payload.group)
      toast('已导入组「' + (payload.group.name || '未命名') + '」（' + (payload.bookmarks || []).length + ' 个书签）')
    }
    store.save()
    history.replaceState(null, '', location.pathname + location.search)
    return true
  } catch (_) { toast('分享链接解析失败', false); return true }
}
