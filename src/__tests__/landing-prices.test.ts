/**
 * 落地页定价一致性 / 划线价合规守卫（零网络、纯文本解析）。
 *
 * 背景：线上 `plans` 表是金额唯一真源，但落地页是静态 HTML（SEO 需要），
 * 中文卡片、JSON-LD description、public/landing.js 的 EN 词典、e2e 断言共四处副本。
 * 历史事故：曾写死 ¥15/¥45/¥168 造成「虚构原价」，main 红了一天并冻结生产。
 *
 * 本测试不锁死具体价格数值（改价是产品决策），只锁**结构关系**：
 *   1. 三档实价在中文卡片 / JSON-LD / EN 词典里一致；
 *   2. 划线价必须等于「按月订满同周期」= 月付 × 3 / × 12（虚构原价即红）；
 *   3. 折扣文案「较按月订阅同周期合计省 ¥N」必须等于 划线价 − 实价；
 *   4. 月付不显示划线价（基准价）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const landingJs = readFileSync(resolve(process.cwd(), 'public/landing.js'), 'utf8')

/** 卡片里的 `.price-amount` 块（可能含 <del> 划线价） */
const amountBlocks = [...html.matchAll(/<div class="price-amount">([\s\S]*?)<\/div>/g)]
  .map((m) => m[1].replace(/<[^>]+>/g, ''))
/** 每块内所有 ¥数字 */
const prices = amountBlocks
  .map((b) => [...b.matchAll(/¥(\d+)/g)].map((m) => Number(m[1])))
  // 第一张是免费卡（¥0），排除后只留三张付费卡
  .filter((p) => p.length > 0 && p[0] > 0)
const nums = (s: string) => [...s.matchAll(/¥(\d+)/g)].map((m) => Number(m[1]))

describe('落地页定价一致性', () => {
  it('恰好三张付费卡：月付无划线价，季/年各一条划线价', () => {
    expect(prices).toHaveLength(3)
    expect(prices[0]).toEqual([expect.any(Number)]) // 月付：只有实价
    expect(prices[1]).toHaveLength(2) // 季付：划线 + 实价
    expect(prices[2]).toHaveLength(2) // 年付：划线 + 实价
  })

  it('划线价 = 月付实价 × 周期（3 / 12），不得虚构原价', () => {
    const monthly = prices[0][0]
    const [quarterStrike, quarterPrice] = prices[1]
    const [yearStrike, yearPrice] = prices[2]
    expect(quarterStrike).toBe(monthly * 3)
    expect(yearStrike).toBe(monthly * 12)
    expect(quarterPrice).toBeLessThan(quarterStrike)
    expect(yearPrice).toBeLessThan(yearStrike)
  })

  it('折扣文案「省 ¥N」= 划线价 − 实价', () => {
    const savings = [...html.matchAll(/较按月订阅同周期合计省 ¥(\d+)/g)].map((m) => Number(m[1]))
    expect(savings).toHaveLength(2)
    expect(savings[0]).toBe(prices[1][0] - prices[1][1])
    expect(savings[1]).toBe(prices[2][0] - prices[2][1])
  })

  it('JSON-LD description 的三档实价与卡片一致', () => {
    const m = /月付 ¥(\d+) \/ 季付 ¥(\d+) \/ 年付 ¥(\d+)/.exec(html)
    expect(m).not.toBeNull()
    expect([Number(m![1]), Number(m![2]), Number(m![3])])
      .toEqual([prices[0][0], prices[1][1], prices[2][1]])
  })

  it('EN 词典的划线价 / 月付基准与中文一致（中英不漂移）', () => {
    const quarterUnit = /'price\.quarterUnit':\s*'([^']*)'/.exec(landingJs)?.[1] || ''
    const yearUnit = /'price\.yearUnit':\s*'([^']*)'/.exec(landingJs)?.[1] || ''
    expect(nums(quarterUnit)).toContain(prices[1][0])
    expect(nums(yearUnit)).toContain(prices[2][0])
    // EN 里不得出现与中文不同的划线价
    expect(nums(quarterUnit + yearUnit).filter((n) => n >= prices[1][0])).toEqual([
      prices[1][0],
      prices[2][0],
    ])
  })
})
