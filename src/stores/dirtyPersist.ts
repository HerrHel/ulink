/**
 * dirtyPersist.ts — 主页空间「待同步标记」落盘
 *
 * 旧实现的 _dirtyIds / _newIds / _deletedIds / _changedFields 只在内存里：未登录时
 * enqueueDirtyAsOps 直接 return（不入队），一刷新标记全丢。之后重新登录，「云端已有
 * 该 id」的离线修改不会再被补推，本地与云端永久分叉。
 *
 * 现在随主页数据一起落到 lv_sync_dirty_v1（随账号分仓走，见 lib/dataOwner.ts），
 * 启动与切回主页时并回内存。
 */
import { safeGetItem, safeSetItem, safeJsonParse } from '../lib/storageSafe.js'
import { isWriteAllowed } from '../lib/dataOwner.js'
import type { TableName } from '../types.js'

export const K_SYNC_DIRTY = 'lv_sync_dirty_v1'

interface DirtyShape {
  dirty: string[]
  added: string[]
  deleted: Array<[string, TableName]>
  fields: Array<[string, string[]]>
}

interface DirtyHolder {
  _dirtyIds: Set<string>
  _newIds: Set<string>
  _deletedIds: Map<string, TableName>
  _changedFields: Map<string, Set<string>>
}

/** 把内存标记写盘（调用方保证当前是主页空间） */
export function persistDirty(ds: DirtyHolder): void {
  if (!isWriteAllowed()) return
  const shape: DirtyShape = {
    dirty: [...ds._dirtyIds],
    added: [...ds._newIds],
    deleted: [...ds._deletedIds],
    fields: [...ds._changedFields].map(([id, f]) => [id, [...f]]),
  }
  if (!shape.dirty.length && !shape.added.length && !shape.deleted.length && !shape.fields.length) {
    // 空集合也要写：覆盖掉已入队（drain）后残留的旧标记
    if (safeGetItem(K_SYNC_DIRTY) === null) return
  }
  safeSetItem(K_SYNC_DIRTY, JSON.stringify(shape))
}

/** 把落盘标记并回内存（取并集，不覆盖内存里已有的） */
export function restoreDirty(ds: DirtyHolder): void {
  const s = safeJsonParse<Partial<DirtyShape> | null>(safeGetItem(K_SYNC_DIRTY), null)
  if (!s) return
  for (const id of s.dirty || []) if (typeof id === 'string') ds._dirtyIds.add(id)
  for (const id of s.added || []) if (typeof id === 'string') ds._newIds.add(id)
  for (const pair of s.deleted || []) {
    if (Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
      ds._deletedIds.set(pair[0], pair[1])
    }
  }
  for (const pair of s.fields || []) {
    if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !Array.isArray(pair[1])) continue
    const set = ds._changedFields.get(pair[0]) ?? new Set<string>()
    for (const f of pair[1]) if (typeof f === 'string') set.add(f)
    ds._changedFields.set(pair[0], set)
  }
}
