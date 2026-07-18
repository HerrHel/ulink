import { ref, reactive, computed } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { supabase } from '../../lib/supabase.js'
import type { Bookmark } from '../../types.js'


interface CheckResult {
  alive: boolean
  status: number
  finalUrl: string
  checkedAt: number
  blocked: boolean
  confidence: number
}

const results = reactive<Record<string, CheckResult>>({})
const checking = ref(false)
const progress = ref({ done: 0, total: 0 })
const lastFullCheckAt = ref(0)

const CONFIDENCE_THRESHOLD = 0.5

// ── 死链检测历史记录（持久化到 localStorage，便于趋势分析）──
const HIST_KEY = 'lv_deadLinkHistory'
const MAX_HIST = 5

function _loadDeadLinkHistory(): Record<string, CheckResult[]> {
  try {
    const raw = localStorage.getItem(HIST_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function _saveDeadLinkHistory(hist: Record<string, CheckResult[]>): void {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(hist)) } catch { /* 存储满时静默忽略 */ }
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

// 网络基线缓存，30s 内复用
let _baselineCache: { value: number; at: number } | null = null

/**
 * RE-10：no-cors 仅作「网络可达」弱信号，opaque 响应读不到 status，
 * 404/5xx 也会 ok=true。不得单独据此判存活。
 */
async function checkDirect(url: string, timeoutMs = 5000): Promise<{ reachable: boolean; duration: number }> {
  const start = Date.now()
  try {
    await Promise.race([
      fetch(url, { method: 'GET', mode: 'no-cors' }),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])
    return { reachable: true, duration: Date.now() - start }
  } catch {
    return { reachable: false, duration: Date.now() - start }
  }
}

async function measureNetworkBaseline(): Promise<number> {
  if (_baselineCache && Date.now() - _baselineCache.at < 30000) return _baselineCache.value
  const start = Date.now()
  try {
    await fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', mode: 'no-cors' })
  } catch { /* ignore */ }
  const duration = Date.now() - start
  _baselineCache = { value: duration, at: Date.now() }
  return duration
}

async function callEdgeFunction(url: string, bookmarkId?: string): Promise<{ status: string; http_status: number }> {
  try {
    const { data, error } = await supabase.functions.invoke('check-link', {
      body: { url, bookmark_id: bookmarkId }
    })
    if (error) throw error
    return data
  } catch {
    return { status: 'unknown', http_status: 0 }
  }
}

export function useDeadLinkChecker() {
  async function checkUrl(url: string, bookmarkId?: string): Promise<CheckResult> {
    if (!url || !url.startsWith('http')) {
      return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked: false, confidence: 1 }
    }

    // 1) 并行测量网络基线 + no-cors 可达性（弱信号，opaque 读不到 status）
    const [gstaticBaseline, direct] = await Promise.all([
      measureNetworkBaseline(),
      checkDirect(url, 3000),
    ])

    // 2) 本机网络不可靠 → unknown
    if (gstaticBaseline > 5000 || gstaticBaseline > 2000) {
      return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked: false, confidence: 0.15 }
    }

    // 3) RE-10：始终用 Edge 读真实 http_status；no-cors 不可单独判存活
    const edgeResult = await callEdgeFunction(url, bookmarkId)

    if (edgeResult.status === 'alive') {
      // 服务端可达：直连也可达 → 存活；直连失败 → 对本机被墙
      if (direct.reachable) {
        return {
          alive: true,
          status: edgeResult.http_status || 200,
          finalUrl: url,
          checkedAt: Date.now(),
          blocked: false,
          confidence: 0.95,
        }
      }
      return {
        alive: false,
        status: edgeResult.http_status,
        finalUrl: '',
        checkedAt: Date.now(),
        blocked: true,
        confidence: 0.95,
      }
    }

    if (edgeResult.status === 'dead') {
      return {
        alive: false,
        status: edgeResult.http_status,
        finalUrl: '',
        checkedAt: Date.now(),
        blocked: false,
        confidence: 0.90,
      }
    }

    if (edgeResult.status === 'blocked') {
      return {
        alive: false,
        status: edgeResult.http_status,
        finalUrl: '',
        checkedAt: Date.now(),
        blocked: true,
        confidence: 0.90,
      }
    }

    // Edge unknown：no-cors 可达仅弱存活（不伪造 status:200）；不可达 → 失效
    if (direct.reachable) {
      return {
        alive: true,
        status: 0,
        finalUrl: url,
        checkedAt: Date.now(),
        blocked: false,
        confidence: 0.55,
      }
    }
    return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked: false, confidence: 0.7 }
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

    // 仅清活跃书签的旧死链标记（PERF-4：batchPatch，一次 bump）
    const clearPatches: Record<string, Record<string, unknown>> = {}
    for (const b of bookmarks) {
      const next = _nextDeadAttrs(b.attributes || {}, 'clear')
      if (next) clearPatches[b.id] = next
    }
    if (Object.keys(clearPatches).length) ds.batchPatchBookmarkAttributes(clearPatches)

    // M16：全量检查期间只写内存 hist，结束 flush 一次
    _getHistCache()

    for (let i = 0; i < bookmarks.length; i += batchSize) {
      if (_abort.signal.aborted) break

      const batch = bookmarks.slice(i, i + batchSize)
      const batchResults = await Promise.allSettled(
        batch.map(b => checkUrl(b.url, b.id))
      )

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j]
        if (result.status === 'fulfilled') {
          results[batch[j].id] = result.value
          _appendDeadLinkHistory(batch[j].id, result.value, false)
        }
      }

      progress.value.done = Math.min(i + batchSize, bookmarks.length)

      if (i + batchSize < bookmarks.length) {
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

    if (result.confidence < CONFIDENCE_THRESHOLD) return result

    const mode = result.alive ? 'alive' : (result.blocked ? 'blocked' : 'dead')
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
      // 低置信度结果：清除旧标记但不设置新标记
      if (r.confidence < CONFIDENCE_THRESHOLD) {
        const next = _nextDeadAttrs(attrs, 'clear')
        if (next) patches[bm.id] = next
        continue
      }

      const mode = r.alive ? 'alive' : (r.blocked ? 'blocked' : 'dead')
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
    if (r) return !r.alive && !r.blocked
    const ds = useDataStore()
    const bm = ds.bookmarkMap[bookmarkId]
    return !!(bm?.attributes && bm.attributes['dead-link'])
  }

  function isBlocked(bookmarkId: string): boolean {
    const r = results[bookmarkId]
    if (r) return !r.alive && r.blocked
    const ds = useDataStore()
    const bm = ds.bookmarkMap[bookmarkId]
    return !!(bm?.attributes && bm.attributes['gfw-blocked'])
  }

  const deadCount = computed(() => {
    const ds = useDataStore()
    let count = 0
    for (const b of ds.bookmarks) {
      if (b.deletedAt) continue
      const r = results[b.id]
      if (r) {
        if (!r.alive && !r.blocked && r.confidence >= CONFIDENCE_THRESHOLD) count++
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
        if (!r.alive && r.blocked && r.confidence >= CONFIDENCE_THRESHOLD) count++
      } else if (b.attributes?.['gfw-blocked']) {
        count++
      }
    }
    return count
  })

  const toastDeadCount = computed(() => {
    let count = 0
    for (const id in results) {
      const r = results[id]
      if (!r.alive && !r.blocked && r.confidence >= CONFIDENCE_THRESHOLD) count++
    }
    return count
  })

  const toastBlockedCount = computed(() => {
    let count = 0
    for (const id in results) {
      const r = results[id]
      if (!r.alive && r.blocked && r.confidence >= CONFIDENCE_THRESHOLD) count++
    }
    return count
  })

  // ── 定时自动检测（D3）──
  const AUTO_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // 每周
  const AUTO_CHECK_KEY = 'lv_autoDeadCheck'
  const AUTO_CHECK_ENABLED_KEY = 'lv_autoDeadCheckEnabled'

  const autoCheckEnabled = ref(!!localStorage.getItem(AUTO_CHECK_ENABLED_KEY))
  let _autoCheckTimer: ReturnType<typeof setInterval> | null = null

  function _persistAutoCheck(v: boolean) {
    if (v) localStorage.setItem(AUTO_CHECK_ENABLED_KEY, '1')
    else localStorage.removeItem(AUTO_CHECK_ENABLED_KEY)
  }

  function startAutoCheck() {
    autoCheckEnabled.value = true
    _persistAutoCheck(true)
    // 检查是否已到检测时间
    const last = parseInt(localStorage.getItem(AUTO_CHECK_KEY) || '0', 10)
    if (Date.now() - last > AUTO_INTERVAL_MS && !checking.value) {
      checkAll(5, 200)
      // DLC-4：只在检测实际运行时更新时间戳。旧实现无条件更新——跳过本次检测时
      // 仍刷时间戳，导致「启动即检测」意图被破坏（需再等 7 天才触发）。
      localStorage.setItem(AUTO_CHECK_KEY, String(Date.now()))
    }
    // 启动定时循环（每 6 小时检查一次）
    if (_autoCheckTimer) clearInterval(_autoCheckTimer)
    _autoCheckTimer = setInterval(() => {
      const last2 = parseInt(localStorage.getItem(AUTO_CHECK_KEY) || '0', 10)
      if (Date.now() - last2 > AUTO_INTERVAL_MS && !checking.value) {
        checkAll(5, 200)
        localStorage.setItem(AUTO_CHECK_KEY, String(Date.now()))
      }
    }, 6 * 60 * 60 * 1000)
  }

  function stopAutoCheck() {
    autoCheckEnabled.value = false
    _persistAutoCheck(false)
    if (_autoCheckTimer) { clearInterval(_autoCheckTimer); _autoCheckTimer = null }
  }

  return {
    results, checking, progress, lastFullCheckAt,
    checkUrl, checkAll, checkOne, abort,
    getResult, isDead, isBlocked, deadCount, blockedCount,
    toastDeadCount, toastBlockedCount,
    autoCheckEnabled, startAutoCheck, stopAutoCheck,
  }
}
