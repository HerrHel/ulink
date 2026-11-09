/**
 * 2026-11-09 全站审查修复回归。
 *
 * 锁定那些 CI（lint/typecheck/5000+ 单测/e2e）全绿时仍漏出的时序与跨层契约问题：
 * 浏览器事件生命周期、timer 代次、构建产物 CSP 来源、支付渠道返回契约、
 * 同步队列容量、分享密码在数据库层的隔离。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { useToastStore } from '../stores/toast.js'
import { useMaskClose } from '../composables/ui/useMaskClose.js'

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('2026-11-09 回归护栏', () => {
  it('useMaskClose：真实事件序列（currentTarget 派发后置 null）仍能关闭遮罩', () => {
    let calls = 0
    const h = useMaskClose(() => { calls++ })
    const mask = document.createElement('div')
    document.body.appendChild(mask)
    mask.addEventListener('mousedown', h.onMaskMouseDown)
    mask.addEventListener('click', h.onMaskClick)
    mask.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    mask.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    mask.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls).toBe(1)
    mask.remove()
  })

  it('toast：连续两次 showWithUndo，第二个撤销条不会在 300ms 后消失', async () => {
    setActivePinia(createPinia())
    const st = useToastStore()
    st.showWithUndo('first', () => {}, 6000)
    await new Promise(r => setTimeout(r, 30))
    st.showWithUndo('second', () => {}, 6000)
    expect(st.undoToast?.msg).toBe('second')
    await new Promise(r => setTimeout(r, 360))
    expect(st.undoToast?.msg).toBe('second')
    st.dismissUndo()
  })

  it('生产 HTML 入口不再手写 CSP meta（由 securityMetaPlugin 单一注入）', () => {
    for (const f of ['index.html', 'app.html']) {
      const html = read(f)
      expect((html.match(/http-equiv=["']Content-Security-Policy/gi) || []).length,
        `${f} 不应再手写 CSP meta，避免多条策略取交集抵消 worker-src`).toBe(0)
    }
    expect(read('vite.config.ts')).toContain("tag: 'meta'")
  })

  it('微信查单返回 paidCents/channelOrderId，且回调校验商户身份', () => {
    const wx = read('cloudbase/functions/pay/lib/wxpay.js')
    const a = wx.indexOf('async function queryOrder')
    const body = wx.slice(a, wx.indexOf('/** 关闭订单', a))
    expect(body, '查单必须返回与结算分支同名的字段').toContain('paidCents:')
    expect(body).toContain('channelOrderId:')
    expect(wx).toContain('mchid_mismatch')
  })

  it('同步队列不再按 1000 条硬裁剪（防首次全量同步静默丢数据）', () => {
    expect(read('src/stores/storage.ts')).not.toContain('count > 1000')
    expect(read('src/composables/domain/useCloudSync.ts')).toContain('i += 200')
  })

  it('分享内容不进共享缓存，且公开 RPC 与验密版 RPC 分离', () => {
    const ssr = read('cloudbase/functions/share-ssr/index.js')
    expect(ssr).toContain("status === 200 ? 'private, no-store'")
    expect(ssr).toContain('get_public_group_verified')
    const sql = read('cloudbase/migrations/20261109000001_share_password_rpc_guard.sql')
    expect(sql).toContain('share_password_hash IS NULL')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_public_group_verified(text) TO service_role')
  })

  it('5xx 不再无条件重试（服务端已预扣，重试会放大计费）', () => {
    expect(read('src/lib/ai/mimoStream.ts')).toContain("x-ulink-retry-safe")
  })
})
