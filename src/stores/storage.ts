/**
 * storage.ts — IndexedDB 持久化层（Dexie.js）
 * 作为 localStorage 的增强方案，突破 5MB 限制
 * B6: 新增 pendingOps 表，支持离线操作队列
 */
import Dexie from 'dexie'

interface IDBRow {
  key: string
  value: any
  updatedAt: number
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

  constructor() {
    super('linkvault')
    this.version(1).stores({
      data: 'key',
    })
    this.version(2).stores({
      data: 'key',
      pendingOps: '++id,createdAt',
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
