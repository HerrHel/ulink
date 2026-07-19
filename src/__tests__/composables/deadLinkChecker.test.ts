/**
 * QUAL-03 / RE-10 / RE-11：死链判定与软删排除
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { CAT_UNCATEGORIZED } from '../../config/constants.js'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    functions: { invoke: invokeMock },
    from: vi.fn(),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

vi.mock('../../stores/app.js', () => ({
  saveAppData: vi.fn(),
  debouncedSaveAppData: vi.fn(),
}))

import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { useDataStore } from '../../stores/data.js'

function seedBm(ds: ReturnType<typeof useDataStore>, partial: Record<string, unknown> = {}) {
  const bm = {
    id: 'bm-1',
    title: 't',
    url: 'https://example.com',
    username: '',
    password: '',
    notes: '',
    icon: '',
    categoryId: CAT_UNCATEGORIZED,
    parentId: null,
    order: 0,
    useCount: 0,
    attributes: {},
    isExpanded: false,
    createdAt: 1,
    updatedAt: 2,
    ...partial,
  }
  ds.addBookmark(bm as any)
  return bm.id as string
}

beforeEach(() => {
  setActivePinia(createPinia())
  invokeMock.mockReset()
  // 基线：探针快返回；书签 no-cors 默认可达
  // Response status 须在 200–599，status:0 会 RangeError 导致 checkDirect 恒 false
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkUrl 决策矩阵（RE-10）', () => {
  it('非 http → 直接失效 confidence=1', async () => {
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('ftp://x')
    expect(r.alive).toBe(false)
    expect(r.confidence).toBe(1)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('Edge alive + 直连可达 → 存活', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'alive', http_status: 200 }, error: null })
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://ok.example')
    expect(r.alive).toBe(true)
    expect(r.blocked).toBe(false)
    expect(r.confidence).toBe(0.95)
  })

  it('Edge alive + 直连失败 → GFW blocked', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'alive', http_status: 200 }, error: null })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      // 基线探针仍成功，书签直连失败
      if (/baidu|gstatic|cloudflare/.test(String(url))) return new Response(null, { status: 200 })
      throw new Error('network fail')
    }))
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://blocked.example')
    expect(r.alive).toBe(false)
    expect(r.blocked).toBe(true)
    expect(r.confidence).toBe(0.9)
  })

  it('Edge dead + 直连失败 → 死链非 blocked', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'dead', http_status: 404 }, error: null })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (/baidu|gstatic|cloudflare/.test(String(url))) return new Response(null, { status: 200 })
      throw new Error('network fail')
    }))
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://gone.example')
    expect(r.alive).toBe(false)
    expect(r.blocked).toBe(false)
    expect(r.status).toBe(404)
    expect(r.confidence).toBe(0.9)
  })

  it('Edge dead + 直连可达 → 弱存活不写 dead（confidence < 0.5）', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'dead', http_status: 404 }, error: null })
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://head-false-positive.example')
    expect(r.alive).toBe(true)
    expect(r.confidence).toBe(0.45)
    expect(r.confidence).toBeLessThan(0.5)
  })

  it('Edge blocked → blocked', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'blocked', http_status: 403 }, error: null })
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://gfw.example')
    expect(r.alive).toBe(false)
    expect(r.blocked).toBe(true)
  })

  it('Edge unknown + no-cors 可达 → 弱存活 confidence=0.55', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'unknown', http_status: 0 }, error: null })
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://opaque.example')
    expect(r.alive).toBe(true)
    expect(r.confidence).toBe(0.55)
  })
})

describe('checkAll / isDead（RE-11 + attributes）', () => {
  it('checkAll 跳过软删与 dead-link-ignored', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'alive', url: 'https://a.com' })
    seedBm(ds, { id: 'soft', url: 'https://b.com', deletedAt: Date.now() })
    seedBm(ds, { id: 'ignored', url: 'https://c.com', attributes: { 'dead-link-ignored': true } })

    invokeMock.mockResolvedValue({ data: { status: 'alive', http_status: 200 }, error: null })
    const { checkAll, progress } = useDeadLinkChecker()
    await checkAll(10, 0)

    expect(progress.value.total).toBe(1)
    const urls = invokeMock.mock.calls.map((c: unknown[]) => (c[1] as { body?: { url?: string } })?.body?.url)
    expect(urls.every((u: string | undefined) => u === 'https://a.com' || u === undefined || !u)).toBe(true)
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('checkOne 死链写 dead-link attribute；blocked 写 gfw-blocked', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-dead', url: 'https://dead.example' })
    invokeMock.mockResolvedValue({ data: { status: 'dead', http_status: 404 }, error: null })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (/baidu|gstatic|cloudflare/.test(String(url))) return new Response(null, { status: 200 })
      throw new Error('network fail')
    }))

    const { checkOne, isDead, isBlocked } = useDeadLinkChecker()
    await checkOne('bm-dead')

    expect(ds.bookmarkMap['bm-dead']?.attributes?.['dead-link']).toBe(true)
    expect(isDead('bm-dead')).toBe(true)
    expect(isBlocked('bm-dead')).toBe(false)
  })

  it('checkOne Edge blocked → gfw-blocked', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-gfw', url: 'https://gfw.example' })
    invokeMock.mockResolvedValue({ data: { status: 'blocked', http_status: 0 }, error: null })

    const { checkOne, isBlocked, isDead } = useDeadLinkChecker()
    await checkOne('bm-gfw')

    expect(ds.bookmarkMap['bm-gfw']?.attributes?.['gfw-blocked']).toBe(true)
    expect(isBlocked('bm-gfw')).toBe(true)
    expect(isDead('bm-gfw')).toBe(false)
  })

  it('deadCount 不计软删书签', async () => {
    const ds = useDataStore()
    seedBm(ds, {
      id: 'gone',
      url: 'https://x.com',
      deletedAt: Date.now(),
      attributes: { 'dead-link': true },
    })
    const { deadCount } = useDeadLinkChecker()
    expect(deadCount.value).toBe(0)
  })
})
