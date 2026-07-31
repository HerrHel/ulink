/**
 * 死链纯决策函数护栏（D1-33）：classifyHttpStatus / makeCheckResult /
 * gradeLocalNetwork / decide 四个纯函数级决策核护栏。
 *
 * 现有 deadLinkChecker.test.ts 只 mock fetch 走 checkUrl 黑盒间接覆盖主路径，
 * 纯函数级边界条件（head_mismatch / no_edge / offline 各分支、HTTP 软活/死集合、
 * 基线分级阈值、makeCheckResult 的 inconclusive 不落标 persist）无直接断言。
 *
 * 本护栏仅 import 已 export 的 4 纯函数 + EdgeEvidence 类型，
 * 逐分支锁死链判定决策表不变量——误判会让中文书签被误标
 * 存活/死链/GFW/inconclusive，直接影响用户可见标签与 attributes 落标。
 *
 * 同 useDeadLinkChecker.test.ts 既有的 mock 口径（vi.mock supabase + stores/app），
 * 因 import useDeadLinkChecker.ts 模块顶层拉 supabase 与 storageSafe 依赖。
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

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

import {
  classifyHttpStatus,
  makeCheckResult,
  gradeLocalNetwork,
  decide,
} from '../../composables/domain/useDeadLinkChecker.js'

describe('classifyHttpStatus HTTP 分类护栏', () => {
  it('2xx 状态码判 alive', () => {
    expect(classifyHttpStatus(200)).toBe('alive')
    expect(classifyHttpStatus(201)).toBe('alive')
    expect(classifyHttpStatus(301)).toBe('alive')
    expect(classifyHttpStatus(302)).toBe('alive')
    expect(classifyHttpStatus(399)).toBe('alive')
  })

  it('4xx/5xx 在 HTTP_SOFT_ALIVE 集合判 alive（鉴权/限流/网关不当死链）', () => {
    // 集合 = {401,402,403,405,408,418,425,429,500,502,503,504}
    for (const code of [401, 402, 403, 405, 408, 418, 425, 429, 500, 502, 503, 504]) {
      expect(classifyHttpStatus(code)).toBe('alive')
    }
  })

  it('HTTP_DEAD 集合 {404,410} 判 dead', () => {
    expect(classifyHttpStatus(404)).toBe('dead')
    expect(classifyHttpStatus(410)).toBe('dead')
  })

  it('不在软活/死集合的 4xx/5xx 判 unknown（偏宁可 unknown 也不误杀）', () => {
    expect(classifyHttpStatus(400)).toBe('unknown')
    expect(classifyHttpStatus(406)).toBe('unknown')
    expect(classifyHttpStatus(409)).toBe('unknown')
    expect(classifyHttpStatus(411)).toBe('unknown')
    expect(classifyHttpStatus(501)).toBe('unknown')
    expect(classifyHttpStatus(599)).toBe('unknown')
  })

  it('临界值：199 与 400 不入 2xx-3xx alive 区间判 unknown', () => {
    expect(classifyHttpStatus(199)).toBe('unknown')
    expect(classifyHttpStatus(400)).toBe('unknown')
  })

  it('0 / 负数 / 极大值 兜底 unknown', () => {
    expect(classifyHttpStatus(0)).toBe('unknown')
    expect(classifyHttpStatus(-1)).toBe('unknown')
    expect(classifyHttpStatus(99999)).toBe('unknown')
  })

  it('SOFT_ALIVE 与 DEAD 互斥：404/410 不在 SOFT_ALIVE 集合', () => {
    // 锁两集合不重叠，防未来误把 404 加入软活致死链判活
    expect([404, 410]).not.toContain(401) // 形式 sanity
    expect(classifyHttpStatus(404)).toBe('dead')
    expect(classifyHttpStatus(410)).toBe('dead')
  })
})

describe('makeCheckResult verdict 派生护栏', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('verdict=alive：alive=true blocked=false persist=true', () => {
    vi.setSystemTime(1000)
    const r = makeCheckResult({ verdict: 'alive', status: 200, finalUrl: 'https://x.com' })
    expect(r.alive).toBe(true)
    expect(r.blocked).toBe(false)
    expect(r.persist).toBe(true)
    expect(r.status).toBe(200)
    expect(r.finalUrl).toBe('https://x.com')
    expect(r.checkedAt).toBe(1000)
    expect(r.reason).toBeUndefined()
  })

  it('verdict=gfw：alive=false blocked=true persist=true（GFW 落标）', () => {
    const r = makeCheckResult({ verdict: 'gfw', status: 200 })
    expect(r.alive).toBe(false)
    expect(r.blocked).toBe(true)
    expect(r.persist).toBe(true)
    expect(r.status).toBe(200)
    expect(r.finalUrl).toBe('')
  })

  it('verdict=dead：alive=false blocked=false persist=true', () => {
    const r = makeCheckResult({ verdict: 'dead', status: 404 })
    expect(r.alive).toBe(false)
    expect(r.blocked).toBe(false)
    expect(r.persist).toBe(true)
  })

  it('verdict=inconclusive：persist=false（不落标不抹——核心不变量）', () => {
    // inconclusive 不落 attributes，历史标保留不变，是一条最易误改为 persist=true 的语义
    const r = makeCheckResult({ verdict: 'inconclusive', reason: 'timeout' })
    expect(r.persist).toBe(false)
    expect(r.alive).toBe(false)
    expect(r.blocked).toBe(false)
    expect(r.reason).toBe('timeout')
  })

  it('status 缺省 → 0，finalUrl 缺省 → ""（兜底）', () => {
    const r = makeCheckResult({ verdict: 'alive' })
    expect(r.status).toBe(0)
    expect(r.finalUrl).toBe('')
  })

  it('reason 透传入参', () => {
    for (const reason of ['head_mismatch', 'offline', 'timeout', 'edge_unknown', 'connect_err', 'ssrf', 'no_edge'] as const) {
      const r = makeCheckResult({ verdict: 'inconclusive', reason })
      expect(r.reason).toBe(reason)
    }
  })

  it('checkedAt 取 Date.now()', () => {
    vi.setSystemTime(12345)
    const r = makeCheckResult({ verdict: 'dead' })
    expect(r.checkedAt).toBe(12345)
  })
})

describe('gradeLocalNetwork 基线分级护栏', () => {
  it('< 2000ms 判 online', () => {
    expect(gradeLocalNetwork(0)).toBe('online')
    expect(gradeLocalNetwork(1)).toBe('online')
    expect(gradeLocalNetwork(1999)).toBe('online')
  })

  it('>= 2000 且 < 4000 判 degraded', () => {
    expect(gradeLocalNetwork(2000)).toBe('degraded')
    expect(gradeLocalNetwork(2500)).toBe('degraded')
    expect(gradeLocalNetwork(3999)).toBe('degraded')
  })

  it('>= 4000 判 offline（BASELINE_OFFLINE_MS 临界严格 >=）', () => {
    expect(gradeLocalNetwork(4000)).toBe('offline')
    expect(gradeLocalNetwork(4001)).toBe('offline')
    expect(gradeLocalNetwork(99999)).toBe('offline')
  })

  it('阈值临界：1999 online / 2000 degraded / 3999 degraded / 4000 offline（严格 >= 切档）', () => {
    expect(gradeLocalNetwork(1999)).toBe('online')
    expect(gradeLocalNetwork(2000)).toBe('degraded')
    expect(gradeLocalNetwork(3999)).toBe('degraded')
    expect(gradeLocalNetwork(4000)).toBe('offline')
  })

  it('负数基线（理论不应出现）走 online 分支不抛', () => {
    // baselineMs 在全探针失败时返 BASELINE_OFFLINE_MS=4000 判 offline，
    // 负数是理论兜底，确认 >= 阈值不匹配时回退 online 不抛
    expect(gradeLocalNetwork(-1)).toBe('online')
  })
})

describe('decide 决策矩阵护栏', () => {
  const url = 'https://example.com'

  it('local=offline：无视 edge/direct 一律 inconclusive（off reason）（核心不可信不变量）', () => {
    // 即便 edge 判 alive 且 direct 可达，offline 仍 inconclusive，绝不落 dead/gfw
    const r = decide({ fetch_outcome: 'ok', http_status: 200 }, { reachable: true }, 'offline', url)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('offline')
    expect(r.persist).toBe(false)
  })

  it('local=offline + edge 判 dead + direct 不可达 仍 inconclusive 不落 dead', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 404 }, { reachable: false }, 'offline', url)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('offline')
  })

  it('edge.fetch_outcome=null（无远端视角）+ direct 可达 → alive（no_edge）', () => {
    const r = decide({ fetch_outcome: null, http_status: 0 }, { reachable: true }, 'online', url)
    expect(r.verdict).toBe('alive')
    expect(r.reason).toBe('no_edge')
    expect(r.finalUrl).toBe(url)
    expect(r.persist).toBe(true)
  })

  it('edge.fetch_outcome=null + direct 不可达 → inconclusive（no_edge）', () => {
    const r = decide({ fetch_outcome: null, http_status: 0 }, { reachable: false }, 'degraded', url)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('no_edge')
    expect(r.persist).toBe(false)
  })

  it('edge ok + HTTP alive + direct 可达 → alive（status 取 http_status 或 200 兜底）', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 204 }, { reachable: true }, 'online', url)
    expect(r.verdict).toBe('alive')
    expect(r.status).toBe(204)
    expect(r.finalUrl).toBe(url)
  })

  it('edge ok + HTTP alive + http_status=0 不走 alive 分支（分类为 unknown）：http_status=0 → classifyHttpStatus 返 unknown，direct 可达走 unknown→alive 分支 status 透传 0 + reason=edge_unknown（锁 alive 分支 status||200 兜底仅在 HTTP 分类 alive 时生效，0 走 unknown 分支不触发兜底）', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 0 }, { reachable: true }, 'online', url)
    expect(r.verdict).toBe('alive')
    expect(r.status).toBe(0) // 0 透传，未走 alive 分支的 || 200 兜底
    expect(r.reason).toBe('edge_unknown')
    expect(r.finalUrl).toBe(url)
  })

  it('edge ok + HTTP alive + direct 不可达 → gfw（远端可达本机不可达）', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 200 }, { reachable: false }, 'online', url)
    expect(r.verdict).toBe('gfw')
    expect(r.blocked).toBe(true)
    expect(r.persist).toBe(true)
    expect(r.status).toBe(200)
  })

  it('edge ok + HTTP dead + direct 可达 → inconclusive（head_mismatch）（Edge 判死本机仍可达）', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 404 }, { reachable: true }, 'online', url)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('head_mismatch')
    expect(r.persist).toBe(false)
    expect(r.status).toBe(404)
  })

  it('edge ok + HTTP dead + direct 不可达 → dead（status=404）', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 404 }, { reachable: false }, 'online', url)
    expect(r.verdict).toBe('dead')
    expect(r.persist).toBe(true)
    expect(r.status).toBe(404)
  })

  it('edge ok + HTTP dead（410）+ direct 不可达 → dead', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 410 }, { reachable: false }, 'online', url)
    expect(r.verdict).toBe('dead')
  })

  it('edge ok + HTTP unknown + direct 可达 → alive（edge_unknown reason）', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 400 }, { reachable: true }, 'online', url)
    expect(r.verdict).toBe('alive')
    expect(r.reason).toBe('edge_unknown')
    expect(r.status).toBe(400)
  })

  it('edge ok + HTTP unknown + direct 不可达 → inconclusive（edge_unknown）', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 400 }, { reachable: false }, 'online', url)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('edge_unknown')
  })

  it('edge connect_error + direct 可达 → inconclusive（connect_err，Edge 网络受限）', () => {
    const r = decide({ fetch_outcome: 'connect_error', http_status: 0 }, { reachable: true }, 'online', url)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('connect_err')
  })

  it('edge connect_error + direct 不可达 → dead（connect_err）', () => {
    const r = decide({ fetch_outcome: 'connect_error', http_status: 0 }, { reachable: false }, 'online', url)
    expect(r.verdict).toBe('dead')
    expect(r.reason).toBe('connect_err')
  })

  it('edge timeout → inconclusive（timeout，无视 direct）', () => {
    expect(decide({ fetch_outcome: 'timeout', http_status: 0 }, { reachable: true }, 'online', url).verdict).toBe('inconclusive')
    expect(decide({ fetch_outcome: 'timeout', http_status: 0 }, { reachable: false }, 'online', url).reason).toBe('timeout')
  })

  it('edge ssrf_reject → inconclusive（ssrf，安全拒绝与死/墙无关）', () => {
    const r = decide({ fetch_outcome: 'ssrf_reject', http_status: 0 }, { reachable: true }, 'online', url)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('ssrf')
  })

  it('edge redirect_denied → inconclusive（ssrf reason）', () => {
    const r = decide({ fetch_outcome: 'redirect_denied', http_status: 0 }, { reachable: false }, 'online', url)
    expect(r.verdict).toBe('inconclusive')
    expect(r.reason).toBe('ssrf')
  })

  it('local=degraded 等价 online 的决策行为（degraded 仍 localHealthy=true）', () => {
    // degraded 不影响决策（仅 offline 压制），与 online 同走决策表
    const r = decide({ fetch_outcome: 'ok', http_status: 404 }, { reachable: false }, 'degraded', url)
    expect(r.verdict).toBe('dead')
  })

  it('local=degraded + edge ok alive + direct 不可达 → gfw（degraded 不压制 gfw 判定）', () => {
    const r = decide({ fetch_outcome: 'ok', http_status: 200 }, { reachable: false }, 'degraded', url)
    expect(r.verdict).toBe('gfw')
  })
})
