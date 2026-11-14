/**
 * useSyncConflict — 同步冲突检测与解决
 *
 * 响应式状态已迁移至 stores/sync.ts (useSyncStore)。
 * 此处仅保留冲突解决逻辑函数。
 */
import { useDataStore } from '../../stores/data.js'
import { useSyncStore } from '../../stores/sync.js'
import { saveAppData } from '../../stores/app.js'
// #26: keepLocal 需要触发同步调度把本地版本推上云。此处为函数体内调用（非顶层求值），
// 规避 useCloudSync ↔ useSyncConflict 的 ESM 循环依赖求值期问题。
import { useCloudSync } from './useCloudSync.js'
import { EditorManager } from '../../lib/editor.js'
import { _clearPendingSync } from './syncPending.js'
import { removeSyncOpsByItemId } from '../../stores/storage.js'
import type { Bookmark, SiblingGroup, Category, CustomAttribute, EntityType } from '../../types.js'

/** 远端快照缓存（非响应式，用于去重判断） */
export const _remoteSnapshots = new Map<string, unknown>()

/** 按实体类型把远端字段写回 data store（走 update* 保证 dirty/track/map） */
export function _applyRemoteToLocal(type: EntityType, id: string, remote: Record<string, unknown>) {
  const ds = useDataStore()
  const apply: Record<EntityType, () => void> = {
    bookmark: () => ds.updateBookmark(id, remote as Partial<Bookmark>),
    group: () => ds.updateGroup(id, remote as Partial<SiblingGroup>),
    category: () => ds.updateCategory(id, remote as Partial<Category>),
    attribute: () => ds.updateAttribute(id, remote as Partial<CustomAttribute>),
  }
  apply[type]?.()
}

export function resolveConflict(id: string, keepLocal: boolean) {
  const store = useSyncStore()
  const conflict = store.getConflict(id)
  if (!conflict) return
  const ds = useDataStore()
  if (!keepLocal) {
    _applyRemoteToLocal(conflict.type, id, conflict.remote as Record<string, unknown>)
    // 采用远端后必须恢复远端 updatedAt：updateBookmark 会无条件写 Date.now()，
    // 否则本地时间戳可能晚于他端后续更新，isRemoteNewer 判定反转导致静默拒收。
    const remoteTs = Number((conflict.remote as { updatedAt?: number })?.updatedAt)
    if (Number.isFinite(remoteTs) && remoteTs > 0) {
      const arr = conflict.type === 'group' ? ds.siblingGroups : ds.bookmarks
      const item = arr.find(x => x.id === id)
      if (item) (item as { updatedAt: number }).updatedAt = remoteTs
    }
    if (conflict.type === 'group' && typeof (conflict.remote as Record<string, unknown>)?.notes === 'string') {
      try {
        EditorManager.silentSetContent(id, (conflict.remote as Record<string, unknown>).notes as string)
      } catch { /* ignore */ }
    }
    ds._dirtyIds.delete(id)
    ds._newIds.delete(id)
    ds._changedFields.delete(id)
    _clearPendingSync([id])
    void removeSyncOpsByItemId(id)
    saveAppData()
  } else {
    _clearPendingSync([id])
    // 保留本地：必须确保本地版本能够胜出并回推覆盖云端。
    // 1. 将 updatedAt 递增至严格大于远端时间戳与当前时间的较大值；
    // 2. 调用 update* 触发 _markDirty 与变更追踪，确保入队推送；
    // 3. 落盘持久化 + 触发同步调度。
    const remoteUpdatedAt = (conflict.remote as { updatedAt?: number })?.updatedAt || 0
    const now = Math.max(Date.now(), remoteUpdatedAt + 1)
    if (conflict.type === 'bookmark') ds.updateBookmark(id, { updatedAt: now })
    else if (conflict.type === 'group') ds.updateGroup(id, { updatedAt: now })
    else if (conflict.type === 'category') ds.updateCategory(id, { updatedAt: now })
    else if (conflict.type === 'attribute') ds.updateAttribute(id, { updatedAt: now })
    // #26: updateBookmark/update* 内部无条件写 `updatedAt: Date.now()`，会把上面传入的
    // now（远端时钟超前时 now = remoteUpdatedAt+1 > 本机 Date.now()）覆盖掉 —— 本地时间戳
    // 退回本机时间、小于他端 → isRemoteNewer 判定反转，keepLocal 的选择被后续 pull 静默
    // 覆盖回来。绕过 update 的覆盖，直接把目标项的 updatedAt 写回 now。
    const localArr = conflict.type === 'group' ? ds.siblingGroups
      : conflict.type === 'category' ? ds.categories
        : conflict.type === 'attribute' ? ds.customAttributes
          : ds.bookmarks
    const target = (localArr as Array<{ id: string; updatedAt?: number }>).find((x) => x.id === id)
    if (target) target.updatedAt = now
    // 强制整行推送：若本地变更来自无字段追踪的路径（undo restoreSnapshot 只 _markDirty、
    // pull 去重只 _markDirty），changedFields 可能只含 updatedAt，partial 更新会把内容
    // 留在本机、云端仍是旧值。删除追踪后 syncPush 走 isNew||!changedFields 的全量分支。
    ds._changedFields.delete(id)
    // #26: 补落盘与同步调度（keepLocal=false 分支已有 saveAppData）。keepLocal 的选择
    // 必须持久化并触发推送把本地版本覆盖云端，否则刷新回退 / 本地版本永不上云。
    // debouncedSync 内含 autoSync / isLoggedIn 门控，关闭自动同步或未登录时安全 no-op。
    saveAppData()
    try {
      void Promise.resolve(useCloudSync().debouncedSync()).catch(() => {})
    } catch {
      // 未登录或 facade 尚未初始化时忽略，不让异常打断冲突解决
    }
  }
  _remoteSnapshots.delete(`${conflict.type}:${id}`)
  store.removeConflict(id)
}

export function resolveAllConflicts(keepLocal: boolean) {
  const store = useSyncStore()
  for (const c of store.conflicts.slice()) {
    resolveConflict(c.id, keepLocal)
  }
}
