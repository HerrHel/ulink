/**
 * deadLinkDecision.ts — 死链判定纯函数（从 composables/domain/useDeadLinkChecker.ts 抽取）
 *
 * 融合 Edge evidence + 本机直连 + 本机网络健康 → LinkVerdict 的全部纯逻辑，
 * 无 fetch / store / 定时器副作用，便于单测直测与 useDeadLinkChecker.ts 瘦身
 * （TECH_DEBT A 类：探活/调度 vs 结果判定分层）。
 */

export type LinkVerdict = 'alive' | 'dead' | 'gfw' | 'inconclusive'
export type DeadLinkReason =
  | 'head_mismatch'   // Edge 判死但本机 no-cors 仍可达（旧 0.45 双补偿的显式化）
  | 'offline'         // 本机基线离线，不敢定
  | 'timeout'         // Edge 超时
  | 'edge_unknown'    // Edge 回 unknown HTTP
  | 'connect_err'     // Edge 连接失败
  | 'ssrf'            // Edge 安全拒绝（ssrf_reject / redirect_denied）
  | 'no_edge'         // Edge 调用失败，无远端视角

export interface CheckResult {
  alive: boolean          // verdict === 'alive'
  status: number
  finalUrl: string
  checkedAt: number
  blocked: boolean        // verdict === 'gfw'
  verdict: LinkVerdict
  persist: boolean        // 是否落 attributes（alive/dead/gfw 落，inconclusive 不落不抹）
  reason?: DeadLinkReason
}

export type LocalNetwork = 'online' | 'degraded' | 'offline'

/** Edge evidence：fetch_outcome 决策依据；http_status 仅在 fetch_outcome==='ok' 有效。 */
export type EdgeEvidence = {
  fetch_outcome: 'ok' | 'timeout' | 'connect_error' | 'ssrf_reject' | 'redirect_denied' | null
  http_status: number
}

/** 鉴权/限流/网关类状态：偏可活，不当死链 */
const HTTP_SOFT_ALIVE = new Set([401, 402, 403, 405, 408, 418, 425, 429, 500, 502, 503, 504])
const HTTP_DEAD = new Set([404, 410])

const LOCAL_ONLINE_MS = 2000
export const BASELINE_OFFLINE_MS = 4000

/** 客户端内部 HTTP 分类（偏宁可 unknown 也不误杀）。
 *  仅在 fetch_outcome==='ok' 有响应时调用；不写库。 */
export function classifyHttpStatus(code: number): 'alive' | 'dead' | 'unknown' {
  if (code >= 200 && code < 400) return 'alive'
  if (HTTP_SOFT_ALIVE.has(code)) return 'alive'
  if (HTTP_DEAD.has(code)) return 'dead'
  return 'unknown'
}

/** 由 verdict 构造 CheckResult：alive/blocked/status/finalUrl 派生自 verdict，
 *  persist 由 verdict 决定（inconclusive 不落标）。 */
export function makeCheckResult(p: {
  verdict: LinkVerdict
  status?: number
  finalUrl?: string
  reason?: DeadLinkReason
}): CheckResult {
  const alive = p.verdict === 'alive'
  const blocked = p.verdict === 'gfw'
  const persist = p.verdict !== 'inconclusive'
  return {
    alive,
    status: p.status ?? 0,
    finalUrl: p.finalUrl ?? '',
    checkedAt: Date.now(),
    blocked,
    verdict: p.verdict,
    persist,
    reason: p.reason,
  }
}

/** 基线耗时 → 本机网络健康分级。offline 时一切远端结论都不落 dead/gfw。 */
export function gradeLocalNetwork(baselineMs: number): LocalNetwork {
  if (baselineMs >= BASELINE_OFFLINE_MS) return 'offline'
  if (baselineMs >= LOCAL_ONLINE_MS) return 'degraded'
  return 'online'
}

/**
 * 单一决策表：融合 Edge evidence + 本机直连 + 本机网络健康 → LinkVerdict。
 * - HTTP 分类只在 Edge 侧拿到响应（fetch_outcome==='ok'）时发生。
 * - GFW 只在「本机网络不 offline + Edge 远端 alive + 本机直连不可达」时产出。
 * - 本机 offline 时一切映射 inconclusive，绝不落 dead/gfw（重构 #4）。
 * - Edge dead + 本机可达 → inconclusive(head_mismatch)，不再用 0.45 弱存活（重构 #6）。
 */
export function decide(
  edge: EdgeEvidence,
  direct: { reachable: boolean },
  local: LocalNetwork,
  url: string,
): CheckResult {
  const localHealthy = local !== 'offline'

  // 本机离线：远端结论都不可信，绝不落标
  if (!localHealthy) {
    return makeCheckResult({ verdict: 'inconclusive', reason: 'offline' })
  }

  // Edge 调用失败：无远端视角，仅凭本机直连
  if (edge.fetch_outcome === null) {
    return direct.reachable
      ? makeCheckResult({ verdict: 'alive', finalUrl: url, reason: 'no_edge' })
      : makeCheckResult({ verdict: 'inconclusive', reason: 'no_edge' })
  }

  switch (edge.fetch_outcome) {
    case 'ok': {
      const http = classifyHttpStatus(edge.http_status)
      if (http === 'alive') {
        return direct.reachable
          ? makeCheckResult({ verdict: 'alive', status: edge.http_status || 200, finalUrl: url })
          : makeCheckResult({ verdict: 'gfw', status: edge.http_status })
      }
      if (http === 'dead') {
        return direct.reachable
          ? makeCheckResult({ verdict: 'inconclusive', status: edge.http_status, reason: 'head_mismatch' })
          : makeCheckResult({ verdict: 'dead', status: edge.http_status })
      }
      // http === 'unknown'
      return direct.reachable
        ? makeCheckResult({ verdict: 'alive', status: edge.http_status, finalUrl: url, reason: 'edge_unknown' })
        : makeCheckResult({ verdict: 'inconclusive', reason: 'edge_unknown' })
    }
    case 'connect_error':
      // Edge 连接失败：本机可达说明 Edge 侧网络受限 → 不定；本机也不可达 → dead
      return direct.reachable
        ? makeCheckResult({ verdict: 'inconclusive', reason: 'connect_err' })
        : makeCheckResult({ verdict: 'dead', reason: 'connect_err' })
    case 'timeout':
      return makeCheckResult({ verdict: 'inconclusive', reason: 'timeout' })
    case 'ssrf_reject':
    case 'redirect_denied':
      // Edge 安全拒绝与用户端死/墙无关
      return makeCheckResult({ verdict: 'inconclusive', reason: 'ssrf' })
  }
}
