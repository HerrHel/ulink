/**
 * useDeadLinkChecker 分支补测：补未覆盖的内部函数行为契约（base 72.2%/58.9% Br → ≥85%）。
 *
 * 已有 deadLinkDecision.test.ts 锁 4 纯导出函数决策表 + deadLinkChecker.test.ts 锁
 * checkUrl 决策矩阵/checkOne 写标/checkAll progress 收敛。本轮补**未覆盖的内部函数分支**：
 *
 * ① callEdgeFunction：data 非对象→fetch_outcome=null / fo 非法字符串→null / error 抛→null 兜底
 * ② measureNetworkBaseline：缓存命中复用 / 全探针失败→OFFLINE 持久化 / 成功→持久化
 * ③ checkAll：checking 早退 / 空书签早退 / URL 解析失败 ungrouped / 最短 URL 选代表 / abort 中断 break
 * ④ checkOne：bm 无 url→null
 * ⑤ _nextDeadAttrs（经 checkOne 间接）：clear/alive 清双标 / blocked 置换 dead-link / dead 置换 gfw / 无变化 null
 * ⑥ _applyDeadLinkAttributes（经 checkAll 间接）：inconclusive 跳过 / alive 清标 / dead 落标批量 patch
 * ⑦ isDead/isBlocked：无 in-session result 走 attributes fallback / getResult 直接读 results
 * ⑧ 各 computed：blockedCount（result 优先 attributes 兜底）+ inconclusiveCount/toastDeadCount/toastBlockedCount
 * ⑨ autoCheck：startAutoCheck 持久化 enabled + 到期触发 checkAll + 未到期不触发 / stopAutoCheck 清 timer
 *
 * 同构桩口径：vi.mock supabase（hoisted invokeMock）+ vi.mock app.js + vi.stubGlobal fetch
 * （探针/目标 no-cors 区分）+ useDataStore 真实 store + setActivePinia。
 *
 * 每条测配一句「锁住什么行为」。
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
import { localStorageMock } from '../setup.js'

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
    attributes: {} as Record<string, unknown>,
    isExpanded: false,
    createdAt: 1,
    updatedAt: 2,
    ...partial,
  }
  ds.addBookmark(bm as any)
  return bm.id as string
}

/** 基线探针成功、目标书签 no-cors 也可达（默认基线健康 + 直连可达） */
function stubProbeOkTargetOk() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
}
/**
 * 模拟**墙内网络 + 目标不可达**（最典型的 GFW 场景）
 *
 * 注意不能笼统地让所有探针都成功：`gstatic.com` 本身就是被墙的境外端点，
 * 而它同时被当作「地区判定」探针——若在 stub 里让它可达，会被判成「墙外」，
 * 与「模拟墙内」的意图自相矛盾（实测会导致本该判 gfw 的用例变成 alive）。
 */
function stubProbeOkTargetFail() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (/baidu/.test(u)) return new Response(null, { status: 200 }) // 境内探针可达 → baseline online
    throw new Error('network fail') // 境外端点 + 目标均不可达 → 墙内
  }))
}
/** 模拟**墙外网络**（境外端点可达）但目标站点不可达 */
function stubOverseasNetworkTargetFail() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (/baidu|gstatic|cloudflare/.test(u)) return new Response(null, { status: 200 })
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
  stubProbeOkTargetOk()
  useDeadLinkChecker()._resetDeadLinkCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  // 清 autoCheck 定时器残留 + 持久键，防跨测污染
  const { stopAutoCheck } = useDeadLinkChecker()
  stopAutoCheck()
  localStorageMock.clear()
})

describe('callEdgeFunction data 形态契约', () => {
  it('data 非对象（字符串）→ fetch_outcome=null + http_status=0（不崩，安全降级）', async () => {
    // 锁：Edge 返回非对象 data 时不崩，降级为无远端视角（fetch_outcome=null）
    invokeMock.mockResolvedValue({ data: 'not-an-object', error: null })
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://x.example')
    expect(r.verdict).toBe('alive')
    expect(r.reason).toBe('no_edge')
  })

  it('data 为 null → fetch_outcome=null（Edge 无响应降级）', async () => {
    invokeMock.mockResolvedValue({ data: null, error: null })
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://y.example')
    expect(r.verdict).toBe('alive')
    expect(r.reason).toBe('no_edge')
  })

  it('fo 为非合法字符串（不在白名单）→ fetch_outcome=null（不接受未知 outcome）', async () => {
    invokeMock.mockResolvedValue({ data: { fetch_outcome: 'mystery', http_status: 200 }, error: null })
    stubProbeOkTargetFail()
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://z.example')
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('no_edge')
  })

  it('error 非 null（Edge 抛错）→ fetch_outcome=null 兜底不崩', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('edge boom') })
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://err.example')
    expect(r.verdict).toBe('alive')
    expect(r.reason).toBe('no_edge')
  })

  it('invoke 整体 reject（catch 路径）→ fetch_outcome=null', async () => {
    invokeMock.mockRejectedValue(new Error('invoke reject'))
    const { checkUrl } = useDeadLinkChecker()
    const r = await checkUrl('https://rej.example')
    expect(r.verdict).toBe('alive')
    expect(r.reason).toBe('no_edge')
  })
})

describe('measureNetworkBaseline 基线契约', () => {
  it('全探针失败→值=BASELINE_OFFLINE_MS(4000) 并持久化到 localStorage（跨页面复用）', async () => {
    // 锁：本机离线时基线值置 offline 阈值并写盘，下次加载可恢复离线判定
    stubAllProbesFail()
    const { checkUrl } = useDeadLinkChecker()
    await checkUrl('https://offline.example')
    const raw = localStorageMock.getItem('lv_deadLinkBaseline')
    expect(raw).not.toBeNull()
    const stored = JSON.parse(raw!)
    expect(stored.value).toBe(4000)
    expect(stored).toHaveProperty('ua')
  })

  it('探针成功→基线耗时持久化（ua 字段含 navigator.userAgent）', async () => {
    // 锁：探针成功时基线耗时与 UA 写盘，UA 变更视为网络环境变更使缓存失效
    stubProbeOkTargetOk()
    const { checkUrl } = useDeadLinkChecker()
    await checkUrl('https://ok.example')
    const raw = localStorageMock.getItem('lv_deadLinkBaseline')
    expect(raw).not.toBeNull()
    const stored = JSON.parse(raw!)
    expect(typeof stored.value).toBe('number')
    expect(stored.value).toBeGreaterThanOrEqual(0)
    expect(stored.at).toBeGreaterThan(0)
  })

  it('基线缓存命中（5min TTL 内）→ 复用不重测探针', async () => {
    // 锁：5min TTL 内基线缓存命中跳过探针阶段，避免冷启动探针风暴
    const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    const { checkUrl } = useDeadLinkChecker()
    await checkUrl('https://first.example')
    const afterFirst = fetchSpy.mock.calls.filter((c: unknown[]) =>
      /baidu|gstatic|cloudflare/.test(String(c[0]))
    ).length
    // 3 个网络基线探针 + 1 次「地区判定」探测（gstatic，同样是境外端点）。
    // 地区判定带 5 分钟缓存 + in-flight 合并，缓存命中后不会再发，不构成探针风暴。
    expect(afterFirst).toBe(4)
    await checkUrl('https://second.example')
    const afterSecond = fetchSpy.mock.calls.filter((c: unknown[]) =>
      /baidu|gstatic|cloudflare/.test(String(c[0]))
    ).length
    // 探针增量=0（缓存命中跳过 measureNetworkBaseline 的探针阶段）
    expect(afterSecond).toBe(afterFirst)
  })
})

describe('失败项延迟重试契约', () => {
  it('判死（timeout）的项会被重试一次（同一 URL 探测两次）', async () => {
    // 锁：单次探测会因瞬时抖动误杀，必须复核一次才能落标
    const ds = useDataStore()
    seedBm(ds, { id: 'r-1', url: 'https://retry.example' })
    stubProbeOkTargetFail() // 墙内网络 + 目标不可达
    // 用 connect_error：这是真正会判 dead 的路径（timeout 在非名单域名下判 inconclusive，
    // 不落标也就不需要重试）
    invokeMock.mockResolvedValue(edge('connect_error'))
    const { checkAll } = useDeadLinkChecker()
    await checkAll(5, 0)
    // 首次探测 + 重试探测（Edge 侧各一次 invoke）
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  }, 15000)

  it('DNS 权威查无记录（dns_not_found）不重试——重试不会改变权威结论', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'r-2', url: 'https://nxdomain.example' })
    stubProbeOkTargetFail()
    invokeMock.mockResolvedValue(edge('dns_not_found'))
    const { checkAll } = useDeadLinkChecker()
    await checkAll(5, 0)
    // 只探测一次，不进入重试阶段
    expect(invokeMock).toHaveBeenCalledTimes(1)
  }, 15000)

  it('重试后不再判死则覆盖首次结论（消除假死）', async () => {
    // 首次 timeout → 判死；重试返回正常 → 最终不应落 dead 标
    const ds = useDataStore()
    seedBm(ds, { id: 'r-3', url: 'https://flaky.example', attributes: {} })
    stubProbeOkTargetFail()
    invokeMock
      .mockResolvedValueOnce(edge('connect_error'))
      .mockResolvedValue(edge('ok', 200))
    const { checkAll, results } = useDeadLinkChecker()
    await checkAll(5, 0)
    expect(results['r-3'].verdict).not.toBe('dead')
    expect(ds.bookmarkMap['r-3'].attributes?.['dead-link']).toBeFalsy()
  }, 15000)
})

describe('checkAll 边界与中断契约', () => {
  it('checking 已在进行中（checking.value=true）→ 早退不重复跑', async () => {
    // 锁：checkAll 并发调用时第二次因 checking.value=true 早退，不进主循环不调 invoke
    const ds = useDataStore()
    seedBm(ds, { id: 'bm-a', url: 'https://a.example' })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkAll, checking } = useDeadLinkChecker()
    checking.value = true
    const invokeCountBefore = invokeMock.mock.calls.length
    await checkAll(10, 0)
    expect(invokeMock.mock.calls.length).toBe(invokeCountBefore)
    expect(checking.value).toBe(true) // 早退路径不重置 checking
    checking.value = false // 复位防污染
  })

  it('无书签（bookmarks 为空）→ 早退不进 checkAll 主循环', async () => {
    // 锁：有效书签为 0（全软删/非 http）时 checkAll 早退，不设 checking 不调 invoke
    const ds = useDataStore()
    seedBm(ds, { id: 'soft', url: 'https://a.example', deletedAt: Date.now() })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkAll, checking } = useDeadLinkChecker()
    await checkAll(10, 0)
    expect(checking.value).toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('URL 解析失败的有效书签经 startsWith 过滤后无成员 → 早退', async () => {
    // 锁：非 http URL 被 startsWith('http') 滤除，有效集为空时 checkAll 早退
    const ds = useDataStore()
    seedBm(ds, { id: 'bad', url: 'not-a-valid-url' })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkAll, checking } = useDeadLinkChecker()
    await checkAll(10, 0)
    // bad 被 startsWith('http') 滤 → 有效集空 → 早退
    expect(checking.value).toBe(false)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('同 origin 多书签 → 选最短 URL 作代表（更快更可靠）', async () => {
    // 锁：同 origin 分组时选最短 URL 为代表，减少检测开销与误判
    const ds = useDataStore()
    seedBm(ds, { id: 'long', url: 'https://same.example/very/long/path/here' })
    seedBm(ds, { id: 'short', url: 'https://same.example' })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkAll } = useDeadLinkChecker()
    await checkAll(10, 0)
    const urls = invokeMock.mock.calls.map((c: unknown[]) => (c[1] as { body?: { url?: string } })?.body?.url)
    expect(urls).toContain('https://same.example')
  })

  it('abort 中断 → checkAll 主循环 break，checking 复位 false', async () => {
    // 锁：abort() 设 AbortController.abort()，主循环遇 _abort.signal.aborted break 退出
    const ds = useDataStore()
    for (let i = 0; i < 3; i++) seedBm(ds, { id: `bm-${i}`, url: `https://o${i}.example` })
    let resolveInvoke: () => void = () => {}
    invokeMock.mockImplementation(() => new Promise(res => { resolveInvoke = () => res(edge('ok', 200)) }))
    const { checkAll, abort, checking } = useDeadLinkChecker()
    const p = checkAll(1, 0)
    await new Promise(r => setTimeout(r, 5))
    abort()
    resolveInvoke() // 解开挂起的 invoke 让 checkAll 走到 break 后退出
    await p
    expect(checking.value).toBe(false)
  })

  it('checkAll 结尾 _applyDeadLinkAttributes：alive verdict 清除旧标', async () => {
    // 锁：全量检测 alive verdict 经 _applyDeadLinkAttributes 清除旧 dead/gfw 标
    const ds = useDataStore()
    seedBm(ds, { id: 'revive', url: 'https://revive.example', attributes: { 'dead-link': true } })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkAll, isDead } = useDeadLinkChecker()
    await checkAll(10, 0)
    expect(isDead('revive')).toBe(false)
    expect(ds.bookmarkMap['revive']?.attributes?.['dead-link']).toBeUndefined()
  })

  it('checkAll 结尾 _applyDeadLinkAttributes：dead verdict 落 dead-link 标（批量 patch）', async () => {
    // 锁：dead verdict 经 batchPatchBookmarkAttributes 批量落 dead-link 标
    const ds = useDataStore()
    seedBm(ds, { id: 'dead', url: 'https://dead.example' })
    invokeMock.mockResolvedValue(edge('ok', 404))
    stubProbeOkTargetFail()
    const { checkAll, isDead } = useDeadLinkChecker()
    await checkAll(10, 0)
    expect(isDead('dead')).toBe(true)
    expect(ds.bookmarkMap['dead']?.attributes?.['dead-link']).toBe(true)
  })

  it('checkAll 结尾 _applyDeadLinkAttributes：inconclusive 跳过不落标不抹旧标', async () => {
    // 锁：inconclusive（persist=false）经 _applyDeadLinkAttributes 跳过，旧 dead-link 标保留不变
    const ds = useDataStore()
    seedBm(ds, { id: 'inc', url: 'https://inc.example', attributes: { 'dead-link': true } })
    invokeMock.mockResolvedValue(edge('ok', 404)) // 直连可达 → head_mismatch inconclusive
    const { checkAll, isUnconfirmed } = useDeadLinkChecker()
    await checkAll(10, 0)
    expect(isUnconfirmed('inc')).toBe(true)
    expect(ds.bookmarkMap['inc']?.attributes?.['dead-link']).toBe(true)
  })

  it('checkAll 结尾 _applyDeadLinkAttributes：gfw verdict 落 gfw-blocked 标', async () => {
    // 锁：gfw verdict 经 _applyDeadLinkAttributes 落 gfw-blocked 标
    const ds = useDataStore()
    seedBm(ds, { id: 'gfw', url: 'https://gfw.example' })
    invokeMock.mockResolvedValue(edge('ok', 403)) // 403 软活 + 直连失败 → gfw
    stubProbeOkTargetFail()
    const { checkAll, isBlocked } = useDeadLinkChecker()
    await checkAll(10, 0)
    expect(isBlocked('gfw')).toBe(true)
    expect(ds.bookmarkMap['gfw']?.attributes?.['gfw-blocked']).toBe(true)
  })
})

describe('checkOne 边界契约', () => {
  it('bm 无 url（bookmarkMap 不存在）→ 返回 null', async () => {
    // 锁：checkOne 对不存在书签返回 null 不崩
    const { checkOne } = useDeadLinkChecker()
    const r = await checkOne('no-such-id')
    expect(r).toBeNull()
  })

  it('checkOne alive → _nextDeadAttrs 清旧 dead-link 标（alive mode）', async () => {
    // 锁：alive mode 清除旧 dead/gfw 标（_nextDeadAttrs clear/alive 分支删双标）
    const ds = useDataStore()
    seedBm(ds, { id: 'was-dead', url: 'https://alive.example', attributes: { 'dead-link': true } })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkOne, isDead } = useDeadLinkChecker()
    await checkOne('was-dead')
    expect(isDead('was-dead')).toBe(false)
    expect(ds.bookmarkMap['was-dead']?.attributes?.['dead-link']).toBeUndefined()
  })

  it('checkOne gfw → _nextDeadAttrs 置换：删 dead-link 置 gfw-blocked（blocked mode）', async () => {
    // 锁：blocked mode 删 dead-link 置 gfw-blocked（_nextDeadAttrs blocked 分支单向置换）
    const ds = useDataStore()
    seedBm(ds, { id: 'to-gfw', url: 'https://gfw.example', attributes: { 'dead-link': true } })
    invokeMock.mockResolvedValue(edge('ok', 403))
    stubProbeOkTargetFail()
    const { checkOne, isBlocked, isDead } = useDeadLinkChecker()
    await checkOne('to-gfw')
    expect(isBlocked('to-gfw')).toBe(true)
    expect(isDead('to-gfw')).toBe(false)
    expect(ds.bookmarkMap['to-gfw']?.attributes?.['gfw-blocked']).toBe(true)
    expect(ds.bookmarkMap['to-gfw']?.attributes?.['dead-link']).toBeUndefined()
  })

  it('checkOne dead → _nextDeadAttrs 置换：删 gfw-blocked 置 dead-link（dead mode）', async () => {
    // 锁：dead mode 删 gfw-blocked 置 dead-link（_nextDeadAttrs dead 分支单向置换）
    const ds = useDataStore()
    seedBm(ds, { id: 'to-dead', url: 'https://dead.example', attributes: { 'gfw-blocked': true } })
    invokeMock.mockResolvedValue(edge('ok', 404))
    stubProbeOkTargetFail()
    const { checkOne, isDead, isBlocked } = useDeadLinkChecker()
    await checkOne('to-dead')
    expect(isDead('to-dead')).toBe(true)
    expect(isBlocked('to-dead')).toBe(false)
    expect(ds.bookmarkMap['to-dead']?.attributes?.['dead-link']).toBe(true)
    expect(ds.bookmarkMap['to-dead']?.attributes?.['gfw-blocked']).toBeUndefined()
  })

  it('checkOne 同标幂等：已 dead 再判 dead → _nextDeadAttrs 返回 null 不 updateBookmark', async () => {
    // 锁：dead mode 命中「hasDead && !hasGfw」无变化返回 null，不冗余写 attributes
    const ds = useDataStore()
    seedBm(ds, { id: 'still', url: 'https://dead.example', attributes: { 'dead-link': true } })
    invokeMock.mockResolvedValue(edge('ok', 404))
    stubProbeOkTargetFail()
    const spy = vi.spyOn(ds, 'updateBookmark')
    const { checkOne } = useDeadLinkChecker()
    await checkOne('still')
    expect(spy).not.toHaveBeenCalled()
  })

  it('checkOne inconclusive → persist=false 早退，不调 updateBookmark', async () => {
    // 锁：inconclusive persist=false 经 checkOne 早退返回，不调 updateBookmark 不动标
    const ds = useDataStore()
    seedBm(ds, { id: 'inc', url: 'https://inc.example' })
    invokeMock.mockResolvedValue(edge('ok', 404))
    const spy = vi.spyOn(ds, 'updateBookmark')
    const { checkOne, isUnconfirmed } = useDeadLinkChecker()
    await checkOne('inc')
    expect(isUnconfirmed('inc')).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('isDead/isBlocked/getResult fallback 契约', () => {
  it('无 in-session result → isDead 走 attributes 兜底返 true', () => {
    // 锁：无 in-session result 时 isDead 读 attributes['dead-link'] 兜底
    const ds = useDataStore()
    seedBm(ds, { id: 'attr-dead', url: 'https://x.example', attributes: { 'dead-link': true } })
    const { isDead } = useDeadLinkChecker()
    expect(isDead('attr-dead')).toBe(true)
  })

  it('无 in-session result → isDead 无标返 false', () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'attr-clean', url: 'https://x.example' })
    const { isDead } = useDeadLinkChecker()
    expect(isDead('attr-clean')).toBe(false)
  })

  it('无 in-session result → isBlocked 走 attributes 兜底返 true', () => {
    // 锁：无 in-session result 时 isBlocked 读 attributes['gfw-blocked'] 兜底
    const ds = useDataStore()
    seedBm(ds, { id: 'attr-gfw', url: 'https://x.example', attributes: { 'gfw-blocked': true } })
    const { isBlocked } = useDeadLinkChecker()
    expect(isBlocked('attr-gfw')).toBe(true)
  })

  it('in-session result 优先于 attributes（isDead 读 result.verdict）', async () => {
    // 锁：有 in-session result 时 isDead 只看 result.verdict，不回退 attributes
    const ds = useDataStore()
    seedBm(ds, { id: 'mixed', url: 'https://mixed.example', attributes: { 'dead-link': true } })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkOne, isDead } = useDeadLinkChecker()
    await checkOne('mixed')
    expect(isDead('mixed')).toBe(false)
  })

  it('getResult 读取 in-session results（未检测返 null）', () => {
    // 锁：getResult 直接读 results[id]，未检测返 null
    const ds = useDataStore()
    seedBm(ds, { id: 'unchecked', url: 'https://x.example' })
    const { getResult } = useDeadLinkChecker()
    expect(getResult('unchecked')).toBeNull()
  })

  it('getResult 检测后返回 CheckResult', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'checked', url: 'https://x.example' })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkOne, getResult } = useDeadLinkChecker()
    await checkOne('checked')
    const r = getResult('checked')
    expect(r).not.toBeNull()
    expect(r?.verdict).toBe('alive')
  })
})

describe('computed 计数契约', () => {
  it('blockedCount 无 result 走 attributes 兜底计 gfw-blocked', () => {
    // 锁：blockedCount 无 in-session result 时回退计 attributes['gfw-blocked']
    const ds = useDataStore()
    seedBm(ds, { id: 'attr-gfw', url: 'https://x.example', attributes: { 'gfw-blocked': true } })
    const { blockedCount } = useDeadLinkChecker()
    expect(blockedCount.value).toBe(1)
  })

  it('blockedCount result 优先（gfw verdict）+ 不计软删', async () => {
    // 锁：blockedCount 有 result 时只计 gfw verdict，软删书签不计
    const ds = useDataStore()
    seedBm(ds, { id: 'gfw', url: 'https://gfw.example' })
    seedBm(ds, { id: 'soft', url: 'https://soft.example', deletedAt: Date.now(), attributes: { 'gfw-blocked': true } })
    invokeMock.mockResolvedValue(edge('ok', 403))
    stubProbeOkTargetFail()
    const { checkOne, blockedCount } = useDeadLinkChecker()
    await checkOne('gfw')
    expect(blockedCount.value).toBe(1)
  })

  it('inconclusiveCount 仅计 in-session inconclusive result', async () => {
    // 锁：inconclusiveCount 仅遍历 in-session results（不读 attributes）
    const ds = useDataStore()
    seedBm(ds, { id: 'inc', url: 'https://inc.example' })
    invokeMock.mockResolvedValue(edge('ok', 404))
    const { checkOne, inconclusiveCount } = useDeadLinkChecker()
    await checkOne('inc')
    expect(inconclusiveCount.value).toBe(1)
  })

  it('toastDeadCount 仅计 in-session dead result（读 results 不读 attributes）', async () => {
    // 锁：toastDeadCount 仅遍历 in-session results 的 dead verdict，不读 attributes
    const ds = useDataStore()
    seedBm(ds, { id: 'attr-only', url: 'https://x.example', attributes: { 'dead-link': true } })
    seedBm(ds, { id: 'live', url: 'https://live.example' })
    invokeMock.mockResolvedValue(edge('ok', 404))
    stubProbeOkTargetFail()
    const { checkOne, toastDeadCount } = useDeadLinkChecker()
    await checkOne('live')
    expect(toastDeadCount.value).toBe(1)
  })

  it('toastBlockedCount 仅计 in-session gfw result', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'gfw', url: 'https://gfw.example' })
    invokeMock.mockResolvedValue(edge('ok', 403))
    stubProbeOkTargetFail()
    const { checkOne, toastBlockedCount } = useDeadLinkChecker()
    await checkOne('gfw')
    expect(toastBlockedCount.value).toBe(1)
  })
})

describe('checkAll 规模上限契约', () => {
  it('传 maxCount 时按上限截断，且如实记录被跳过的数量', async () => {
    // 锁：自动全量扫描的成本与书签数成正比，必须封顶；
    //     截断不能静默——要能在 UI 上如实告知"另有 N 个未检查"
    const ds = useDataStore()
    seedBm(ds, { id: 'a', url: 'https://a.example' })
    seedBm(ds, { id: 'b', url: 'https://b.example' })
    seedBm(ds, { id: 'c', url: 'https://c.example' })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkAll, progress } = useDeadLinkChecker()
    await checkAll(5, 0, 2)
    expect(progress.value.total).toBe(2)
    expect(progress.value.truncated).toBe(1)
  })

  it('不传 maxCount 时不截断（手动检查不受限）', async () => {
    const ds = useDataStore()
    seedBm(ds, { id: 'a', url: 'https://a.example' })
    seedBm(ds, { id: 'b', url: 'https://b.example' })
    seedBm(ds, { id: 'c', url: 'https://c.example' })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const { checkAll, progress } = useDeadLinkChecker()
    await checkAll(5, 0)
    expect(progress.value.total).toBe(3)
    expect(progress.value.truncated).toBe(0)
  })
})

describe('autoCheck 定时检测契约', () => {
  it('startAutoCheck：持久化 enabled=true（写 lv_autoDeadCheckEnabled）', () => {
    // 锁：startAutoCheck 写 enabled 持久键，autoCheckEnabled ref=true
    localStorageMock.clear()
    const { startAutoCheck, autoCheckEnabled , autoCheckAllowed} = useDeadLinkChecker()
    autoCheckAllowed.value = true // 具备 Plus 权益（linkcheck.auto）才允许启动
    startAutoCheck()
    expect(autoCheckEnabled.value).toBe(true)
    expect(localStorageMock.getItem('lv_autoDeadCheckEnabled')).toBe('1')
  })

  it('stopAutoCheck：持久化 disabled + 清 timer（不写 enabled key）', () => {
    // 锁：stopAutoCheck 清 enabled 持久键（移除），autoCheckEnabled ref=false
    const { startAutoCheck, stopAutoCheck, autoCheckEnabled , autoCheckAllowed} = useDeadLinkChecker()
    autoCheckAllowed.value = true // 具备 Plus 权益（linkcheck.auto）才允许启动
    startAutoCheck()
    stopAutoCheck()
    expect(autoCheckEnabled.value).toBe(false)
    expect(localStorageMock.getItem('lv_autoDeadCheckEnabled')).toBeNull()
  })

  it('无 Plus 权益时 startAutoCheck 拒绝启动（不写 enabled 持久键）', () => {
    // 锁：自动全量检测是成本最高的路径（请求数与书签数成正比），
    //     无 linkcheck.auto 权益时必须拒绝启动，避免免费用户持续产生外呼成本
    localStorageMock.clear()
    const { startAutoCheck, autoCheckEnabled, autoCheckAllowed } = useDeadLinkChecker()
    expect(autoCheckAllowed.value).toBe(false)
    const started = startAutoCheck()
    expect(started).toBe(false)
    expect(autoCheckEnabled.value).toBe(false)
    expect(localStorageMock.getItem('lv_autoDeadCheckEnabled')).toBeNull()
  })

  it('autoCheckEnabled 初始从 localStorage 读取（禁用态）', () => {
    localStorageMock.clear()
    const { autoCheckEnabled } = useDeadLinkChecker()
    expect(autoCheckEnabled.value).toBe(false)
  })

  it('startAutoCheck 到期（last 时间戳超 7 天）触发 checkAll 并更新时间戳', async () => {
    // 锁：到期（>7天）时 startAutoCheck 立即触发 checkAll 并刷新 last 时间戳（DLC-4）
    const ds = useDataStore()
    seedBm(ds, { id: 'a', url: 'https://due.example' })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const eightDaysAgo = Date.now() - 8 * 7 * 24 * 60 * 60 * 1000
    localStorageMock.setItem('lv_autoDeadCheck', String(eightDaysAgo))
    const { startAutoCheck, checking , autoCheckAllowed} = useDeadLinkChecker()
    autoCheckAllowed.value = true // 具备 Plus 权益（linkcheck.auto）才允许启动
    startAutoCheck()
    await new Promise(r => setTimeout(r, 50))
    expect(invokeMock).toHaveBeenCalled()
    const ts = parseInt(localStorageMock.getItem('lv_autoDeadCheck') || '0', 10)
    expect(ts).toBeGreaterThan(eightDaysAgo)
    await new Promise(r => setTimeout(r, 50))
    expect(checking.value).toBe(false)
  })

  it('startAutoCheck 未到期（last 在 7 天内）不立即触发 checkAll', () => {
    // 锁：未到期时 startAutoCheck 不立即 checkAll，时间戳保持不变（不刷无谓触发）
    const ds = useDataStore()
    seedBm(ds, { id: 'fresh', url: 'https://fresh.example' })
    invokeMock.mockResolvedValue(edge('ok', 200))
    const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000
    localStorageMock.setItem('lv_autoDeadCheck', String(oneDayAgo))
    const { startAutoCheck , autoCheckAllowed} = useDeadLinkChecker()
    autoCheckAllowed.value = true // 具备 Plus 权益（linkcheck.auto）才允许启动
    startAutoCheck()
    expect(invokeMock).not.toHaveBeenCalled()
    expect(parseInt(localStorageMock.getItem('lv_autoDeadCheck') || '0', 10)).toBe(oneDayAgo)
  })
})
