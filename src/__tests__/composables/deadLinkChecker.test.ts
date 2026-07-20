/**
 * QUAL-03 / RE-10 / RE-11：死链判定与软删排除
 *
 * 本轮重构后：Edge 回 evidence API（fetch_outcome + http_status），客户端独占属性
 * 写入并用 LinkVerdict 枚举决策（drop confidence）。mock 返回用 fetch_outcome。
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

/** 基线探针成功、目标书签 no-cors 失败（模拟 GFW / 本机不可达） */
function stubProbeOkTargetFail() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (/baidu|gstatic|cloudflare/.test(String(url))) return new Response(null, { status: 200 })
    throw new Error('network fail')
  }))
}

/** 基线探针全部失败（模拟本机离线） */
function stubAllProbesFail() {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
}

/** Edge evidence mock 构造器 */
function edge(fo: string, http_status = 0) {
  return { data: { fetch_outcome: fo, http_status }, error: null }
}

beforeEach(() => {
  setActivePinia(createPinia())
  invokeMock.mockReset()
  // 基线：探针快返回；书签 no-cors 默认可达
  // Response status 须在 200–599，status:0 会 RangeError 导致 checkDirect 恒 false
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  // 清跨用例共享的模块级缓存（baseline 30s 缓存会在用例间污染离线判定）
  useDeadLinkChecker()._resetDeadLinkCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkUrl 决策矩阵（RE-10，verdict 枚举）', () => {
  it('非 http → verdict=dead', async () => {
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('ftp://x')
    expect(r.verdict).toBe('dead')
    expect(r.alive).toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('Edge ok+alive(200) + 直连可达 → alive', async () => {
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://ok.example')
    expect(r.verdict).toBe('alive')
    expect(r.blocked).toBe(false)
    expect(r.alive).toBe(true)
    expect(r.persist).toBe(true)
  })

  it('Edge ok+alive(200) + 直连失败 → gfw', async () => {
    invokeMock.mockResolvedValue(edge('ok', 200))
    stubProbeOkTargetFail()
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://blocked.example')
    expect(r.verdict).toBe('gfw')
    expect(r.alive).toBe(false)
    expect(r.blocked).toBe(true)
    expect(r.persist).toBe(true)
  })

  it('Edge ok+dead(404) + 直连失败 → dead', async () => {
    invokeMock.mockResolvedValue(edge('ok', 404))
    stubProbeOkTargetFail()
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://gone.example')
    expect(r.verdict).toBe('dead')
    expect(r.status).toBe(404)
    expect(r.blocked).toBe(false)
    expect(r.persist).toBe(true)
  })

  it('Edge ok+dead(404) + 直连可达 → inconclusive(head_mismatch)，不落标', async () => {
    invokeMock.mockResolvedValue(edge('ok', 404))
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://head-false-positive.example')
    expect(r.verdict).toBe('inconclusive')
    expect(r.persist).toBe(false)
    expect(r.reason).toBe('head_mismatch')
  })

  it('Edge ssrf_reject → inconclusive（Edge 拒不等于用户端墙/死）', async () => {
    invokeMock.mockResolvedValue(edge('ssrf_reject', 0))
    stubProbeOkTargetFail()
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://ssrf.example')
    expect(r.verdict).toBe('inconclusive')
    expect(r.persist).toBe(false)
    expect(r.reason).toBe('ssrf')
  })

  it('Edge redirect_denied → inconclusive(reason=ssrf)', async () => {
    invokeMock.mockResolvedValue(edge('redirect_denied', 0))
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://redir.example')
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('ssrf')
  })

  it('Edge ok+unknown(0) + 直连可达 → alive(弱, edge_unknown)', async () => {
    invokeMock.mockResolvedValue(edge('ok', 0))
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://opaque.example')
    expect(r.verdict).toBe('alive')
    expect(r.reason).toBe('edge_unknown')
  })

  it('Edge connect_error + 直连失败 → dead', async () => {
    invokeMock.mockResolvedValue(edge('connect_error', 0))
    stubProbeOkTargetFail()
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://connfail.example')
    expect(r.verdict).toBe('dead')
    expect(r.reason).toBe('connect_err')
  })

  it('Edge timeout → inconclusive（不再因超时标 dead/gfw）', async () => {
    invokeMock.mockResolvedValue(edge('timeout', 0))
    stubProbeOkTargetFail()
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://slow.example')
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('timeout')
    expect(r.persist).toBe(false)
  })

  it('Edge 调用失败 + 直连可达 → alive(no_edge)', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('edge down') })
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://directonly.example')
    expect(r.verdict).toBe('alive')
    expect(r.reason).toBe('no_edge')
  })

  it('本机离线 + Edge alive → inconclusive(offline)，绝不落 gfw', async () => {
    invokeMock.mockResolvedValue(edge('ok', 200))
    stubAllProbesFail()
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://offline-but-edge-ok.example')
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('offline')
    expect(r.persist).toBe(false)
  })
})

describe('checkAll / isDead（RE-11 + attributes）', () => {
  it('checkAll 跳过软删与 dead-link-ignored', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'alive', url: 'https://a.com' })
    seedBm(ds, { id: 'soft', url: 'https://b.com', deletedAt: Date.now() })
    seedBm(ds, { id: 'ignored', url: 'https://c.com', attributes: { 'dead-link-ignored': true } })

    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkAll, progress } = useDeadLinkChecker()
    await checkAll(10, 0)

    expect(progress.value.total).toBe(1)
    const urls = invokeMock.mock.calls.map((c: unknown[]) => (c[1] as { body?: { url?: string } })?.body?.url)
    expect(urls.every((u: string | undefined) => u === 'https://a.com' || u === undefined || !u)).toBe(true)
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('checkOne dead → 写 dead-link attribute；isDead=true', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-dead', url: 'https://dead.example' })
    invokeMock.mockResolvedValue(edge('ok', 404))
    stubProbeOkTargetFail()

    const { checkOne, isDead, isBlocked } = useDeadLinkChecker()
    await checkOne('bm-dead')

    expect(ds.bookmarkMap['bm-dead']?.attributes?.['dead-link']).toBe(true)
    expect(isDead('bm-dead')).toBe(true)
    expect(isBlocked('bm-dead')).toBe(false)
  })

  it('checkOne gfw → 写 gfw-blocked（Edge 403 + 直连失败 + 基线健康）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-gfw', url: 'https://gfw.example' })
    invokeMock.mockResolvedValue(edge('ok', 403))
    stubProbeOkTargetFail()

    const { checkOne, isBlocked, isDead } = useDeadLinkChecker()
    await checkOne('bm-gfw')

    expect(ds.bookmarkMap['bm-gfw']?.attributes?.['gfw-blocked']).toBe(true)
    expect(isBlocked('bm-gfw')).toBe(true)
    expect(isDead('bm-gfw')).toBe(false)
  })

  it('checkOne inconclusive → 不落标也不抹旧标', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-inc', url: 'https://inc.example', attributes: { 'dead-link': true } })
    // Edge dead + 本机可达 → inconclusive(head_mismatch)
    invokeMock.mockResolvedValue(edge('ok', 404))

    const { checkOne, isUnconfirmed } = useDeadLinkChecker()
    await checkOne('bm-inc')

    expect(isUnconfirmed('bm-inc')).toBe(true)
    // 旧 dead-link 标保留（inconclusive 不抹）
    expect(ds.bookmarkMap['bm-inc']?.attributes?.['dead-link']).toBe(true)
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
