/**
 * storage.ts — IndexedDB 持久化层（Dexie.js）
 * 作为 localStorage 的增强方案，突破 5MB 限制
 * B6: 新增 pendingOps 表，支持离线操作队列
 * P0: 结构化 ops_queue — queue-based sync
 */
import Dexie from 'dexie'

interface IDBRow {
  key: string
  value: any
  updatedAt: number
}

export type OpAction = 'upsert' | 'delete'
export type OpTable = 'bookmarks' | 'sibling_groups' | 'categories' | 'custom_attributes'

export interface SyncOp {
  id?: number
  action: OpAction
  table: OpTable
  itemId: string
  data: Record<string, unknown> | null
  ts: number
  retries: number
}

export interface PendingOp {
  id?: number
  type: string
  payload: any
  createdAt: number
  retries: number
}

class LinkVaultDB extends Dexie {
  data!: Dexie.Table<IDBRow, string>
  pendingOps!: Dexie.Table<PendingOp, number>
  syncOps!: Dexie.Table<SyncOp, number>

  constructor() {
    super('linkvault')
    this.version(1).stores({
      data: 'key',
    })
    this.version(2).stores({
      data: 'key',
      pendingOps: '++id,createdAt',
    })
    this.version(3).stores({
      data: 'key',
      pendingOps: '++id,createdAt',
      syncOps: '++id,itemId,table,ts',
    })
  }
}

const db = new LinkVaultDB()

export async function idbSet(key: string, value: any): Promise<void> {
  try {
    await db.data.put({ key, value, updatedAt: Date.now() })
  } catch (e) {
    console.warn('[IDB] set error:', e)
  }
}

export async function idbGet(key: string): Promise<any | null> {
  try {
    const row = await db.data.get(key)
    return row?.value ?? null
  } catch (e) {
    console.warn('[IDB] get error:', e)
    return null
  }
}

// ── 离线操作队列 ──

export async function enqueueOp(type: string, payload: any): Promise<void> {
  try {
    await db.pendingOps.add({ type, payload, createdAt: Date.now(), retries: 0 })
  } catch (e) {
    console.warn('[IDB] enqueue error:', e)
  }
}

export async function drainPendingOps(): Promise<PendingOp[]> {
  try {
    return await db.pendingOps.orderBy('id').toArray()
  } catch (e) {
    console.warn('[IDB] drain error:', e)
    return []
  }
}

export async function removePendingOp(id: number): Promise<void> {
  try {
    await db.pendingOps.delete(id)
  } catch (e) {
    console.warn('[IDB] remove op error:', e)
  }
}

export async function clearPendingOps(): Promise<void> {
  try {
    await db.pendingOps.clear()
  } catch (e) {
    console.warn('[IDB] clear ops error:', e)
  }
}

export async function pendingOpsCount(): Promise<number> {
  try {
    return await db.pendingOps.count()
  } catch (_) {
    return 0
  }
}

// ── 结构化同步队列（P0）──

export async function enqueueSyncOp(op: Omit<SyncOp, 'id' | 'retries'>): Promise<void> {
  try {
    await db.syncOps.add({ ...op, retries: 0 })
  } catch (e) {
    console.warn('[IDB] enqueueSyncOp error:', e)
  }
}

export async function enqueueSyncOps(ops: Array<Omit<SyncOp, 'id' | 'retries'>>): Promise<void> {
  if (!ops.length) return
  try {
    await db.syncOps.bulkAdd(ops.map(op => ({ ...op, retries: 0 })))
  } catch (e) {
    console.warn('[IDB] enqueueSyncOps error:', e)
  }
}

export async function drainSyncOps(): Promise<SyncOp[]> {
  try {
    return await db.syncOps.orderBy('id').toArray()
  } catch (e) {
    console.warn('[IDB] drainSyncOps error:', e)
    return []
  }
}

export async function removeSyncOp(id: number): Promise<void> {
  try {
    await db.syncOps.delete(id)
  } catch (e) {
    console.warn('[IDB] removeSyncOp error:', e)
  }
}

export async function removeSyncOps(ids: number[]): Promise<void> {
  if (!ids.length) return
  try {
    await db.syncOps.bulkDelete(ids)
  } catch (e) {
    console.warn('[IDB] removeSyncOps error:', e)
  }
}

export async function clearSyncOps(): Promise<void> {
  try {
    await db.syncOps.clear()
  } catch (e) {
    console.warn('[IDB] clearSyncOps error:', e)
  }
}

export async function syncOpsCount(): Promise<number> {
  try {
    return await db.syncOps.count()
  } catch (_) {
    return 0
  }
}

export async function getSyncOpsByItem(itemId: string): Promise<SyncOp[]> {
  try {
    return await db.syncOps.where('itemId').equals(itemId).toArray()
  } catch (e) {
    console.warn('[IDB] getSyncOpsByItem error:', e)
    return []
  }
}
