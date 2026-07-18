/**
 * E1-001/E1-002：IDB hydrate 门闩。
 * 独立模块避免 useBookmark ↔ useAppLifecycle 循环依赖。
 */

let _dataHydrated = false
let _dataReadyResolve: (() => void) | null = null
const _dataReadyPromise = new Promise<void>((resolve) => { _dataReadyResolve = resolve })

/** 数据已从 IDB/localStorage 灌入 store 且索引重建完成 */
export function isDataHydrated(): boolean { return _dataHydrated }

/** 等待首次 hydrate 完成；已完成则立即 resolve */
export function whenDataReady(): Promise<void> {
  if (_dataHydrated) return Promise.resolve()
  return _dataReadyPromise
}

/** lifecycle 在 loadData + _syncMaps 后调用 */
export function markDataReady(): void {
  if (_dataHydrated) return
  _dataHydrated = true
  _dataReadyResolve?.()
  _dataReadyResolve = null
}

/** 测试专用：重置门闩（勿在生产路径调用） */
export function __testResetDataReady(): void {
  _dataHydrated = false
}

/** 测试专用：直接标记已就绪 */
export function __testMarkDataReady(): void {
  markDataReady()
}
