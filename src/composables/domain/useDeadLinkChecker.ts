import { ref, reactive, computed } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { debouncedSaveAppData } from '../../stores/app.js'
import { supabase } from '../../lib/supabase.js'
import { trackMetric } from '../../lib/stats.js'

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

/** 追加一次检测结果到历史记录（保留最近 MAX_HIST 条，按 checkedAt 降序） */
function _appendDeadLinkHistory(bmId: string, result: CheckResult): void {
  const hist = _loadDeadLinkHistory()
  if (!hist[bmId]) hist[bmId] = []
  hist[bmId].unshift(result)
  hist[bmId] = hist[bmId].slice(0, MAX_HIST)
  _saveDeadLinkHistory(hist)
}

/** 删除某书签的检测历史（永久删除时调用） */
function _clearDeadLinkHistory(bmId: string): void {
  const hist = _loadDeadLinkHistory()
  delete hist[bmId]
  _saveDeadLinkHistory(hist)
}

// 启动时加载历史到 results（便于 isDead/isBlocked computed 使用历史数据）
const _history = _loadDeadLinkHistory()
for (const [id, checks] of Object.entries(_history)) {
  if (checks.length > 0) results[id] = checks[0]  // 取最新一次记录覆盖 results
}

let _abort: AbortController | null = null

// 网络基线缓存，30s 内复用
let _baselineCache: { value: number; at: number } | null = null

async function checkDirect(url: string, timeoutMs = 5000): Promise<{ ok: boolean; duration: number }> {
  const start = Date.now()
  try {
    await Promise.race([
      fetch(url, { method: 'GET', mode: 'no-cors' }),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])
    return { ok: true, duration: Date.now() - start }
  } catch {
    return { ok: false, duration: Date.now() - start }
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

    // 1) 并行测量网络基线 + 直接访问目标
    const [gstaticBaseline, direct] = await Promise.all([
      measureNetworkBaseline(),
      checkDirect(url, 3000),
    ])

    // 2) 直接访问成功 → 存活
    if (direct.ok) {
      return { alive: true, status: 200, finalUrl: url, checkedAt: Date.now(), blocked: false, confidence: 0.95 }
    }

    // 3) 确定基线
    // gstatic <5s 说明网络可达（只是延迟高），用它作为基线
    // gstatic >5s 说明网络本身不通或被墙，无法可靠判断，直接返回 unknown
    if (gstaticBaseline > 5000) {
      return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked: false, confidence: 0.15 }
    }
    const baseline = gstaticBaseline

    // 4) 网络差 → 无法判断，标记为 unknown（不改变书签属性）
    if (baseline > 2000) {
      return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked: false, confidence: 0.15 }
    }

    // 5) 网络良好但直连失败 → 调用 Edge Function 确认
    const edgeResult = await callEdgeFunction(url, bookmarkId)

    if (edgeResult.status === 'alive') {
      return { alive: false, status: edgeResult.http_status, finalUrl: '', checkedAt: Date.now(), blocked: true, confidence: 0.95 }
    }

    if (edgeResult.status === 'dead') {
      return { alive: false, status: edgeResult.http_status, finalUrl: '', checkedAt: Date.now(), blocked: false, confidence: 0.90 }
    }

    // Edge Function 无法确认，但直连已失败且网络正常 → 仍判定为失效
    return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked: false, confidence: 0.7 }
  }

  async function checkAll(batchSize = 5, intervalMs = 200): Promise<void> {
    if (checking.value) return
    const ds = useDataStore()
    const bookmarks = ds.bookmarks.filter(b => b.url && b.url.startsWith('http') && !b.attributes?.['dead-link-ignored'])
    if (bookmarks.length === 0) return

    checking.value = true
    progress.value = { done: 0, total: bookmarks.length }
    _abort = new AbortController()

    Object.keys(results).forEach(k => delete results[k])

    // 清除所有书签的旧标记（不只是 filtered 的），避免残留计数
    for (const b of ds.bookmarks) {
      const attrs = b.attributes || {}
      if (attrs['dead-link'] || attrs['gfw-blocked']) {
        const rest = { ...attrs }
        delete rest['dead-link']
        delete rest['gfw-blocked']
        ds.updateBookmark(b.id, { attributes: rest })
      }
    }

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
          _appendDeadLinkHistory(batch[j].id, result.value)
        }
      }

      progress.value.done = Math.min(i + batchSize, bookmarks.length)

      if (i + batchSize < bookmarks.length) {
        await new Promise(r => setTimeout(r, intervalMs))
      }
    }

    checking.value = false
    lastFullCheckAt.value = Date.now()
    _applyDeadLinkAttributes()
    debouncedSaveAppData()
    trackMetric('deadlink_check_batch', {
      count: bookmarks.length,
      duration: Date.now() - (progress.value.total > 0 ? lastFullCheckAt.value : Date.now()),
    })
  }

  async function checkOne(bookmarkId: string): Promise<CheckResult | null> {
    const ds = useDataStore()
    const bm = ds.bookmarkMap[bookmarkId]
    if (!bm?.url) return null

    const result = await checkUrl(bm.url, bookmarkId)
    results[bookmarkId] = result
    _appendDeadLinkHistory(bookmarkId, result)

    if (result.confidence < CONFIDENCE_THRESHOLD) return result

    const attrs = { ...(bm.attributes || {}) }
    if (!result.alive) {
      if (result.blocked) {
        attrs['gfw-blocked'] = true
        delete attrs['dead-link']
      } else {
        attrs['dead-link'] = true
        delete attrs['gfw-blocked']
      }
    } else {
      delete attrs['dead-link']
      delete attrs['gfw-blocked']
    }
    ds.updateBookmark(bookmarkId, { attributes: attrs })
    debouncedSaveAppData()

    return result
  }

  function _applyDeadLinkAttributes() {
    const ds = useDataStore()
    for (const bm of ds.bookmarks) {
      const r = results[bm.id]
      if (!r) continue

      const attrs = bm.attributes || {}
      const hasDeadAttr = !!attrs['dead-link']
      const hasGfwAttr = !!attrs['gfw-blocked']

      // 低置信度结果：清除旧标记但不设置新标记
      if (r.confidence < CONFIDENCE_THRESHOLD) {
        if (hasDeadAttr || hasGfwAttr) {
          const rest = { ...attrs }
          delete rest['dead-link']
          delete rest['gfw-blocked']
          ds.updateBookmark(bm.id, { attributes: rest })
        }
        continue
      }

      if (r.alive) {
        if (hasDeadAttr || hasGfwAttr) {
          const rest = { ...attrs }
          delete rest['dead-link']
          delete rest['gfw-blocked']
          ds.updateBookmark(bm.id, { attributes: rest })
        }
      } else if (r.blocked) {
        if (!hasGfwAttr || hasDeadAttr) {
          // DLC-2：用 delete 清 key 而非设 false，与 checkOne 行为一致。
          // 设 false 在布尔判定上等价，但 key 残留在 attributes 对象里越积越多。
          const rest = { ...attrs }
          delete rest['dead-link']
          rest['gfw-blocked'] = true
          ds.updateBookmark(bm.id, { attributes: rest })
        }
      } else {
        if (!hasDeadAttr || hasGfwAttr) {
          const rest = { ...attrs }
          delete rest['gfw-blocked']
          rest['dead-link'] = true
          ds.updateBookmark(bm.id, { attributes: rest })
        }
      }
    }
  }

  function abort() {
    _abort?.abort()
    checking.value = false
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
