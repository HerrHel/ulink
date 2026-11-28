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
import {
  fetchMyEntitlement,
  fetchMyAiAccess,
  setMyTimezone,
  type MyEntitlement,
  type MyAiAccess,
  type SetTimezoneResult,
} from './useRedeem.js'
import { browserTimeZone } from '../../lib/quotaTime.js'

/** AI 访问状态未知的默认值（本地定义：模块加载即用，不依赖 useRedeem 的运行时导出，mock 友好） */
const UNKNOWN_AI_ACCESS: MyAiAccess = { tier: 'unknown', used: 0, limit: 0, remaining: 0 }
import { safeGetItem, safeSetItem, safeRemoveItem } from '../../lib/storageSafe.js'
import { toastWithAction } from '../../lib/toast.js'
import { t } from '../../i18n/index.js'
import { useUIStore } from '../../stores/ui.js'

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
/** 到期响应式刻度：订阅临期/到期时触发 computed 重算，无需轮询 */
const expiryTick = ref(0)
let _expiryTimer: ReturnType<typeof setTimeout> | null = null

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

/** 校验会员截止时间戳是否仍在有效期内（长驻页面跨到期时间点自动失效，不残留 PRO 状态） */
function isNotExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true
  const ts = new Date(expiresAt).getTime()
  return Number.isNaN(ts) || ts > Date.now()
}

function isEntitlementActive(e: MyEntitlement): boolean {
  return Boolean(e.isPaid) && e.status === 'active' && isNotExpired(e.expiresAt)
}

function scheduleExpiryTimer(expiresAt: string | null | undefined): void {
  if (_expiryTimer) {
    clearTimeout(_expiryTimer)
    _expiryTimer = null
  }
  if (!expiresAt) return
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (!Number.isFinite(ms)) return
  if (ms <= 0) {
    expiryTick.value++
    return
  }
  // 仅在 32 位 setTimeout 安全范围内（~24.8 天）挂载一次性到期定时器
  if (ms <= 2_147_483_647) {
    _expiryTimer = setTimeout(() => {
      _expiryTimer = null
      serverVerifiedPaid = false
      expiryTick.value++
    }, ms + 5)
    if (typeof _expiryTimer === 'object' && 'unref' in _expiryTimer) {
      (_expiryTimer as { unref?: () => void }).unref?.()
    }
  }
}

/** 语义搜索等门禁：只认服务端已确认的付费状态且未过期，绝不认展示态/缓存 */
export function isProUser(): boolean {
  return serverVerifiedPaid && isNotExpired(currentEntitlement.value.expiresAt)
}

export function useEntitlement() {
  const isPaid = computed(() => {
    void expiryTick.value
    return isEntitlementActive(currentEntitlement.value)
  })
  const isPro = computed(() => {
    void expiryTick.value
    return isEntitlementActive(currentEntitlement.value)
  })
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
      serverVerifiedPaid = e.isPaid === true && isNotExpired(e.expiresAt)
      scheduleExpiryTimer(e.isPaid ? e.expiresAt : null)
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
    if (_expiryTimer) {
      clearTimeout(_expiryTimer)
      _expiryTimer = null
    }
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
    if (gen === refreshGeneration) {
      aiAccess.value = a
      void reportInitialTimezone(a, gen)
    }
    return aiAccess.value
  }

  /**
   * AI 能力的前端门禁（只用于展示与提前拦截，服务端 consume_ai_access 才是最终裁决）
   * - PRO（服务端 refresh 确认）：不限次
   * - 免费：终身试用剩余次数（my_ai_access 镜像）；状态未知时放行，让服务端决定
   * - 未登录：不可用（试用次数记在账号上）
   */
  function checkAiEnrichQuota(): { allowed: boolean; remaining: number; total: number; isPro: boolean } {
    // #36：门禁只认服务端 refresh 确认的决策态，不认展示态/缓存的 isPaid；长驻过期一并回收
    if ((serverVerifiedPaid && isNotExpired(currentEntitlement.value.expiresAt)) || aiAccess.value.tier === 'pro') {
      return { allowed: true, remaining: 999999, total: 999999, isPro: true }
    }
    const a = aiAccess.value
    if (a.tier === 'anonymous') return { allowed: false, remaining: 0, total: 0, isPro: false }
    if (a.tier === 'unknown') return { allowed: true, remaining: 0, total: 0, isPro: false }
    return { allowed: a.remaining > 0, remaining: a.remaining, total: a.limit, isPro: false }
  }

  /** 一次 AI 调用成功后同步本地镜像（服务端已扣次，这里只让展示即时更新） */
  function consumeAiEnrichQuota(): boolean {
    if ((serverVerifiedPaid && isNotExpired(currentEntitlement.value.expiresAt)) || aiAccess.value.tier === 'pro') return true
    const a = aiAccess.value
    if (a.tier !== 'trial') return true
    if (a.remaining <= 0) return false
    aiAccess.value = { ...a, used: a.used + 1, remaining: a.remaining - 1 }
    return true
  }

  /** 服务端明确回报试用已用完（aiGate=ai_trial_exhausted）：本地镜像立即归零并撤销决策态 PRO */
  function markAiTrialExhausted(): void {
    serverVerifiedPaid = false
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
    aiQuotaView,
    refreshAiAccess,
    refreshAiAccessSoon,
    checkAiEnrichQuota,
    consumeAiEnrichQuota,
    markAiTrialExhausted,
  }
}

/** 本代次（账号）是否已尝试过首次上报时区：每个登录会话最多一次 */
let _tzReportedGen = -1

/**
 * 首次自动上报额度时区：账号还没登记时，把本设备时区报上去（服务端 initial 模式：
 * 已登记则不改，所以多设备 / 并发上报不会互相改写；当天已有用量会延到下一个 0 点生效）。
 * 成功后用返回的时区状态更新镜像，界面立即显示正确的恢复时刻。
 */
async function reportInitialTimezone(a: MyAiAccess, gen: number): Promise<void> {
  if (!a.tz || a.tz.isSet || _tzReportedGen === gen) return
  const zone = browserTimeZone()
  if (!zone) return
  _tzReportedGen = gen
  const r = await setMyTimezone(zone, true)
  if (gen === refreshGeneration && r.tz) aiAccess.value = { ...aiAccess.value, tz: r.tz }
}

/**
 * 手动修改额度时区（设置面板）：成功 / 冷却都会带回最新时区状态，写回镜像。
 */
export async function changeQuotaTimezone(zone: string): Promise<SetTimezoneResult> {
  const gen = refreshGeneration
  const r = await setMyTimezone(zone, false)
  if (gen === refreshGeneration && r.tz) aiAccess.value = { ...aiAccess.value, tz: r.tz }
  return r
}

let _exhaustedNotifiedAt = 0
/**
 * 服务端回报「AI 试用已用完」的统一出口：归零本地镜像，并给出带「升级 PRO」按钮的提示。
 * 同一分钟内多处同时命中（对话 + 自动预填）只提示一次，避免连弹。
 */
export function notifyAiTrialExhausted(): void {
  useEntitlement().markAiTrialExhausted()
  const now = Date.now()
  if (now - _exhaustedNotifiedAt < 60_000) return
  _exhaustedNotifiedAt = now
  toastWithAction(t('ai.trialExhaustedToast'), t('ai.trialExhaustedAction'), () => useUIStore().openPurchase())
}

/** 试用剩余 ≤ 该值时进入提醒态（标签变色 + 升级入口） */
export const AI_TRIAL_LOW_THRESHOLD = 5

export type AiQuotaKind = 'pro' | 'trial' | 'low' | 'exhausted' | 'anonymous' | 'unknown'

/**
 * PRO 提醒阈值（输入框标签只在接近上限时出现）：
 *  - 每月次数（主限额）剩余 ≤ 上限的 PRO_NEAR_RATIO；
 *  - 每日防滥用上限剩余 ≤ 上限的 PRO_NEAR_RATIO（正常用户几乎碰不到）；
 *  - 本月 token 兜底用量 ≥ PRO_MONTH_WARN_PCT%。
 */
export const PRO_NEAR_RATIO = 0.1
export const PRO_MONTH_WARN_PCT = 80

export interface ProQuotaView {
  /** 每月请求次数（主限额）；limit 0 = 旧套餐未配置，此时以每日次数为主 */
  monthUsed: number
  monthLimit: number
  monthRemaining: number
  monthNear: boolean
  /** 每日防滥用上限；limit 0 = 未配置 */
  dailyUsed: number
  dailyLimit: number
  dailyRemaining: number
  dailyNear: boolean
  /** 本月 token 兜底用量百分比；未配置上限为 -1 */
  tokenPct: number
  tokenNear: boolean
  /** 任一接近上限：决定输入框标签是否出现 */
  near: boolean
}

function proQuotaView(p: NonNullable<MyAiAccess['pro']>): ProQuotaView {
  const nearBy = (remaining: number, limit: number) => limit > 0 && remaining <= Math.max(1, Math.floor(limit * PRO_NEAR_RATIO))
  const monthRemaining = p.requestsMonthLimit > 0 ? Math.max(0, p.requestsMonthLimit - p.requestsMonthUsed) : 0
  const dailyRemaining = p.dailyLimit > 0 ? Math.max(0, p.dailyLimit - p.dailyUsed) : 0
  const tokenPct = p.monthlyLimitTokens > 0
    ? Math.min(100, Math.round((p.monthlyUsedTokens / p.monthlyLimitTokens) * 100))
    : -1
  const monthNear = nearBy(monthRemaining, p.requestsMonthLimit)
  const dailyNear = nearBy(dailyRemaining, p.dailyLimit)
  const tokenNear = tokenPct >= PRO_MONTH_WARN_PCT
  return {
    monthUsed: p.requestsMonthUsed,
    monthLimit: p.requestsMonthLimit,
    monthRemaining,
    monthNear,
    dailyUsed: p.dailyUsed,
    dailyLimit: p.dailyLimit,
    dailyRemaining,
    dailyNear,
    tokenPct,
    tokenNear,
    near: monthNear || dailyNear || tokenNear,
  }
}

export interface AiQuotaView {
  kind: AiQuotaKind
  remaining: number
  total: number
  /** 仅 PRO 且服务端返回了用量时存在 */
  pro?: ProQuotaView
}

/**
 * 面向展示的 AI 额度视图（AI 助手输入框标签、设置面板共用，口径唯一）：
 * - pro：每月次数（主限额）/ 每日防滥用上限 / 月度 token 见 pro 字段（旧服务端不返回则无）
 * - trial / low / exhausted：免费终身试用剩余 remaining / total
 * - anonymous：未登录，登录后才有试用次数
 * - unknown：尚未拉到服务端状态（不展示，避免闪出错误数字）
 */
const aiQuotaView = computed<AiQuotaView>(() => {
  void expiryTick.value
  const a = aiAccess.value
  if ((serverVerifiedPaid && isNotExpired(currentEntitlement.value.expiresAt)) || a.tier === 'pro') {
    if (a.tier !== 'pro' || !a.pro) return { kind: 'pro', remaining: 0, total: 0 }
    const pv = proQuotaView(a.pro)
    // remaining / total：主限额（每月次数；旧套餐无月度键时退回每日次数）
    return pv.monthLimit > 0
      ? { kind: 'pro', remaining: pv.monthRemaining, total: pv.monthLimit, pro: pv }
      : { kind: 'pro', remaining: pv.dailyRemaining, total: pv.dailyLimit, pro: pv }
  }
  if (a.tier === 'anonymous') return { kind: 'anonymous', remaining: 0, total: 0 }
  if (a.tier !== 'trial') return { kind: 'unknown', remaining: 0, total: 0 }
  const kind: AiQuotaKind = a.remaining <= 0 ? 'exhausted' : a.remaining <= AI_TRIAL_LOW_THRESHOLD ? 'low' : 'trial'
  return { kind, remaining: a.remaining, total: a.limit }
})

let _refreshSoonTimer: ReturnType<typeof setTimeout> | null = null
/**
 * 一次 AI 调用结束后（成功、失败退还都可能改变次数）合并刷新服务端剩余次数。
 * 对话 / 整理未分类等入口不一定走 consumeAiEnrichQuota 的本地扣减，以服务端为准最稳；
 * 800ms 内多次调用只发一次请求。
 */
export function refreshAiAccessSoon(): void {
  if (_refreshSoonTimer) clearTimeout(_refreshSoonTimer)
  _refreshSoonTimer = setTimeout(() => {
    _refreshSoonTimer = null
    const gen = refreshGeneration
    void fetchMyAiAccess()
      .then((a) => {
        // unknown = 拉取失败：保留现有镜像，不把已知次数刷成「未知」
        if (gen === refreshGeneration && a.tier !== 'unknown') aiAccess.value = a
      })
      .catch(() => {})
  }, 800)
}
