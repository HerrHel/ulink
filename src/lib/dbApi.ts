/**
 * dbApi — 双后端统一数据访问入口（超薄）
 *
 * CloudBase 的 RdbBuilder 刻意做成 supabase-js 同形链式（select/eq/order/single/
 * upsert 等，见 cloudbase.ts 的类型面），所以这里只换「入口」：
 *   supabase.from(t) → dbFrom(t)、supabase.rpc(f, args) → dbRpc(f, args)
 * 调用侧链式写法零改动，Supabase 分支保持原生行为（测试 vi.mock('lib/supabase.js') 不受影响）。
 *
 * 用在 useE2E / useVault / useSyncHistory / syncShare 等「单腿直连」的收编处；
 * 大块双分支（errorReporter / useDeadLinkChecker / AI 三件套）保持既有模式不动。
 */
import { supabase } from './supabase.js'
import { getCbDb, isCloudBaseBackend } from './cloudbase.js'

type FromBuilder = ReturnType<typeof supabase.from>
type RpcBuilder = ReturnType<typeof supabase.rpc>

/** 统一 from()：按运行时后端开关分流 */
export function dbFrom(table: string): FromBuilder {
  if (isCloudBaseBackend()) return getCbDb().from(table) as unknown as FromBuilder
  return supabase.from(table)
}

/** 统一 rpc()：同上（await 后得 { data, error }） */
export function dbRpc(fn: string, args?: Record<string, unknown>): RpcBuilder {
  if (isCloudBaseBackend()) return getCbDb().rpc(fn, args) as unknown as RpcBuilder
  return supabase.rpc(fn, args as never)
}
