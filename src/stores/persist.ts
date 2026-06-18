import { STORAGE_KEY, DEFAULTS } from '../config/constants.js'
import { runMigrations } from './migrations.js'
import { idbGet, idbSet } from './storage.js'
import type { AppData } from '../types.js'

const IDB_KEY = 'linkvault_v2'

let _localSavedAt = 0

interface StorageInfo {
  size: number
  percent: number
  label: string
}

export function loadFromLocalStorage(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      _localSavedAt = d._savedAt || 0
      const result: AppData = {
        categories: d.categories || DEFAULTS.categories.slice(),
        bookmarks: d.bookmarks || [],
        customAttributes: d.customAttributes || [],
        siblingGroups: d.siblingGroups || []
      }
      const needsPersist = runMigrations(d, result)
      if (needsPersist) saveToLocalStorage(result)
      return result
    }
  } catch (e) { console.warn('[persist] localStorage load failed:', (e as Error).message) }
  return JSON.parse(JSON.stringify(DEFAULTS))
}

export async function loadFromIDB(): Promise<AppData | null> {
  try {
    const idbData = await idbGet(IDB_KEY)
    if (idbData && idbData.bookmarks) {
      if ((idbData._savedAt || 0) >= _localSavedAt) return idbData
    }
  } catch (e) { console.warn('[persist] IDB load fallback:', (e as Error).message) }
  return null
}

export function saveToLocalStorage(data: AppData): boolean {
  try {
    const stamped = { ...data, _savedAt: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped))
  } catch (e) {
    console.warn('[persist] localStorage save failed:', (e as Error).message)
    return false
  }
  return true
}

let _idbTimer: ReturnType<typeof setTimeout> | null = null
export function saveToIDB(data: AppData): void {
  if (_idbTimer) clearTimeout(_idbTimer)
  _idbTimer = setTimeout(() => {
    _idbTimer = null
    const plain = JSON.parse(JSON.stringify(data))
    plain._savedAt = Date.now()
    idbSet(IDB_KEY, plain).catch((e: Error) =>
      console.warn('[persist] IDB sync failed:', e.message))
  }, 500)
}

export function getStorageInfo(data: AppData): StorageInfo {
  try {
    const bytes = new Blob([JSON.stringify(data)]).size
    const sizeKB = bytes / 1024
    const percent = Math.min(100, Math.round(bytes / 5242880 * 100))
    return {
      size: sizeKB, percent,
      label: sizeKB < 1024
        ? sizeKB.toFixed(1) + ' KB'
        : (sizeKB / 1024).toFixed(1) + ' MB'
    }
  } catch (_) { return { size: 0, percent: 0, label: '0 KB' } }
}
