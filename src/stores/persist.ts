/**
 * persist.ts — 持久化层（IDB 权威 + localStorage 缓存）
 *
 * 架构变更（2026-07）：
 * - IndexedDB 是权威数据存储
 * - localStorage 仅作快速启动缓存（尽力同步）
 * - `_writeSeq`：进程内单调写入序号（可比多端/缓存新旧）
 * - `_schemaVersion`：仅 migrations 读写的 schema 版本（与 writeSeq 分离，QUAL-01）
 * - 写入策略：IDB 先写 → 成功后再写 localStorage（尽力），
 *   任一失败不回滚另一端（不阻塞主流程）
 */
import { STORAGE_KEY, DEFAULTS } from '../config/constants.js'
import { runMigrations, CURRENT_SCHEMA_VERSION } from './migrations.js'
import { idbGet, idbSet } from './storage.js'
import { AppDataSchema } from '../schemas.js'
import type { AppData } from '../types.js'

const IDB_KEY = 'linkvault_v2'

// 进程内单调写入序号（不表示 schema 版本）
let _writeSeq = 0

export interface StorageInfo {
  size: number
  percent: number
  label: string
}

function _stamp(data: AppData) {
  _writeSeq++
  // 保留已有 _schemaVersion；禁止用 writeSeq 覆盖
  const schema =
    typeof (data as { _schemaVersion?: number })._schemaVersion === 'number'
      ? (data as { _schemaVersion?: number })._schemaVersion
      : CURRENT_SCHEMA_VERSION
  return {
    ...data,
    _writeSeq,
    _schemaVersion: schema,
    // 兼容旧读者：_dataVersion 不再作迁移门控，仅镜像 writeSeq
    _dataVersion: _writeSeq,
    _savedAt: Date.now(),
  }
}

// ── 写入 ──

/**
 * 保存数据到 IDB（权威）和 localStorage（缓存）
 * IDB 写入失败返回 false，localStorage 失败不阻塞
 */
export async function saveData(data: AppData): Promise<boolean> {
  const stamped = _stamp(data)

  // L14 修复：旧实现先 JSON.parse(JSON.stringify(stamped)) 给 IDB 再 JSON.stringify(stamped)
  // 写 localStorage，同一 stamped 对象走两遍 JSON 字符串化，大数据集下是双倍序列化主线程开销。
  // 复用同一份 raw 字符串：IDB 走 JSON.parse(raw) 得纯对象，localStorage 直接存 raw。
  const raw = JSON.stringify(stamped)

  // IDB 权威写入
  try {
    const plain = JSON.parse(raw)
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

  // localStorage 尽力同步（静默失败），复用已序列化的 raw 免去第二次 stringify
  try {
    localStorage.setItem(STORAGE_KEY, raw)
  } catch {
    // localStorage 满时静默忽略，IDB 已有完整数据
  }

  return true
}

/** 仅写 localStorage（用于备份/导出场景） */
export function saveToLocalStorage(data: AppData): boolean {
  try {
    const stamped = _stamp(data)
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
  const stamped = _stamp(data)
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
      // C2 修复：旧版 data 可能缺 isExpanded/updatedAt/createdAt 等 migrations 步骤 6/7
      // 本应补齐的字段。若在 runMigrations 之前用 AppDataSchema.safeParse 做严格校验，
      // 这些必填字段缺失会令整条 safeParse 失败，下方回退 DEFAULTS 会把用户全部书签/
      // 分组替换为默认示例数据丢弃。改为仅做轻量结构性检查（是对象且含核心数组），
      // 先让 runMigrations 补齐缺失字段，再用 schema 校验；只有结构彻底无法识别时
      // 才回退 DEFAULTS，避免把"可被迁移修复的旧数据"误判为"损坏数据整体丢弃"。
      if (!d || typeof d !== 'object' || !Array.isArray(d.bookmarks) || !Array.isArray(d.siblingGroups)) {
        console.warn('[persist] localStorage data structure invalid, falling back to defaults')
        return JSON.parse(JSON.stringify(DEFAULTS))
      }
      const result: AppData = {
        categories: d.categories || DEFAULTS.categories.slice(),
        bookmarks: d.bookmarks || [],
        customAttributes: d.customAttributes || [],
        siblingGroups: d.siblingGroups || []
      }
      const needsPersist = runMigrations(d, result)
      // 迁移后再用 schema 严格校验：若补齐后仍不符合（schema 演进或真正损坏）才回退 DEFAULTS
      const parsed = AppDataSchema.safeParse(result)
      if (!parsed.success) {
        console.warn('[persist] data validation failed after migration, falling back to defaults:', parsed.error.issues)
        return JSON.parse(JSON.stringify(DEFAULTS))
      }
      if (needsPersist) saveToLocalStorage(parsed.data)
      return parsed.data
    }
  } catch (e) { console.warn('[persist] localStorage load failed:', (e as Error).message) }
  return JSON.parse(JSON.stringify(DEFAULTS))
}

export async function loadFromIDB(): Promise<AppData | null> {
  try {
    const idbData = await idbGet(IDB_KEY)
    if (idbData && idbData.bookmarks) {
      // C2（与 loadFromLocalStorage 同因）：IDB 虽是自写自读的权威源，但旧版数据可能缺
      // migrations 步骤 6/7 本应补齐的 isExpanded/updatedAt/createdAt。若在 runMigrations
      // 之前用 AppDataSchema.safeParse 做严格校验，必填字段缺失会令整条失败并回退 null，
      // loadData 进一步回退到 localStorage（同样失败）→ DEFAULTS，用户数据全丢无自愈。
      // 改为轻量结构性检查，先迁移补齐，再用 schema 校验；结构彻底无法识别才回退。
      if (typeof idbData !== 'object' || !Array.isArray(idbData.bookmarks) || !Array.isArray(idbData.siblingGroups)) {
        console.warn('[persist] IDB data structure invalid, falling back to localStorage')
        return null
      }
      // 与 loadFromLocalStorage 一样跑 runMigrations：IDB 是权威源，用户从旧版本升级时
      // 早期数据 _dataVersion 可能缺失/< CURRENT_VERSION，若 IDB 加载分支不迁移，旧格式数据
      // （文本笔记未转 HTML、categoryId=CAT_ALL、缺 updatedAt 等）会直入 store 且永不被清洗
      // —— 后续每次 saveData 盖新 _dataVersion 反而把脏数据「冻结」。两条加载路径行为必须一致。
      // 迁移后需回写，否则下次加载仍走旧分支。
      //
      // H18 修复：必须在**同一对象**上跑 runMigrations（即 runMigrations(idbData, idbData)）。
      // Zod v4 的 AppDataSchema.safeParse 对 z.object/z.record/z.array 元素返回**新引用**，
      // 若用 parsed.data 作为迁移结果目标，migrations step2 的属性 id 重映射
      // (b.attributes[keep.id] = b.attributes[a.id]; delete b.attributes[a.id])
      // 写的是 idbData.bookmarks[i].attributes，不会反映到 parsed.data.bookmarks，
      // 导致 customAttributes 去重生效但 bookmark 仍引用旧 attr id，boolean 标记永久失联；
      // 且随后 _schemaVersion 被钉为 CURRENT 再不迁移。在原对象上迁移后再 parse 得清洗副本返回。
      const needsm = runMigrations(idbData, idbData as unknown as AppData)
      // 迁移后再用 schema 严格校验：补齐后仍不符合才回退 null（让 loadData 走 localStorage 兜底）
      const parsed = AppDataSchema.safeParse(idbData)
      if (!parsed.success) {
        console.warn('[persist] IDB validation failed after migration, falling back to localStorage:', parsed.error.issues)
        return null
      }
      // L3 修复：迁移结果必须 await 落库后再返回，否则隐私模式/IDB 临时不可用时 saveToIDB
      // 静默失败，本次会话看到内存迁移态但下次刷新仍读旧未迁移态（_schemaVersion 未落库）。
      if (needsm) await saveToIDB(parsed.data)
      return parsed.data
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
