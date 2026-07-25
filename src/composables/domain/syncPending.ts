/**
 * syncPending — in-flight 同步 id 集合（H3）
 *
 * drain dirty 入队后、op 真正 push 成功前，远端 newer 应转 conflict 而非静默 assign。
 */
const _pendingSyncIds = new Set<string>()

export function _isPendingSync(id: string): boolean {
  return _pendingSyncIds.has(id)
}

export function _markPendingSync(ids: Iterable<string>): void {
  for (const id of ids) _pendingSyncIds.add(id)
}

export function _clearPendingSync(ids: Iterable<string>): void {
  for (const id of ids) {
    if (_pendingSyncIds.has(id)) _pendingSyncIds.delete(id)
  }
}

/**
 * 清空全部 in-flight pending id（登出/切账号时调用）。
 * 审计 R1：登出不清 _pendingSyncIds 致旧账号残留 pending 标记跨账号串留，与 IDB syncOps
 * 残留 op 一起在 B 登录 initialSync 时被推到 B 云端。登出需一并清队列与 pending 标记。
 */
export function _clearAllPendingSync(): void {
  _pendingSyncIds.clear()
}

/** 测试专用：模拟已 drain 待推送；beforeEach 需 clear */
export const __testPendingSync = {
  add: (id: string) => _pendingSyncIds.add(id),
  clear: () => _pendingSyncIds.clear(),
  /** 单测断言用：死信 clear 后应 false */
  has: (id: string) => _pendingSyncIds.has(id),
  delete: (id: string) => _pendingSyncIds.delete(id),
}
