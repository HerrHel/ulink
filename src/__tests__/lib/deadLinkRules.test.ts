/**
 * 死链判定规则表（RULES）的契约测试
 *
 * `decide()` 已从 20 多个嵌套 if/else 改成表驱动（见 deadLinkDecision.ts 的 RULES）。
 * 表驱动的收益是「加规则只需加一项、不会漏改别处」，代价是**优先级藏在数组顺序里**——
 * 顺序一乱，行为就变，而且不会有任何编译错误。
 *
 * 本测试用 `decideWithRule()` 断言每个场景命中**哪条规则**，锁住：
 *   ① 每条规则都可达（没有死规则）；
 *   ② 规则之间的优先级边界（尤其 gfw 相关规则必须排在通用规则之前）。
 */
import { describe, it, expect } from 'vitest'
import { decideWithRule, type EdgeEvidence, type LocalNetwork } from '../../lib/deadLinkDecision.js'

const edge = (outcome: EdgeEvidence['fetch_outcome'], status = 0): EdgeEvidence => ({
  fetch_outcome: outcome,
  http_status: status,
})

const IN = true // 墙内网络
const OUT = false // 墙外网络
const GFW_URL = 'https://www.google.com/' // 命中名单
const NORMAL_URL = 'https://example.com/' // 不在名单

/** 断言命中指定规则，并返回结果便于继续断言 */
function hit(
  args: [EdgeEvidence, { reachable: boolean }, LocalNetwork, string, boolean],
  expectedRuleId: string,
) {
  const { result, ruleId } = decideWithRule(...args)
  expect(ruleId).toBe(expectedRuleId)
  return result
}

describe('判定规则表：优先级与可达性', () => {
  it('本机离线压过一切（即使名单命中、服务端超时）', () => {
    const r = hit([edge('timeout'), { reachable: false }, 'offline', GFW_URL, IN], 'local.offline')
    expect(r.verdict).toBe('inconclusive')
    expect(r.persist).toBe(false)
  })

  describe('Edge 无响应（fetch_outcome=null）', () => {
    it('本机可达 → alive', () => {
      hit([edge(null), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.none.reachable')
    })
    it('本机不可达 + 墙内 + 名单命中 → gfw', () => {
      hit([edge(null), { reachable: false }, 'online', GFW_URL, IN], 'edge.none.gfw')
    })
    it('本机不可达 + 墙外 + 名单命中 → 不判 gfw，退回不确定', () => {
      const r = hit([edge(null), { reachable: false }, 'online', GFW_URL, OUT], 'edge.none.unknown')
      expect(r.verdict).toBe('inconclusive')
    })
  })

  describe('Edge 状态码判活', () => {
    it('本机可达 → alive（服务端优先拿状态码）', () => {
      const r = hit([edge('ok', 200), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.ok.alive.reachable')
      expect(r.status).toBe(200)
    })
    it('本机不可达 + 墙内 → gfw（被墙典型特征）', () => {
      hit([edge('ok', 200), { reachable: false }, 'online', GFW_URL, IN], 'edge.ok.alive.gfw')
    })
    it('本机不可达 + 墙外 → alive（本机网络问题，服务端证据更强）', () => {
      const r = hit([edge('ok', 200), { reachable: false }, 'online', GFW_URL, OUT], 'edge.ok.alive.noLocal')
      expect(r.verdict).toBe('alive')
    })
  })

  describe('Edge 状态码判死', () => {
    it('本机可达 → inconclusive（信号冲突，保守不定性）', () => {
      const r = hit([edge('ok', 404), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.ok.dead.reachable')
      expect(r.verdict).toBe('inconclusive')
      expect(r.reason).toBe('head_mismatch')
    })
    it('本机不可达 → dead（双端确认）', () => {
      hit([edge('ok', 410), { reachable: false }, 'online', NORMAL_URL, IN], 'edge.ok.dead.confirmed')
    })
    it('死状态码不受名单影响（google.com 404 也不该判被墙）', () => {
      const r = hit([edge('ok', 404), { reachable: false }, 'online', GFW_URL, IN], 'edge.ok.dead.confirmed')
      expect(r.verdict).toBe('dead')
    })
  })

  describe('Edge 状态码无法分类', () => {
    it('本机可达 → alive', () => {
      hit([edge('ok', 418), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.ok.alive.reachable')
    })
    it('本机不可达 → inconclusive', () => {
      const r = hit([edge('ok', 599), { reachable: false }, 'online', NORMAL_URL, IN], 'edge.ok.unknown')
      expect(r.verdict).toBe('inconclusive')
    })
  })

  describe('权威结论', () => {
    it('NXDOMAIN → dead（不受本机可达性影响）', () => {
      const r = hit([edge('dns_not_found'), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.dns_not_found')
      expect(r.verdict).toBe('dead')
      expect(r.reason).toBe('dns_not_found')
    })
    it('云端捕获阻断特征 → gfw', () => {
      hit([edge('gfw_blocked'), { reachable: false }, 'online', NORMAL_URL, IN], 'edge.gfw_blocked')
    })
  })

  describe('连接失败与超时', () => {
    it('connect_error + 本机可达 → alive', () => {
      hit([edge('connect_error'), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.connect_error.reachable')
    })
    it('connect_error + 本机不可达 + 墙内名单 → gfw', () => {
      hit([edge('connect_error'), { reachable: false }, 'online', GFW_URL, IN], 'edge.connect_error.gfw')
    })
    it('connect_error + 本机不可达 + 非名单 → dead', () => {
      hit([edge('connect_error'), { reachable: false }, 'online', NORMAL_URL, IN], 'edge.connect_error.dead')
    })
    it('timeout + 本机可达 → alive', () => {
      hit([edge('timeout'), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.timeout.reachable')
    })
    it('timeout + 本机不可达 + 墙内名单 → gfw', () => {
      hit([edge('timeout'), { reachable: false }, 'online', GFW_URL, IN], 'edge.timeout.gfw')
    })
    it('timeout + 本机不可达 + 非名单 → inconclusive（不落标）', () => {
      const r = hit([edge('timeout'), { reachable: false }, 'online', NORMAL_URL, IN], 'edge.timeout')
      expect(r.persist).toBe(false)
    })
  })

  describe('安全拒绝与兜底', () => {
    it('ssrf_reject → inconclusive(ssrf)', () => {
      const r = hit([edge('ssrf_reject'), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.security_reject')
      expect(r.reason).toBe('ssrf')
    })
    it('redirect_denied → 同样归入安全拒绝', () => {
      hit([edge('redirect_denied'), { reachable: true }, 'online', NORMAL_URL, IN], 'edge.security_reject')
    })
    it('非法 URL 不抛错，按非受限站点处理', () => {
      const { ruleId } = decideWithRule(edge('timeout'), { reachable: false }, 'online', 'not-a-url', IN)
      expect(ruleId).toBe('edge.timeout')
    })
  })

  describe('离线判定优先级最高', () => {
    it('离线 + Edge 拿到 200 → 仍不落标', () => {
      const r = hit([edge('ok', 200), { reachable: true }, 'offline', NORMAL_URL, IN], 'local.offline')
      expect(r.persist).toBe(false)
    })
  })
})
