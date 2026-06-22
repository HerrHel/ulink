import { ref, reactive } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useAppStore } from '../../stores/app.js'

interface CheckResult {
  alive: boolean
  status: number
  finalUrl: string
  checkedAt: number
  blocked: boolean
}

const results = reactive<Record<string, CheckResult>>({})
const checking = ref(false)
const progress = ref({ done: 0, total: 0 })
const lastFullCheckAt = ref(0)

const PROXIES = [
  (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
]

const GFW_DOMAINS = [
  'google.com', 'google.com.hk', 'youtube.com', 'twitter.com', 'x.com',
  'facebook.com', 'instagram.com', 'wikipedia.org', 'wikimedia.org',
  'reddit.com', 'telegram.org', 't.me', 'whatsapp.com', 'line.me',
  'medium.com', 'githubusercontent.com', 'nytimes.com', 'bbc.com',
  'bbc.co.uk', 'bloomberg.com', 'reuters.com', 'wsj.com',
  'dropbox.com', 'vimeo.com', 'pinterest.com', 'tumblr.com',
  'soundcloud.com', 'archive.org', 'signal.org', 'brave.com',
]

function isGFWBlocked(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return GFW_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
  } catch { return false }
}

let _abort: AbortController | null = null

export function useDeadLinkChecker() {
  async function checkUrl(url: string): Promise<CheckResult> {
    if (!url || !url.startsWith('http')) {
      return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked: false }
    }

    for (const proxyFn of PROXIES) {
      try {
        const proxyUrl = proxyFn(url)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)

        const resp = await fetch(proxyUrl, {
          signal: controller.signal,
          mode: 'cors',
        })
        clearTimeout(timeout)

        if (resp.ok) {
          const data = await resp.json().catch(() => null)
          const status = data?.status?.http_code || data?.status || resp.status
          const alive = status >= 200 && status < 400
          return { alive, status, finalUrl: data?.status?.url || url, checkedAt: Date.now(), blocked: false }
        }
      } catch {
        continue
      }
    }

    // 所有代理失败 — 检查是否为 GFW 封锁
    const blocked = isGFWBlocked(url)
    return { alive: false, status: 0, finalUrl: '', checkedAt: Date.now(), blocked }
  }

  async function checkAll(batchSize = 5, intervalMs = 500): Promise<void> {
    if (checking.value) return
    const ds = useDataStore()
    const app = useAppStore()
    const bookmarks = ds.bookmarks.filter(b => b.url && b.url.startsWith('http'))
    if (bookmarks.length === 0) return

    checking.value = true
    progress.value = { done: 0, total: bookmarks.length }
    _abort = new AbortController()

    for (let i = 0; i < bookmarks.length; i += batchSize) {
      if (_abort.signal.aborted) break

      const batch = bookmarks.slice(i, i + batchSize)
      const batchResults = await Promise.allSettled(
        batch.map(b => checkUrl(b.url))
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

    const result = await checkUrl(bm.url)
    results[bookmarkId] = result

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
            attributes: { ...attrs, 'gfw-blocked': true, 'dead-link': undefined }
          })
        }
      } else {
        if (!hasDeadAttr || hasGfwAttr) {
          ds.updateBookmark(bm.id, {
            attributes: { ...attrs, 'dead-link': true, 'gfw-blocked': undefined }
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

  function deadCount(): number {
    const ds = useDataStore()
    return ds.bookmarks.filter(b => isDead(b.id)).length
  }

  function blockedCount(): number {
    const ds = useDataStore()
    return ds.bookmarks.filter(b => isBlocked(b.id)).length
  }

  return {
    results, checking, progress, lastFullCheckAt,
    checkUrl, checkAll, checkOne, abort,
    getResult, isDead, isBlocked, deadCount, blockedCount,
  }
}
