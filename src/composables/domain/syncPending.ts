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

/** 测试专用：模拟已 drain 待推送；beforeEach 需 clear */
export const __testPendingSync = {
  add: (id: string) => _pendingSyncIds.add(id),
  clear: () => _pendingSyncIds.clear(),
  /** 单测断言用：死信 clear 后应 false */
  has: (id: string) => _pendingSyncIds.has(id),
  delete: (id: string) => _pendingSyncIds.delete(id),
}
