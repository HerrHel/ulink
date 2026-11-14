/**
 * syncResolvedConflicts — 记住「用户已裁决过的远端版本」，避免同一冲突反复弹。
 *
 * 背景：用户点「保留本地 / 采用云端」后，resolveConflict 会触发 debouncedSync；
 * 下一轮 pull 若远端仍是**同一个版本**（updatedAt 没前进），合并逻辑会再次判定
 * conflict 并重新挂出横幅 —— 用户刚做完的决定被立刻推翻，且横幅永远关不掉
 * （E2E「冲突横幅 UI」在 CI 上就是这样卡住的）。
 *
 * 规则：按 (type:id) 记住裁决时的远端 updatedAt。只有远端版本**严格更新**时，
 * 才允许再次判定为冲突。语义上等价于「同一版本不再重复询问」。
 *
 * 独立小模块（无任何依赖）是为了避免 useSyncConflict ↔ syncLocalMerge 的循环依赖。
 */
const resolved = new Map<string, number>()
/** 上限：冲突通常很少，设一个硬上限防长期运行无限增长 */
const MAX_ENTRIES = 500

const keyOf = (type: string, id: string) => `${type}:${id}`

/** 记录某实体在某个远端版本上已被用户裁决 */
export function markConflictResolved(type: string, id: string, remoteUpdatedAt: number): void {
  if (!id) return
  const v = Number(remoteUpdatedAt)
  resolved.set(keyOf(type, id), Number.isFinite(v) ? v : 0)
  if (resolved.size > MAX_ENTRIES) {
    // Map 保持插入顺序：淘汰最早的一条
    const oldest = resolved.keys().next()
    if (!oldest.done) resolved.delete(oldest.value)
  }
}

/**
 * 该远端版本是否已被裁决过。
 * @param remoteUpdatedAt 远端条目的 updatedAt（非数字按 0 处理）
 * @returns true = 同一或更旧版本已裁决，不应再弹冲突
 */
export function isConflictVersionResolved(type: string, id: string, remoteUpdatedAt: number): boolean {
  const prev = resolved.get(keyOf(type, id))
  if (prev === undefined) return false
  const v = Number(remoteUpdatedAt)
  const current = Number.isFinite(v) ? v : 0
  return current <= prev
}

/** 清空（换账号 / 测试复位） */
export function clearResolvedConflicts(): void {
  resolved.clear()
}
