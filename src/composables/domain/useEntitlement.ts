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

function getInitialEntitlement(): MyEntitlement {
  try {
    const raw = safeGetItem(ENTITLEMENT_CACHE_KEY) || safeGetItem(LEGACY_ENTITLEMENT_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return {
        planId: parsed.planId || 'free',
        planName: parsed.planName || 'free',
        status: parsed.status || 'active',
        expiresAt: parsed.expiresAt || null,
        features: parsed.features || {},
        isPaid: Boolean(parsed.isPaid),
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

const currentEntitlement = ref<MyEntitlement>(getInitialEntitlement())
const loadingEntitlement = ref(false)

export function isProUser(): boolean {
  return currentEntitlement.value.isPaid
}

export function useEntitlement() {
  const isPaid = computed(() => currentEntitlement.value.isPaid)
  const isPro = computed(() => currentEntitlement.value.isPaid)
  const planId = computed(() => currentEntitlement.value.planId)
  const planName = computed(() => currentEntitlement.value.planName)
  const expiresAt = computed(() => currentEntitlement.value.expiresAt)
  const features = computed(() => currentEntitlement.value.features)

  async function refresh(): Promise<MyEntitlement> {
    loadingEntitlement.value = true
    try {
      const e = await fetchMyEntitlement()
      currentEntitlement.value = e
      try {
        safeSetItem(ENTITLEMENT_CACHE_KEY, JSON.stringify(e))
        safeSetItem(LEGACY_ENTITLEMENT_CACHE_KEY, JSON.stringify(e))
      } catch { /* ignore */ }
      return e
    } finally {
      loadingEntitlement.value = false
    }
  }

  function clear(): void {
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
    if (currentEntitlement.value.isPaid) {
      return { allowed: true, remaining: 999999, total: 999999, isPro: true }
    }
    const key = getTodayKey()
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
    if (currentEntitlement.value.isPaid) return true
    const quota = checkAiEnrichQuota()
    if (!quota.allowed) return false
    const key = getTodayKey()
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
