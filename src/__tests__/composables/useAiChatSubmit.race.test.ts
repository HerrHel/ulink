/**
 * #22：媒体预处理 catch / aborted / 超长提示词三处早退无条件写
 * aiLoading=false、abortSlot.current=null，会抹掉被停止/切会话接管后的新请求状态。
 *
 * useAiChatSubmit 依赖链极重（mimoClient / cloudAiClient / agent / 多个 store），
 * 直接实例化跑完整 handleAiSubmit 成本高且脆弱；这里以「源码接线不变式」钉住
 * 三处早退都必须带 abortSlot.current === controller 守卫（对照 finally 已有的正确
 * 写法），防止守卫被删。guard 先于同块的复位赋值出现，即状态写入落在守卫内。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function preflightRegion(): string {
  const src = readFileSync(
    join(process.cwd(), 'src/composables/domain/useAiChatSubmit.ts'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const start = src.indexOf('abortSlot.current = controller')
  const end = src.indexOf('chatTurns.value.push', start)
  return src.slice(start, end > start ? end : undefined)
}

describe('useAiChatSubmit 早退守卫（#22）', () => {
  it('预处理早退区三次复位共享状态都落在 abortSlot.current === controller 守卫内', () => {
    const r = preflightRegion()
    const guards = (r.match(/abortSlot\.current === controller/g) || []).length
    const resets = (r.match(/aiLoading\.value = false/g) || []).length
    const slotClears = (r.match(/abortSlot\.current = null/g) || []).length
    // catch / aborted / 超长提示词 三处
    expect(guards).toBeGreaterThanOrEqual(3)
    expect(resets).toBe(3)
    expect(slotClears).toBe(3)
    expect(guards).toBeGreaterThanOrEqual(resets)
    // 第一处 guard 必须出现在它保护的复位赋值之前
    expect(r.indexOf('abortSlot.current === controller')).toBeLessThan(r.indexOf('aiLoading.value = false'))
  })
})
