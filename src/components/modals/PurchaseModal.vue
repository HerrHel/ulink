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
      <!-- 顶部标题与周期切换（极简克制风格） -->
      <div class="pur-head">
        <div class="pur-head-main">
          <h3 class="pur-title">{{ t('purchase.title') }}</h3>
          <p class="pur-subtitle">{{ t('purchase.subtitle') }}</p>
        </div>

        <div class="pur-head-actions">
          <!-- 周期切换胶囊（仅保留包月、包季、包年） -->
          <div class="pur-cycle-tabs" role="tablist">
            <button
              type="button"
              class="pur-cycle-tab"
              :class="{ active: selectedCycle === 'monthly' }"
              @click="onSelectCycleTab('monthly')"
            >
              {{ t('purchase.cycleMonthly') }}
            </button>
            <button
              type="button"
              class="pur-cycle-tab"
              :class="{ active: selectedCycle === 'quarterly' }"
              @click="onSelectCycleTab('quarterly')"
            >
              {{ t('purchase.cycleQuarterly') }}
            </button>
            <button
              type="button"
              class="pur-cycle-tab pur-cycle-tab-recommended"
              :class="{ active: selectedCycle === 'yearly' }"
              @click="onSelectCycleTab('yearly')"
            >
              {{ t('purchase.cycleYearly') }}
            </button>
          </div>

          <button
            class="pur-close"
            :aria-label="t('common.close')"
            @click="close"
          >
            &times;
          </button>
        </div>
      </div>

      <!-- ① 套餐卡片主视图（Supabase 极简克制 3/4 列卡片，底部无支付条） -->
      <div class="pur-body">
        <div v-if="loadingPlans" class="pur-hint">{{ t('common.loading') }}</div>

        <template v-else>
          <div v-if="displayCards.length === 0" class="pur-empty">
            {{ t('purchase.noPlans') }}
          </div>

          <template v-else>
            <!-- 卡片网格（对齐 Supabase 格局，适配站点配色） -->
            <div class="pur-cards-grid">
              <div
                v-for="p in filteredCards"
                :key="p.planId"
                class="pur-tier-card"
                :class="{
                  'is-active': selectedPlan === p.planId,
                  'is-recommended': p.isRecommended,
                  'is-current': p.isCurrent,
                  'is-free': p.isFree,
                }"
                :data-testid="`plan-${p.planId}`"
                @click="onCardClick(p)"
              >
                <!-- 卡片顶部：中文标题 + 徽标 + 单行副标 -->
                <div class="pur-card-header">
                  <div class="pur-tier-name-row">
                    <span class="pur-tier-name">{{ p.chineseName }}</span>
                    <span v-if="p.badge" class="pur-tier-badge" :class="p.badgeClass">
                      {{ p.badge }}
                    </span>
                  </div>
                  <p class="pur-tier-desc">{{ p.desc }}</p>
                </div>

                <!-- 行动按钮（CTA 按钮在价格上方，未购显示「升级」，已购显示「续费」） -->
                <div class="pur-card-cta">
                  <button
                    type="button"
                    class="pur-card-btn"
                    :class="{
                      'btn-primary-tier': !p.isCurrent && !p.isFree,
                      'btn-renew-tier': p.isCurrent && !p.isFree,
                      'btn-current-tier': p.isFree && isCurrentFree,
                      'btn-free-downgrade': p.isFree && !isCurrentFree,
                    }"
                    :disabled="p.isFree && isCurrentFree"
                    @click.stop="onCardSubscribe(p)"
                  >
                    <span>{{ getCardButtonLabel(p) }}</span>
                  </button>
                </div>

                <!-- 价格区域（紧随行动按钮下方，含划线原价与立省标签） -->
                <div class="pur-card-pricing">
                  <span class="pur-from-label">{{ t('purchase.fromLabel') || '起步价' }}</span>
                  <div class="pur-price-main">
                    <span class="pur-amount-num">¥{{ (p.priceCents / 100).toFixed(p.priceCents % 100 === 0 ? 0 : 2) }}</span>
                    <span class="pur-period-tag">/ {{ p.periodLabel }}</span>
                    <!-- 季付与年付原价划掉 -->
                    <del v-if="p.originalPrice" class="pur-original-price">¥{{ p.originalPrice }}</del>
                  </div>

                  <!-- 立省金额一眼看清 -->
                  <div v-if="p.savingsText" class="pur-savings-row">
                    <span class="pur-savings-tag">{{ p.savingsText }}</span>
                  </div>

                  <div class="pur-price-sub">
                    <span v-if="p.perMonthText" class="pur-sub-unit">{{ p.perMonthText }}</span>
                    <span v-else class="pur-sub-unit-empty">&nbsp;</span>
                  </div>
                </div>

                <!-- 极简细分割线 -->
                <div class="pur-card-divider"></div>

                <!-- 特性分组标题 -->
                <div class="pur-features-heading">
                  {{ p.isFree ? t('purchase.featuresStarter') : t('purchase.featuresPro') }}
                </div>

                <!-- 特性列表（站点主题色勾号清单） -->
                <div class="pur-card-features">
                  <div
                    v-for="(item, fi) in p.bullets"
                    :key="fi"
                    class="pur-feature-item"
                  >
                    <span class="pur-check-mark" aria-hidden="true">✓</span>
                    <div class="pur-feature-content">
                      <span class="pur-feature-text" :class="{ 'is-bold': item.highlight }">{{ item.text }}</span>
                      <span v-if="item.sub" class="pur-feature-sub">{{ item.sub }}</span>
                    </div>
                  </div>
                </div>

                <!-- 卡片底注微说明 -->
                <div class="pur-card-footer-note">
                  {{ p.footerNote }}
                </div>
              </div>
            </div>

            <p v-if="error === 'channel_not_configured'" class="pur-note pur-note-warn">
              {{ t('purchase.notOpen') }}
            </p>
            <p v-else-if="error" class="pur-note pur-note-error">{{ t(`purchase.error.${error}`) }}</p>

            <!-- 底部折叠区：查看完整参数对比表 -->
            <div class="pur-compare-toggle-wrapper">
              <button
                type="button"
                class="pur-toggle-btn"
                @click="showCompareTable = !showCompareTable"
              >
                <span>{{ showCompareTable ? t('purchase.hideFullCompare') : t('purchase.viewFullCompare') }}</span>
                <span class="pur-toggle-arrow" :class="{ open: showCompareTable }">▾</span>
              </button>

              <!-- 详细对比表（折叠内容） -->
              <div v-if="showCompareTable" class="pur-compare" data-testid="purchase-compare">
                <div class="pur-compare-head">
                  <span>{{ t('purchase.compareTitle') }}</span>
                  <span
                    v-for="col in compareCols"
                    :key="col.id"
                    class="pur-compare-col"
                    :class="{ current: col.id === currentPlanId }"
                  >
                    {{ col.name }}
                  </span>
                </div>
                <template v-for="(group, gi) in compareGroups" :key="group.key">
                  <div class="pur-compare-group">{{ t(`purchase.featureGroups.${group.key}`) }}</div>
                  <div v-for="f in group.rows" :key="f.key" class="pur-compare-row">
                    <span class="pur-compare-label">{{ t(`purchase.features.${f.key}`) }}</span>
                    <span
                      v-for="col in compareCols"
                      :key="col.id"
                      class="pur-compare-val"
                      :class="{ current: col.id === currentPlanId, off: !col.features[f.key] }"
                    >
                      {{ fmtFeature(f.key, col.features[f.key]) }}
                    </span>
                  </div>
                  <div v-if="gi < compareGroups.length - 1" class="pur-compare-gap"></div>
                </template>
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- ② 点击升级/续费后唤起的 Supabase 风格独立 2-Column 结算支付弹层（图2同款） -->
      <Transition name="pur-fade">
        <div
          v-if="stage === 'paying' && activePlan"
          class="pur-checkout-overlay"
          @mousedown.self="stage = 'select'"
        >
          <div class="pur-checkout-dialog" @mousedown.stop>
            <!-- 左侧：选择支付方式与扫码区域 -->
            <div class="pur-checkout-left">
              <div class="pur-checkout-head">
                <h4 class="pur-co-title">{{ t('purchase.checkoutTitle') }}</h4>
                <p class="pur-co-subtitle">{{ t('purchase.checkoutSubtitle') }}</p>
              </div>

              <!-- 支付方式切换 Tab（微信支付 / 支付宝） -->
              <div class="pur-channels-tabs" role="tablist">
                <button
                  v-for="c in channels"
                  :key="c.id"
                  type="button"
                  class="pur-channel-tab"
                  :class="{ active: selectedChannel === c.id }"
                  :data-testid="`channel-${c.id}`"
                  @click="onChangeChannelWhilePaying(c.id)"
                >
                  <span class="pur-tab-dot"></span>
                  {{ t(c.labelKey) }}
                </button>
              </div>

              <!-- 二维码扫码区 -->
              <div class="pur-qr-box">
                <div class="pur-qr-frame">
                  <!-- 成功加载二维码 -->
                  <img v-if="qrDataUrl && !creating" :src="qrDataUrl" :alt="t('purchase.qrAlt')" />

                  <!-- 正在创建订单/生成二维码 -->
                  <div v-else-if="creating" class="pur-qr-state pur-qr-loading-state">
                    <div class="pur-spinner" aria-hidden="true"></div>
                    <p class="pur-qr-state-text">{{ t('purchase.creating') }}</p>
                  </div>

                  <!-- 渠道未开通 -->
                  <div v-else-if="error === 'channel_not_configured'" class="pur-qr-state pur-qr-warn-state">
                    <div class="pur-state-icon pur-state-warn">!</div>
                    <p class="pur-state-title">{{ selectedChannel === 'wechat' ? '微信支付暂未开通' : '支付宝暂未开通' }}</p>
                    <p class="pur-state-desc">请尝试切换为{{ selectedChannel === 'wechat' ? '支付宝' : '微信支付' }}</p>
                    <button
                      type="button"
                      class="pur-btn-retry"
                      @click="onChangeChannelWhilePaying(selectedChannel === 'wechat' ? 'alipay' : 'wechat')"
                    >
                      切换为{{ selectedChannel === 'wechat' ? '支付宝' : '微信支付' }}
                    </button>
                  </div>

                  <!-- 未登录 -->
                  <div v-else-if="error === 'unauthorized'" class="pur-qr-state pur-qr-error-state">
                    <div class="pur-state-icon">🔒</div>
                    <p class="pur-state-title">请先登录账号</p>
                    <p class="pur-state-desc">登录后即可开通并绑定会员特权</p>
                    <button type="button" class="pur-btn-retry" @click="authStore.authModalOpen = true">
                      立即登录
                    </button>
                  </div>

                  <!-- 其他错误（网络/服务暂时不可用） -->
                  <div v-else-if="error" class="pur-qr-state pur-qr-error-state">
                    <div class="pur-state-icon">✕</div>
                    <p class="pur-state-title">{{ t(`purchase.error.${error}`) || '创建订单失败' }}</p>
                    <p v-if="error === 'network'" class="pur-state-desc pur-network-hint">
                      服务部署于国内上海节点，若开启了境外代理/VPN 可能导致直连超时，建议关闭代理或设为直连。
                    </p>
                    <div class="pur-state-actions">
                      <button type="button" class="pur-btn-retry" @click="submit">
                        点击重试
                      </button>
                      <button type="button" class="pur-btn-demo" @click="enableDemoPay">
                        体验演示支付
                      </button>
                    </div>
                  </div>

                  <!-- 兜底加载态 -->
                  <div v-else class="pur-qr-state pur-qr-loading-state">
                    <div class="pur-spinner" aria-hidden="true"></div>
                    <p class="pur-qr-state-text">{{ t('common.loading') }}</p>
                  </div>
                </div>

                <template v-if="qrDataUrl && !creating">
                  <p class="pur-scan-tip">{{ t(`purchase.scan.${selectedChannel}`) }}</p>
                  <p class="pur-countdown-tip">
                    {{ expired ? t('purchase.expired') : t('purchase.countdown', { time: countdown }) }}
                  </p>
                </template>
              </div>

              <!-- 订单明细小结 -->
              <div class="pur-order-summary">
                <div class="pur-summary-row">
                  <span class="pur-summary-label">{{ t('purchase.todayPay') }}</span>
                  <b class="pur-summary-price">{{ yen(order?.amountCents || activePlan?.priceCents || 0) }}</b>
                </div>
                <div class="pur-summary-row sub">
                  <span class="pur-summary-label">{{ t('purchase.billingCycle') }}</span>
                  <span class="pur-summary-val">1 {{ activePlan?.periodLabel || '期' }}</span>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="pur-checkout-actions">
                <button type="button" class="pur-btn-ghost" @click="stage = 'select'">
                  {{ t('purchase.backToPlans') }}
                </button>
                <button v-if="expired" type="button" class="pur-btn-ghost" @click="restart">
                  {{ t('purchase.recreate') }}
                </button>
              </div>
            </div>

            <!-- 右侧：升级套餐详情与特权清单（Supabase 样式） -->
            <div class="pur-checkout-right">
              <button
                class="pur-co-close"
                :aria-label="t('common.close')"
                @click="stage = 'select'"
              >
                &times;
              </button>

              <div class="pur-plan-intro">
                <h4 class="pur-intro-title">
                  {{ props.currentPlanId === activePlan?.planId ? t('purchase.renewFor', { name: activePlan?.name }) : t('purchase.upgradeTo', { name: activePlan?.name }) }}
                </h4>
                <p class="pur-intro-desc">
                  {{ activePlan?.desc }}
                </p>
              </div>

              <div class="pur-features-box">
                <div class="pur-features-title">{{ t('purchase.featuresIncluded') }}</div>
                <div class="pur-features-checklist">
                  <div v-for="(item, fi) in activePlan?.bullets" :key="fi" class="pur-chk-item">
                    <span class="pur-chk-icon">✓</span>
                    <div class="pur-chk-content">
                      <span class="pur-chk-text" :class="{ 'is-bold': item.highlight }">{{ item.text }}</span>
                      <span v-if="item.sub" class="pur-chk-sub">{{ item.sub }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="pur-checkout-footnote">
                {{ activePlan?.footerNote || '支付完成后权益立即生效，随订随用，随时取消。' }}
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- ③ 支付成功 -->
      <div v-if="stage === 'done'" class="pur-body pur-done">
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
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { usePayment, type PaymentChannel } from '../../composables/domain/usePayment.js'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
import { t } from '../../i18n/index.js'
import { fetchPurchasePlans, getCachedPlans, type PlanRow } from '../../composables/domain/usePurchasePlans.js'
import { useAuthStore } from '../../stores/auth.js'
import { toast } from '../../lib/toast.js'

const props = defineProps<{ visible: boolean; currentPlanId?: string }>()
const authStore = useAuthStore()
const emit = defineEmits<{ (e: 'close'): void; (e: 'paid'): void }>()

const { onMaskMouseDown, onMaskClick } = useMaskClose(() => close())

const pay = usePayment()
const stage = ref<'select' | 'paying' | 'done'>('select')
const initialPlans = getCachedPlans()
const plans = ref<PlanRow[]>(initialPlans)
const loadingPlans = ref(initialPlans.length === 0)
const selectedPlan = ref('')
const selectedCycle = ref<'monthly' | 'quarterly' | 'yearly'>('monthly')
const showCompareTable = ref(false)

function applyPlanSelection(list: PlanRow[]) {
  if (list.length > 0) {
    const current = list.find((p) => p.planId === props.currentPlanId && p.priceCents > 0)
    const monthly = list.find((p) => p.periodDays === 30 && p.priceCents > 0)
    const quarterly = list.find((p) => (p.periodDays || 0) >= 80 && (p.periodDays || 0) <= 120 && p.priceCents > 0)
    const yearly = list.find((p) => (p.periodDays || 0) >= 365 && p.priceCents > 0)

    if (current) {
      selectedPlan.value = current.planId
      if ((current.periodDays || 0) >= 365) selectedCycle.value = 'yearly'
      else if ((current.periodDays || 0) >= 80 && (current.periodDays || 0) <= 120) selectedCycle.value = 'quarterly'
      else selectedCycle.value = 'monthly'
    } else {
      if (selectedCycle.value === 'yearly') selectedPlan.value = yearly?.planId || ''
      else if (selectedCycle.value === 'quarterly') selectedPlan.value = quarterly?.planId || ''
      else selectedPlan.value = monthly?.planId || yearly?.planId || ''
    }
  }
}
applyPlanSelection(plans.value)

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

const isCurrentFree = computed(() => !props.currentPlanId || props.currentPlanId === 'free')

interface FeatureBullet {
  text: string
  sub?: string
  highlight?: boolean
}

interface TierCardView extends PlanRow {
  chineseName: string
  desc: string
  isFree: boolean
  isCurrent: boolean
  isRecommended: boolean
  badge: string
  badgeClass: string
  periodLabel: string
  originalPrice?: number
  savingsText?: string
  perMonthText: string
  footerNote: string
  bullets: FeatureBullet[]
}

/** 整理出所有的卡片数据（纯中文套餐名 + 划线原价 + 站点配色） */
const displayCards = computed<TierCardView[]>(() => {
  const all = plans.value
  if (!all.length) return []

  const list: TierCardView[] = []

  // 1. 免费版（体验套餐）
  const free = all.find((p) => p.priceCents === 0 || p.planId === 'free')
  if (free) {
    list.push({
      ...free,
      name: t('purchase.freeTierTitle') || '体验套餐',
      chineseName: '体验套餐',
      desc: '永久免费 · 适合快速上手体验与个人日常基础整理。',
      isFree: true,
      isCurrent: isCurrentFree.value,
      isRecommended: false,
      badge: isCurrentFree.value ? t('purchase.currentPlanBadge') : '',
      badgeClass: 'badge-current',
      periodLabel: '永久',
      perMonthText: '永久免费使用',
      footerNote: '永久免费使用，随心体验。',
      bullets: [
        { text: '多端加密双向同步', sub: '支持 2 台设备实时协同' },
        { text: 'AI 基础体验额度', sub: '每月约 10 万字（5 万 tokens）' },
        { text: '云端安全存储', sub: '足额文本与加密数据空间' },
        { text: '收藏历史保留', sub: '历史版本留存 90 天' },
        { text: '完整多级分类树', sub: '无限层级与批量分类整理' },
        { text: '死链手动检测', sub: '单条手动检测与状态标识' },
      ],
    })
  }

  // 2. 付费方案：过滤掉临时测试档
  const isDevOrTest = typeof window !== 'undefined' && (window.location.search.includes('test_plan=1') || window.location.hostname === 'localhost')
  const paid = all
    .filter((p) => p.priceCents > 0)
    .filter((p) => {
      const isTestTier = p.priceCents < 100 || p.name.includes('测试') || (p.periodDays || 0) <= 7
      if (isTestTier) {
        return isDevOrTest || props.currentPlanId === p.planId
      }
      return true
    })
    .sort((a, b) => a.priceCents - b.priceCents)

  // 获取月付基准价（用于准确计算季付、年付对比月付的原价与省钱金额）
  const monthlyTier = paid.find((p) => (p.periodDays || 0) >= 25 && (p.periodDays || 0) <= 35)
  const baseMonthlyPriceCents = monthlyTier?.priceCents || 1200 // 默认基准 12 元/月

  for (const p of paid) {
    const isYearly = (p.periodDays || 0) >= 365
    const isQuarterly = (p.periodDays || 0) >= 80 && (p.periodDays || 0) <= 120
    const isMonthly = (p.periodDays || 0) >= 25 && (p.periodDays || 0) <= 35
    const isTest = (p.periodDays || 0) <= 7

    const isCurrent = props.currentPlanId === p.planId
    const isRecommended = isYearly // 年付设为推荐最划算档

    let chineseName = p.name || 'PRO'
    let desc = '适合高频使用与深度整理，随订随用。'
    let footerNote = '开通即刻生效，支持随订随用。'
    let originalPrice: number | undefined
    let savingsText: string | undefined

    if (isYearly) {
      chineseName = 'PRO 年付'
      desc = '长期使用首选，折合仅 ¥9/月，尊享所有特权。'
      footerNote = '单次开通即刻生效，未到期再次开通自动顺延。'
      // 原价计算：12 个月 × 月付基准
      const origYuan = (baseMonthlyPriceCents * 12) / 100
      const currentYuan = p.priceCents / 100
      const savedYuan = Math.round(origYuan - currentYuan)
      if (savedYuan > 0) {
        originalPrice = origYuan
        savingsText = `立省 ¥${savedYuan}（省25%）· 相当于省下 3 个月`
      }
    } else if (isQuarterly) {
      chineseName = 'PRO 季付'
      desc = '季度进阶订阅，折算性价比更高。'
      footerNote = '单次开通即刻生效，到期不自动续费。'
      // 原价计算：3 个月 × 月付基准
      const origYuan = (baseMonthlyPriceCents * 3) / 100
      const currentYuan = p.priceCents / 100
      const savedYuan = Math.round(origYuan - currentYuan)
      if (savedYuan > 0) {
        originalPrice = origYuan
        savingsText = `立省 ¥${savedYuan}（省11%）`
      }
    } else if (isMonthly) {
      chineseName = 'PRO 月付'
      desc = '灵活按月订阅，随订随用，无续费压力。'
      footerNote = '单次开通即刻生效，到期不自动续费。'
    }

    let badge = ''
    let badgeClass = ''
    if (isCurrent) {
      badge = t('purchase.currentPlanBadge')
      badgeClass = 'badge-current'
    } else if (isRecommended) {
      badge = `${t('purchase.recommended')} · 省25%`
      badgeClass = 'badge-recommended'
    } else if (isQuarterly) {
      badge = '省11%'
      badgeClass = 'badge-discount'
    } else if (isTest) {
      badge = '测试'
      badgeClass = 'badge-test'
    }

    const f = p.features || {}
    const aiChars = f['ai.tokens.monthly'] ? `${Math.round((f['ai.tokens.monthly'] * 2) / 10000)} 万` : '40 万'

    const bullets: FeatureBullet[] = [
      {
        text: '视频内容智能解析与提取',
        sub: '支持 B站、YouTube、抖音等主流平台，自动提取标题/简介/字幕/评论中出现的工具与网站；受平台风控影响时可能降级，不承诺每次完整',
        highlight: true,
      },
      {
        text: '实验室：视频深度解析（实验性）',
        sub: '口播转写 + 画面网址；需安装「与链」浏览器扩展（仅桌面端），B站正式支持，抖音/小红书实验性且不保证可用；每日 2 次体验额度',
        highlight: false,
      },
      { text: 'AI 智能提取与自动补齐', sub: '自动抓取网页与正文，智能推荐分类并补齐摘要', highlight: true },
      { text: 'AI 自然语言模糊搜索', sub: '忘记标题也没关系，用日常口语意图精准找书签', highlight: true },
      { text: `每月 ${aiChars}字高阶 AI 额度`, sub: '畅享深度提炼、阅读问答与长文总结', highlight: true },
      { text: '全自动定期死链检测', sub: '每周后台静默巡检，失效链接一眼知晓' },
      { text: '不限设备多端加密同步', sub: '多台电脑、手机端实时加密协同，无设备上限', highlight: true },
    ]

    if (isYearly) {
      bullets.unshift({
        text: '全年立省 25% 优惠',
        sub: '折合仅 ¥9/月（每天不到 3 毛钱）',
        highlight: true,
      })
      bullets.push({
        text: '优先技术支持与新特性内测',
        sub: '专属反馈通道与最新 AI 特性优先体验',
        highlight: true,
      })
    }

    list.push({
      ...p,
      chineseName,
      desc,
      footerNote,
      isFree: false,
      isCurrent,
      isRecommended,
      badge,
      badgeClass,
      originalPrice,
      savingsText,
      periodLabel: isYearly ? '年' : isQuarterly ? '季' : isMonthly ? '月' : days(p.periodDays),
      perMonthText: perMonth(p),
      bullets,
    })
  }

  return list
})

/** 顶部周期筛选过滤后的卡片 */
const filteredCards = computed(() => {
  if (selectedCycle.value === 'all') return displayCards.value
  if (selectedCycle.value === 'monthly') {
    return displayCards.value.filter((c) => c.isFree || c.periodDays === 30)
  }
  if (selectedCycle.value === 'quarterly') {
    return displayCards.value.filter((c) => c.isFree || (c.periodDays >= 80 && c.periodDays <= 120))
  }
  if (selectedCycle.value === 'yearly') {
    return displayCards.value.filter((c) => c.isFree || c.periodDays >= 365)
  }
  return displayCards.value
})

/** 当前正在结算的套餐 */
const activePlan = computed(() => {
  return displayCards.value.find((c) => c.planId === selectedPlan.value) || displayCards.value.find((c) => !c.isFree)
})

function getCardButtonLabel(p: TierCardView): string {
  if (p.isFree) {
    return isCurrentFree.value ? t('purchase.current') : (t('purchase.freeTierTitle') || '体验套餐')
  }
  // 只有当前用户已经购买了该套餐，才显示「续费」；否则一律显示「升级」
  if (props.currentPlanId === p.planId) {
    return t('purchase.renew') || '续费'
  }
  return t('purchase.upgrade') || '升级'
}

function onSelectCycleTab(cycle: 'monthly' | 'quarterly' | 'yearly') {
  selectedCycle.value = cycle
  const match = displayCards.value.find((c) => {
    if (cycle === 'monthly') return c.periodDays === 30
    if (cycle === 'quarterly') return c.periodDays >= 80 && c.periodDays <= 120
    if (cycle === 'yearly') return c.periodDays >= 365
    return false
  })
  if (match) selectedPlan.value = match.planId
}

function onCardClick(card: TierCardView) {
  if (!card.isFree) {
    selectedPlan.value = card.planId
  }
}

async function onCardSubscribe(card: TierCardView) {
  if (card.isFree) return
  selectedPlan.value = card.planId
  stage.value = 'paying'
  await submit()
}

/** 对比表列：免费 + 付费（按价格升序） */
const compareCols = computed(() =>
  plans.value.map((p) => ({ id: p.planId, name: p.name, features: p.features || {} })),
)

/** feature 分组 */
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

/** 分 → ¥（仅展示） */
function yen(cents: number): string {
  return `¥${(cents / 100).toFixed(2).replace(/\.00$/, '')}`
}
function days(d: number): string {
  if (!d) return '永久'
  return d % 365 === 0 ? `${d / 365} 年` : d % 30 === 0 ? `${d / 30} 个月` : `${d} 天`
}
function perMonth(p: PlanRow): string {
  if (!p.periodDays) return ''
  // 月付（约 30 天周期）原价本来就是按月计费，不需要重复显示「折合 ¥12/月」
  if (p.periodDays >= 25 && p.periodDays <= 35) return ''
  const perMonthCents = Math.round((p.priceCents / p.periodDays) * 30)
  return t('purchase.perMonth', { price: yen(perMonthCents) })
}

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
  if (plans.value.length === 0) {
    loadingPlans.value = true
  }
  try {
    const list = await fetchPurchasePlans()
    if (Array.isArray(list) && list.length > 0) {
      plans.value = list
      applyPlanSelection(list)
    }
  } finally {
    loadingPlans.value = false
  }
}

async function submit() {
  qrDataUrl.value = ''
  stopCountdown()
  const o = await pay.create(selectedPlan.value, selectedChannel.value)
  if (!o?.qrCode) {
    if (pay.error.value) {
      if (pay.error.value === 'channel_not_configured') {
        toast(t('purchase.notOpen') || '该支付方式暂未开通', false)
      } else if (pay.error.value === 'unauthorized') {
        toast(t('purchase.error.unauthorized') || '请先登录后再购买', false)
        authStore.authModalOpen = true
      } else {
        toast(t(`purchase.error.${pay.error.value}`) || '订单创建失败，请重试', false)
      }
    }
    return
  }
  qrDataUrl.value = await QRCode.toDataURL(o.qrCode, { width: 480, margin: 1 })
  startCountdown(o.expiresAt || '')
  pay.startPolling(() => {
    stage.value = 'done'
    stopCountdown()
    emit('paid')
  })
}

async function enableDemoPay() {
  qrDataUrl.value = ''
  stopCountdown()
  const mockQr = `https://ulink.ren/pay/test?channel=${selectedChannel.value}&plan=${selectedPlan.value}&t=${Date.now()}`
  qrDataUrl.value = await QRCode.toDataURL(mockQr, { width: 480, margin: 1 })
  startCountdown(new Date(Date.now() + 30 * 60000).toISOString())
}

async function onChangeChannelWhilePaying(channel: PaymentChannel) {
  if (selectedChannel.value === channel) return
  selectedChannel.value = channel
  if (qrDataUrl.value && pay.error.value) {
    await enableDemoPay()
    return
  }
  await submit()
}

function startCountdown(expiresAt: string) {
  stopCountdown()
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
/* ── 遮罩层（使用设计令牌，适应多主题） ── */
.pur-mask {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay, rgba(0, 0, 0, 0.65)) !important;
  backdrop-filter: blur(8px) !important;
  z-index: var(--z-modal, 6000);
  padding: 24px;
}

/* ── 宽屏模态框（极简克制，覆盖全局 .modal 的 max-width: 500px） ── */
.modal.pur-modal,
.pur-modal {
  position: relative;
  width: min(940px, calc(100vw - 32px)) !important;
  max-width: min(940px, calc(100vw - 32px)) !important;
  min-width: min(940px, calc(100vw - 32px)) !important;
  max-height: min(92vh, 880px) !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: hidden !important;
  background: var(--surface) !important;
  border: 1px solid var(--border) !important;
  border-radius: var(--radius-lg, 14px) !important;
  box-shadow: var(--shadow-xl) !important;
  color: var(--text) !important;
}

/* 顶部导航区 */
.pur-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.pur-head-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pur-title {
  margin: 0;
  font-size: var(--fs-lg, 1.1rem);
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}
.pur-subtitle {
  margin: 0;
  font-size: var(--fs-xs, 0.75rem);
  color: var(--text-secondary);
}

.pur-head-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* 顶部周期切换胶囊（极简克制分段控制器） */
.pur-cycle-tabs {
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-alt);
  border: 1px solid var(--border);
}
.pur-cycle-tab {
  padding: 5px 13px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 500;
  border-radius: var(--radius-xs, 4px);
  cursor: pointer;
  transition: var(--transition-fast);
  white-space: nowrap;
}
.pur-cycle-tab:hover {
  color: var(--text);
}
.pur-cycle-tab.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow-xs);
  font-weight: 600;
}
.pur-cycle-tab-recommended.active {
  color: var(--accent);
}

.pur-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-alt);
  color: var(--text-secondary);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  transition: var(--transition-fast);
}
.pur-close:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.pur-body {
  padding: 24px 28px 28px;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
}
.pur-hint,
.pur-empty {
  padding: 80px 0;
  text-align: center;
  font-size: var(--fs-base, 0.875rem);
  color: var(--text-muted);
}

/* ── 核心格局：极简克制横向并列卡片网格（双卡片居中展示） ── */
.pur-cards-grid {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 420px)) !important;
  justify-content: center !important;
  gap: 20px !important;
  align-items: stretch !important;
  width: 100% !important;
  margin: 0 auto !important;
}

.pur-tier-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 22px 20px 20px;
  border-radius: var(--radius-md, 10px);
  background: var(--bg-card, var(--surface));
  border: 1px solid var(--border);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  cursor: pointer;
  min-height: 480px;
}
.pur-tier-card:hover {
  border-color: var(--border-hover);
}

/* 选中高亮态（微描边，绝无浮夸光晕） */
.pur-tier-card.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

/* 推荐档（年付，使用站点品牌强调色） */
.pur-tier-card.is-recommended {
  border-color: var(--accent);
}

/* 卡片顶部中文名称与徽章 */
.pur-card-header {
  margin-bottom: 16px;
}
.pur-tier-name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
}
.pur-tier-name {
  font-size: var(--fs-md, 0.95rem);
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
}
.pur-tier-badge {
  padding: 2px 7px;
  border-radius: var(--radius-full);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.pur-tier-badge.badge-recommended {
  background: var(--accent-light);
  border: 1px solid var(--accent);
  color: var(--accent);
}
.pur-tier-badge.badge-discount {
  background: var(--accent-light);
  border: 1px solid var(--accent);
  color: var(--accent);
}
.pur-tier-badge.badge-current {
  background: var(--bg-alt);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.pur-tier-badge.badge-test {
  background: var(--accent-light);
  color: var(--accent);
}
.pur-tier-desc {
  margin: 6px 0 0;
  font-size: var(--fs-xs, 0.75rem);
  color: var(--text-secondary);
  line-height: 1.45;
  min-height: 34px;
}

/* ── 行动按钮（CTA 位于价格上方，未购显示「升级」，已购显示「续费」） ── */
.pur-card-cta {
  margin-bottom: 18px;
}
.pur-card-btn {
  width: 100%;
  height: 38px;
  border-radius: var(--radius-sm, 6px);
  font: inherit;
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition-fast);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.02em;
}
.pur-card-btn:active {
  transform: scale(0.99);
}

/* 升级按钮：使用站点品牌主色 */
.btn-primary-tier {
  border: 1px solid transparent;
  background: var(--accent);
  color: var(--text-on-accent, #ffffff);
}
.btn-primary-tier:hover {
  background: var(--accent-hover, var(--accent-dark));
  filter: brightness(1.08);
}
.btn-primary-tier:active {
  filter: brightness(0.95);
}

/* 续费按钮：已购套餐显示续费 */
.btn-renew-tier {
  border: 1px solid transparent;
  background: var(--accent);
  color: var(--text-on-accent, #ffffff);
}
.btn-renew-tier:hover {
  background: var(--accent-hover, var(--accent-dark));
  filter: brightness(1.08);
}

/* 当前方案按钮（免费版用户禁用态） */
.btn-current-tier {
  border: 1px solid var(--border);
  background: var(--surface-hover);
  color: var(--text-muted);
  cursor: default;
}

/* 免费版降级或未选按钮 */
.btn-free-downgrade {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-secondary);
  cursor: default;
}

/* ── 价格区域（紧随行动按钮下方） ── */
.pur-card-pricing {
  margin-bottom: 16px;
}
.pur-from-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 2px;
}
.pur-price-main {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.pur-amount-num {
  font-size: 1.65rem;
  font-weight: 700;
  line-height: 1.1;
  color: var(--text);
  letter-spacing: -0.02em;
}
.pur-period-tag {
  font-size: var(--fs-xs, 0.75rem);
  color: var(--text-muted);
}
/* 原价划掉样式 */
.pur-original-price {
  font-size: var(--fs-sm, 0.82rem);
  color: var(--text-muted);
  text-decoration: line-through;
  margin-left: 6px;
  font-weight: 500;
}
/* 立省标签 */
.pur-savings-row {
  margin-top: 4px;
  min-height: 20px;
  display: flex;
  align-items: center;
}
.pur-savings-tag {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: var(--accent-light);
  padding: 2px 7px;
  border-radius: var(--radius-xs, 4px);
}

.pur-price-sub {
  margin-top: 3px;
  min-height: 16px;
}
.pur-sub-unit {
  font-size: 11px;
  color: var(--text-muted);
}
.pur-sub-unit-empty {
  visibility: hidden;
}

.pur-card-divider {
  height: 1px;
  background: var(--border-light);
  margin-bottom: 16px;
}

/* ── 特性清单标题与项目（站点主题色勾号） ── */
.pur-features-heading {
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.pur-card-features {
  display: flex;
  flex-direction: column;
  gap: 11px;
  margin-bottom: 20px;
  flex: 1; /* 吸底对齐底注 */
}
.pur-feature-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.pur-check-mark {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--accent);
  flex-shrink: 0;
}
.pur-feature-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pur-feature-text {
  font-size: var(--fs-xs, 0.75rem);
  line-height: 1.4;
  color: var(--text);
}
.pur-feature-text.is-bold {
  font-weight: 600;
}
.pur-feature-sub {
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-muted);
}

/* 卡片底注微文字 */
.pur-card-footer-note {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border-light);
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* ── 完整参数对比折叠区 ── */
.pur-compare-toggle-wrapper {
  margin-top: 20px;
}
.pur-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s ease;
  margin-bottom: 12px;
}
.pur-toggle-btn:hover {
  color: var(--text);
}
.pur-toggle-arrow {
  display: inline-block;
  transition: transform 0.2s ease;
}
.pur-toggle-arrow.open {
  transform: rotate(180deg);
}

.pur-compare {
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  overflow: hidden;
  font-size: var(--fs-xs, 0.75rem);
  background: var(--surface);
}
.pur-compare-head,
.pur-compare-row {
  display: grid;
  grid-template-columns: 1.5fr repeat(v-bind(compareCols.length), 1fr);
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
}
.pur-compare-head {
  background: var(--bg-alt);
  font-weight: 600;
  color: var(--text);
}
.pur-compare-col {
  text-align: center;
}
.pur-compare-col.current {
  color: var(--accent);
}
.pur-compare-group {
  padding: 10px 14px 4px;
  font-size: var(--fs-2xs, 0.72rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pur-compare-row {
  border-top: 1px solid var(--border-light);
}
.pur-compare-label {
  color: var(--text-secondary);
}
.pur-compare-val {
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.pur-compare-val.current {
  color: var(--accent);
  font-weight: 600;
}
.pur-compare-val.off {
  color: var(--text-muted);
}
.pur-compare-gap {
  height: 4px;
}

.pur-note {
  margin: 12px 0 0;
  font-size: var(--fs-xs, 0.75rem);
  line-height: 1.5;
}
.pur-note-warn {
  color: var(--amber, #d97706);
}
.pur-note-error {
  color: var(--danger, #ef4444);
}

/* ── Supabase 风格独立 2-Column 结算支付弹层 ── */
.pur-checkout-overlay {
  position: absolute;
  inset: 0;
  background: var(--overlay, rgba(0, 0, 0, 0.65));
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 20px;
}

.pur-checkout-dialog {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  width: min(860px, calc(100vw - 40px));
  max-height: min(90vh, 680px);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 14px);
  box-shadow: 0 20px 48px -12px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.05);
  overflow: hidden;
  animation: purScaleIn 0.2s var(--ease-out);
}

@keyframes purScaleIn {
  from {
    transform: scale(0.96);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* 左侧：支付方式与扫码区域 */
.pur-checkout-left {
  padding: 28px 24px 28px 28px;
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.pur-co-title {
  margin: 0;
  font-size: var(--fs-md, 0.95rem);
  font-weight: 700;
  color: var(--text);
}
.pur-co-subtitle {
  margin: 4px 0 16px;
  font-size: var(--fs-xs, 0.75rem);
  color: var(--text-secondary);
}

/* 支付渠道切换标签（iOS / Linear 风格连体胶囊，消除碎杂色块） */
.pur-channels-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 3px;
  margin-bottom: 16px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm, 8px);
}
.pur-channel-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: calc(var(--radius-sm, 8px) - 2px);
  font: inherit;
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.pur-channel-tab:hover {
  color: var(--text);
}
.pur-channel-tab.active {
  background: var(--surface);
  color: var(--accent);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.pur-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--border);
  transition: background 0.15s ease;
}
.pur-channel-tab.active .pur-tab-dot {
  background: var(--accent);
}

/* 二维码容器 */
.pur-qr-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin: 4px 0 16px;
}
.pur-qr-frame {
  width: 190px;
  height: 190px;
  padding: 8px;
  border-radius: var(--radius-sm, 8px);
  background: #ffffff;
  border: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.pur-qr-frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.pur-qr-loading {
  font-size: var(--fs-xs, 0.75rem);
  color: var(--text-muted);
}
.pur-qr-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px;
  text-align: center;
  height: 100%;
  width: 100%;
}
.pur-qr-state .pur-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: pur-spin 0.8s linear infinite;
  margin-bottom: 8px;
}
@keyframes pur-spin {
  to { transform: rotate(360deg); }
}
.pur-qr-state-text {
  margin: 0;
  font-size: var(--fs-xs, 0.75rem);
  color: var(--text-muted);
}
.pur-state-icon {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 6px;
  background: var(--surface-hover);
  color: var(--text-muted);
  border: 1px solid var(--border-light);
}
.pur-state-icon.pur-state-warn {
  background: var(--accent-light);
  color: var(--accent);
  border-color: var(--accent);
}
.pur-state-title {
  margin: 0 0 4px;
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 600;
  color: var(--text);
  line-height: 1.4;
}
.pur-state-desc {
  margin: 0 0 8px;
  font-size: var(--fs-2xs, 0.7rem);
  color: var(--text-muted);
  line-height: 1.3;
}
.pur-btn-retry {
  padding: 5px 12px;
  font-size: var(--fs-2xs, 0.72rem);
  border-radius: var(--radius-sm, 6px);
  background: var(--accent);
  color: #fff;
  border: none;
  cursor: pointer;
  font-weight: 500;
  transition: opacity 0.15s ease;
}
.pur-btn-retry:hover {
  opacity: 0.9;
}
.pur-network-hint {
  font-size: 11px !important;
  line-height: 1.35 !important;
  color: var(--text-muted) !important;
  max-width: 175px !important;
  margin: 0 0 10px !important;
}
.pur-state-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
}
.pur-btn-demo {
  padding: 5px 10px;
  font-size: var(--fs-2xs, 0.72rem);
  border-radius: var(--radius-sm, 6px);
  background: var(--surface);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  cursor: pointer;
  font-weight: 500;
  transition: var(--transition-fast);
}
.pur-btn-demo:hover {
  background: var(--surface-hover);
  color: var(--accent);
  border-color: var(--accent);
}
.pur-scan-tip {
  margin: 10px 0 4px;
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 600;
  color: var(--text);
}
.pur-countdown-tip {
  margin: 0;
  font-size: var(--fs-2xs, 0.72rem);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* 订单明细小卡（轻盈通透，杜绝大黄块） */
.pur-order-summary {
  margin-top: auto;
  padding: 12px 14px;
  border-radius: var(--radius-sm, 8px);
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pur-summary-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.pur-summary-label {
  font-size: var(--fs-xs, 0.75rem);
  color: var(--text-secondary);
}
.pur-summary-price {
  font-size: var(--fs-lg, 1.1rem);
  font-weight: 700;
  color: var(--accent);
}
.pur-summary-row.sub {
  font-size: var(--fs-2xs, 0.72rem);
  color: var(--text-muted);
}
.pur-summary-val {
  font-weight: 500;
}

.pur-checkout-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.pur-btn-ghost {
  flex: 1;
  min-height: 36px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm, 8px);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition-fast);
}
.pur-btn-ghost:hover {
  background: var(--surface-hover);
  color: var(--text);
  border-color: var(--border);
}

/* 右侧：升级详情与特权清单（Supabase 纯净一体化，底色与左侧完全同色） */
.pur-checkout-right {
  position: relative;
  padding: 28px 28px 28px 24px;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.pur-co-close {
  position: absolute;
  top: 18px;
  right: 18px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-muted);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  transition: var(--transition-fast);
}
.pur-co-close:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.pur-plan-intro {
  margin-bottom: 20px;
  padding-right: 28px;
}
.pur-intro-title {
  margin: 0;
  font-size: var(--fs-md, 0.95rem);
  font-weight: 700;
  color: var(--text);
}
.pur-intro-desc {
  margin: 6px 0 0;
  font-size: var(--fs-xs, 0.75rem);
  color: var(--text-secondary);
  line-height: 1.45;
}

.pur-features-box {
  flex: 1;
  margin-bottom: 16px;
}
.pur-features-title {
  font-size: var(--fs-xs, 0.75rem);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.pur-features-checklist {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pur-chk-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.pur-chk-icon {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent);
  flex-shrink: 0;
  line-height: 1.35;
}
.pur-chk-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.pur-chk-text {
  font-size: var(--fs-xs, 0.75rem);
  line-height: 1.4;
  color: var(--text);
}
.pur-chk-text.is-bold {
  font-weight: 600;
}
.pur-chk-sub {
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-muted);
}

.pur-checkout-footnote {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* ── 支付成功 ── */
.pur-done {
  text-align: center;
  padding: 60px 20px;
}
.pur-done-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: var(--accent-light);
  color: var(--accent);
  font-size: 1.75rem;
  font-weight: 700;
}
.pur-done h4 {
  margin: 0 0 8px;
  font-size: var(--fs-lg, 1.1rem);
  font-weight: 700;
  color: var(--text);
}
.pur-done p {
  margin: 0 0 24px;
  font-size: var(--fs-sm, 0.82rem);
  color: var(--text-secondary);
}
.pur-primary {
  padding: 8px 32px;
  min-height: 38px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: var(--accent);
  color: var(--text-on-accent, #ffffff);
  font: inherit;
  font-weight: 600;
  font-size: var(--fs-xs, 0.75rem);
  cursor: pointer;
}
.pur-primary:hover {
  background: var(--accent-hover, var(--accent-dark));
  filter: brightness(1.08);
}

/* ── 响应式适配 ── */
@media (max-width: 820px) {
  .pur-head {
    flex-wrap: wrap;
    gap: 12px;
  }
  .pur-cycle-tabs {
    order: 3;
    width: 100%;
    justify-content: center;
  }
}

@media (max-width: 720px) {
  .pur-cards-grid {
    grid-template-columns: 1fr !important;
    gap: 14px !important;
  }
  .pur-checkout-dialog {
    grid-template-columns: 1fr;
    max-height: 92vh;
  }
  .pur-checkout-left {
    border-right: none;
    border-bottom: 1px solid var(--border-light);
    padding: 20px;
  }
  .pur-checkout-right {
    padding: 20px;
  }
}

@media (max-width: 640px) {
  .pur-mask {
    align-items: flex-end;
    padding: 0;
  }
  .modal.pur-modal,
  .pur-modal {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 100% !important;
    max-height: 92vh !important;
    border-radius: var(--radius-lg, 14px) var(--radius-lg, 14px) 0 0 !important;
  }
  .pur-head {
    padding: 16px 20px 12px;
  }
  .pur-body {
    padding: 16px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  }
  .pur-cards-grid {
    grid-template-columns: 1fr !important;
    gap: 14px;
  }
}

/* 弹层淡入动画 */
.pur-fade-enter-active,
.pur-fade-leave-active {
  transition: opacity 0.2s ease;
}
.pur-fade-enter-from,
.pur-fade-leave-to {
  opacity: 0;
}
</style>
