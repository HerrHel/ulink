<template>
  <!-- AI 额度标签：只对「看得到次数」的用户显示（免费试用 / 未登录）；PRO 与状态未知时不占位 -->
  <div v-if="visible" class="ai-quota-chip-row" :class="{ dock }">
    <button
      type="button"
      class="ai-quota-chip"
      :class="`is-${view.kind}`"
      data-testid="ai-quota-chip"
      :title="hint"
      @click.stop="onClick"
    >
      <span class="ai-quota-dot" aria-hidden="true"></span>
      <span class="ai-quota-text">{{ label }}</span>
      <span v-if="actionLabel" class="ai-quota-action">{{ actionLabel }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * AI 助手输入框下方的额度标签。
 * 免费用户 AI 为终身试用（服务端 consume_ai_access 计次），此前只有用完被拦下时才知道；
 * 这里常驻展示剩余次数，低于阈值变提醒色，用完 / 未登录时给出购买 / 登录入口。
 */
import { computed, onMounted } from 'vue'
import { t } from '../../i18n/index.js'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'
import { useUIStore } from '../../stores/ui.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { formatLocalMoment } from '../../lib/quotaTime.js'

defineProps<{ dock?: boolean }>()

const ent = useEntitlement()
const ui = useUIStore()
const auth = useAuth()

const view = ent.aiQuotaView

/** PRO 只在接近今日 / 本月上限时出现，平时不打扰；未知状态不展示 */
const visible = computed(() => {
  const v = view.value
  if (v.kind === 'unknown') return false
  if (v.kind === 'pro') return !!v.pro?.near
  return true
})

const label = computed(() => {
  const v = view.value
  switch (v.kind) {
    case 'pro': {
      // 只显示最紧迫的一项：今日防滥用上限 > 每月次数 > token 兜底
      const p = v.pro
      if (p?.dailyNear) return t('ai.quotaChipProDaily', { remaining: p.dailyRemaining, total: p.dailyLimit })
      if (p?.monthNear) return t('ai.quotaChipProMonthReq', { remaining: p.monthRemaining, total: p.monthLimit })
      return t('ai.quotaChipProMonth', { pct: p?.tokenPct ?? 0 })
    }
    case 'exhausted':
      return t('ai.quotaChipExhausted')
    case 'anonymous':
      return t('ai.quotaChipAnonymous')
    default:
      return t('ai.quotaChipTrial', { remaining: v.remaining, total: v.total })
  }
})

const actionLabel = computed(() => {
  const k = view.value.kind
  if (k === 'anonymous') return t('ai.quotaChipLogin')
  if (k === 'low' || k === 'exhausted') return t('ai.quotaChipUpgrade')
  return ''
})

const hint = computed(() => {
  const k = view.value.kind
  if (k === 'anonymous') return t('ai.quotaChipAnonymousHint')
  if (k === 'pro') {
    // 恢复时刻换算成用户本地时间；旧服务端没给时刻时用固定说法
    const a = ent.aiAccess.value
    if (view.value.pro?.dailyNear) {
      return t('ai.quotaChipProDailyHint', {
        daily: formatLocalMoment(a.tz?.dailyResetsAt) || t('ai.quotaChipDailyFallback'),
      })
    }
    return t('ai.quotaChipProHint', {
      month: formatLocalMoment(a.pro?.requestsMonthResetsAt || a.pro?.monthlyResetsAt) || t('ai.quotaChipMonthFallback'),
    })
  }
  return t('ai.quotaChipHint')
})

function onClick() {
  const k = view.value.kind
  if (k === 'anonymous') {
    auth.authModalOpen = true
    return
  }
  // PRO 已是最高档：点击打开设置里的用量明细，而不是购买页
  if (k === 'pro') {
    ui.settingsInitialTab = 'account'
    ui.panels.settings = true
    return
  }
  ui.openPurchase()
}

onMounted(() => {
  // 首次进入 AI 助手时状态可能还没拉过（未知）：登录用户补拉一次
  if (view.value.kind === 'unknown' && auth.isLoggedIn) void ent.refreshAiAccess().catch(() => {})
})
</script>

<style scoped>
.ai-quota-chip-row {
  display: flex;
  justify-content: center;
  margin-top: 12px;
  width: 100%;
}
.ai-quota-chip-row.dock {
  margin-top: 8px;
  pointer-events: auto;
}
.ai-quota-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: var(--fs-2xs);
  line-height: 1.6;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}
.ai-quota-chip:hover {
  background: var(--surface-hover);
  border-color: var(--border-light);
  color: var(--text);
}
.ai-quota-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0.7;
  flex-shrink: 0;
}
.ai-quota-action {
  color: var(--accent);
  font-weight: 600;
}
.ai-quota-chip.is-low,
.ai-quota-chip.is-exhausted,
.ai-quota-chip.is-pro {
  color: var(--amber);
  background: var(--amber-light);
}
.ai-quota-chip.is-low .ai-quota-dot,
.ai-quota-chip.is-exhausted .ai-quota-dot,
.ai-quota-chip.is-pro .ai-quota-dot {
  background: var(--amber);
  opacity: 1;
}
.ai-quota-chip.is-anonymous .ai-quota-dot {
  background: var(--text-muted);
}
</style>
