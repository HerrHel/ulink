/**
 * useAttrFilter — 属性筛选逻辑
 * 从 ui/attr-filter.js 迁移，供 AttrDropdown.vue 和 legacy 代码使用
 */
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { saveAppData } from '../../stores/app.js'
import { gid } from '../../utils.js'

export function toggleAttrFilter(attrId: string) {
  const ui = useUIStore()
  const activeIdx = ui.activeAttrs.indexOf(attrId)
  if (activeIdx !== -1) {
    ui.activeAttrs.splice(activeIdx, 1)
  } else {
    ui.activeAttrs.push(attrId)
    const exclIdx = ui.excludedAttrs.indexOf(attrId)
    if (exclIdx > -1) ui.excludedAttrs.splice(exclIdx, 1)
  }
}

export function toggleAttrExclude(attrId: string) {
  const ui = useUIStore()
  const exclIdx = ui.excludedAttrs.indexOf(attrId)
  if (exclIdx !== -1) {
    ui.excludedAttrs.splice(exclIdx, 1)
  } else {
    ui.excludedAttrs.push(attrId)
    const activeIdx = ui.activeAttrs.indexOf(attrId)
    if (activeIdx > -1) ui.activeAttrs.splice(activeIdx, 1)
  }
}

export function addAttrQuick(name: string): boolean {
  if (!name) return false
  const ds = useDataStore()
  const dsId = name.replace(/[\s]+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || gid()
  if (ds.customAttributes.find(function (a) { return a.id === dsId || a.name === name })) return false
  ds.addAttribute({ id: dsId, name: name, type: 'boolean' })
  saveAppData()
  return true
}
