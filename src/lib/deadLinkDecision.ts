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
  | 'dns_not_found'   // DNS 权威查询无记录（NXDOMAIN，真死链）
  | 'gfw_blocked'     // 命中被墙/受限特征（RST/受限大站）

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
  fetch_outcome:
    | 'ok'
    | 'timeout'
    | 'connect_error'
    | 'ssrf_reject'
    | 'redirect_denied'
    | 'dns_not_found'
    | 'gfw_blocked'
    | null
  http_status: number
}

/** 鉴权/限流/网关类状态：偏可活，不当死链 */
const HTTP_SOFT_ALIVE = new Set([401, 402, 403, 405, 408, 418, 425, 429, 500, 502, 503, 504])
const HTTP_DEAD = new Set([404, 410])

const LOCAL_ONLINE_MS = 2000
export const BASELINE_OFFLINE_MS = 4000

/** 常见海外公认受限服务域名后缀（在境内机房及国内直连均被阻断/丢包） */
const GFW_KNOWN_HOST_SUFFIXES = [
  'google.com', 'google.com.hk', 'google.co.jp', 'google.co.uk',
  'youtube.com', 'youtu.be',
  'twitter.com', 'x.com', 't.co',
  'facebook.com', 'instagram.com',
  'wikipedia.org', 'wikimedia.org',
  'medium.com', 'reddit.com',
  't.me', 'telegram.org',
  'pinterest.com', 'quora.com',
  'bloomberg.com', 'nytimes.com',
  'github.io', 'gist.github.com',
]

export function isKnownGfwHost(hostname: string): boolean {
  if (!hostname) return false
  const h = hostname.toLowerCase().split(':')[0]
  return GFW_KNOWN_HOST_SUFFIXES.some(suffix => h === suffix || h.endsWith('.' + suffix))
}

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
 * - GFW 只在「本机网络不 offline + Edge 远端 alive + 本机直连不可达」或捕获到受限特征时产出。
 * - 本机 offline 时一切映射 inconclusive，绝不落 dead/gfw（重构 #4）。
 * - Edge dead + 本机可达 → inconclusive(head_mismatch)，不再用 0.45 弱存活（重构 #6）。
 * - 明确 DNS NXDOMAIN → dead(dns_not_found)，不再当 SSRF 拒成 inconclusive。
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

  let isGfwHost = false
  try {
    const u = new URL(url)
    isGfwHost = isKnownGfwHost(u.hostname)
  } catch {
    /* ignore invalid url */
  }

  // Edge 调用失败：无远端视角，仅凭本机直连
  if (edge.fetch_outcome === null) {
    return direct.reachable
      ? makeCheckResult({ verdict: 'alive', finalUrl: url, reason: 'no_edge' })
      : (isGfwHost
          ? makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' })
          : makeCheckResult({ verdict: 'inconclusive', reason: 'no_edge' }))
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
    case 'dns_not_found':
      // 权威 DNS 查无记录（NXDOMAIN）：100% 确认死链
      return makeCheckResult({ verdict: 'dead', reason: 'dns_not_found' })
    case 'gfw_blocked':
      // 云端捕获阻断或受限特征
      return makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' })
    case 'connect_error':
      // Edge 连接失败：若为知名境外受限站点，在境内环境下判定为被墙而非误杀死链
      if (isGfwHost && !direct.reachable) {
        return makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' })
      }
      return direct.reachable
        ? makeCheckResult({ verdict: 'inconclusive', reason: 'connect_err' })
        : makeCheckResult({ verdict: 'dead', reason: 'connect_err' })
    case 'timeout':
      // Edge 超时：若为境外受限站点，静默丢包直接判定为被墙；普通站点判定为 inconclusive
      if (isGfwHost && !direct.reachable) {
        return makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' })
      }
      return makeCheckResult({ verdict: 'inconclusive', reason: 'timeout' })
    case 'ssrf_reject':
    case 'redirect_denied':
      // Edge 安全拒绝与用户端死/墙无关
      return makeCheckResult({ verdict: 'inconclusive', reason: 'ssrf' })
  }
}
