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

/**
 * 境内公认受限的海外站点后缀（用于把「被墙」与「真死链」区分开，避免误删用户数据）
 *
 * 数据来源：GreatFire top-site 测试 + vpnAlert 每日实测，2026-10 交叉核对。
 *
 * ⚠️ 筛选标准（别放宽，加错一个比漏一个危害大得多）：
 *   1. **只收明确 blocked 的**。标为 intermittent（间歇性）的一律不收 —— 例如
 *      github.com / gitlab.com / cloudflare.com / amazon.com / microsoft.com /
 *      spotify.com / wordpress.com / openai.com 都是间歇性，混进来会把
 *      正常站点偶发超时误判成「被墙」。
 *   2. **不收「网站自己拒绝中国访客」的**（Claude、Netflix 等区域限制）——
 *      它们会正常返回 403/451，已由 HTTP_SOFT_ALIVE 处理，不属于网络封锁。
 *   3. 只收大众、长期、跨运营商（电信/联通/移动/CERNET）表现一致的站点。
 *
 * 判定语义：**仅当探测本身失败**（timeout / connect_error / 无远端视角）时才查本名单。
 *   命中 → gfw（被墙，不算死链）；未命中 → inconclusive（不落标也不抹标）。
 *   因此漏一个只是「判不出」，加错一个才会「误判」，务必宁缺毋滥。
 */
const GFW_KNOWN_HOST_SUFFIXES = [
  // ── Google 全家桶（含 YouTube 及其媒体 CDN）──
  'google.com', 'google.com.hk', 'google.co.jp', 'google.co.uk',
  'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'ggpht.com',
  'youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com',
  // ── Meta ──
  'facebook.com', 'fb.com', 'fb.me', 'fbcdn.net',
  'instagram.com', 'cdninstagram.com',
  'whatsapp.com', 'whatsapp.net', 'wa.me',
  'messenger.com',
  // ── X / Twitter ──
  'twitter.com', 'x.com', 't.co', 'twimg.com',
  // ── 通讯 ──
  'telegram.org', 'telegram.me', 't.me',
  'discord.com', 'discord.gg',
  'signal.org',
  'line.me', 'line-apps.com',
  // ── 社交 / 内容 ──
  'reddit.com', 'redd.it',
  'pinterest.com', 'tumblr.com', 'quora.com', 'medium.com',
  'vk.com', 'bsky.app',
  'tiktok.com', 'tiktokv.com',
  'flickr.com', 'imgur.com', 'snapchat.com',
  // ── 视频 / 音频 ──
  'twitch.tv', 'vimeo.com', 'dailymotion.com', 'soundcloud.com',
  // ── 百科 / 存档 ──
  'wikipedia.org', 'wikimedia.org',
  'archive.org',
  // ── 新闻（仅确定封锁者）──
  'nytimes.com', 'bloomberg.com',
  'bbc.com', 'bbc.co.uk',
  'reuters.com', 'wsj.com',
  'washingtonpost.com', 'dw.com', 'aljazeera.com',
  // ── 博客 / 发布 ──
  'blogspot.com', 'wixsite.com', 'linktr.ee', 'issuu.com',
  // ── 开发者 / 云（⚠️ github.com 本身可用，绝不能加；只收 Pages 与 Workers）──
  'github.io', 'gist.github.com', 'workers.dev',
  // ── AI（openai.com 为间歇性，只收 chatgpt.com）──
  'chatgpt.com', 'copilot.microsoft.com',
  // ── 其他常用 ──
  'dropbox.com', 'box.com',
  'etsy.com', 'tradingview.com', 'roku.com',
  // ── 倡议 / 人权组织 ──
  'change.org', 'amnesty.org', 'hrw.org', 'freedomhouse.org',
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
  /**
   * 本机是否处于「受限网络」（中国大陆）。
   *
   * 名单 `GFW_KNOWN_HOST_SUFFIXES` 是一条**地域性先验知识**——它只在墙内成立。
   * 对墙外用户（含开代理的用户）来说，这份名单纯属错误先验：他把 google.com
   * 加进收藏，若此刻本机探测因代理配置/CSP/抖动失败，就会被误判成「被墙」。
   *
   * 因此由调用方探测「能否直连纯境外端点」来决定是否启用名单：
   * 能直连 → false（名单不适用）；连不上 → true（保守，沿用原行为）。
   */
  restrictedNetwork = true,
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
      : (isGfwHost && restrictedNetwork
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
      // 本机可达 = 用户实际能访问到（服务端在上海，访问境外站必然连不上）。
      // 墙外用户与原「判 inconclusive」相比，这里给 alive 才不会平白制造噪音。
      if (direct.reachable) {
        return makeCheckResult({ verdict: 'alive', finalUrl: url, reason: 'connect_err' })
      }
      // Edge 连不上 + 本机也连不上：境内环境下若是知名受限站点，判被墙而非误杀死链
      if (isGfwHost && restrictedNetwork) {
        return makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' })
      }
      return makeCheckResult({ verdict: 'dead', reason: 'connect_err' })
    case 'timeout':
      // 本机可达 = 用户能打开，不该因为服务端超时就告诉他「不确定」
      if (direct.reachable) {
        return makeCheckResult({ verdict: 'alive', finalUrl: url, reason: 'timeout' })
      }
      // Edge 超时 + 本机不可达：境内环境下若是境外受限站点，判被墙；普通站点判不确定
      if (isGfwHost && restrictedNetwork) {
        return makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' })
      }
      return makeCheckResult({ verdict: 'inconclusive', reason: 'timeout' })
    case 'ssrf_reject':
    case 'redirect_denied':
      // Edge 安全拒绝与用户端死/墙无关
      return makeCheckResult({ verdict: 'inconclusive', reason: 'ssrf' })
  }
}
