<template>
  <Teleport to="body">
    <Transition name="renewal-slide">
      <div v-if="reminder" class="renewal-banner" data-testid="lv-renewal-banner" role="status">
        <div class="renewal-text">
          <span class="renewal-title">
            {{ reminder.stage === 'final' ? t('purchase.reminderTitleFinal') : t('purchase.reminderTitle', { n: reminder.daysLeft }) }}
          </span>
          <span class="renewal-body">{{ t('purchase.reminderBody') }}</span>
        </div>
        <div class="renewal-actions">
          <button class="btn btn-ghost btn-sm" data-testid="lv-renewal-later" @click="dismiss">{{ t('purchase.reminderLater') }}</button>
          <button class="btn btn-primary btn-sm" data-testid="lv-renewal-cta" @click="renew">{{ t('purchase.reminderCta') }}</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 到期前续费提醒：PRO 到期前 7 天内提醒一次、最后 1 天再提醒一次（规则见 lib/renewal.ts）。
 * 点「续费」打开购买弹窗并优先选中年付；点「稍后」记住关闭，同一到期日的同一阶段不再出现。
 * 分享只读态、扩展侧边栏、购买弹窗已打开时不显示。
 */
import { computed, ref } from 'vue'
import { t } from '../../i18n/index.js'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'
import { useUIStore } from '../../stores/ui.js'
import { useExtPanelStore } from '../../stores/extPanel.js'
import { safeGetItem, safeSetItem } from '../../lib/storageSafe.js'
import { computeRenewalReminder } from '../../lib/renewal.js'

const ent = useEntitlement()
const ui = useUIStore()
const extPanel = useExtPanelStore()
/** 本会话内关闭过的键（存储受限时仍能立刻隐藏） */
const dismissedNow = ref<Set<string>>(new Set())

const reminder = computed(() => {
  if (ui.shareMode || extPanel.active || ui.modals.purchase) return null
  return computeRenewalReminder({
    isPaid: ent.isPaid.value,
    expiresAt: ent.expiresAt.value,
    isDismissed: (key) => dismissedNow.value.has(key) || safeGetItem(key) === '1',
  })
})

function dismiss() {
  const r = reminder.value
  if (!r) return
  safeSetItem(r.dismissKey, '1')
  dismissedNow.value = new Set([...dismissedNow.value, r.dismissKey])
}

function renew() {
  // 打开购买弹窗即视为已处理本阶段提醒，避免关弹窗后横幅又冒出来
  dismiss()
  ui.openPurchase({ preferCycle: 'yearly' })
}
</script>

<style scoped>
.renewal-banner {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  z-index: 7100; width: min(460px, calc(100vw - 32px));
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-base); box-shadow: var(--shadow-xl);
  font-size: var(--fs-sm);
}
.renewal-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.renewal-title { font-weight: 600; color: var(--text); }
.renewal-body { color: var(--text-secondary); font-size: var(--fs-xs); line-height: 1.5; }
.renewal-actions { display: flex; gap: 6px; flex-shrink: 0; }
.renewal-slide-enter-active { transition: all .3s cubic-bezier(.34,1.56,.64,1); }
.renewal-slide-leave-active { transition: all .2s ease; }
.renewal-slide-enter-from { opacity: 0; transform: translateX(-50%) translateY(24px); }
.renewal-slide-leave-to { opacity: 0; transform: translateX(-50%) translateY(12px); }
@media (max-width: 480px) {
  .renewal-banner { flex-direction: column; align-items: stretch; }
  .renewal-actions { justify-content: flex-end; }
}
</style>
