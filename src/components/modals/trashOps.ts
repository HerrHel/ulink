import type { useDataStore } from '../../stores/data.js'

/**
 * 回收站多选辅助：type/id 编码与按类型分发到 data store 的单 id 方法。
 * store action 依赖 this，helper 一律收 store 实例调用，不能解构 action 后传入。
 */
export type TrashType = 'bookmark' | 'group' | 'category' | 'attribute'

type DataStore = ReturnType<typeof useDataStore>

/** 选中 key 编码：`type:id`（与主界面 batchSelected 的 `group:` 前缀同惯用法） */
export const trashKey = (t: TrashType, id: string) => `${t}:${id}`

/** 解析选中 key，只切第一个冒号（id 本身可含冒号） */
export function splitTrashKey(k: string): { type: TrashType; id: string } {
  const i = k.indexOf(':')
  return { type: k.slice(0, i) as TrashType, id: k.slice(i + 1) }
}

const restoreFns: Record<TrashType, (ds: DataStore, id: string) => void> = {
  bookmark: (ds, id) => ds.restoreBookmark(id),
  group: (ds, id) => ds.restoreGroup(id),
  category: (ds, id) => ds.restoreCategory(id),
  attribute: (ds, id) => ds.restoreAttribute(id),
}

const permanentFns: Record<TrashType, (ds: DataStore, id: string) => void> = {
  bookmark: (ds, id) => ds.permanentDeleteBookmark(id),
  group: (ds, id) => ds.permanentDeleteGroup(id),
  category: (ds, id) => ds.permanentDeleteCategory(id),
  attribute: (ds, id) => ds.permanentDeleteAttribute(id),
}

/** 批量恢复：按 type 分发到对应单 id 方法 */
export function restoreItems(ds: DataStore, items: Array<{ type: TrashType; id: string }>) {
  for (const it of items) restoreFns[it.type](ds, it.id)
}

/** 批量永久删除：按 type 分发到对应单 id 方法 */
export function permanentDeleteItems(ds: DataStore, items: Array<{ type: TrashType; id: string }>) {
  for (const it of items) permanentFns[it.type](ds, it.id)
}
