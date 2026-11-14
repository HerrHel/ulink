/**
 * 全局会员权益与分层控制 (useEntitlement)
 *
 * 统一管理用户权益（免费版 vs PRO 会员），以及对付费专属特权的配额校验与功能拦截：
 * 1. PRO 状态读取与缓存响应式更新
 * 2. AI 智能提取与补齐（免费版每日 3 次体验额度，PRO 无限）
 * 3. AI 语义搜索权限校验
 */
import { ref, computed } from 'vue'
import { fetchMyEntitlement, type MyEntitlement } from './useRedeem.js'
import { safeGetItem, safeSetItem, safeRemoveItem } from '../../lib/storageSafe.js'

export const ENTITLEMENT_CACHE_KEY = 'ulink_entitlement_v1'
export const LEGACY_ENTITLEMENT_CACHE_KEY = 'lv_entitlement_v1'
const FREE_DAILY_AI_ENRICH_LIMIT = 3

function getTodayKey(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `lv_ai_enrich_${y}-${m}-${day}`
}

export function pruneOldAiEnrichKeys(todayKey: string = getTodayKey()): void {
  try {
    if (typeof localStorage === 'undefined') return
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('lv_ai_enrich_') && k !== todayKey) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) {
      safeRemoveItem(k)
    }
  } catch {
    /* ignore in restricted environments */
  }
}

function getInitialEntitlement(): MyEntitlement {
  try {
    const raw = safeGetItem(ENTITLEMENT_CACHE_KEY) || safeGetItem(LEGACY_ENTITLEMENT_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const planId = parsed.planId || 'free'
      const status = parsed.status || 'active'
      const isExpired = status === 'expired' || (parsed.expiresAt ? new Date(parsed.expiresAt).getTime() < Date.now() : false)
      const isPaid = Boolean(parsed.isPaid) && !isExpired && status === 'active'
      return {
        planId: isPaid ? planId : 'free',
        planName: isPaid ? (parsed.planName || planId) : (isExpired ? '免费版 (已过期)' : '免费版'),
        status: isExpired ? 'expired' : status,
        expiresAt: parsed.expiresAt || null,
        features: isPaid ? (parsed.features || {}) : {},
        isPaid,
      }
    }
  } catch { /* ignore */ }
  return {
    planId: 'free',
    planName: 'free',
    status: 'active',
    expiresAt: null,
    features: {},
    isPaid: false,
  }
}

// 展示态：可来自 localStorage 缓存，仅用于 UI 显示昵称/套餐/状态（离线体验保留）。
const currentEntitlement = ref<MyEntitlement>(getInitialEntitlement())
const loadingEntitlement = ref(false)

/**
 * #36 决策态：配额 / 权限门禁的唯一依据，与展示态严格分离。
 * 旧实现把 getInitialEntitlement()（完全信任 localStorage 的 isPaid/expiresAt）直接
 * 喂给 checkAiEnrichQuota / isProUser，手改缓存即可让前端 PRO 门禁放行。
 * 现在只有 refresh() 成功且服务端明确返回 isPaid 才置 true；缓存、entitlement.value
 * 直接赋值都影响不了它；refresh 失败 / 未刷新 / clear 一律 false（免费档 fail-closed）。
 */
let serverVerifiedPaid = false

/**
 * refresh 代次：clear()（退出登录 / 切换账号）会让所有在途 refresh() 失效。
 * 否则退出登录瞬间仍在飞行的请求会在 clear 之后把 FREE_PLAN（甚至旧账号的
 * 付费权益）写回缓存并覆盖内存态，造成「已登出却残留会员缓存」的竞态。
 */
let refreshGeneration = 0

/** 语义搜索等门禁：只认服务端已确认的付费状态，绝不认展示态/缓存 */
export function isProUser(): boolean {
  return serverVerifiedPaid
}

export function useEntitlement() {
  const isPaid = computed(() => currentEntitlement.value.isPaid)
  const isPro = computed(() => currentEntitlement.value.isPaid)
  const planId = computed(() => currentEntitlement.value.planId)
  const planName = computed(() => currentEntitlement.value.planName)
  const expiresAt = computed(() => currentEntitlement.value.expiresAt)
  const features = computed(() => currentEntitlement.value.features)

  async function refresh(): Promise<MyEntitlement> {
    const gen = ++refreshGeneration
    loadingEntitlement.value = true
    try {
      let e: MyEntitlement
      try {
        e = await fetchMyEntitlement()
      } catch (err) {
        // #36 fail-closed：服务端不可达/报错时门禁立即回落免费档，绝不沿用缓存或
        // 上一次成功结果放行 PRO 额度。展示态保留（离线体验不受影响），异常按原语义
        // 继续抛出交给调用方处理。
        if (gen === refreshGeneration) serverVerifiedPaid = false
        throw err
      }
      // 已被 clear() 或更新的 refresh() 取代：丢弃旧结果，绝不覆盖状态/写回缓存
      if (gen !== refreshGeneration) return currentEntitlement.value
      currentEntitlement.value = e
      // #36：决策态只在服务端明确返回 isPaid 时放行；缓存 / 展示态赋值影响不了它
      serverVerifiedPaid = e.isPaid === true
      try {
        safeSetItem(ENTITLEMENT_CACHE_KEY, JSON.stringify(e))
        safeSetItem(LEGACY_ENTITLEMENT_CACHE_KEY, JSON.stringify(e))
      } catch { /* ignore */ }
      return e
    } finally {
      // 旧代次不得提前关掉新请求的 loading 标记
      if (gen === refreshGeneration) loadingEntitlement.value = false
    }
  }

  function clear(): void {
    ++refreshGeneration
    loadingEntitlement.value = false
    serverVerifiedPaid = false // 门禁一并失效（退出登录/切换账号不得残留 PRO 决策态）
    currentEntitlement.value = {
      planId: 'free',
      planName: 'free',
      status: 'active',
      expiresAt: null,
      features: {},
      isPaid: false,
    }
    safeRemoveItem(ENTITLEMENT_CACHE_KEY)
    safeRemoveItem(LEGACY_ENTITLEMENT_CACHE_KEY)
  }

  /**
   * 检查 AI 智能提取与补齐的当前额度
   * - PRO 会员：无限次
   * - 免费版用户：每日免费体验 3 次
   */
  function checkAiEnrichQuota(): { allowed: boolean; remaining: number; total: number; isPro: boolean } {
    // #36：门禁只认服务端 refresh 确认的决策态，不认展示态/缓存的 isPaid
    if (serverVerifiedPaid) {
      return { allowed: true, remaining: 999999, total: 999999, isPro: true }
    }
    const key = getTodayKey()
    pruneOldAiEnrichKeys(key)
    const used = parseInt(safeGetItem(key) || '0', 10)
    const remaining = Math.max(0, FREE_DAILY_AI_ENRICH_LIMIT - used)
    return {
      allowed: remaining > 0,
      remaining,
      total: FREE_DAILY_AI_ENRICH_LIMIT,
      isPro: false,
    }
  }

  /**
   * 消耗 1 次 AI 智能提取额度
   */
  function consumeAiEnrichQuota(): boolean {
    // #36：同上，PRO 免消耗额度只认服务端确认的决策态
    if (serverVerifiedPaid) return true
    const quota = checkAiEnrichQuota()
    if (!quota.allowed) return false
    const key = getTodayKey()
    pruneOldAiEnrichKeys(key)
    const used = parseInt(safeGetItem(key) || '0', 10)
    safeSetItem(key, String(used + 1))
    return true
  }

  return {
    entitlement: currentEntitlement,
    isPaid,
    isPro,
    planId,
    planName,
    expiresAt,
    features,
    loading: loadingEntitlement,
    refresh,
    clear,
    checkAiEnrichQuota,
    consumeAiEnrichQuota,
  }
}
