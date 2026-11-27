<template>
  <div class="settings-tab-panel" data-testid="settings-panel-billing">

    <!-- 会员与权益卡片 -->
    <div class="sp-card">
      <div class="sp-card-head">{{ t('settings.membership') }}</div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.currentPlan') }}</span>
          <span class="sp-row-desc" v-if="entitlement.isPaid && entitlement.expiresAt">
            {{ t('settings.expiresAt') }}: {{ formatExpiry(entitlement.expiresAt) }}
          </span>
        </div>
        <div class="sp-row-ctrl">
          <span class="sp-sync-status" data-testid="lv-entitlement-plan">{{ entitlementLabel }}</span>
          <span v-if="entitlement.isPaid && entitlement.expiresAt" class="hidden" data-testid="lv-entitlement-expiry">{{ entitlement.expiresAt }}</span>
        </div>
      </div>
      <!-- 免费用户：AI 终身试用剩余次数（与 AI 助手输入框标签同一数据源） -->
      <div v-if="trialRow" class="sp-card-row" data-testid="lv-ai-trial">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.aiTrialTitle') }}</span>
          <span class="sp-row-desc">{{ trialRow.desc }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-quota-bar" role="progressbar" :aria-valuenow="trialRow.pct" aria-valuemin="0" aria-valuemax="100">
            <div class="sp-quota-fill" :class="{ warn: trialRow.warn }" :style="{ width: trialRow.pct + '%' }"></div>
          </div>
        </div>
      </div>
      <!-- PRO：本月 AI 次数（主限额，按账号时区自然月；旧服务端无此数据则不显示） -->
      <div v-if="proMonthRow" class="sp-card-row" data-testid="lv-ai-month">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.aiMonthTitle') }}</span>
          <span class="sp-row-desc">{{ t('settings.aiMonthDesc', { used: proMonthRow.used, limit: proMonthRow.limit, reset: monthResetText }) }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-quota-bar" role="progressbar" :aria-valuenow="proMonthRow.pct" aria-valuemin="0" aria-valuemax="100">
            <div class="sp-quota-fill" :class="{ warn: proMonthRow.warn }" :style="{ width: proMonthRow.pct + '%' }"></div>
          </div>
        </div>
      </div>
      <!-- PRO：单日上限（防滥用）——有月度主限额时只在接近上限才显示；旧套餐无月度键时作为主行 -->
      <div v-if="proDailyRow" class="sp-card-row" data-testid="lv-ai-daily">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ proMonthRow ? t('settings.aiDailyCapTitle') : t('settings.aiDailyTitle') }}</span>
          <span class="sp-row-desc">{{ t('settings.aiDailyDesc', { used: proDailyRow.used, limit: proDailyRow.limit, reset: dailyResetText }) }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-quota-bar" role="progressbar" :aria-valuenow="proDailyRow.pct" aria-valuemin="0" aria-valuemax="100">
            <div class="sp-quota-fill" :class="{ warn: proDailyRow.warn }" :style="{ width: proDailyRow.pct + '%' }"></div>
          </div>
        </div>
      </div>
      <!-- 额度刷新时区：每日额度按该时区 0 点恢复；改时区到下一个 0 点生效、30 天一次 -->
      <div v-if="tzRow" class="sp-card-row" data-testid="lv-quota-tz">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.quotaTzTitle') }}</span>
          <span class="sp-row-desc">{{ tzRow.desc }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button
            v-if="tzRow.action"
            type="button"
            class="btn btn-secondary btn-sm"
            data-testid="lv-quota-tz-btn"
            :disabled="tzBusy"
            :title="tzRow.actionTitle"
            @click="onTzAction"
          >
            {{ tzRow.actionLabel }}
          </button>
        </div>
      </div>
      <!-- 本月 AI 用量进度条（enforce 拦截前用户可见的消耗） -->
      <!-- 有每月次数主限额时，token 只是成本兜底：接近 80% 才显示，免得两种口径并列让人困惑 -->
      <div v-if="aiQuota && aiQuota.limit > 0 && (!proMonthRow || quotaPct >= 80)" class="sp-card-row" data-testid="lv-ai-quota">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.aiQuota') }}</span>
          <span class="sp-row-desc">{{ t('settings.aiQuotaUsed', { used: aiQuota.used, limit: aiQuota.limit }) }}</span>
        </div>
        <div class="sp-row-ctrl">
          <div class="sp-quota-bar" role="progressbar" :aria-valuenow="quotaPct" aria-valuemin="0" aria-valuemax="100">
            <div class="sp-quota-fill" :class="{ warn: quotaPct >= 80 }" :style="{ width: quotaPct + '%' }"></div>
          </div>
        </div>
      </div>
      <!-- 在线订阅入口：价格与套餐来自服务端 plans 表，前端不硬编码 -->
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ entitlement.isPaid ? t('purchase.renewTitle') : t('purchase.title') }}</span>
        </div>
        <div class="sp-row-ctrl">
          <button
            type="button"
            class="btn btn-secondary btn-sm sp-upgrade-btn"
            data-testid="lv-upgrade-btn"
            @click="showPurchase = true"
          >
            {{ entitlement.isPaid ? t('purchase.renew') : t('purchase.upgrade') }}
          </button>
        </div>
      </div>
      <div class="sp-card-row">
        <div class="sp-row-meta">
          <span class="sp-row-title">{{ t('settings.activateRedeemCode') }}</span>
        </div>
        <div class="sp-row-ctrl sp-redeem-ctrl">
          <input
            class="form-input sp-redeem-input"
            type="text"
            v-model="redeemInput"
            :placeholder="t('settings.redeemPlaceholder')"
            maxlength="64"
            autocomplete="off"
            spellcheck="false"
            @keyup.enter="onRedeem"
          />
          <button
            class="btn btn-primary btn-sm"
            data-testid="lv-redeem-btn"
            :disabled="redeeming || !redeemInput.trim()"
            @click.stop="onRedeem"
          >
            {{ redeeming ? t('settings.redeeming') : t('settings.redeem') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 交易记录卡片 -->
    <div v-if="auth.isLoggedIn" class="sp-card sp-card-transactions" data-testid="lv-transactions-card">
      <div class="sp-card-head sp-tx-card-head">
        <div class="sp-tx-title-group">
          <span class="sp-tx-title">{{ t('settings.transactions') }}</span>

        </div>
        <div class="sp-tx-head-actions">
          <button
            type="button"
            class="btn btn-ghost btn-xs sp-tx-refresh-btn"
            :class="{ 'is-spinning': loadingTx }"
            :disabled="loadingTx"
            :title="t('settings.txRefresh')"
            :aria-label="t('settings.txRefresh')"
            @click.stop="fetchTransactions()"
          >
            <span aria-hidden="true" v-html="I.refresh"></span>
          </button>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!loadingTx && transactions.length === 0" class="sp-tx-empty">
        <span class="sp-tx-empty-icon" aria-hidden="true" v-html="I.history"></span>
        <div class="sp-tx-empty-title">{{ t('settings.txEmpty') }}</div>
        <div class="sp-tx-empty-desc">{{ t('settings.txEmptyDesc') }}</div>
      </div>

      <!-- 交易明细表格 -->
      <div v-else class="sp-tx-table-wrapper">
        <table class="sp-tx-table">
          <thead>
            <tr>
              <th>{{ t('settings.txTime') }}</th>
              <th>{{ t('settings.txOrderNo') }}</th>
              <th>{{ t('settings.txAmount') }}</th>
              <th>{{ t('settings.txType') }}</th>
              <th>{{ t('settings.txChannel') }}</th>
              <th>{{ t('settings.txStatus') }}</th>
              <th>{{ t('settings.txNotes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="tx in transactions" :key="tx.orderId">
              <td class="sp-tx-cell-time">{{ formatTxTime(tx.paidAt || tx.createdAt) }}</td>
              <td class="sp-tx-cell-order">
                <div class="sp-tx-order-box">
                  <span class="sp-tx-order-id" :title="tx.orderId">{{ tx.orderId }}</span>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs sp-tx-copy-btn"
                    :title="copiedTxOrderId === tx.orderId ? t('settings.txCopied') : t('common.copy')"
                    :aria-label="t('common.copy')"
                    @click.stop="copyOrderNo(tx.orderId)"
                  >
                    <span aria-hidden="true" v-html="copiedTxOrderId === tx.orderId ? I.check : I.copy"></span>
                  </button>
                </div>
              </td>
              <td class="sp-tx-cell-amount">
                <span class="sp-tx-amount" :class="{ 'is-zero': tx.amountCents === 0 }">
                  {{ tx.amountCents > 0 ? `¥ ${tx.amountYen}` : '¥ 0.00' }}
                </span>
              </td>
              <td class="sp-tx-cell-type">
                <span class="sp-tx-type-tag" :class="'type-' + tx.type">{{ formatTxType(tx.type, tx.typeLabel) }}</span>
              </td>
              <td class="sp-tx-cell-channel">{{ formatTxChannel(tx.channel, tx.channelLabel) }}</td>
              <td class="sp-tx-cell-status">
                <span class="sp-tx-badge" :class="'status-' + tx.status">
                  <span class="sp-tx-badge-dot"></span>
                  {{ formatTxStatus(tx.status, tx.statusLabel) }}
                </span>
              </td>
              <td class="sp-tx-cell-notes" :title="tx.notes || '-'">{{ tx.notes || '-' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页条 -->
      <div v-if="totalTx > 0" class="sp-tx-pagination">
        <span class="sp-tx-total">{{ t('settings.txTotal', { total: totalTx }) }}</span>
        <div class="sp-tx-pager">
          <button
            type="button"
            class="btn btn-ghost btn-xs sp-tx-page-btn"
            :disabled="!hasPrevTx || loadingTx"
            @click="prevTxPage"
            aria-label="Previous page"
          >
            &lt;
          </button>
          <span class="sp-tx-page-box">{{ txPage }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs sp-tx-page-btn"
            :disabled="!hasNextTx || loadingTx"
            @click="nextTxPage"
            aria-label="Next page"
          >
            &gt;
          </button>
          <span class="sp-tx-page-size">{{ t('settings.txPerPage', { n: txPageSize }) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 设置面板 ·「会员与账单（权益 / AI 用量 / 兑换码 / 交易明细）」标签页。共享实例经 settingsContext 注入，见该文件说明。 */
import { computed, ref, onBeforeUnmount } from 'vue'
import { I } from '../../../config/icons.js'
import { toast, showConfirm } from '../../../lib/toast.js'
import { copyToClipboard } from '../../../utils.js'
import {
  redeemCode,

  type RedeemError,
} from '../../../composables/domain/useRedeem.js'
import { t, useI18n } from '../../../i18n/index.js'
import { useSettingsContext } from './settingsContext.js'
import { useEntitlement, changeQuotaTimezone } from '../../../composables/domain/useEntitlement.js'
import { browserTimeZone, timeZoneLabel, formatLocalMoment } from '../../../lib/quotaTime.js'

const { fetchTransactions, formatTxTime, prevTxPage, nextTxPage, hasNextTx, hasPrevTx, txPageSize, txPage, totalTx, loadingTx, transactions, refreshEntitlement, entitlement, auth, showPurchase, aiQuota } = useSettingsContext()

const { locale } = useI18n()

function formatTxType(type: string, fallback?: string): string {
  const map: Record<string, string> = {
    purchase: t('settings.txTypePurchase'),
    redeem: t('settings.txTypeRedeem'),
    gift: t('settings.txTypeGift'),
  }
  return map[type] || fallback || type
}

function formatTxChannel(channel: string, fallback?: string): string {
  const map: Record<string, string> = {
    wxpay: t('settings.txChannelWxpay'),
    alipay: t('settings.txChannelAlipay'),
    redeem: t('settings.txChannelRedeem'),
    gift: t('settings.txChannelGift'),
  }
  return map[channel] || fallback || channel
}

function formatTxStatus(status: string, fallback?: string): string {
  const map: Record<string, string> = {
    paid: t('settings.txStatusPaid'),
    pending: t('settings.txStatusPending'),
    failed: t('settings.txStatusFailed'),
    refunded: t('settings.txStatusRefunded'),
  }
  return map[status] || fallback || status
}

const copiedTxOrderId = ref<string | null>(null)

let copyTxTimer: ReturnType<typeof setTimeout> | null = null

async function copyOrderNo(orderId: string) {
  if (!orderId) return
  await copyToClipboard(orderId)
  copiedTxOrderId.value = orderId
  toast(t('settings.txCopied'))
  if (copyTxTimer) clearTimeout(copyTxTimer)
  copyTxTimer = setTimeout(() => {
    copiedTxOrderId.value = null
  }, 2000)
}

const redeemInput = ref('')

const redeeming = ref(false)

const { aiQuotaView, aiAccess } = useEntitlement()

/** 试用行：只对登录的免费用户显示（PRO 看下方月度 token 用量；未登录 / 未知不显示） */
const trialRow = computed(() => {
  const v = aiQuotaView.value
  if (v.kind !== 'trial' && v.kind !== 'low' && v.kind !== 'exhausted') return null
  const used = Math.max(0, v.total - v.remaining)
  return {
    desc: v.kind === 'exhausted'
      ? t('settings.aiTrialExhausted', { total: v.total })
      : t('settings.aiTrialRemaining', { remaining: v.remaining, total: v.total }),
    pct: v.total > 0 ? Math.min(100, Math.round((used / v.total) * 100)) : 100,
    warn: v.kind !== 'trial',
  }
})

const quotaTz = computed(() => aiAccess.value.tz)
const deviceTz = browserTimeZone()

/** 每日额度恢复时刻（本地时间说法）；旧服务端没有时区信息时沿用固定说法 */
const dailyResetText = computed(() =>
  formatLocalMoment(quotaTz.value?.dailyResetsAt) || t('settings.aiDailyResetFallback'),
)

/**
 * 时区行：
 *  - 有待生效修改 → 说明何时切换，按钮「撤销」（改回当前时区，不占冷却）；
 *  - 本设备时区与账号不同 → 按钮「改为本设备时区」；
 *  - 一致 → 只展示。
 */
const tzRow = computed(() => {
  const z = quotaTz.value
  if (!z || !auth.isLoggedIn) return null
  const cur = timeZoneLabel(z.zone)
  if (z.pendingZone) {
    return {
      desc: t('settings.quotaTzPending', { cur, next: timeZoneLabel(z.pendingZone), when: formatLocalMoment(z.pendingAt) }),
      action: 'cancel' as const,
      actionLabel: t('settings.quotaTzCancel'),
      actionTitle: t('settings.quotaTzCancelTitle', { cur }),
    }
  }
  const desc = t('settings.quotaTzDesc', { cur })
  if (deviceTz && deviceTz !== z.zone) {
    return {
      desc,
      action: 'change' as const,
      actionLabel: t('settings.quotaTzUseDevice'),
      actionTitle: t('settings.quotaTzUseDeviceTitle', { device: timeZoneLabel(deviceTz) }),
    }
  }
  return { desc, action: null, actionLabel: '', actionTitle: '' }
})

const tzBusy = ref(false)

async function onTzAction() {
  const row = tzRow.value
  const z = quotaTz.value
  if (!row?.action || !z || tzBusy.value) return
  if (row.action === 'change') {
    const ok = await showConfirm(t('settings.quotaTzConfirm', {
      device: timeZoneLabel(deviceTz),
      when: formatLocalMoment(z.dailyResetsAt),
    }))
    if (!ok) return
  }
  tzBusy.value = true
  try {
    const r = await changeQuotaTimezone(row.action === 'cancel' ? z.zone : deviceTz)
    if (r.ok) {
      toast(row.action === 'cancel' ? t('settings.quotaTzCancelled') : t('settings.quotaTzScheduled', {
        when: formatLocalMoment(r.tz?.pendingAt) || formatLocalMoment(z.dailyResetsAt),
      }))
    } else if (r.reason === 'cooldown') {
      toast(t('settings.quotaTzCooldown', { date: formatLocalMoment(r.nextAllowedAt) }), false)
    } else {
      toast(t('settings.quotaTzFailed'), false)
    }
  } finally {
    tzBusy.value = false
  }
}

const pct = (used: number, limit: number) => Math.min(100, Math.round((used / limit) * 100))

/** 本月次数恢复时刻（账号时区下个月 1 日 0 点，本地时间说法） */
const monthResetText = computed(() =>
  formatLocalMoment(aiAccess.value.pro?.requestsMonthResetsAt) || t('settings.aiMonthResetFallback'),
)

/** PRO 本月次数行（主限额） */
const proMonthRow = computed(() => {
  const p = aiQuotaView.value.pro
  if (aiQuotaView.value.kind !== 'pro' || !p || p.monthLimit <= 0) return null
  return { used: p.monthUsed, limit: p.monthLimit, pct: pct(p.monthUsed, p.monthLimit), warn: p.monthNear }
})

/** PRO 单日行：有月度主限额时只在接近单日上限才出现（防滥用上限，正常用户碰不到） */
const proDailyRow = computed(() => {
  const p = aiQuotaView.value.pro
  if (aiQuotaView.value.kind !== 'pro' || !p || p.dailyLimit <= 0) return null
  if (p.monthLimit > 0 && !p.dailyNear) return null
  return { used: p.dailyUsed, limit: p.dailyLimit, pct: pct(p.dailyUsed, p.dailyLimit), warn: p.dailyNear }
})

const quotaPct = computed(() => {
  const q = aiQuota.value
  if (!q || q.limit <= 0) return 0
  return Math.min(100, Math.round((q.used / q.limit) * 100))
})

/** 有效期格式化：ISO → 本地可读（例：2026/10/31 11:12） */
function formatExpiry(iso: string): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return iso
  return new Date(time).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

const entitlementLabel = computed(() => {
  if (!entitlement.value.isPaid) return t('settings.freePlan')
  const map: Record<string, string> = {
    pro_monthly: t('settings.planPlusMonthly'),
    pro_yearly: t('settings.planPlusYearly'),
    pro_quarterly: t('settings.planPlusQuarterly'),
    plus_monthly: t('settings.planPlusMonthly'),
    plus_yearly: t('settings.planPlusYearly'),
  }
  // 优先服务端 plan_name（测试档等非内置套餐也能显示名称），再退内置映射，最后退 planId
  return map[entitlement.value.planId] || entitlement.value.planName || entitlement.value.planId
})

function redeemErrKey(e?: RedeemError): string {
  switch (e) {
    case 'not_found':
      return 'settings.redeemErrNotFound'
    case 'already_used':
      return 'settings.redeemErrUsed'
    case 'plan_inactive':
      return 'settings.redeemErrInactive'
    case 'unauthorized':
      return 'settings.redeemErrAuth'
    case 'rate_limited':
      return 'settings.redeemErrRate'
    default:
      return 'settings.redeemErrNetwork'
  }
}

async function onRedeem() {
  const code = redeemInput.value.trim()
  if (!code || redeeming.value) return
  if (!auth.isLoggedIn) {
    toast(t('settings.redeemErrAuth'), false)
    return
  }
  redeeming.value = true
  try {
    const r = await redeemCode(code)
    if (r.ok) {
      toast(t('settings.redeemSuccess', { plan: r.planName || '', date: r.expiresAt || '' }))
      redeemInput.value = ''
      await refreshEntitlement()
      void fetchTransactions(1)
    } else {
      toast(t(redeemErrKey(r.error)), false)
    }
  } finally {
    redeeming.value = false
  }
}

// 订单号「已复制」提示计时器：卸载时清理
onBeforeUnmount(() => {
  if (copyTxTimer) {
    clearTimeout(copyTxTimer)
    copyTxTimer = null
  }
})
</script>
