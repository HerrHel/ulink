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
  | 'recent_alive'    // 历史上曾可达，本次判死 → 软化（见 softenByHistory）

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
/** 判定上下文：所有信号先算好，规则只做条件判断——避免重复计算，也避免「某条分支漏判断某个条件」 */
interface DecisionContext {
  url: string
  edge: EdgeEvidence
  /** 仅在 edge.fetch_outcome === 'ok' 时有意义 */
  http: 'alive' | 'dead' | 'unknown'
  localReachable: boolean
  localNetwork: LocalNetwork
  /** 命中 GFW 已知受限名单 */
  isGfwHost: boolean
  /** 是否墙内（名单只在墙内有意义，见 decide 的 restrictedNetwork 说明） */
  restrictedNetwork: boolean
}

interface DecisionRule {
  /** 规则标识：命中后可知是哪条规则得出的结论，便于定位与单测 */
  id: string
  when: (c: DecisionContext) => boolean
  then: (c: DecisionContext) => CheckResult
}

/**
 * 死链判定规则表（**顺序即优先级**，自上而下第一条命中即返回）
 *
 * 之所以改成表驱动：原先是 20 多个嵌套 if/else 分支，加一个信号要改多处，
 * 曾出现「`case 'ok'` 里忘了加 restrictedNetwork 判断」这类遗漏（墙外用户被误判被墙）。
 * 表驱动后每条规则自带**完整条件**，加规则 = 加一项，不会漏改别处。
 *
 * 修改规则时的铁律：
 *   1. 新规则的插入位置决定其优先级，务必显式想清楚要覆盖谁；
 *   2. 每条规则的 when 必须写全前置条件（不要依赖「前面的规则已经排除了」）；
 *   3. 删除/调整规则前先看 `deadLinkDecision.test.ts` 的决策矩阵护栏。
 */
const RULES: readonly DecisionRule[] = [
  // ── ① 本机离线：远端结论都不可信，绝不落标 ──
  {
    id: 'local.offline',
    when: (c) => c.localNetwork === 'offline',
    then: () => makeCheckResult({ verdict: 'inconclusive', reason: 'offline' }),
  },

  // ── ② Edge 无响应：仅凭本机直连 ──
  {
    id: 'edge.none.reachable',
    when: (c) => c.edge.fetch_outcome === null && c.localReachable,
    then: (c) => makeCheckResult({ verdict: 'alive', finalUrl: c.url, reason: 'no_edge' }),
  },
  {
    id: 'edge.none.gfw',
    when: (c) =>
      c.edge.fetch_outcome === null && !c.localReachable && c.isGfwHost && c.restrictedNetwork,
    then: () => makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' }),
  },
  {
    id: 'edge.none.unknown',
    when: (c) => c.edge.fetch_outcome === null,
    then: () => makeCheckResult({ verdict: 'inconclusive', reason: 'no_edge' }),
  },

  // ── ③ Edge 有响应且状态码判活 ──
  {
    id: 'edge.ok.alive.reachable',
    when: (c) => c.edge.fetch_outcome === 'ok' && c.http === 'alive' && c.localReachable,
    then: (c) =>
      makeCheckResult({ verdict: 'alive', status: c.edge.http_status || 200, finalUrl: c.url }),
  },
  {
    id: 'edge.ok.alive.gfw',
    // 服务端拿到 2xx/3xx 而本机不可达：墙内是「被墙」的典型特征
    when: (c) => c.edge.fetch_outcome === 'ok' && c.http === 'alive' && !c.localReachable && c.restrictedNetwork,
    then: (c) => makeCheckResult({ verdict: 'gfw', status: c.edge.http_status }),
  },
  {
    id: 'edge.ok.alive.noLocal',
    // 墙外却本机不可达 → 是本机网络/代理问题，服务端证据更强，判活
    when: (c) => c.edge.fetch_outcome === 'ok' && c.http === 'alive' && !c.localReachable,
    then: (c) =>
      makeCheckResult({ verdict: 'alive', status: c.edge.http_status || 200, finalUrl: c.url }),
  },

  // ── ④ Edge 状态码判死 ──
  {
    id: 'edge.ok.dead.reachable',
    // 服务端说死、本机却连得上 → 信号冲突，保守不定性
    when: (c) => c.edge.fetch_outcome === 'ok' && c.http === 'dead' && c.localReachable,
    then: (c) =>
      makeCheckResult({ verdict: 'inconclusive', status: c.edge.http_status, reason: 'head_mismatch' }),
  },
  {
    id: 'edge.ok.dead.confirmed',
    when: (c) => c.edge.fetch_outcome === 'ok' && c.http === 'dead',
    then: (c) => makeCheckResult({ verdict: 'dead', status: c.edge.http_status }),
  },

  // ── ⑤ Edge 状态码无法分类（偏宁可 unknown 也不误杀）──
  {
    id: 'edge.ok.unknown.reachable',
    when: (c) => c.edge.fetch_outcome === 'ok' && c.localReachable,
    then: (c) =>
      makeCheckResult({
        verdict: 'alive',
        status: c.edge.http_status,
        finalUrl: c.url,
        reason: 'edge_unknown',
      }),
  },
  {
    id: 'edge.ok.unknown',
    when: (c) => c.edge.fetch_outcome === 'ok',
    then: () => makeCheckResult({ verdict: 'inconclusive', reason: 'edge_unknown' }),
  },

  // ── ⑥ 权威结论 ──
  {
    id: 'edge.dns_not_found',
    // 权威 DNS 查无记录（NXDOMAIN）：确定性死链，不受本机可达性影响
    when: (c) => c.edge.fetch_outcome === 'dns_not_found',
    then: () => makeCheckResult({ verdict: 'dead', reason: 'dns_not_found' }),
  },
  {
    id: 'edge.gfw_blocked',
    // 云端捕获阻断或受限特征
    when: (c) => c.edge.fetch_outcome === 'gfw_blocked',
    then: () => makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' }),
  },

  // ── ⑦ 连接失败 ──
  {
    id: 'edge.connect_error.reachable',
    // 服务端在上海，访问境外站必然连不上；用户自己打得开就是活的
    when: (c) => c.edge.fetch_outcome === 'connect_error' && c.localReachable,
    then: (c) => makeCheckResult({ verdict: 'alive', finalUrl: c.url, reason: 'connect_err' }),
  },
  {
    id: 'edge.connect_error.gfw',
    when: (c) => c.edge.fetch_outcome === 'connect_error' && c.isGfwHost && c.restrictedNetwork,
    then: () => makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' }),
  },
  {
    id: 'edge.connect_error.dead',
    when: (c) => c.edge.fetch_outcome === 'connect_error',
    then: () => makeCheckResult({ verdict: 'dead', reason: 'connect_err' }),
  },

  // ── ⑧ 超时 ──
  {
    id: 'edge.timeout.reachable',
    // 本机可达 = 用户能打开，不该因为服务端超时就判「不确定」
    when: (c) => c.edge.fetch_outcome === 'timeout' && c.localReachable,
    then: (c) => makeCheckResult({ verdict: 'alive', finalUrl: c.url, reason: 'timeout' }),
  },
  {
    id: 'edge.timeout.gfw',
    when: (c) => c.edge.fetch_outcome === 'timeout' && c.isGfwHost && c.restrictedNetwork,
    then: () => makeCheckResult({ verdict: 'gfw', reason: 'gfw_blocked' }),
  },
  {
    id: 'edge.timeout',
    when: (c) => c.edge.fetch_outcome === 'timeout',
    then: () => makeCheckResult({ verdict: 'inconclusive', reason: 'timeout' }),
  },

  // ── ⑨ 安全拒绝：与用户端死/墙无关 ──
  {
    id: 'edge.security_reject',
    when: (c) => c.edge.fetch_outcome === 'ssrf_reject' || c.edge.fetch_outcome === 'redirect_denied',
    then: () => makeCheckResult({ verdict: 'inconclusive', reason: 'ssrf' }),
  },

  // ── ⑩ 兜底：未知 outcome 一律不落标（防御性）──
  {
    id: 'fallback.unresolved',
    when: () => true,
    then: () => makeCheckResult({ verdict: 'inconclusive', reason: 'no_edge' }),
  },
]

/** 判定结果 + 命中的规则 id（便于追踪「这个结论是谁给出的」） */
export function decideWithRule(
  edge: EdgeEvidence,
  direct: { reachable: boolean },
  local: LocalNetwork,
  url: string,
  restrictedNetwork = true,
): { result: CheckResult; ruleId: string } {
  let isGfwHost = false
  try {
    isGfwHost = isKnownGfwHost(new URL(url).hostname)
  } catch {
    /* invalid url：按非受限站点处理 */
  }

  const ctx: DecisionContext = {
    url,
    edge,
    http: edge.fetch_outcome === 'ok' ? classifyHttpStatus(edge.http_status) : 'unknown',
    localReachable: direct.reachable,
    localNetwork: local,
    isGfwHost,
    restrictedNetwork,
  }

  const rule = RULES.find((r) => r.when(ctx)) ?? RULES[RULES.length - 1]
  return { result: rule.then(ctx), ruleId: rule.id }
}

/**
 * 单一决策表：融合 Edge evidence + 本机直连 + 本机网络健康 → LinkVerdict。
 *
 * 规则与优先级见上面的 `RULES`。几条贯穿始终的原则：
 * - 本机 offline 时一切映射 inconclusive，绝不落 dead/gfw。
 * - `inconclusive` 不落标也不抹标（保留上次状态，避免抖动）。
 * - 判断「被墙」必须同时满足：双端失败 + 命中名单 + **墙内网络**（`restrictedNetwork`）。
 *
 * @param restrictedNetwork 本机是否处于受限网络（中国大陆）。
 *   名单 `GFW_KNOWN_HOST_SUFFIXES` 是**地域性先验知识**，只在墙内成立。
 *   墙外用户（含开代理者）若本机探测因代理配置/CSP/抖动失败，
 *   无条件套用名单会把他能打开的站点判成「被墙」。
 *   由调用方探测「能否直连纯境外端点」决定：能直连 → false；连不上 → true（保守）。
 */
export function decide(
  edge: EdgeEvidence,
  direct: { reachable: boolean },
  local: LocalNetwork,
  url: string,
  restrictedNetwork = true,
): CheckResult {
  return decideWithRule(edge, direct, local, url, restrictedNetwork).result
}

/** 历史衰减窗口：该时间窗内曾判定过 alive，则本次「判死」只作参考、不落标 */
export const STALE_ALIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 用历史状态软化「死链」结论（横切关注点，独立于 A/B/C 规则表）
 *
 * 要解决的场景：**昨天还好、今天突然变成死链**。用户看到这个会第一反应怀疑检测本身，
 * 比「什么都不显示」更伤信任；而实际上大多是临时故障（服务端重启、CDN 回源失败、
 * DNS 短暂异常、站点临时下线维护）。
 *
 * 规则：`dead` + 7 天内曾 `alive` → 降级为 `inconclusive`（不落标、不抹标）。
 *
 * 刻意**不软化**的两类：
 *   - `gfw`：被墙是明确的网络现象，已由「双端失败 + 名单 + 墙内网络」三重确认；
 *   - `alive`：本来就是好消息，无需处理。
 *
 * 代价：真死链会延迟到超出窗口（最长 7 天）才被标记。这个延迟是可接受的——
 *      用户点开链接就会自己发现，而误标会造成他直接删掉好数据。
 */
export function softenByHistory(result: CheckResult, recentlyAlive: boolean): CheckResult {
  if (!recentlyAlive) return result
  if (result.verdict !== 'dead') return result
  return makeCheckResult({
    verdict: 'inconclusive',
    status: result.status,
    finalUrl: result.finalUrl,
    reason: 'recent_alive',
  })
}
