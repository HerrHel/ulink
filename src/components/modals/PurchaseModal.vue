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

      <!-- ① 选套餐 -->
      <div v-if="stage === 'select'" class="pur-body">
        <div v-if="loadingPlans" class="pur-hint">{{ t('common.loading') }}</div>

        <template v-else>
          <div v-if="plans.length === 0" class="pur-empty">
            {{ t('purchase.noPlans') }}
          </div>

          <div v-else class="pur-plans">
            <button
              v-for="p in plans"
              :key="p.planId"
              type="button"
              class="pur-plan"
              :class="{ active: selectedPlan === p.planId }"
              :data-testid="`plan-${p.planId}`"
              @click="selectedPlan = p.planId"
            >
              <span class="pur-plan-name">{{ p.name }}</span>
              <span class="pur-plan-price">
                <b>{{ yen(p.priceCents) }}</b>
                <em>/ {{ days(p.periodDays) }}</em>
              </span>
            </button>
          </div>

          <!-- 支付方式 -->
          <div v-if="plans.length" class="pur-channels">
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

          <!-- 未开通提示：商户号还没配时明确告知，而不是报错 -->
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
            {{ creating ? t('purchase.creating') : t('purchase.payNow') }}
          </button>
        </template>
      </div>

      <!-- ② 扫码支付 -->
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

      <!-- ③ 支付成功 -->
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
 * 购买弹窗：选套餐 → 选渠道 → 扫码 → 轮询 → 成功
 *
 * 设计约束：
 *   · 价格全部来自服务端（`action:'plans'` / 下单返回的 `amountCents`），前端不参与计算
 *   · 渠道未配置（商户号没配）时展示「即将开放」而非报错 —— 这是上线初期的常态
 *   · 二维码用 `qrcode` 本地渲染成 dataURL，**不外发到任何第三方二维码服务**（隐私）
 *   · 关窗即停止轮询，避免用户离开后还在打接口
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
}

const props = defineProps<{ visible: boolean }>()
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

/** 分 → ¥ 展示（仅展示，不参与任何计算） */
function yen(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}
function days(d: number): string {
  if (!d) return ''
  return d % 30 === 0 ? `${d / 30} 个月` : `${d} 天`
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
      if (!selectedPlan.value && body.plans.length) selectedPlan.value = body.plans[0].planId
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
  const deadline = expiresAt ? new Date(expiresAt).getTime() : Date.now() + 30 * 60000
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
  width: min(440px, calc(100vw - 32px));
  max-height: min(86vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pur-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 12px;
}
.pur-title {
  margin: 0;
  font-size:var(--fs-lg);
  font-weight: 600;
}
.pur-sub {
  margin: 4px 0 0;
  font-size:var(--fs-sm);
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
  font-size:var(--fs-2xl);
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
  font-size:var(--fs-sm);
  color: var(--text-tertiary, #888);
}

/* 套餐卡片 */
.pur-plans {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
}
.pur-plan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
  padding: 12px 14px;
  border: 1px solid var(--border, #e5e5e5);
  border-radius: 12px;
  background: var(--surface, #fff);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.pur-plan.active {
  border-color: var(--accent, var(--accent));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, var(--accent)) 14%, transparent);
}
.pur-plan-name {
  font-weight: 600;
}
.pur-plan-price b {
  font-size:var(--fs-lg);
}
.pur-plan-price em {
  font-style: normal;
  font-size:var(--fs-xs);
  color: var(--text-tertiary, #888);
  margin-left: 2px;
}

/* 渠道 */
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
  border-color: var(--accent, var(--accent));
  color: var(--accent, var(--accent));
  font-weight: 600;
}

.pur-note {
  margin: 0 0 12px;
  font-size:var(--fs-sm);
  line-height: 1.5;
}
.pur-note-warn {
  color: #b45309;
}
.pur-note-error {
  color: var(--danger);
}

.pur-primary {
  width: 100%;
  min-height: 46px;
  border: none;
  border-radius: 12px;
  background: var(--accent, var(--accent));
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.pur-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 扫码 */
.pur-pay {
  text-align: center;
}
.pur-amount b {
  font-size: 1.6rem;
}
.pur-amount span {
  display: block;
  margin-top: 2px;
  font-size:var(--fs-sm);
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
  font-size:var(--fs-sm);
  color: var(--text-tertiary, #888);
}
.pur-scan {
  margin: 0 0 6px;
  font-size:var(--fs-sm);
}
.pur-countdown {
  margin: 0 0 16px;
  font-size:var(--fs-sm);
  color: var(--text-tertiary, #888);
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

/* 成功 */
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
  background: color-mix(in srgb, var(--green) 14%, transparent);
  color: var(--green);
  font-size: 1.6rem;
  font-weight: 700;
}
.pur-done h4 {
  margin: 0 0 6px;
  font-size: 1rem;
}
.pur-done p {
  margin: 0 0 18px;
  font-size:var(--fs-sm);
  color: var(--text-tertiary, #888);
}

/* 移动端：底部弹层 + 更大触控 */
@media (max-width: 768px) {
  .pur-mask {
    align-items: flex-end;
  }
  .pur-modal {
    width: 100%;
    max-height: 88vh;
    border-radius: 16px 16px 0 0;
  }
  .pur-body {
    padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  }
  .pur-plan {
    min-height: 60px;
  }
  .pur-primary,
  .pur-ghost {
    min-height: 48px;
  }
}
</style>
