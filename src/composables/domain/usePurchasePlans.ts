/**
 * usePurchasePlans —— 套餐方案列表查询与极速缓存
 *
 * 优化核心：
 *   1. 优先直连数据库 RPC `dbRpc('list_purchase_plans')`（毫秒级直连，彻底避开云函数 2~4 秒冷启动）；
 *   2. 云函数 `pay?action=plans` 降级兜底（双保险）；
 *   3. 模块级内存缓存（SWR 策略，15 分钟 TTL）：有缓存时 0ms 瞬间渲染，后台静默对齐；
 *   4. 支持 prefetch 预拉取，在用户打开账户菜单或进入应用时即可后台准备好数据。
 */

import { dbRpc } from '../../lib/dbApi.js'
import { edgeFnUrl, isCloudBaseBackend } from '../../lib/cloudbase.js'
import { getApiToken } from '../../lib/authDriver.js'

export interface PlanRow {
  planId: string
  name: string
  priceCents: number
  currency: string
  periodDays: number
  features?: Record<string, number>
}

let cachedPlans: PlanRow[] = []
let lastFetchedAt = 0
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 分钟有效
let inFlightPromise: Promise<PlanRow[]> | null = null

export async function fetchPurchasePlans(force = false): Promise<PlanRow[]> {
  const now = Date.now()
  // 有效缓存直接返回
  if (!force && cachedPlans.length > 0 && now - lastFetchedAt < CACHE_TTL_MS) {
    return cachedPlans
  }

  // 防止并发重叠请求
  if (inFlightPromise) {
    return inFlightPromise
  }

  inFlightPromise = (async () => {
    try {
      // 1. 首选直连数据库 RPC（直连 PostgREST/PG，仅几十毫秒，无云函数冷启动）
      const { data, error } = await dbRpc('list_purchase_plans')
      if (!error && Array.isArray(data) && data.length > 0) {
        cachedPlans = data as PlanRow[]
        lastFetchedAt = Date.now()
        return cachedPlans
      }
    } catch {
      // 直连异常进入 fallback
    }

    // 2. 降级走云函数 pay
    try {
      if (isCloudBaseBackend()) {
        const endpoint = edgeFnUrl('pay')
        const token = await getApiToken()
        if (endpoint && token) {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action: 'plans' }),
          })
          const body = (await res.json().catch(() => ({}))) as { ok?: boolean; plans?: PlanRow[] }
          if (body.ok && Array.isArray(body.plans) && body.plans.length > 0) {
            cachedPlans = body.plans
            lastFetchedAt = Date.now()
            return cachedPlans
          }
        }
      }
    } catch {
      // 降级失败
    }

    return cachedPlans
  })().finally(() => {
    inFlightPromise = null
  })

  return inFlightPromise
}

/** 预取套餐（在后台静默运行，不抛错） */
export function prefetchPurchasePlans(): void {
  void fetchPurchasePlans().catch(() => {})
}

export function getCachedPlans(): PlanRow[] {
  return cachedPlans
}

/** 仅测试重置用 */
export function _resetPurchasePlansCache(): void {
  cachedPlans = []
  lastFetchedAt = 0
  inFlightPromise = null
}
