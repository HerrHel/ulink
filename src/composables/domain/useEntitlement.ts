/**
 * 全局会员权益与分层控制 (useEntitlement)
 *
 * 统一管理用户权益（免费版 vs PRO 会员），以及对付费专属特权的配额校验与功能拦截：
 * 1. PRO 状态读取与缓存响应式更新
 * 2. AI 能力门禁（2026-11-21 起 AI 为 PRO 专属；免费用户为服务端记账的终身试用次数，
 *    前端只镜像 my_ai_access 的剩余次数用于展示与提前拦截，最终以服务端裁决为准）
 * 3. AI 语义搜索权限校验
 */
import { ref, computed } from 'vue'
import { fetchMyEntitlement, fetchMyAiAccess, type MyEntitlement, type MyAiAccess } from './useRedeem.js'

/** AI 访问状态未知的默认值（本地定义：模块加载即用，不依赖 useRedeem 的运行时导出，mock 友好） */
const UNKNOWN_AI_ACCESS: MyAiAccess = { tier: 'unknown', used: 0, limit: 0, remaining: 0 }
import { safeGetItem, safeSetItem, safeRemoveItem } from '../../lib/storageSafe.js'

export const ENTITLEMENT_CACHE_KEY = 'ulink_entitlement_v1'
export const LEGACY_ENTITLEMENT_CACHE_KEY = 'lv_entitlement_v1'

/** 服务端 AI 访问状态镜像（模块级单例：所有 useEntitlement() 调用共享） */
const aiAccess = ref<MyAiAccess>({ ...UNKNOWN_AI_ACCESS })

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
        if (gen === refreshGeneration) {
          serverVerifiedPaid = false
          // AI 访问镜像同样不得沿用上一次的 pro（#36 fail-closed 同口径）
          aiAccess.value = { ...UNKNOWN_AI_ACCESS }
        }
        throw err
      }
      // 已被 clear() 或更新的 refresh() 取代：丢弃旧结果，绝不覆盖状态/写回缓存
      if (gen !== refreshGeneration) return currentEntitlement.value
      currentEntitlement.value = e
      // #36：决策态只在服务端明确返回 isPaid 时放行；缓存 / 展示态赋值影响不了它
      serverVerifiedPaid = e.isPaid === true
      // 顺带刷新 AI 试用状态；失败不影响权益刷新本身
      void refreshAiAccess().catch(() => {})
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
    aiAccess.value = { ...UNKNOWN_AI_ACCESS }
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

  /** 从服务端刷新 AI 访问状态（试用剩余次数）；失败保持 unknown，交由实际调用时服务端裁决 */
  async function refreshAiAccess(): Promise<MyAiAccess> {
    const gen = refreshGeneration
    // 旧版按天计数（lv_ai_enrich_YYYY-MM-DD）已废弃：传空串把历史键全部清掉
    pruneOldAiEnrichKeys('')
    const a = await fetchMyAiAccess()
    if (gen === refreshGeneration) aiAccess.value = a
    return aiAccess.value
  }

  /**
   * AI 能力的前端门禁（只用于展示与提前拦截，服务端 consume_ai_access 才是最终裁决）
   * - PRO（服务端 refresh 确认）：不限次
   * - 免费：终身试用剩余次数（my_ai_access 镜像）；状态未知时放行，让服务端决定
   * - 未登录：不可用（试用次数记在账号上）
   */
  function checkAiEnrichQuota(): { allowed: boolean; remaining: number; total: number; isPro: boolean } {
    // #36：门禁只认服务端 refresh 确认的决策态，不认展示态/缓存的 isPaid
    if (serverVerifiedPaid || aiAccess.value.tier === 'pro') {
      return { allowed: true, remaining: 999999, total: 999999, isPro: true }
    }
    const a = aiAccess.value
    if (a.tier === 'anonymous') return { allowed: false, remaining: 0, total: 0, isPro: false }
    if (a.tier === 'unknown') return { allowed: true, remaining: 0, total: 0, isPro: false }
    return { allowed: a.remaining > 0, remaining: a.remaining, total: a.limit, isPro: false }
  }

  /** 一次 AI 调用成功后同步本地镜像（服务端已扣次，这里只让展示即时更新） */
  function consumeAiEnrichQuota(): boolean {
    if (serverVerifiedPaid || aiAccess.value.tier === 'pro') return true
    const a = aiAccess.value
    if (a.tier !== 'trial') return true
    if (a.remaining <= 0) return false
    aiAccess.value = { ...a, used: a.used + 1, remaining: a.remaining - 1 }
    return true
  }

  /** 服务端明确回报试用已用完（aiGate=ai_trial_exhausted）：本地镜像立即归零 */
  function markAiTrialExhausted(): void {
    const a = aiAccess.value
    aiAccess.value = { tier: 'trial', used: a.limit || a.used, limit: a.limit, remaining: 0 }
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
    aiAccess,
    refreshAiAccess,
    checkAiEnrichQuota,
    consumeAiEnrichQuota,
    markAiTrialExhausted,
  }
}
