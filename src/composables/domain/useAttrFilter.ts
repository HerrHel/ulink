/**
 * useAttrFilter — 属性筛选逻辑
 * 从 ui/attr-filter.js 迁移，供 AttrDropdown.vue 和 legacy 代码使用
 */
import { gid } from '../../utils.js'
import { useAppStore } from '../../stores/app.js'

export function toggleAttrFilter(attrId: string) {
  const store = useAppStore()
  const activeIdx = store.activeAttrs.indexOf(attrId)
  if (activeIdx !== -1) {
    store.activeAttrs.splice(activeIdx, 1)
  } else {
    store.activeAttrs.push(attrId)
    const exclIdx = store.excludedAttrs.indexOf(attrId)
    if (exclIdx > -1) store.excludedAttrs.splice(exclIdx, 1)
  }
}

export function toggleAttrExclude(attrId: string) {
  const store = useAppStore()
  const exclIdx = store.excludedAttrs.indexOf(attrId)
  if (exclIdx !== -1) {
    store.excludedAttrs.splice(exclIdx, 1)
  } else {
    store.excludedAttrs.push(attrId)
    const activeIdx = store.activeAttrs.indexOf(attrId)
    if (activeIdx > -1) store.activeAttrs.splice(activeIdx, 1)
  }
}

export function addAttrQuick(name: string): boolean {
  if (!name) return false
  const store = useAppStore()
  const id = name.replace(/[\s]+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || gid()
  if (store.customAttributes.find(function (a) { return a.id === id || a.name === name })) return false
  store.customAttributes.push({ id: id, name: name, type: 'boolean' })
  store.save()
  return true
}
