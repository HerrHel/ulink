/**
 * storage.ts — IndexedDB 持久化层（Dexie.js）
 * 作为 localStorage 的增强方案，突破 5MB 限制
 */
import Dexie from 'dexie'

interface IDBRow {
  key: string
  value: any
  updatedAt: number
}

class LinkVaultDB extends Dexie {
  data!: Dexie.Table<IDBRow, string>

  constructor() {
    super('linkvault')
    this.version(1).stores({
      data: 'key',
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
