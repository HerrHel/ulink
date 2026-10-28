<template>
  <div
    v-if="visible"
    class="modal-mask pur-mask"
    :class="{ open: visible }"
    role="dialog"
    aria-modal="true"
    :aria-label="t('purchase.title')"
    @mousedown="onMaskMouseDown"
    @click="onMaskClick"
  >
    <div class="modal pur-modal" @mousedown.stop @click.stop>
      <div class="pur-head">
        <div>
          <h3 class="pur-title">{{ t('purchase.title') }}</h3>
          <p class="pur-sub">{{ t('purchase.subtitle') }}</p>
        </div>
        <button class="pur-close" :aria-label="t('common.close')" @click="close">&times;</button>
      </div>

      <!-- ① 档位卡（免费档不进卡组，进对比表） -->
      <div v-if="stage === 'select'" class="pur-body">
        <div v-if="loadingPlans" class="pur-hint">{{ t('common.loading') }}</div>

        <template v-else>
          <div v-if="paidPlans.length === 0" class="pur-empty">
            {{ t('purchase.noPlans') }}
          </div>

          <template v-else>
            <div class="pur-plans">
              <button
                v-for="p in paidPlans"
                :key="p.planId"
                type="button"
                class="pur-plan"
                :class="{
                  active: selectedPlan === p.planId,
                  recommended: p.planId === recommendedId,
                  current: currentPlanId === p.planId,
                }"
                :data-testid="`plan-${p.planId}`"
                @click="selectedPlan = p.planId"
              >
                <span v-if="p.planId === recommendedId" class="pur-badge">{{ t('purchase.recommended') }}</span>
                <span v-else-if="currentPlanId === p.planId" class="pur-badge pur-badge-current">{{ t('purchase.currentPlanBadge') }}</span>
                <span class="pur-plan-name">{{ p.name }}</span>
                <span class="pur-plan-price">
                  <b>{{ yen(p.priceCents) }}</b>
                  <em>/ {{ days(p.periodDays) }}</em>
                </span>
                <span class="pur-plan-unit">{{ perMonth(p) }}</span>
              </button>
            </div>

            <!-- ② 权益对比表（Supabase 式：分组行 × 档位列，含免费列） -->
            <div class="pur-compare" data-testid="purchase-compare">
              <div class="pur-compare-head">
                <span>{{ t('purchase.compareTitle') }}</span>
                <span v-for="col in compareCols" :key="col.id" class="pur-compare-col" :class="{ current: col.id === currentPlanId }">
                  {{ col.name }}
                </span>
              </div>
              <template v-for="(group, gi) in compareGroups" :key="group.key">
                <div class="pur-compare-group">{{ t(`purchase.featureGroups.${group.key}`) }}</div>
                <div v-for="f in group.rows" :key="f.key" class="pur-compare-row">
                  <span class="pur-compare-label">{{ t(`purchase.features.${f.key}`) }}</span>
                  <span v-for="col in compareCols" :key="col.id" class="pur-compare-val" :class="{ current: col.id === currentPlanId, off: !col.features[f.key] }">
                    {{ fmtFeature(f.key, col.features[f.key]) }}
                  </span>
                </div>
                <div v-if="gi < compareGroups.length - 1" class="pur-compare-gap"></div>
              </template>
            </div>

            <!-- ③ 支付方式 -->
            <div class="pur-channels">
              <button
                v-for="c in channels"
                :key="c.id"
                type="button"
                class="pur-channel"
                :class="{ active: selectedChannel === c.id }"
                :data-testid="`channel-${c.id}`"
                @click="selectedChannel = c.id"
              >
                {{ t(c.labelKey) }}
              </button>
            </div>

            <p v-if="error === 'channel_not_configured'" class="pur-note pur-note-warn">
              {{ t('purchase.notOpen') }}
            </p>
            <p v-else-if="error" class="pur-note pur-note-error">{{ t(`purchase.error.${error}`) }}</p>

            <button
              type="button"
              class="pur-primary"
              :disabled="!selectedPlan || !selectedChannel || creating"
              data-testid="purchase-submit"
              @click="submit"
            >
              {{ ctaLabel }}
            </button>
          </template>
        </template>
      </div>

      <!-- ④ 扫码支付 -->
      <div v-else-if="stage === 'paying'" class="pur-body pur-pay">
        <div class="pur-amount">
          <b>{{ order ? yen(order.amountCents) : '' }}</b>
          <span>{{ planName }}</span>
        </div>

        <div class="pur-qr">
          <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('purchase.qrAlt')" />
          <div v-else class="pur-qr-loading">{{ t('common.loading') }}</div>
        </div>

        <p class="pur-scan">{{ t(`purchase.scan.${selectedChannel}`) }}</p>

        <p class="pur-countdown">
          {{ expired ? t('purchase.expired') : t('purchase.countdown', { time: countdown }) }}
        </p>

        <div class="pur-actions">
          <button type="button" class="pur-ghost" @click="restart">{{ t('purchase.recreate') }}</button>
          <button type="button" class="pur-ghost" @click="close">{{ t('common.close') }}</button>
        </div>
      </div>

      <!-- ⑤ 支付成功 -->
      <div v-else class="pur-body pur-done">
        <div class="pur-done-icon" aria-hidden="true">✓</div>
        <h4>{{ t('purchase.successTitle') }}</h4>
        <p>{{ t('purchase.successDesc') }}</p>
        <button type="button" class="pur-primary" data-testid="purchase-done" @click="close">
          {{ t('common.close') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 购买弹窗：档位卡 + Supabase 式权益对比表 + 渠道 + 扫码 + 轮询。
 *
 * 设计约束：
 *   · 套餐与 features 全部来自服务端（plans 表），前端零硬编码价格/额度；
 *     对比表的行集合 = 各档 features 键的并集，按 key 前缀分组展示。
 *   · 免费列来自同一 RPC（priceCents=0），下单仍限付费档（服务端再校验）。
 *   · 二维码本地渲染（qrcode → dataURL），不外发第三方。
 *   · 关窗即停轮询。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { usePayment, type PaymentChannel } from '../../composables/domain/usePayment.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
import { t } from '../../i18n/index.js'
import { edgeFnUrl, isCloudBaseBackend } from '../../lib/cloudbase.js'
import { getApiToken } from '../../lib/authDriver.js'

interface PlanRow {
  planId: string
  name: string
  priceCents: number
  currency: string
  periodDays: number
  features?: Record<string, number>
}

const props = defineProps<{ visible: boolean; currentPlanId?: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'paid'): void }>()

const { onMaskMouseDown, onMaskClick } = useMaskClose(() => close())

const pay = usePayment()
const stage = ref<'select' | 'paying' | 'done'>('select')
const plans = ref<PlanRow[]>([])
const loadingPlans = ref(false)
const selectedPlan = ref('')
const selectedChannel = ref<PaymentChannel>('wechat')
const qrDataUrl = ref('')
const countdown = ref('')
let countdownTimer: ReturnType<typeof setInterval> | null = null

const channels: { id: PaymentChannel; labelKey: string }[] = [
  { id: 'wechat', labelKey: 'purchase.channel.wechat' },
  { id: 'alipay', labelKey: 'purchase.channel.alipay' },
]

const order = computed(() => pay.order.value)
const error = computed(() => pay.error.value)
const creating = computed(() => pay.creating.value)
const expired = computed(() => pay.expired.value)
const planName = computed(() => plans.value.find((p) => p.planId === selectedPlan.value)?.name || '')

/** 付费档（卡组与下单可选） */
const paidPlans = computed(() => plans.value.filter((p) => p.priceCents > 0))
/** 推荐档：周期最长（年付）挂「最划算」徽章 */
const recommendedId = computed(() => {
  const sorted = [...paidPlans.value].sort((a, b) => b.periodDays - a.periodDays)
  return sorted[0]?.planId || ''
})

/** 对比表列：免费 + 付费（按价格升序） */
const compareCols = computed(() =>
  plans.value.map((p) => ({ id: p.planId, name: p.name, features: p.features || {} })),
)

/** feature 分组：按 key 首段归类，行集合为各档 features 键并集 */
const compareGroups = computed(() => {
  const keys = new Set<string>()
  for (const col of compareCols.value) for (const k of Object.keys(col.features)) keys.add(k)
  const groupOrder = ['sync', 'linkcheck', 'ai', 'video']
  const groups = new Map<string, string[]>()
  for (const k of keys) {
    const g = groupOrder.includes(k.split('.')[0]) ? k.split('.')[0] : 'sync'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(k)
  }
  return groupOrder
    .filter((g) => groups.has(g))
    .map((g) => ({ key: g, rows: groups.get(g)!.map((key) => ({ key })) }))
})

const ctaLabel = computed(() => (creating.value ? t('purchase.creating') : t('purchase.payNow')))

/** 分 → ¥（仅展示） */
function yen(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}
function days(d: number): string {
  if (!d) return ''
  return d % 365 === 0 ? `${d / 365} 年` : d % 30 === 0 ? `${d / 30} 个月` : `${d} 天`
}
/** 折算月单价（年付/季付自动显得划算） */
function perMonth(p: PlanRow): string {
  if (!p.periodDays) return ''
  const perMonthCents = Math.round((p.priceCents / p.periodDays) * 30)
  return t('purchase.perMonth', { price: yen(perMonthCents) })
}

/** feature 值格式化：bytes→GB、大数→万、布尔→✓ */
function fmtFeature(key: string, v: number | undefined): string {
  if (v === undefined || v === null) return t('purchase.notIncluded')
  if (key.endsWith('.bytes')) {
    const gb = v / 1073741824
    return `${gb >= 10 ? Math.round(gb) : Math.round(gb * 10) / 10} GB`
  }
  if (key.endsWith('.days')) return t('purchase.unitDays', { n: v })
  if (v >= 10000) return t('purchase.unitWan', { n: Math.round(v / 1000) / 10 })
  if (v <= 1 && !key.includes('.daily') && !key.includes('.max')) return t('purchase.included')
  return String(v)
}

async function loadPlans() {
  if (!isCloudBaseBackend()) return
  const endpoint = edgeFnUrl('pay')
  if (!endpoint) return
  const token = await getApiToken()
  if (!token) return

  loadingPlans.value = true
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'plans' }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; plans?: PlanRow[] }
    if (body.ok && Array.isArray(body.plans)) {
      plans.value = body.plans
      // 默认选月付（低门槛）；当前方案在列则预选它（续费场景）
      if (!selectedPlan.value) {
        const current = body.plans.find((p) => p.planId === props.currentPlanId && p.priceCents > 0)
        const monthly = body.plans.find((p) => p.periodDays === 30 && p.priceCents > 0)
        selectedPlan.value = (current || monthly || body.plans.find((p) => p.priceCents > 0))?.planId || ''
      }
    }
  } finally {
    loadingPlans.value = false
  }
}

async function submit() {
  const o = await pay.create(selectedPlan.value, selectedChannel.value)
  if (!o?.qrCode) return
  stage.value = 'paying'
  qrDataUrl.value = await QRCode.toDataURL(o.qrCode, { width: 480, margin: 1 })
  startCountdown(o.expiresAt || '')
  pay.startPolling(() => {
    stage.value = 'done'
    stopCountdown()
    emit('paid')
  })
}

function startCountdown(expiresAt: string) {
  stopCountdown()
  // 后端序列化的时间字符串在个别环境可能解析出 NaN：兜底 30 分钟，绝不显示 NaN:NaN
  const parsed = expiresAt ? new Date(expiresAt).getTime() : NaN
  const deadline = Number.isFinite(parsed) ? parsed : Date.now() + 30 * 60000
  const tick = () => {
    const left = deadline - Date.now()
    if (left <= 0) {
      countdown.value = '00:00'
      stopCountdown()
      return
    }
    const m = Math.floor(left / 60000)
    const s = Math.floor((left % 60000) / 1000)
    countdown.value = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  tick()
  countdownTimer = setInterval(tick, 1000)
}
function stopCountdown() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function restart() {
  pay.reset()
  qrDataUrl.value = ''
  stage.value = 'select'
  stopCountdown()
}

function close() {
  pay.stopPolling()
  stopCountdown()
  emit('close')
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      stage.value = 'select'
      qrDataUrl.value = ''
      pay.reset()
      void loadPlans()
    } else {
      pay.stopPolling()
      stopCountdown()
    }
  },
)

onBeforeUnmount(() => {
  pay.stopPolling()
  stopCountdown()
})
</script>

<style scoped>
.pur-mask {
  display: flex;
  align-items: center;
  justify-content: center;
}
.pur-modal {
  width: min(520px, calc(100vw - 32px));
  max-height: min(88vh, 780px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pur-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 10px;
}
.pur-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
}
.pur-sub {
  margin: 4px 0 0;
  font-size: 0.78rem;
  color: var(--text-tertiary, #888);
}
.pur-close {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: none;
  color: inherit;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}
.pur-body {
  padding: 0 20px 20px;
  overflow-y: auto;
}
.pur-hint,
.pur-empty {
  padding: 24px 0;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-tertiary, #888);
}

/* ── 档位卡：横排三张，active 渐变描边 + 发光 ── */
.pur-plans {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.pur-plan {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 104px;
  padding: 14px 12px 12px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 14px;
  background: var(--surface, #fff);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
}
.pur-plan:hover {
  transform: translateY(-1px);
}
.pur-plan.active {
  border-color: transparent;
  background:
    linear-gradient(var(--surface, #fff), var(--surface, #fff)) padding-box,
    linear-gradient(135deg, var(--accent, #ec4899), color-mix(in srgb, var(--accent, #ec4899) 40%, #8b5cf6)) border-box;
  box-shadow: 0 4px 18px color-mix(in srgb, var(--accent, #ec4899) 22%, transparent);
}
.pur-badge {
  position: absolute;
  top: -9px;
  right: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--accent, #ec4899), #8b5cf6);
  color: #fff;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.pur-badge-current {
  background: var(--text-tertiary, #888);
}
.pur-plan-name {
  font-weight: 700;
  font-size: 0.92rem;
}
.pur-plan-price b {
  font-size: 1.3rem;
  font-weight: 800;
}
.pur-plan-price em {
  font-style: normal;
  font-size: 0.72rem;
  color: var(--text-tertiary, #888);
  margin-left: 2px;
}
.pur-plan-unit {
  font-size: 0.68rem;
  color: var(--text-tertiary, #999);
}

/* ── 权益对比表 ── */
.pur-compare {
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 16px;
  font-size: 0.78rem;
}
.pur-compare-head,
.pur-compare-row {
  display: grid;
  grid-template-columns: 1.4fr repeat(v-bind(compareCols.length), 1fr);
  align-items: center;
  gap: 4px;
  padding: 7px 12px;
}
.pur-compare-head {
  background: color-mix(in srgb, var(--accent, #ec4899) 7%, transparent);
  font-weight: 700;
}
.pur-compare-col {
  text-align: center;
}
.pur-compare-col.current {
  color: var(--accent, #ec4899);
}
.pur-compare-group {
  padding: 8px 12px 4px;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary, #999);
}
.pur-compare-row {
  border-top: 1px solid color-mix(in srgb, var(--border, #e5e5e5) 55%, transparent);
}
.pur-compare-label {
  color: var(--text-secondary, #666);
}
.pur-compare-val {
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.pur-compare-val.current {
  color: var(--accent, #ec4899);
  font-weight: 600;
}
.pur-compare-val.off {
  color: var(--text-tertiary, #aaa);
}
.pur-compare-gap {
  height: 5px;
}

/* ── 渠道 / CTA ── */
.pur-channels {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.pur-channel {
  flex: 1;
  min-height: 44px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 10px;
  background: var(--surface, #fff);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.pur-channel.active {
  border-color: var(--accent, #ec4899);
  color: var(--accent, #ec4899);
  font-weight: 600;
}
.pur-note {
  margin: 0 0 12px;
  font-size: 0.8rem;
  line-height: 1.5;
}
.pur-note-warn {
  color: #b45309;
}
.pur-note-error {
  color: #dc2626;
}
.pur-primary {
  width: 100%;
  min-height: 46px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--accent, #ec4899), color-mix(in srgb, var(--accent, #ec4899) 55%, #8b5cf6));
  color: #fff;
  font: inherit;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 4px 14px color-mix(in srgb, var(--accent, #ec4899) 30%, transparent);
}
.pur-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

/* ── 扫码 ── */
.pur-pay {
  text-align: center;
}
.pur-amount b {
  font-size: 1.6rem;
}
.pur-amount span {
  display: block;
  margin-top: 2px;
  font-size: 0.8rem;
  color: var(--text-tertiary, #888);
}
.pur-qr {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 220px;
  height: 220px;
  margin: 16px auto 10px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 14px;
  background: #fff;
}
.pur-qr img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pur-qr-loading {
  font-size: 0.8rem;
  color: var(--text-tertiary, #888);
}
.pur-scan {
  margin: 0 0 6px;
  font-size: 0.85rem;
}
.pur-countdown {
  margin: 0 0 16px;
  font-size: 0.78rem;
  color: var(--text-tertiary, #888);
  font-variant-numeric: tabular-nums;
}
.pur-actions {
  display: flex;
  gap: 10px;
}
.pur-ghost {
  flex: 1;
  min-height: 44px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 10px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

/* ── 成功 ── */
.pur-done {
  text-align: center;
  padding-bottom: 24px;
}
.pur-done-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin: 8px auto 12px;
  border-radius: 50%;
  background: color-mix(in srgb, #16a34a 14%, transparent);
  color: #16a34a;
  font-size: 1.6rem;
  font-weight: 700;
}
.pur-done h4 {
  margin: 0 0 6px;
  font-size: 1rem;
}
.pur-done p {
  margin: 0 0 18px;
  font-size: 0.82rem;
  color: var(--text-tertiary, #888);
}

/* ── 移动端：底部弹层 + 触控 ── */
@media (max-width: 768px) {
  .pur-mask {
    align-items: flex-end;
  }
  .pur-modal {
    width: 100%;
    max-height: 90vh;
    border-radius: 16px 16px 0 0;
  }
  .pur-body {
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  }
  .pur-plans {
    grid-template-columns: 1fr;
  }
  .pur-plan {
    min-height: 64px;
  }
  .pur-primary,
  .pur-ghost {
    min-height: 48px;
  }
  .pur-compare-head,
  .pur-compare-row {
    grid-template-columns: 1.2fr repeat(v-bind(compareCols.length), 1fr);
    padding: 8px 10px;
  }
}
</style>
