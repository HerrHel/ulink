/**
 * syncCircuit — 客户端同步熔断器（纯模块级状态，不经 Pinia）
 *
 * 防的目标：云端触顶（DB 满 / egress 耗尽 / 项目暂停 / 平台限流）后，online /
 * visibilitychange 每次触发都会打一排注定失败的请求；且 pushFromQueue 每失败
 * 一轮就给 op 累计 retries，一次数小时的宕机足以把积压 op 全部打死信（永久出
 * 队），恢复后只能靠用户手动「重建同步队列」补推。
 *
 * 三态熔断（closed / open / half-open）：
 * - closed：放行一切同步；连续 OPEN_THRESHOLD 轮失败 → open；
 * - open：编排层（useCloudSync 的事件触发与防抖推送）跳过网络调用，本地照常
 *   写队列；退避表 [1,2,5,15,30] 分钟随熔断次数递增封顶；
 * - open 到期后放行**一次**探活（half-open 单飞，并发触发不再放行）：
 *   失败 → 回 open、退避升一档；成功 → closed 并置 recovered 标志，
 *   编排层据此自动 resyncAllToCloud() 把死信/积压一次追平，无需用户手动。
 *
 * 手动入口（fullSync / resyncAllToCloud / initialSync）不设门——用户主动操作
 * 不该被熔断拦住；它们的成败照常计入熔断统计。
 *
 * 探活判定必须零开销且与 Pinia 生命周期解耦，故为模块级单例（与 useCloudSync
 * 的 _initialized 同模式）；__resetSyncCircuit 供测试统一复位（setup.ts）。
 */

export type SyncErrorKind = 'network' | 'quota' | 'auth' | 'server'

/** 连续失败多少**轮**后熔断（一轮 = 一次 pull/push 编排，不是单条 op） */
export const SYNC_CIRCUIT_THRESHOLD = 3

/** 退避表（毫秒）：第 N 次熔断后等待 SYNC_CIRCUIT_BACKOFF_MS[min(N-1, last)] */
export const SYNC_CIRCUIT_BACKOFF_MS = [60_000, 120_000, 300_000, 900_000, 1_800_000] as const

type CircuitState = 'closed' | 'open' | 'half-open'

let _state: CircuitState = 'closed'
let _failures = 0
let _openCount = 0
let _reopenAt = 0
let _inOutage = false
let _recovered = false
let _kind: SyncErrorKind | null = null

const backoffFor = (openCount: number): number =>
  SYNC_CIRCUIT_BACKOFF_MS[Math.min(openCount - 1, SYNC_CIRCUIT_BACKOFF_MS.length - 1)]

/**
 * 按错误文本粗分类，供 UI 归因（「云端空间已满」vs 泛「同步失败」）。
 * port 层把远端错误统一折叠成 message 字符串，只能做启发式匹配；宽松匹配
 * 好过漏判——误归 server 只是文案退化，漏判 quota 则用户看不到关键提示。
 */
export function classifySyncError(message: string): SyncErrorKind {
  const m = String(message || '')
  if (/离线|offline|failed to fetch|networkerror|network error/i.test(m)) return 'network'
  if (/429|402|407|413|507|quota|rate.?limit|too many requests|exceed|payment|空间已满|容量/i.test(m)) return 'quota'
  if (/401|403|jwt|unauthorized|forbidden|row-level|rls|permission|authenticated/i.test(m)) return 'auth'
  return 'server'
}

/** 编排层发起网络同步前询问；open 到期时转入 half-open 并放行一次探活。 */
export function canAttemptSync(now: number = Date.now()): boolean {
  if (_state === 'closed') return true
  if (_state === 'open' && now >= _reopenAt) {
    _state = 'half-open'
    return true
  }
  return false
}

/** 一轮同步失败：计数、分类；达阈值或探活失败则熔断并排定下次探活时间。 */
export function recordSyncFailure(message: string): void {
  _failures++
  _kind = classifySyncError(message)
  if (_state === 'half-open') {
    // 探活失败：回 open，退避升一档
    _openCount++
    _reopenAt = Date.now() + backoffFor(_openCount)
    _state = 'open'
    return
  }
  if (_state === 'closed' && _failures >= SYNC_CIRCUIT_THRESHOLD) {
    _state = 'open'
    _openCount++
    _reopenAt = Date.now() + backoffFor(_openCount)
    _inOutage = true
  }
}

/** 一轮同步成功：归零复位；若刚从熔断/故障中恢复则置 recovered 标志。 */
export function recordSyncSuccess(): void {
  const wasOutage = _inOutage || _state !== 'closed'
  _failures = 0
  _kind = null
  _state = 'closed'
  _inOutage = false
  _openCount = 0
  _recovered = wasOutage
}

/**
 * 编排层在每轮受控同步后调用：返回 true 表示「刚从熔断中恢复」，应自动
 * resyncAllToCloud 追平死信。取走即清，保证一轮恢复只触发一次补推。
 */
export function takeSyncRecovered(): boolean {
  const r = _recovered
  _recovered = false
  return r
}

export interface SyncCircuitSnapshot {
  state: CircuitState
  failures: number
  kind: SyncErrorKind | null
  /** open 时距下次探活的毫秒数；其余状态为 0 */
  msUntilRetry: number
}

export function getSyncCircuitSnapshot(now: number = Date.now()): SyncCircuitSnapshot {
  return {
    state: _state,
    failures: _failures,
    kind: _kind,
    msUntilRetry: _state === 'open' ? Math.max(0, _reopenAt - now) : 0,
  }
}

/** 测试专用：整体复位（setup.ts beforeEach 统一调用，防模块级状态跨用例泄漏）。 */
export function __resetSyncCircuit(): void {
  _state = 'closed'
  _failures = 0
  _openCount = 0
  _reopenAt = 0
  _inOutage = false
  _recovered = false
  _kind = null
}
