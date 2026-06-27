import { ref, reactive, computed } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'
import { supabase } from '../../lib/supabase.js'

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

let _abort: AbortController | null = null

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
  const start = Date.now()
  try {
    await fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', mode: 'no-cors' })
  } catch { /* ignore */ }
  return Date.now() - start
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

    return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked: false, confidence: 0.2 }
  }

  async function checkAll(batchSize = 5, intervalMs = 200): Promise<void> {
    if (checking.value) return
    const ds = useDataStore()
    const app = useAppStore()
    const bookmarks = ds.bookmarks.filter(b => b.url && b.url.startsWith('http'))
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
    app.debouncedSave()
  }

  async function checkOne(bookmarkId: string): Promise<CheckResult | null> {
    const ds = useDataStore()
    const app = useAppStore()
    const bm = ds.bookmarkMap[bookmarkId]
    if (!bm?.url) return null

    const result = await checkUrl(bm.url, bookmarkId)
    results[bookmarkId] = result

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
    app.debouncedSave()

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
          ds.updateBookmark(bm.id, {
            attributes: { ...attrs, 'gfw-blocked': true, 'dead-link': false }
          })
        }
      } else {
        if (!hasDeadAttr || hasGfwAttr) {
          ds.updateBookmark(bm.id, {
            attributes: { ...attrs, 'dead-link': true, 'gfw-blocked': false }
          })
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

  return {
    results, checking, progress, lastFullCheckAt,
    checkUrl, checkAll, checkOne, abort,
    getResult, isDead, isBlocked, deadCount, blockedCount,
    toastDeadCount, toastBlockedCount,
  }
}
