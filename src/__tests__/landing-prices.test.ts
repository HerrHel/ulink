/**
 * 落地页「不写具体价格与额度」守卫（零网络、纯文本解析）。
 *
 * 背景：线上 `plans` 表是价格与权益的唯一真源。落地页曾把 ¥15/¥36/¥108、划线价、
 * 「每月 N 万字」「每日 N 次」等手抄进静态 HTML 与 EN 词典，每次调价/调额度都要记得同步，
 * 漏一次就落后（还出过「虚构原价」事故，main 红了一天并冻结生产）。
 * 2026-11-25 起落地页只做免费 / PRO 定性对比，具体数字引导到应用内购买弹窗（/app?upgrade=1）。
 *
 * 本测试锁死这条约定：中文页面、JSON-LD、EN 词典里都不得再出现金额、划线价与额度数字。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const html = readFileSync(resolve(process.cwd(), 'about.html'), 'utf8')
const landingJs = readFileSync(resolve(process.cwd(), 'public/landing.js'), 'utf8')
const body = html.slice(html.indexOf('<body'))
/** 正文可见文字（去掉标签与注释） */
const bodyText = body.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
/** EN 词典的全部字符串值 */
const enBlock = /var EN = \{([\s\S]*?)\};/.exec(landingJs)?.[1] || ''
const enText = [...enBlock.matchAll(/'((?:[^'\\]|\\.)*)'\s*[,\n]/g)].map((m) => m[1]).join(' ')

describe('落地页不写具体价格与额度', () => {
  it('正文不出现金额与划线价', () => {
    expect(bodyText).not.toMatch(/¥\s*\d/)
    expect(body).not.toContain('<del')
  })

  it('正文不出现「N 次 / N 天 / N 万字」一类额度数字', () => {
    expect(bodyText).not.toMatch(/\d+\s*(次|天|万字)/)
  })

  it('PRO 入口直达应用内购买弹窗（价格由弹窗从 plans 表实时读取）', () => {
    expect(body).toContain('href="/app?upgrade=1"')
  })

  it('JSON-LD 只声明免费起步价，不列 PRO 金额', () => {
    const m = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(html)
    expect(m).not.toBeNull()
    const ld = JSON.parse(m![1])
    expect(ld.offers.price).toBe('0')
    expect(ld.offers.priceSpecification).toBeUndefined()
    expect(JSON.stringify(ld)).not.toMatch(/¥\s*\d/)
  })

  it('EN 词典同样不写金额与额度', () => {
    expect(enText.length).toBeGreaterThan(0)
    expect(enText).not.toMatch(/[¥$]\s*\d/)
    expect(enText).not.toMatch(/\d+\s*\/\s*(day|month)|\d+M chars|\d+\s*(days|uses)\b/i)
  })
})
