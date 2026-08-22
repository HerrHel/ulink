<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="uiStore.panels.settings" class="settings-drawer-wrap" @click.self="uiStore.panels.settings = false">
        <div class="settings-drawer" data-testid="lv-settings-drawer" @click.stop>
          <div class="settings-drawer-head">
            <h2 class="settings-drawer-title">{{ t('settings.title') }}</h2>
            <button class="sp-help-btn" @click.stop="onOpenShortcutHelp" :aria-label="t('settings.shortcutHelp')" :title="t('settings.shortcutHelp')">?</button>
            <button class="modal-close" @click="uiStore.panels.settings = false" :aria-label="t('settings.closeSettings')">&times;</button>
          </div>
          <div class="settings-drawer-body">
            <!-- Language -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.language') }}</span>
              <div class="sp-row">
                <div class="sp-seg" data-testid="lv-lang-switch">
                  <button class="sp-seg-btn" :class="{ active: locale === 'zh-CN' }" @click="setLocale('zh-CN')">中文</button>
                  <button class="sp-seg-btn" :class="{ active: locale === 'en-US' }" @click="setLocale('en-US')">English</button>
                </div>
              </div>
            </div>
            <!-- Theme -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.theme') }}</span>
              <div class="sp-row">
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'premium' }" @click="onSetThemeStyle('premium')">{{ t('settings.themePremium') }}</button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'comfortable' }" @click="onSetThemeStyle('comfortable')">{{ t('settings.themeComfortable') }}</button>
                </div>
              </div>
              <div class="sp-toggle-row" :class="{ active: uiStore.themeMode === 'auto' }" @click="onToggleAutoTheme">
                <span aria-hidden="true" v-html="I.sun" class="sp-icon auto-icon-sun"></span>
                <span aria-hidden="true" v-html="I.moon" class="sp-icon auto-icon-moon"></span>
                <span class="sp-toggle-label">{{ t('settings.followSystem') }}</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- Layout -->
            <div class="sp-section sp-section-layout">
              <span class="sp-section-title">{{ t('settings.layout') }}</span>
              <div class="sp-row">
                <div class="sp-seg">
                  <button v-if="!uiStore.isMobile" class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'grid' }" @click="onSetLayout('grid')" :title="t('settings.gridView')"><span aria-hidden="true" v-html="I.grid"></span></button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'list' }" @click="onSetLayout('list')" :title="t('settings.listView')"><span aria-hidden="true" v-html="I.list"></span></button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'mini-grid' }" @click="onSetLayout('mini-grid')" :title="t('settings.miniGridView')"><span aria-hidden="true" v-html="I.miniGrid"></span></button>
                </div>
              </div>
            </div>
            <!-- Sort -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.sort') }}</span>
              <div class="sp-row">
                <div class="sp-seg sp-seg-wrap">
                  <button v-for="s in sortModes" :key="s.id" class="sp-seg-btn"
                          :class="{ active: uiStore.sortMode === s.id }" @click="onSetSortMode(s.id)">{{ t(s.labelKey) }}</button>
                </div>
              </div>
              <div class="sp-toggle-row" :class="{ active: uiStore.groupsOnTop }" @click="onToggleGroupsOnTop">
                <span class="sp-toggle-label">{{ t('settings.groupsOnTop') }}</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- 维护 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.maintenance') }}</span>
              <div class="sp-actions">
                <button class="sp-action" :class="{ checking: dlChecking }" @click.stop="onCheckDeadLinks" :disabled="dlChecking">
                  <span aria-hidden="true" v-html="I.radar"></span>
                  <span>{{ dlChecking ? t('settings.checking') : t('settings.checkDeadLinks') }}</span>
                  <span v-if="deadCount > 0" class="sp-badge">{{ deadCount }}</span>
                  <span v-if="blockedCount > 0" class="sp-badge sp-badge-gfw">{{ blockedCount }}</span>
                </button>
                <div v-if="dlChecking && dlProgress.total > 0" class="sp-check-progress">
                  <div class="sp-check-progress-bar" :style="{ width: (dlProgress.done / dlProgress.total * 100) + '%' }"></div>
                  <span class="sp-check-progress-text">{{ dlProgress.done }}/{{ dlProgress.total }}</span>
                </div>
                <button v-if="deadCount + blockedCount > 0" class="sp-action sp-action-sm" @click.stop="onViewDeadLinks">
                  <span aria-hidden="true" v-html="I.link"></span>
                  <span>{{ t('settings.view') }}</span>
                </button>
              </div>
              <div class="sp-toggle-row" :class="{ active: dlAutoEnabled }" @click="onToggleAutoDeadCheck">
                <span class="sp-toggle-label">{{ t('settings.autoDeadCheckWeekly') }}</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- 同步与安全 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.syncSecurity') }}</span>
              <template v-if="auth.isLoggedIn">
                <div class="sp-row">
                  <span class="sp-row-label"><span aria-hidden="true" v-html="I.cloud" class="sp-icon"></span>{{ t('settings.cloudSync') }}</span>
                  <span class="sp-sync-status" data-testid="lv-sync-label" :class="syncState.level">
                    <span class="sp-sync-dot" :class="syncState.dotClass"></span>{{ syncState.label }}
                  </span>
                </div>
                <div class="sp-row">
                  <span class="sp-user-email">{{ auth.userEmail }}</span>
                </div>
                <div class="sp-row sp-row-actions">
                  <button class="btn btn-ghost btn-sm text-danger" @click.stop="onLogout">{{ t('settings.logout') }}</button>
                </div>
                <div v-if="syncState.level === 'error' && sync.syncError.value" class="sp-sync-error">{{ sync.syncError.value }}</div>
              </template>
              <template v-else>
                <div class="sp-row">
                  <span class="sp-hint">{{ t('settings.loginHint') }}</span>
                </div>
                <div class="sp-row">
                  <button class="btn btn-primary btn-sm" @click.stop="onOpenLogin">{{ t('settings.loginRegister') }}</button>
                </div>
              </template>
              <div class="sp-divider"></div>
              <div class="sp-row">
                <span class="sp-row-label"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span>{{ t('settings.e2eEncryption') }}</span>
                <span class="sp-sync-status" data-testid="lv-e2e-status" :class="e2eEnabled ? 'ok' : 'error'">
                  {{ e2eEnabled ? (e2eUnlocked ? t('settings.e2eUnlocked') : t('settings.e2eLocked')) : t('settings.e2eDisabled') }}
                </span>
              </div>
              <div class="sp-row">
                <span class="sp-hint">{{ t('settings.e2eHint') }}<span v-if="!auth.isLoggedIn">{{ t('settings.e2eHintLocalOnly') }}</span></span>
              </div>
              <div class="sp-row sp-row-actions">
                <button v-if="!e2eEnabled" class="btn btn-primary btn-sm" data-testid="lv-e2e-setup-btn" @click.stop="onOpenE2ESetup"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> {{ t('settings.enableEncryption') }}</button>
                <button v-else-if="!e2eUnlocked" class="btn btn-primary btn-sm" data-testid="lv-e2e-unlock-btn" @click.stop="onOpenE2EUnlock"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> {{ e2e.isBiometricEnrolled.value ? t('settings.biometricUnlock') : t('settings.unlock') }}</button>
                <template v-else>
                  <button class="btn btn-ghost btn-sm" data-testid="lv-e2e-lock-btn" @click.stop="onE2ELock"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> {{ t('settings.lock') }}</button>
                  <button class="btn btn-ghost btn-sm" data-testid="lv-e2e-changepw-btn" @click.stop="onOpenE2EChangePw"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> {{ t('settings.changeMasterPassword') }}</button>
                  <button v-if="e2e.isBiometricEnrolled.value" class="btn btn-ghost btn-sm" data-testid="lv-e2e-biometric-remove" @click.stop="onRemoveBiometric">{{ t('settings.removeBiometric') }}</button>
                </template>
              </div>
            </div>
            <!-- 数据 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.data') }}</span>
              <div class="sp-actions">
                <button class="sp-action" @click.stop="onOpenTrash"><span v-html="trashIcon"></span>{{ t('settings.trash') }}</button>
              </div>
              <div class="sp-actions">
                <button class="sp-action" @click.stop="onTriggerImport"><span aria-hidden="true" v-html="I.import"></span>{{ t('settings.import') }}</button>
                <div class="sp-export-wrap" @click.stop>
                  <button class="sp-action" @click="exportMenuOpen = !exportMenuOpen"><span aria-hidden="true" v-html="I.export"></span>{{ t('settings.export') }}</button>
                  <div v-if="exportMenuOpen" class="sp-export-menu">
                    <button class="sp-export-item" @click="onExport('json')">
                      <span class="sp-export-name">{{ t('settings.exportJson') }}</span>
                      <span class="sp-export-hint">{{ t('settings.exportJsonHint') }}</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('html')">
                      <span class="sp-export-name">{{ t('settings.exportHtml') }}</span>
                      <span class="sp-export-hint">{{ t('settings.exportHtmlHint') }}</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('csv')">
                      <span class="sp-export-name">{{ t('settings.exportCsv') }}</span>
                      <span class="sp-export-hint">{{ t('settings.exportCsvHint') }}</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('raindrop')">
                      <span class="sp-export-name">Raindrop.io</span>
                      <span class="sp-export-hint">{{ t('settings.exportRaindropHint') }}</span>
                    </button>
                  </div>
                </div>
              </div>
              <div class="sp-divider"></div>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.historyMax') }}</span>
                <span class="sp-range-value">{{ t('settings.historyMaxValue', { n: uiStore.historyMax }) }}</span>
              </div>
              <div class="sp-row">
                <input type="range" class="sp-range" min="5" max="30" step="1"
                       v-model.number="uiStore.historyMax" @change="onHistoryMaxChange">
                <span class="sp-range-hint">5–30</span>
              </div>
            </div>
            <!-- 关于 -->
            <div class="sp-section">
              <span class="sp-section-title">{{ t('settings.about') }}</span>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.version') }}</span>
                <span class="sp-sync-status" data-testid="lv-app-version">v{{ APP_VERSION }}</span>
              </div>
              <div class="sp-row">
                <span class="sp-row-label">{{ t('settings.buildTime') }}</span>
                <span class="sp-sync-status" data-testid="lv-build-time">{{ buildTimeText }}</span>
              </div>
              <button class="sp-action" @click.stop="onFeedback">{{ t('settings.feedback') }}</button>
            </div>
            <!-- Danger -->
            <div class="sp-section sp-danger">
              <span class="sp-section-title">{{ t('settings.danger') }}</span>
              <button class="sp-danger-btn" @click.stop="onResetData">
                <span aria-hidden="true" v-html="I.trash"></span>{{ t('settings.resetData') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 反馈 / 建议 弹窗：邮箱地址 + 打开邮箱客户端 / 复制邮箱 双按钮 -->
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="uiStore.overlays.feedback" class="modal-mask open" role="dialog" aria-modal="true" :aria-label="t('settings.feedback')" @click.self="uiStore.overlays.feedback = false">
        <div class="modal modal-sm">
          <div class="modal-body modal-body-center">
            <div class="confirm-msg">{{ t('settings.feedbackHint') }}</div>
            <div class="sp-feedback-email" style="margin-top:12px;font-size:15px;word-break:break-all;">{{ FEEDBACK_EMAIL }}</div>
          </div>
          <div class="modal-foot confirm-foot">
            <button class="btn btn-secondary" @click="copyFeedbackEmail">{{ t('settings.copyEmail') }}</button>
            <button class="btn btn-primary" @click="openFeedbackMail">{{ t('settings.openEmail') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, onBeforeUnmount } from 'vue'
import { useUIStore, type ThemeStyle, type SortMode, type LayoutMode } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { toggleAutoTheme as themeToggleAuto, setThemeStyle as themeSetStyle, K_THEME_MODE } from '../../lib/theme.js'
import { exportData, exportHTML, exportCSV, exportRaindrop, resetToDefaults } from '../../composables/domain/useDataIO.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import { I } from '../../config/icons.js'
import { toast } from '../../lib/toast.js'
import { safeGetItem } from '../../lib/storageSafe.js'
import { APP_VERSION, BUILD_TIME } from '../../version.js'
import { t, tN, useI18n } from '../../i18n/index.js'

// 语言切换：locale 为响应式 computed，切语言后本面板与全局文案立即更新
const { locale, setLocale } = useI18n()


function triggerImport() { const el = document.getElementById('importFile') as HTMLInputElement | null; if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() } }

function onOpenShortcutHelp() { pushNavState(); uiStore.panels.shortcutHelp = true; uiStore.panels.settings = false }

const uiStore = useUIStore()
const dataStore = useDataStore()
const auth = useAuth()
const sync = useCloudSync()
const dl = useDeadLinkChecker()
const e2e = useE2E()
const e2eEnabled = computed(() => e2e.isE2EEnabled.value)
const e2eUnlocked = computed(() => e2e.isUnlocked.value)

function onE2ELock() { e2e.lock(); toast(t('settings.lockedToast')) }
function onRemoveBiometric() { e2e.removeBiometric(); toast(t('settings.biometricRemovedToast')) }
function onOpenE2ESetup() { uiStore.modals.e2eSetup = true; uiStore.panels.settings = false }
function onOpenE2EUnlock() { uiStore.e2eUnlockInitialMode = 'unlock'; uiStore.modals.e2eUnlock = true; uiStore.panels.settings = false }
function onOpenE2EChangePw() {
  uiStore.e2eUnlockInitialMode = 'changePw'
  uiStore.modals.e2eUnlock = true
  uiStore.panels.settings = false
}

const trashCount = computed(() => dataStore.trashCount)
const trashIcon = computed(() => trashCount.value > 0 ? I.trashFull : I.trash)
const syncState = useSyncState()
// 构建时间本地化显示（__BUILD_TIME__ 为 UTC ISO 串 → 本地时区）；define 未注入时兜底
const buildTimeText = computed(() => {
  if (!BUILD_TIME) return ''
  const d = new Date(BUILD_TIME)
  if (Number.isNaN(d.getTime())) return BUILD_TIME
  return d.toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', { hour12: false })
})
const dlChecking = computed(() => dl.checking.value)
const dlProgress = computed(() => dl.progress.value)
const deadCount = computed(() => dl.deadCount.value)
const blockedCount = computed(() => dl.blockedCount.value)
const dlAutoEnabled = computed(() => dl.autoCheckEnabled.value)

const sortModes: { id: SortMode; labelKey: string }[] = [
  { id: 'order', labelKey: 'settings.sortCustom' },
  { id: 'title', labelKey: 'settings.sortTitle' },
  { id: 'dateDesc', labelKey: 'settings.sortDateDesc' },
  { id: 'dateAsc', labelKey: 'settings.sortDateAsc' },
  { id: 'useCount', labelKey: 'settings.sortUseCount' },
]

function onSetThemeStyle(style: ThemeStyle) {
  themeSetStyle(style)
  uiStore.themeStyle = style
}

function onToggleAutoTheme() {
  themeToggleAuto()
  uiStore.themeMode = safeGetItem(K_THEME_MODE) === 'auto' ? 'auto' : 'manual'
}

function onSetLayout(mode: LayoutMode) {
  if (uiStore.focusedGroupId) return
  // 移动端不可用 grid：拦截
  if (uiStore.isMobile && mode === 'grid') return
  uiStore.layoutMode = mode
  if (uiStore.isMobile && (mode === 'list' || mode === 'mini-grid')) {
    uiStore._mobileLayoutMode = mode
  }
  // A4-005：即时落盘，不依赖 beforeunload
  uiStore.saveUIState()
}

function onSetSortMode(mode: SortMode) {
  uiStore.sortMode = mode
  uiStore.saveUIState()
}

function onToggleGroupsOnTop() {
  uiStore.groupsOnTop = !uiStore.groupsOnTop
  uiStore.saveUIState()
}

function onHistoryMaxChange() {
  uiStore.historyMax = Math.min(30, Math.max(5, uiStore.historyMax))
  uiStore.saveUIState()
}

function onOpenTrash() { pushNavState(); uiStore.panels.trash = true; uiStore.panels.settings = false }
function onTriggerImport() { triggerImport(); uiStore.panels.settings = false }

const exportMenuOpen = ref(false)
function onExport(fmt: 'json' | 'html' | 'csv' | 'raindrop') {
  if (fmt === 'json') exportData()
  else if (fmt === 'html') exportHTML()
  else if (fmt === 'csv') exportCSV()
  else if (fmt === 'raindrop') exportRaindrop()
  exportMenuOpen.value = false
  uiStore.panels.settings = false
}
function _closeExportMenu(e: MouseEvent) {
  const t = e.target as HTMLElement
  if (!t.closest('.sp-export-wrap')) exportMenuOpen.value = false
}
onMounted(() => { document.addEventListener('click', _closeExportMenu); e2e.checkE2EStatus() })
onBeforeUnmount(() => document.removeEventListener('click', _closeExportMenu))
function onResetData() { resetToDefaults(); uiStore.panels.settings = false }

async function onOpenLogin() {
  auth.authModalOpen = true
  uiStore.panels.settings = false
}

async function onLogout() {
  const ok = await auth.signOut()
  if (ok) await sync.resetSyncState()
}

function onCheckDeadLinks() {
  if (dl.checking.value) return
  toast(t('settings.checkDeadLinksStart'))
  dl.checkAll(5, 200).then(() => {
    const ds = dataStore
    let dead = 0
    let blocked = 0
    for (const b of ds.bookmarks) {
      if (b.attributes?.['dead-link']) dead++
      if (b.attributes?.['gfw-blocked']) blocked++
    }
    if (dead > 0 && blocked > 0) {
      toast(t('settings.deadCheckDoneMixed', { dead, blocked }))
    } else if (dead > 0) {
      toast(tN('settings.deadCheckDoneDead', dead))
    } else if (blocked > 0) {
      toast(tN('settings.deadCheckDoneBlocked', blocked))
    } else {
      toast(t('settings.deadCheckAllOk'))
    }
  })
}

function onViewDeadLinks() {
  pushNavState()
  uiStore.overlays.deadLinks = true
  uiStore.panels.settings = false
}

function onToggleAutoDeadCheck() {
  if (dl.autoCheckEnabled.value) dl.stopAutoCheck()
  else dl.startAutoCheck()
}

// ── 反馈（A4-007：状态进 overlays.feedback，支持 Esc / popstate）──
const FEEDBACK_EMAIL = '2629490959@qq.com'

function onFeedback() {
  pushNavState()
  uiStore.overlays.feedback = true
  uiStore.panels.settings = false
}

async function copyFeedbackEmail() {
  try {
    await navigator.clipboard.writeText(FEEDBACK_EMAIL)
    toast(t('settings.emailCopied'), true)
  } catch {
    // clipboard API 不可用（旧浏览器/非安全上下文）：提示手动选中复制
    toast(t('settings.copyEmailFailed'), false)
  }
  uiStore.overlays.feedback = false
}

function openFeedbackMail() {
  window.open('mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(t('settings.feedbackSubject')), '_blank')
  uiStore.overlays.feedback = false
}
</script>
