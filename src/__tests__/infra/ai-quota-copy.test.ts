/**
 * PRO AI 月额度口径守卫（2026-11-24）
 *
 * 1. mimo-chat 只有 PRO 会走 token 预扣（免费为终身试用，不预扣），所以「本月额度已用完」
 *    提示绝不能引导「升级 PRO」——付费用户看到会以为没开通成功。
 * 2. 落地页对比表的月度额度文案必须与迁移里的 ai.tokens.monthly 同口径（字数 = token × 2）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('PRO AI 月额度文案', () => {
  it('mimo-chat 月额度耗尽提示不引导升级 PRO', () => {
    const src = read('cloudbase/functions/mimo-chat/index.js')
    // 月额度耗尽分支（每日次数耗尽是另一条 quota_exceeded，文案里提到「PRO 每日 100 次」属说明，不在此列）
    const msgs = [...src.matchAll(/message:\s*'([^']*)'/g)].map((m) => m[1])
    const monthly = msgs.filter((m) => m.includes('本月 AI 额度'))
    expect(monthly.length).toBe(1)
    expect(monthly[0]).toContain('下月 1 日')
    expect(monthly[0]).not.toMatch(/升级|PRO|¥/)
  })

  it('落地页月度额度与迁移中的 ai.tokens.monthly 一致（字数 = token × 2）', () => {
    const sql = read('cloudbase/migrations/20261124000001_pro_ai_tokens_monthly.sql')
    const tokens = Number(/'\{ai\.tokens\.monthly\}',\s*'(\d+)'/.exec(sql)?.[1])
    expect(tokens).toBe(3_000_000)
    const wan = (tokens * 2) / 10_000
    const html = read('index.html')
    expect(html).toContain(`每月 ${wan} 万字`)
    expect(html).not.toContain('每月 40 万字')
    expect(read('public/landing.js')).toContain(`'${(tokens * 2) / 1_000_000}M chars / month'`)
  })
})
