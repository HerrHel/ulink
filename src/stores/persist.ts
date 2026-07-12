/**
 * persist.ts — 持久化层（IDB 权威 + localStorage 缓存）
 *
 * 架构变更（2026-07）：
 * - IndexedDB 是权威数据存储
 * - localStorage 仅作快速启动缓存（尽力同步）
 * - 单调递增版本号 `_dataVersion` 取代时间戳 `_savedAt`，
 *   避免系统时间变化导致的数据偏斜
 * - 写入策略：IDB 先写 → 成功后再写 localStorage（尽力），
 *   任一失败不回滚另一端（不阻塞主流程）
 */
import { STORAGE_KEY, DEFAULTS } from '../config/constants.js'
import { runMigrations } from './migrations.js'
import { idbGet, idbSet } from './storage.js'
import { AppDataSchema } from '../schemas.js'
import type { AppData } from '../types.js'

const IDB_KEY = 'linkvault_v2'

// 单调递增版本号（进程内，不持久化）
let _dataVersion = 0

export interface StorageInfo {
  size: number
  percent: number
  label: string
}

// ── 写入 ──

/**
 * 保存数据到 IDB（权威）和 localStorage（缓存）
 * IDB 写入失败返回 false，localStorage 失败不阻塞
 */
export async function saveData(data: AppData): Promise<boolean> {
  _dataVersion++
  const stamped = { ...data, _dataVersion, _savedAt: Date.now() }

  // IDB 权威写入
  try {
    const plain = JSON.parse(JSON.stringify(stamped))
    const ok = await idbSet(IDB_KEY, plain)
    // idbSet 现在如实返回 false（见 storage.ts）；旧实现吞错致此处恒为 true，
    // 使 app.ts 的「存储不可用」toast 永不触发——隐私模式/配额满时数据丢失无提示。
    if (!ok) {
      console.error('[persist] IDB 写入失败（idbSet 返回 false），数据未保存')
      return false
    }
  } catch (e) {
    console.error('[persist] IDB 写入失败，数据未保存:', e)
    return false
  }

  // localStorage 尽力同步（静默失败）
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped))
  } catch {
    // localStorage 满时静默忽略，IDB 已有完整数据
  }

  return true
}

/** 仅写 localStorage（用于备份/导出场景） */
export function saveToLocalStorage(data: AppData): boolean {
  try {
    const stamped = { ...data, _dataVersion, _savedAt: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped))
    return true
  } catch (e) {
    console.warn('[persist] localStorage save failed:', (e as Error).message)
    return false
  }
}

/** 仅写 IDB（用于显式备份 / localStorage→IDB 回填）
 *  返回是否写入成功。备份场景同样不应静默吞掉 IDB 失败（隐私模式/配额满），
 *  否则用户以为「已备份到本地」实则没落库——与 saveData 对齐如实上报。 */
export async function saveToIDB(data: AppData): Promise<boolean> {
  const stamped = { ...data, _dataVersion, _savedAt: Date.now() }
  const plain = JSON.parse(JSON.stringify(stamped))
  try {
    const ok = await idbSet(IDB_KEY, plain)
    if (!ok) {
      console.warn('[persist] saveToIDB：IDB 写入失败（idbSet 返回 false）')
      return false
    }
    return true
  } catch (e: unknown) {
    console.warn('[persist] IDB save failed:', e instanceof Error ? e.message : e)
    return false
  }
}

// ── 读取 ──

/**
 * 加载数据：优先 IDB（权威），回退 localStorage
 */
export async function loadData(): Promise<AppData> {
  const idbData = await loadFromIDB()
  if (idbData) {
    // IDB 加载成功，尝试保持 localStorage 一致（静默）
    saveToLocalStorage(idbData)
    return idbData
  }

  const lsData = loadFromLocalStorage()
  if (lsData && lsData.bookmarks?.length) {
    // localStorage → IDB 异步回填
    saveToIDB(lsData)
  }
  return lsData
}

export function loadFromLocalStorage(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const d = JSON.parse(raw)
      // 运行时验证数据结构完整性，防止损坏数据导致白屏
      const parsed = AppDataSchema.safeParse(d)
      if (!parsed.success) {
        console.warn('[persist] data validation failed, falling back to defaults:', parsed.error.issues)
        return JSON.parse(JSON.stringify(DEFAULTS))
      }
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
      // 与 loadFromLocalStorage 对齐加 safeParse：IDB 虽是自写自读的权威源，
      // 但被外部工具篡改/跨版本结构漂移/写入中断致半条数据时，缺校验会让坏字段直入 store
      // 引发后续 NPE 或白屏。失败时返回 null 让 loadData 回退到 localStorage（同时回退路径
      // 还会用 DEFAULTS 兜底），避免静默吞入损坏数据。
      const parsed = AppDataSchema.safeParse(idbData)
      if (!parsed.success) {
        console.warn('[persist] IDB validation failed, falling back to localStorage:', parsed.error.issues)
        return null
      }
      // 与 loadFromLocalStorage 一样跑 runMigrations：IDB 是权威源，但用户从旧版本升级时
      // 早期数据 _dataVersion 可能缺失/< CURRENT_VERSION，若 IDB 加载分支不迁移，旧格式数据
      // （文本笔记未转 HTML、categoryId=CAT_ALL、缺 updatedAt 等）会直入 store 且永不被清洗
      // —— 后续每次 saveData 盖新 _dataVersion 反而把脏数据「冻结」。两条加载路径行为必须一致。
      // 迁移后需回写，否则下次加载仍走旧分支。
      const data = parsed.data
      const needsm = runMigrations(idbData, data)
      if (needsm) saveToIDB(data)
      return data
    }
  } catch (e) { console.warn('[persist] IDB load fallback:', (e as Error).message) }
  return null
}

// ── 兼容旧调用方 ──

export function flushIDB(): void {
  // IDB 保存已是即时的，flush 仅保留为兼容 API
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
  } catch (e) { console.warn('[persist] storage info error:', e); return { size: 0, percent: 0, label: '0 KB' } }
}
