/**
 * cloudbaseEnvSwitch — 后端开关真源契约（双形态共用）
 *
 * 背景（审计 #25）：`npm run test:cloudbase` 的既有用例里，一部分整体
 * vi.mock('lib/cloudbase.js') / vi.mock('lib/dbApi.js')，开关本身
 * （isCloudBaseBackend 读 import.meta.env.VITE_BACKEND）在任何门禁里都没有
 * 「真源」断言——config 设了 VITE_BACKEND=cloudbase 却没人验证代码真的跟着切。
 *
 * 本文件**不 mock** lib/cloudbase.js / lib/dbApi.js，只把云 SDK 底座
 * （@cloudbase/js-sdk）换成 fake：
 *   - 默认套件（vitest.config：VITE_BACKEND=''）→ 锁 Supabase 分支
 *   - cloudbase 套件（vitest.cloudbase.config：VITE_BACKEND='cloudbase'）
 *     → 锁 CloudBase 分支（含 dbFrom/dbRpc 真的拿到 rdb builder）
 * 同一文件在两套件里断言方向相反：谁改坏 env 开关（改名/默认值翻转/硬编码），
 * 对应门禁立刻红，而不是被 mock 掩盖。
 */
import { describe, it, expect, vi } from 'vitest'

const backend = ((import.meta.env.VITE_BACKEND as string | undefined) || '').trim()
const isCb = backend === 'cloudbase'

// vi.mock 工厂被提升到 import 之前，不能引用外层变量；fake 经 vi.hoisted 暴露。
// builder 打上 marker，供 dbFrom/dbRpc 断言「拿到的是 rdb 那份」而非 supabase 的。
const fake = vi.hoisted(() => {
  const marker = Symbol('cb-rdb-builder')
  const calls: Array<{ method: string; args?: unknown }> = []
  const builder: Record<PropertyKey, unknown> = {}
  const db = {
    from(table: string) {
      calls.push({ method: 'from', args: table })
      builder.marker = marker
      return builder
    },
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ method: 'rpc', args: [name, args] })
      builder.marker = marker
      return builder
    },
  }
  const init = vi.fn(() => ({ rdb: () => db }))
  return { marker, calls, builder, db, init }
})

vi.mock('@cloudbase/js-sdk', () => ({ default: { init: fake.init } }))

// vi.mock 提升语义：下面两个被测模块的 import 会被 vitest 转换器排在 mock 之后执行
import { isCloudBaseBackend, edgeFnUrl, getCbFnBase } from '../../lib/cloudbase.js'
import { dbFrom, dbRpc } from '../../lib/dbApi.js'

describe(`后端开关真源契约（VITE_BACKEND="${backend}"）`, () => {
  it('isCloudBaseBackend() 严格跟随 VITE_BACKEND', () => {
    expect(isCloudBaseBackend()).toBe(isCb)
  })

  it('edgeFnUrl 按当前后端拼云函数基址', () => {
    // 两套 vitest 配置都显式钉了这两个基址，不受本地 .env 泄漏影响
    expect(getCbFnBase()).toBe('https://test.ulink.ren')
    expect(edgeFnUrl('pay')).toBe(
      isCb ? 'https://test.ulink.ren/pay' : 'https://test.supabase.co/functions/v1/pay',
    )
  })

  it('dbFrom/dbRpc 按开关分流到对应客户端', () => {
    const from = dbFrom('bookmarks') as unknown as Record<PropertyKey, unknown>
    const rpc = dbRpc('get_share_secret', { sid: 's1' }) as unknown as Record<PropertyKey, unknown>
    if (isCb) {
      // CloudBase 分支：必须拿到 rdb builder（marker 一致）且记录了调用
      expect(from.marker).toBe(fake.marker)
      expect(rpc.marker).toBe(fake.marker)
      expect(fake.calls).toContainEqual({ method: 'from', args: 'bookmarks' })
      expect(fake.calls).toContainEqual({ method: 'rpc', args: ['get_share_secret', { sid: 's1' }] })
      // init 收到 cloudbase 套件注入的 envId / publishable key
      expect(fake.init).toHaveBeenCalledWith(
        expect.objectContaining({ env: 'test-env', accessKey: expect.any(String) }),
      )
    } else {
      // Supabase 分支：绝不能拿到 rdb builder（拿到即开关失效、写错后端）
      expect(from.marker).not.toBe(fake.marker)
      expect(rpc.marker).not.toBe(fake.marker)
      expect(fake.init).not.toHaveBeenCalled()
    }
  })
})
