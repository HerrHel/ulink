import { ref, reactive, computed } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { supabase } from '../../lib/supabase.js'
import { safeGetItem, safeSetItem, safeRemoveItem, safeJsonParse } from '../../lib/storageSafe.js'
import type { Bookmark } from '../../types.js'


export type LinkVerdict = 'alive' | 'dead' | 'gfw' | 'inconclusive'
export type DeadLinkReason =
  | 'head_mismatch'   // Edge 判死但本机 no-cors 仍可达（旧 0.45 双补偿的显式化）
  | 'offline'         // 本机基线离线，不敢定
  | 'timeout'         // Edge 超时
  | 'edge_unknown'    // Edge 回 unknown HTTP
  | 'connect_err'     // Edge 连接失败
  | 'ssrf'            // Edge 安全拒绝（ssrf_reject / redirect_denied）
  | 'no_edge'         // Edge 调用失败，无远端视角

interface CheckResult {
  alive: boolean          // verdict === 'alive'
  status: number
  finalUrl: string
  checkedAt: number
  blocked: boolean        // verdict === 'gfw'
  verdict: LinkVerdict
  persist: boolean        // 是否落 attributes（alive/dead/gfw 落，inconclusive 不落不抹）
  reason?: DeadLinkReason
}

/** 鉴权/限流/网关类状态：偏可活，不当死链 */
const HTTP_SOFT_ALIVE = new Set([401, 402, 403, 405, 408, 418, 425, 429, 500, 502, 503, 504])
const HTTP_DEAD = new Set([404, 410])

/** 客户端内部 HTTP 分类（偏宁可 unknown 也不误杀）。
 *  仅在 fetch_outcome==='ok' 有响应时调用；不写库。 */
function classifyHttpStatus(code: number): 'alive' | 'dead' | 'unknown' {
  if (code >= 200 && code < 400) return 'alive'
  if (HTTP_SOFT_ALIVE.has(code)) return 'alive'
  if (HTTP_DEAD.has(code)) return 'dead'
  return 'unknown'
}

type LocalNetwork = 'online' | 'degraded' | 'offline'
const LOCAL_ONLINE_MS = 2000

const results = reactive<Record<string, CheckResult>>({})
const checking = ref(false)
const progress = ref({ done: 0, total: 0 })
const lastFullCheckAt = ref(0)

// ── 死链检测历史记录（持久化到 localStorage，便于趋势分析）──
const HIST_KEY = 'lv_deadLinkHistory'
const MAX_HIST = 5

function _loadDeadLinkHistory(): Record<string, CheckResult[]> {
  const parsed = safeJsonParse<Record<string, unknown[]>>(safeGetItem(HIST_KEY), {})
  const out: Record<string, CheckResult[]> = {}
  // 兼容旧结构：删除含 confidence（无 verdict）的条目；history 只是缓存，丢弃安全
  for (const [id, checks] of Object.entries(parsed)) {
    if (!Array.isArray(checks)) continue
    const migrated = checks.filter((c): c is CheckResult =>
      !!c && typeof c === 'object' && 'verdict' in (c as Record<string, unknown>)
    )
    if (migrated.length) out[id] = migrated
  }
  return out
}

function _saveDeadLinkHistory(hist: Record<string, CheckResult[]>): void {
  safeSetItem(HIST_KEY, JSON.stringify(hist))
}

// M16：内存中的历史缓存；全量检查只 mutate 内存，结束时一次 save，避免 O(N²) 全量 stringify
let _histCache: Record<string, CheckResult[]> | null = null

function _getHistCache(): Record<string, CheckResult[]> {
  if (!_histCache) _histCache = _loadDeadLinkHistory()
  return _histCache
}

/** 追加一次检测结果到内存缓存（不写盘）；调用方在批次结束时 flush */
function _appendDeadLinkHistory(bmId: string, result: CheckResult, persist = true): void {
  const hist = _getHistCache()
  if (!hist[bmId]) hist[bmId] = []
  hist[bmId].unshift(result)
  hist[bmId] = hist[bmId].slice(0, MAX_HIST)
  if (persist) _saveDeadLinkHistory(hist)
}

function _flushDeadLinkHistory(): void {
  if (_histCache) _saveDeadLinkHistory(_histCache)
}

/** 删除某书签的检测历史（永久删除时调用） */
function _clearDeadLinkHistory(bmId: string): void {
  const hist = _getHistCache()
  delete hist[bmId]
  _saveDeadLinkHistory(hist)
}

// 启动时加载历史到 results（便于 isDead/isBlocked computed 使用历史数据）
const _history = _getHistCache()
for (const [id, checks] of Object.entries(_history)) {
  if (checks.length > 0) results[id] = checks[0]  // 取最新一次记录覆盖 results
}

let _abort: AbortController | null = null

// 网络基线缓存，30s 内复用；in-flight 合并避免 checkAll 冷启动探针风暴
let _baselineCache: { value: number; at: number } | null = null
let _baselineInflight: Promise<number> | null = null

const BASELINE_PROBES = [
  'https://www.baidu.com/favicon.ico',
  'https://www.gstatic.com/generate_204',
  'https://cloudflare.com/favicon.ico',
] as const
const BASELINE_TTL_MS = 30000
const BASELINE_PROBE_TIMEOUT_MS = 4000
const BASELINE_OFFLINE_MS = 4000
/** no-cors 限时 fetch；成功 resolve，超时/网络失败 reject */
function fetchNoCorsWithTimeout(
  url: string,
  opts: { method?: 'GET' | 'HEAD'; timeoutMs: number; signal?: AbortSignal } = { timeoutMs: 5000 },
): Promise<Response> {
  const { method = 'GET', timeoutMs, signal } = opts
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    fetch(url, { method, mode: 'no-cors', cache: 'no-store', signal })
      .then((res) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(res)
      })
      .catch((err) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(err)
      })
  })
}

/** 由 verdict 构造 CheckResult：alive/blocked/status/finalUrl 派生自 verdict，
 *  persist 由 verdict 决定（inconclusive 不落标）。 */
function makeCheckResult(p: {
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

/**
 * RE-10：no-cors 仅作「网络可达」弱信号，opaque 响应读不到 status，
 * 404/5xx 也会 ok=true。不得单独据此判存活。
 */
async function checkDirect(url: string, timeoutMs = 5000): Promise<{ reachable: boolean; duration: number }> {
  const start = Date.now()
  try {
    await fetchNoCorsWithTimeout(url, { method: 'GET', timeoutMs })
    return { reachable: true, duration: Date.now() - start }
  } catch {
    return { reachable: false, duration: Date.now() - start }
  }
}

/** 返回基线耗时（ms）。全探针失败时返回 BASELINE_OFFLINE_MS（>= offline 阈值，
 *  使下方 gradeLocalNetwork 判为 offline）。 */
async function measureNetworkBaseline(): Promise<number> {
  if (_baselineCache && Date.now() - _baselineCache.at < BASELINE_TTL_MS) return _baselineCache.value
  if (_baselineInflight) return _baselineInflight

  _baselineInflight = (async () => {
    const start = Date.now()
    const ac = new AbortController()
    try {
      // 不用 Promise.any（tsconfig lib 未含 ES2021）；任一探针成功即 resolve 并 abort 其余
      await new Promise<void>((resolve, reject) => {
        let pending = BASELINE_PROBES.length
        let settled = false
        for (const u of BASELINE_PROBES) {
          fetchNoCorsWithTimeout(u, {
            method: 'HEAD',
            timeoutMs: BASELINE_PROBE_TIMEOUT_MS,
            signal: ac.signal,
          }).then(() => {
            if (!settled) {
              settled = true
              ac.abort()
              resolve()
            }
          }).catch(() => {
            pending -= 1
            if (pending === 0 && !settled) reject(new Error('all probes failed'))
          })
        }
      })
    } catch {
      // 全探针失败 → 本机网络离线；返回 >= offline 阈值使 gradeLocalNetwork 判 offline
      _baselineCache = { value: BASELINE_OFFLINE_MS, at: Date.now() }
      return BASELINE_OFFLINE_MS
    }
    const duration = Date.now() - start
    _baselineCache = { value: duration, at: Date.now() }
    return duration
  })()

  try {
    return await _baselineInflight
  } finally {
    _baselineInflight = null
  }
}

/** 基线耗时 → 本机网络健康分级。offline 时一切远端结论都不落 dead/gfw。 */
function gradeLocalNetwork(baselineMs: number): LocalNetwork {
  if (baselineMs >= BASELINE_OFFLINE_MS) return 'offline'
  if (baselineMs >= LOCAL_ONLINE_MS) return 'degraded'
  return 'online'
}

/** Edge evidence：fetch_outcome 决策依据；http_status 仅在 fetch_outcome==='ok' 有效。 */
type EdgeEvidence = {
  fetch_outcome: 'ok' | 'timeout' | 'connect_error' | 'ssrf_reject' | 'redirect_denied' | null
  http_status: number
}

async function callEdgeFunction(url: string, bookmarkId?: string): Promise<EdgeEvidence> {
  try {
    const { data, error } = await supabase.functions.invoke('check-link', {
      body: { url, bookmark_id: bookmarkId }
    })
    if (error) throw error
    if (!data || typeof data !== 'object') return { fetch_outcome: null, http_status: 0 }
    const fo = data.fetch_outcome
    return {
      fetch_outcome:
        typeof fo === 'string' &&
        ['ok', 'timeout', 'connect_error', 'ssrf_reject', 'redirect_denied'].includes(fo)
          ? (fo as EdgeEvidence['fetch_outcome'])
          : null,
      http_status: Number(data.http_status) || 0,
    }
  } catch {
    return { fetch_outcome: null, http_status: 0 }
  }
}

/**
 * 单一决策表：融合 Edge evidence + 本机直连 + 本机网络健康 → LinkVerdict。
 * - HTTP 分类只在 Edge 侧拿到响应（fetch_outcome==='ok'）时发生。
 * - GFW 只在「本机网络不 offline + Edge 远端 alive + 本机直连不可达」时产出。
 * - 本机 offline 时一切映射 inconclusive，绝不落 dead/gfw（重构 #4）。
 * - Edge dead + 本机可达 → inconclusive(head_mismatch)，不再用 0.45 弱存活（重构 #6）。
 */
function decide(
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

export function useDeadLinkChecker() {
  async function checkUrl(url: string, bookmarkId?: string): Promise<CheckResult> {
    if (!url || !url.startsWith('http')) {
      return makeCheckResult({ verdict: 'dead' })
    }

    // 基线 / 直连 / Edge 互不依赖，三者并行以降低 wall-clock
    // 国内慢网/gstatic 抖动不再整批跳过，始终走 Edge
    const [baselineMs, direct, edgeResult] = await Promise.all([
      measureNetworkBaseline(),
      checkDirect(url, 4000),
      callEdgeFunction(url, bookmarkId),
    ])

    return decide(edgeResult, direct, gradeLocalNetwork(baselineMs), url)
  }

  async function checkAll(batchSize = 5, intervalMs = 200): Promise<void> {
    if (checking.value) return
    const ds = useDataStore()
    // RE-11：排除软删与 ignored，避免污染回收站项
    const bookmarks = ds.bookmarks.filter(
      b => !b.deletedAt && b.url && b.url.startsWith('http') && !b.attributes?.['dead-link-ignored']
    )
    if (bookmarks.length === 0) return

    checking.value = true
    progress.value = { done: 0, total: bookmarks.length }
    _abort = new AbortController()

    Object.keys(results).forEach(k => delete results[k])

    // 全量检测不预先清标：inconclusive 维持旧标（避免抖动），由结尾 _applyDeadLinkAttributes
    //  按 verdict 重落——verdict=alive 清标，dead/gfw 刷新标，inconclusive 不动。

    // M16：全量检查期间只写内存 hist，结束 flush 一次
    _getHistCache()

    // 相同 origin 的 URL 只检测一次：提取代表 URL，结果复制给同组其他书签
    const originGroups = new Map<string, { representative: typeof bookmarks[0]; others: typeof bookmarks[0][] }>()
    const ungrouped: typeof bookmarks = []

    for (const bm of bookmarks) {
      try {
        const url = new URL(bm.url)
        const origin = url.origin.toLowerCase()
        const group = originGroups.get(origin)
        if (!group) {
          originGroups.set(origin, { representative: bm, others: [] })
        } else {
          // 选最短的 URL 作为代表（通常是根路径，检测更快更可靠）
          if (bm.url.length < group.representative.url.length) {
            group.others.push(group.representative)
            group.representative = bm
          } else {
            group.others.push(bm)
          }
        }
      } catch {
        // URL 解析失败，单独检测
        ungrouped.push(bm)
      }
    }

    // 收集所有需要检测的代表 URL
    const toCheck: typeof bookmarks = []
    const representativeMap = new Map<string, { representative: typeof bookmarks[0]; others: typeof bookmarks[0][] }>()

    for (const [origin, group] of originGroups) {
      toCheck.push(group.representative)
      representativeMap.set(group.representative.id, group)
    }
    toCheck.push(...ungrouped)

    // 进度显示实际书签总数，而非去重后的检测数
    const totalBookmarks = bookmarks.length

    for (let i = 0; i < toCheck.length; i += batchSize) {
      if (_abort.signal.aborted) break

      const batch = toCheck.slice(i, i + batchSize)
      const batchResults = await Promise.allSettled(
        batch.map(b => checkUrl(b.url, b.id))
      )

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j]
        if (result.status === 'fulfilled') {
          const bm = batch[j]
          results[bm.id] = result.value
          _appendDeadLinkHistory(bm.id, result.value, false)

          // 将结果复制给同 origin 的其他书签
          const group = representativeMap.get(bm.id)
          if (group) {
            for (const other of group.others) {
              results[other.id] = result.value
              _appendDeadLinkHistory(other.id, result.value, false)
            }
          }
        }
      }

      // 更新进度：已处理的代表数 + 已复制结果的其他书签数
      let processedCount = Math.min(i + batchSize, toCheck.length)
      for (let k = 0; k < Math.min(i + batchSize, toCheck.length); k++) {
        const group = representativeMap.get(toCheck[k].id)
        if (group) processedCount += group.others.length
      }
      progress.value.done = Math.min(processedCount, totalBookmarks)

      if (i + batchSize < toCheck.length) {
        await new Promise(r => setTimeout(r, intervalMs))
      }
    }

    _flushDeadLinkHistory()
    checking.value = false
    lastFullCheckAt.value = Date.now()
    _applyDeadLinkAttributes()
    debouncedSaveAppData()
  }

  async function checkOne(bookmarkId: string): Promise<CheckResult | null> {
    const ds = useDataStore()
    const bm = ds.bookmarkMap[bookmarkId]
    if (!bm?.url) return null

    const result = await checkUrl(bm.url, bookmarkId)
    results[bookmarkId] = result
    _appendDeadLinkHistory(bookmarkId, result)

    // inconclusive 不落标也不抹标（保留上次状态，避免抖动）
    if (!result.persist) return result

    const mode = result.verdict === 'alive' ? 'alive' : (result.verdict === 'gfw' ? 'blocked' : 'dead')
    const next = _nextDeadAttrs(bm.attributes || {}, mode)
    if (next) {
      ds.updateBookmark(bookmarkId, { attributes: next as Bookmark['attributes'] })
      debouncedSaveAppData()
    }

    return result
  }

  function _applyDeadLinkAttributes() {
    const ds = useDataStore()
    const patches: Record<string, Record<string, unknown>> = {}
    for (const bm of ds.bookmarks) {
      if (bm.deletedAt) continue
      const r = results[bm.id]
      if (!r) continue

      const attrs = bm.attributes || {}
      // inconclusive：不落标也不抹标，保持上次状态，避免反复检测时标抖动
      if (!r.persist) continue

      const mode = r.verdict === 'alive' ? 'alive' : (r.verdict === 'gfw' ? 'blocked' : 'dead')
      const next = _nextDeadAttrs(attrs, mode)
      if (next) patches[bm.id] = next
    }
    if (Object.keys(patches).length) ds.batchPatchBookmarkAttributes(patches)
  }

  function abort() {
    _abort?.abort()
    checking.value = false
  }

  /** L12：统一构造死链/被墙 attrs，仅在有变化时返回新对象 */
  function _nextDeadAttrs(
    attrs: Record<string, unknown>,
    mode: 'clear' | 'alive' | 'blocked' | 'dead',
  ): Record<string, unknown> | null {
    const hasDead = !!attrs['dead-link']
    const hasGfw = !!attrs['gfw-blocked']
    if (mode === 'clear' || mode === 'alive') {
      if (!hasDead && !hasGfw) return null
      const rest = { ...attrs }
      delete rest['dead-link']
      delete rest['gfw-blocked']
      return rest
    }
    if (mode === 'blocked') {
      if (hasGfw && !hasDead) return null
      const rest = { ...attrs }
      delete rest['dead-link']
      rest['gfw-blocked'] = true
      return rest
    }
    // dead
    if (hasDead && !hasGfw) return null
    const rest = { ...attrs }
    delete rest['gfw-blocked']
    rest['dead-link'] = true
    return rest
  }

  function getResult(bookmarkId: string): CheckResult | null {
    return results[bookmarkId] || null
  }

  function isDead(bookmarkId: string): boolean {
    const r = results[bookmarkId]
    if (r) return r.verdict === 'dead'
    const ds = useDataStore()
    const bm = ds.bookmarkMap[bookmarkId]
    return !!(bm?.attributes && bm.attributes['dead-link'])
  }

  function isBlocked(bookmarkId: string): boolean {
    const r = results[bookmarkId]
    if (r) return r.verdict === 'gfw'
    const ds = useDataStore()
    const bm = ds.bookmarkMap[bookmarkId]
    return !!(bm?.attributes && bm.attributes['gfw-blocked'])
  }

  /** 本次检测结果为「未确认」——只有 in-session result 才会出现，不读 attributes。 */
  function isUnconfirmed(bookmarkId: string): boolean {
    const r = results[bookmarkId]
    return !!r && r.verdict === 'inconclusive'
  }

  const deadCount = computed(() => {
    const ds = useDataStore()
    let count = 0
    for (const b of ds.bookmarks) {
      if (b.deletedAt) continue
      const r = results[b.id]
      if (r) {
        if (r.verdict === 'dead') count++
      } else if (b.attributes?.['dead-link']) {
        count++
      }
    }
    return count
  })

  const blockedCount = computed(() => {
    const ds = useDataStore()
    let count = 0
    for (const b of ds.bookmarks) {
      if (b.deletedAt) continue
      const r = results[b.id]
      if (r) {
        if (r.verdict === 'gfw') count++
      } else if (b.attributes?.['gfw-blocked']) {
        count++
      }
    }
    return count
  })

  // 本轮（in-session）「未确认」计数。不进 toast——避免检测完弹"N 个未确认"噪音
  const inconclusiveCount = computed(() => {
    let count = 0
    for (const id in results) {
      if (results[id].verdict === 'inconclusive') count++
    }
    return count
  })

  const toastDeadCount = computed(() => {
    let count = 0
    for (const id in results) {
      if (results[id].verdict === 'dead') count++
    }
    return count
  })

  const toastBlockedCount = computed(() => {
    let count = 0
    for (const id in results) {
      if (results[id].verdict === 'gfw') count++
    }
    return count
  })

  // ── 定时自动检测（D3）──
  const AUTO_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // 每周
  const AUTO_CHECK_KEY = 'lv_autoDeadCheck'
  const AUTO_CHECK_ENABLED_KEY = 'lv_autoDeadCheckEnabled'

  const autoCheckEnabled = ref(!!safeGetItem(AUTO_CHECK_ENABLED_KEY))
  let _autoCheckTimer: ReturnType<typeof setInterval> | null = null

  function _persistAutoCheck(v: boolean) {
    if (v) safeSetItem(AUTO_CHECK_ENABLED_KEY, '1')
    else safeRemoveItem(AUTO_CHECK_ENABLED_KEY)
  }

  function startAutoCheck() {
    autoCheckEnabled.value = true
    _persistAutoCheck(true)
    // 检查是否已到检测时间
    const last = parseInt(safeGetItem(AUTO_CHECK_KEY) || '0', 10)
    if (Date.now() - last > AUTO_INTERVAL_MS && !checking.value) {
      checkAll(5, 200)
      // DLC-4：只在检测实际运行时更新时间戳。旧实现无条件更新——跳过本次检测时
      // 仍刷时间戳，导致「启动即检测」意图被破坏（需再等 7 天才触发）。
      safeSetItem(AUTO_CHECK_KEY, String(Date.now()))
    }
    // 启动定时循环（每 6 小时检查一次）
    if (_autoCheckTimer) clearInterval(_autoCheckTimer)
    _autoCheckTimer = setInterval(() => {
      const last2 = parseInt(safeGetItem(AUTO_CHECK_KEY) || '0', 10)
      if (Date.now() - last2 > AUTO_INTERVAL_MS && !checking.value) {
        checkAll(5, 200)
        safeSetItem(AUTO_CHECK_KEY, String(Date.now()))
      }
    }, 6 * 60 * 60 * 1000)
  }

  function stopAutoCheck() {
    autoCheckEnabled.value = false
    _persistAutoCheck(false)
    if (_autoCheckTimer) { clearInterval(_autoCheckTimer); _autoCheckTimer = null }
  }

  /** 测试钩子：清空跨用例共享的模块级缓存（baseline 30s 缓存、in-flight、histCache、results） */
  function _resetDeadLinkCache() {
    _baselineCache = null
    _baselineInflight = null
    _histCache = null
    Object.keys(results).forEach(k => delete results[k])
  }

  return {
    results, checking, progress, lastFullCheckAt,
    checkUrl, checkAll, checkOne, abort,
    getResult, isDead, isBlocked, isUnconfirmed, deadCount, blockedCount, inconclusiveCount,
    toastDeadCount, toastBlockedCount,
    autoCheckEnabled, startAutoCheck, stopAutoCheck,
    _resetDeadLinkCache,
  }
}
