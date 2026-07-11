/**
 * storage.ts �?IndexedDB 持久化层（Dexie.js�?
 * 作为 localStorage 的增强方案，突破 5MB 限制
 * P0: 结构�?ops_queue �?queue-based sync
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

class LinkVaultDB extends Dexie {
  data!: Dexie.Table<IDBRow, string>
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

// ── 结构化同步队列（P0）──

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

export async function removeSyncOps(ids: number[]): Promise<void> {
  if (!ids.length) return
  try {
    await db.syncOps.bulkDelete(ids)
  } catch (e) {
    console.warn('[IDB] removeSyncOps error:', e)
  }
}

/** 更新某条 op 的重试计数（失败时累计，用于判定是否达上限移除） */
export async function updateSyncOpRetry(id: number, retries: number): Promise<void> {
  try {
    await db.syncOps.update(id, { retries })
  } catch (e) {
    console.warn('[IDB] updateSyncOpRetry error:', e)
  }
}

export async function syncOpsCount(): Promise<number> {
  try {
    return await db.syncOps.count()
  } catch (e) { console.warn('[IDB] syncOpsCount error:', e); return 0 }
}

// ── 本地版本历史（C2：下放给本地用户，存储于 localStorage）──

export interface LocalHistoryVersion {
  id: number
  data: Record<string, unknown>
  created_at: string
}

const _histKey = (itemId: string) => 'lv_hist:' + itemId

export function fetchLocalHistory(itemId: string): LocalHistoryVersion[] {
  try {
    const raw = localStorage.getItem(_histKey(itemId))
    return raw ? JSON.parse(raw) as LocalHistoryVersion[] : []
  } catch (e) { console.warn('[IDB] fetchLocalHistory error:', e); return [] }
}

/** �?historyId 取本地某版本 data，供 restore 回退用�?*/
export function getLocalHistoryVersion(itemId: string, historyId: number): Record<string, unknown> | null {
  const arr = fetchLocalHistory(itemId)
  const v = arr.find(x => x.id === historyId)
  return v?.data ?? null
}
