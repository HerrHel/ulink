<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="uiStore.panels.settings"
        class="settings-modal-wrap settings-drawer-wrap"
        role="dialog"
        aria-modal="true"
        :aria-label="t('settings.title')"
        @mousedown="onMaskMouseDown" @click="onMaskClick" @keydown.esc="uiStore.panels.settings = false"
      >
        <div class="settings-dialog settings-drawer" data-testid="lv-settings-drawer" @click.stop>
          <!-- 弹窗顶栏 -->
          <div class="settings-dialog-head settings-drawer-head">
            <div class="settings-dialog-title-row">
              <!-- 移动端返回按钮：处于子页面时显示返回上一级 -->
              <button
                v-if="uiStore.isMobile && mobileSubPage"
                type="button"
                class="sp-mobile-back-btn"
                data-testid="sp-mobile-back-btn"
                @click.stop="onBackToMobileMenu"
                :aria-label="t('common.back')"
              >
                <span class="sp-mobile-back-icon" aria-hidden="true" v-html="I.back"></span>
                <span class="sp-mobile-back-text">{{ t('settings.title') }}</span>
              </button>

              <span v-if="!uiStore.isMobile || !mobileSubPage" class="settings-dialog-icon" aria-hidden="true" v-html="I.settings"></span>
              <h2 class="settings-dialog-title settings-drawer-title">
                {{ uiStore.isMobile && mobileSubPage ? currentMobileTabTitle : t('settings.title') }}
              </h2>
            </div>
            <div class="settings-dialog-actions">
              <button class="sp-help-btn" @click.stop="onOpenShortcutHelp" :aria-label="t('settings.shortcutHelp')" :title="t('settings.shortcutHelp')">?</button>
              <button class="modal-close" @click="uiStore.panels.settings = false" :aria-label="t('settings.closeSettings')">&times;</button>
            </div>
          </div>

          <!-- 弹窗主体：左侧分类导航 + 右侧设置内容 -->
          <div class="settings-dialog-body settings-drawer-body">
            <!-- 左侧导航选项卡（无 emoji） -->
            <!-- 移动端专属主菜单视图（仅在移动端且未进入子页面时渲染） -->
            <div v-if="uiStore.isMobile && !mobileSubPage" class="sp-mobile-menu" data-testid="sp-mobile-menu">
              <!-- 顶部用户卡片 -->
              <div class="sp-mobile-user-card" data-testid="sp-mobile-user-card" @click="onSelectMobileTab('account')">
                <div class="sp-mobile-user-avatar">
                  <span v-if="auth.avatar" class="sp-user-emoji">{{ auth.avatar }}</span>
                  <span v-else-if="auth.isLoggedIn" class="sp-user-initial">{{ userInitial }}</span>
                  <span v-else class="sp-mobile-cloud-icon" aria-hidden="true" v-html="I.user"></span>
                </div>
                <div class="sp-mobile-user-info">
                  <div class="sp-mobile-user-name">
                    {{ auth.isLoggedIn ? (auth.displayName || userDisplay) : t('nav.loginTitle') }}
                  </div>
                  <div class="sp-mobile-user-sub">
                    <span v-if="auth.isLoggedIn" class="sp-sync-dot-inline" :class="syncState.dotClass"></span>
                    {{ auth.isLoggedIn ? (auth.userEmail || syncState.label) : t('nav.loginSubtitle') }}
                  </div>
                </div>
                <span class="sp-mobile-arrow" aria-hidden="true" v-html="I.chevron"></span>
              </div>

              <!-- 分组导航菜单 -->
              <div v-for="grp in tabGroups" :key="grp.key" class="sp-mobile-group">
                <div class="sp-mobile-group-title">{{ t(grp.titleKey) }}</div>
                <div class="sp-mobile-group-card">
                  <button
                    v-for="tab in grp.tabs"
                    :key="tab.id"
                    type="button"
                    class="sp-mobile-menu-item"
                    :data-testid="'mobile-tab-' + tab.id"
                    @click="onSelectMobileTab(tab.id)"
                  >
                    <span class="sp-m-icon" aria-hidden="true" v-html="tab.icon"></span>
                    <div class="sp-m-info">
                      <span class="sp-m-title">{{ t(tab.labelKey) }}</span>
                      <span class="sp-m-desc">{{ getTabDesc(tab.id) }}</span>
                    </div>
                    <span v-if="tab.badge" class="sp-m-badge">{{ tab.badge }}</span>
                    <span class="sp-m-arrow" aria-hidden="true" v-html="I.chevron"></span>
                  </button>
                </div>
              </div>
            </div>

            <!-- PC 端左侧导航（移动端隐藏） -->
            <nav v-show="!uiStore.isMobile" class="settings-nav" aria-label="Settings navigation">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                type="button"
                class="settings-nav-item"
                :class="{ active: currentTab === tab.id }"
                :data-testid="'settings-tab-' + tab.id"
                @click="currentTab = tab.id"
              >
                <span class="nav-item-icon" aria-hidden="true" v-html="tab.icon"></span>
                <span class="nav-item-label">{{ t(tab.labelKey) }}</span>
                <span v-if="tab.badge" class="nav-item-badge">{{ tab.badge }}</span>
              </button>
            </nav>

            <!-- 右侧设置内容主视窗 -->
            <div v-show="!uiStore.isMobile || mobileSubPage" class="settings-content-pane">
              <!-- 账号与会员：账号/同步/加密 + 会员/额度/兑换码/交易 -->
              <SettingsAccountTab v-show="currentTab === 'account'" />
              <SettingsBillingTab v-show="currentTab === 'account'" />
              <!-- 外观与视图 -->
              <SettingsAppearanceTab v-show="currentTab === 'appearance'" />
              <!-- AI 与智能 -->
              <SettingsAiTab v-show="currentTab === 'ai'" />
              <!-- 数据与维护：存储/备份/导入导出 + 死链检测/公开分享 -->
              <SettingsDataTab v-show="currentTab === 'data'" />
              <SettingsMaintenanceTab v-show="currentTab === 'data'" />
              <!-- 关于与帮助 -->
              <SettingsAboutTab v-show="currentTab === 'about'" />
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <SettingsFeedbackModal />
  <!-- 购买弹窗：挂在最外层，避免被 drawer 的 overflow 裁切 -->
  <PurchaseModal :visible="showPurchase" :current-plan-id="entitlement.planId" @close="showPurchase = false" @paid="onPurchasePaid" />
</template>

<script setup lang="ts">
/**
 * SettingsPanel — 设置抽屉外壳：顶栏、PC 侧栏导航 / 移动端菜单、7 个标签页容器、购买与反馈弹窗。
 * 各标签页内容拆在 ./settings/Settings*Tab.vue；跨页共享的实例与状态（同步、死链、权益、
 * 交易、公开分享统计等）只在此创建一次，经 settingsContext 注入（见该文件说明）。
 * 面板打开 / 切页 / 登录态变化时的数据刷新也集中在此。
 */
import { computed, nextTick, onMounted, ref, watch, defineAsyncComponent } from 'vue'
import { useMaskClose } from '../../composables/ui/useMaskClose.js'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import { I } from '../../config/icons.js'
import { fetchUserCategoryShares } from '../../composables/domain/useDataShare.js'
import { SHARE_BASE } from '../../config/urls.js'
import { CATEGORY_SHARE_PATH } from '../../composables/domain/syncShare.js'
import { dbRpc } from '../../lib/dbApi.js'
import { useEntitlement } from '../../composables/domain/useEntitlement.js'
import { useTransactions } from '../../composables/domain/useTransactions.js'
import { t } from '../../i18n/index.js'
import SettingsAccountTab from './settings/SettingsAccountTab.vue'
import SettingsAppearanceTab from './settings/SettingsAppearanceTab.vue'
import SettingsBillingTab from './settings/SettingsBillingTab.vue'
import SettingsAiTab from './settings/SettingsAiTab.vue'
import SettingsMaintenanceTab from './settings/SettingsMaintenanceTab.vue'
import SettingsDataTab from './settings/SettingsDataTab.vue'
import SettingsAboutTab from './settings/SettingsAboutTab.vue'
import SettingsFeedbackModal from './settings/SettingsFeedbackModal.vue'
import { provideSettingsContext, type SettingsTab, type PublicShareItem } from './settings/settingsContext.js'

// 异步组件：常驻挂载语义不变，但代码在首屏渲染后再拉取，不进首屏包
const PurchaseModal = defineAsyncComponent(() => import('../modals/PurchaseModal.vue'))


const currentTab = ref<SettingsTab>('account')

const mobileSubPage = computed<SettingsTab | null>({
  get: () => uiStore.settingsMobileSubPage as SettingsTab | null,
  set: (val) => { uiStore.settingsMobileSubPage = val },
})

const currentMobileTabTitle = computed(() => {
  if (!mobileSubPage.value) return t('settings.title')
  const matched = tabs.value.find(tab => tab.id === mobileSubPage.value)
  return matched ? t(matched.labelKey) : t('settings.title')
})

function onSelectMobileTab(id: SettingsTab) {
  currentTab.value = id
  mobileSubPage.value = id
  pushNavState()
  nextTick(() => {
    const pane = document.querySelector('.settings-content-pane')
    if (pane) pane.scrollTop = 0
  })
}

function onBackToMobileMenu() {
  mobileSubPage.value = null
}

function getTabDesc(id: SettingsTab) {
  return t('settings.tabNavDesc' + id.charAt(0).toUpperCase() + id.slice(1))
}

const tabGroups = computed(() => [
  {
    key: 'account',
    titleKey: 'settings.navGroupAccount',
    tabs: tabs.value.filter(t => t.group === 'account'),
  },
  {
    key: 'system',
    titleKey: 'settings.navGroupSystem',
    tabs: tabs.value.filter(t => t.group === 'system'),
  },
])

/** 旧标签 id 兼容：会员并入「账号」、维护并入「数据」（外部仍可能传入旧 id） */
function normalizeTab(id: string): SettingsTab {
  if (id === 'billing') return 'account'
  if (id === 'maintenance') return 'data'
  return id as SettingsTab
}

// 用户交易明细与记录
const {
  transactions,
  loading: loadingTx,
  total: totalTx,
  page: txPage,
  pageSize: txPageSize,
  hasPrev: hasPrevTx,
  hasNext: hasNextTx,
  fetchTransactions,
  nextPage: nextTxPage,
  prevPage: prevTxPage,
  formatTxTime,
} = useTransactions()

function onOpenShortcutHelp() { pushNavState(); uiStore.panels.shortcutHelp = true; uiStore.panels.settings = false }

const uiStore = useUIStore()

const { onMaskMouseDown, onMaskClick } = useMaskClose(() => {
  uiStore.panels.settings = false
})

const dataStore = useDataStore()

const auth = useAuth()

const sync = useCloudSync()

const syncState = useSyncState()

const dl = useDeadLinkChecker()

const e2e = useE2E()

const userInitial = computed(() => {
  const name = auth.displayName || auth.userEmail
  if (!name) return 'U'
  return name.charAt(0).toUpperCase()
})

const userDisplay = computed(() => {
  if (!auth.userEmail) return ''
  return auth.userEmail.split('@')[0]
})

// 会员权益与兑换码
const entService = useEntitlement()

const entitlement = entService.entitlement

/** 本月 AI 用量（设置面板进度条；enforce 门控的数据源同一 RPC） */
const aiQuota = ref<{ used: number; limit: number } | null>(null)

async function loadAiQuota(): Promise<void> {
  const uid = (auth as { user?: { id?: string } }).user?.id
  if (!auth.isLoggedIn || !uid) {
    aiQuota.value = null
    return
  }
  try {
    const { data, error } = await dbRpc('ai_quota_check', { p_uid: uid })
    if (error || !data) return
    const d = data as { used_tokens?: number; limit_tokens?: number }
    aiQuota.value = {
      used: Math.round(Number(d.used_tokens) || 0),
      limit: Math.round(Number(d.limit_tokens) || 0),
    }
  } catch {
    /* 静默：进度条只是信息展示，不影响主流程 */
  }
}

/** 购买弹窗开关 */
const showPurchase = ref(false)

/** 支付成功后刷新权益（后端发货已幂等，这里只负责把最新权益拉回来） */
async function onPurchasePaid() {
  try {
    await entService.refresh()
    void loadAiQuota()
    void fetchTransactions(1)
  } catch {
    /* 刷新失败不影响支付结果本身，下次打开设置会重新拉 */
  }
  void loadAiQuota()
}

async function refreshEntitlement() {
  if (!auth.isLoggedIn) {
    entService.clear()
    await dl.refreshAutoCheckAllowed(entitlement.value)
    return
  }
  await entService.refresh()
  // 权益变化会影响「自动全量检测」是否可用（Plus 专属）
  await dl.refreshAutoCheckAllowed(entitlement.value)
}

// 权益随登录态刷新（必须声明在 entitlement / refreshEntitlement 之后：
// immediate 回调会同步执行，否则会撞上暂时性死区）
watch(
  () => auth.isLoggedIn,
  () => {
    void refreshEntitlement()
  },
  { immediate: true },
)

const deadCount = computed(() => dl.deadCount.value)

const blockedCount = computed(() => dl.blockedCount.value)

// 抽屉展开时确保深浅主题与当前实际 DOM 保持同步
watch(() => uiStore.panels.settings, (open) => {
  if (open) uiStore.syncThemeFromDOM()
})

onMounted(() => { e2e.checkE2EStatus() })

// ── 公开分享管理（列表在维护页，统计用于导航角标）──

const userCategoryShares = ref<Array<{ id: string; category_id: string }>>([])

const loadingCategoryShares = ref(false)

async function loadUserCategoryShares() {
  if (!auth.isLoggedIn || !navigator.onLine) {
    userCategoryShares.value = []
    return
  }
  loadingCategoryShares.value = true
  try {
    userCategoryShares.value = await fetchUserCategoryShares()
  } catch {
    userCategoryShares.value = []
  } finally {
    loadingCategoryShares.value = false
  }
}

watch(() => uiStore.panels.settings, (open) => {
  if (open) {
    if (uiStore.settingsInitialTab) {
      currentTab.value = normalizeTab(uiStore.settingsInitialTab)
      mobileSubPage.value = currentTab.value
      uiStore.settingsInitialTab = ''
    } else {
      mobileSubPage.value = null
    }
    loadUserCategoryShares()
    if (auth.isLoggedIn) {
      void refreshEntitlement()
      if (currentTab.value === 'account') {
        void fetchTransactions()
        void loadAiQuota()
      }
    }
  } else {
    mobileSubPage.value = null
  }
})

watch(() => currentTab.value, (tab) => {
  if (tab === 'account' && uiStore.panels.settings && auth.isLoggedIn) {
    void fetchTransactions()
    void refreshEntitlement()
    void loadAiQuota()
  }
})

watch(() => auth.isLoggedIn, (logged) => {
  if (logged && uiStore.panels.settings) {
    loadUserCategoryShares()
  }
})

if (uiStore.panels.settings) {
  if (uiStore.settingsInitialTab) {
    currentTab.value = normalizeTab(uiStore.settingsInitialTab)
    mobileSubPage.value = currentTab.value
    uiStore.settingsInitialTab = ''
  }
  loadUserCategoryShares()
}

const publicGroupItems = computed<PublicShareItem[]>(() => {
  return dataStore.siblingGroups
    .filter(g => g.isPublic && !g.deletedAt)
    .map(g => ({
      type: 'group' as const,
      id: g.id,
      title: g.name || t('cards.unnamedGroup'),
      icon: g.icon,
      url: `${SHARE_BASE}/${g.id}`,
    }))
})

const publicCategoryItems = computed<PublicShareItem[]>(() => {
  return userCategoryShares.value.map(c => {
    const cat = dataStore.categoryMap[c.category_id]
    return {
      type: 'category' as const,
      id: c.category_id,
      shareId: c.id,
      title: cat?.name || c.id,
      icon: cat?.icon,
      color: cat?.color,
      url: `${SHARE_BASE}/${CATEGORY_SHARE_PATH}/${c.id}`,
    }
  })
})

const allPublicShares = computed<PublicShareItem[]>(() => [
  ...publicGroupItems.value,
  ...publicCategoryItems.value,
])

const tabs = computed(() => [
  {
    id: 'account' as SettingsTab,
    labelKey: 'settings.tabAccount',
    icon: I.user,
    badge: syncState.value?.level === 'error' ? '!' : undefined,
    group: 'account',
  },
  {
    id: 'appearance' as SettingsTab,
    labelKey: 'settings.tabAppearance',
    icon: I.sun,
    group: 'account',
  },
  {
    id: 'ai' as SettingsTab,
    labelKey: 'settings.tabAi',
    icon: I.sparkles,
    group: 'account',
  },
  {
    id: 'data' as SettingsTab,
    labelKey: 'settings.tabData',
    icon: I.database || I.import,
    // 死链 / 公开分享计数随「维护」并入数据页
    badge: (deadCount.value + blockedCount.value > 0)
      ? String(deadCount.value + blockedCount.value)
      : (allPublicShares.value.length > 0 ? String(allPublicShares.value.length) : undefined),
    group: 'system',
  },
  {
    id: 'about' as SettingsTab,
    labelKey: 'settings.tabAbout',
    icon: I.info,
    group: 'system',
  },
])

provideSettingsContext({
  sync,
  auth,
  e2e,
  userDisplay,
  userInitial,
  syncState,
  fetchTransactions,
  formatTxTime,
  prevTxPage,
  nextTxPage,
  hasNextTx,
  hasPrevTx,
  txPageSize,
  txPage,
  totalTx,
  loadingTx,
  transactions,
  refreshEntitlement,
  entitlement,
  entService,
  dl,
  showPurchase,
  aiQuota,
  loadUserCategoryShares,
  loadingCategoryShares,
  userCategoryShares,
  allPublicShares,
  publicCategoryItems,
  publicGroupItems,
  blockedCount,
  deadCount,
  onOpenShortcutHelp,
})
</script>
