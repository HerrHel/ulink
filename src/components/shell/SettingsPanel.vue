<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="uiStore.panels.settings" class="settings-drawer-wrap" @click.self="uiStore.panels.settings = false">
        <div class="settings-drawer" @click.stop>
          <div class="settings-drawer-head">
            <h2 class="settings-drawer-title">设置</h2>
            <button class="sp-help-btn" @click.stop="onOpenShortcutHelp" aria-label="快捷键速查" title="快捷键速查">?</button>
            <button class="modal-close" @click="uiStore.panels.settings = false" aria-label="关闭设置">&times;</button>
          </div>
          <div class="settings-drawer-body">
            <!-- Theme -->
            <div class="sp-section">
              <span class="sp-section-title">主题</span>
              <div class="sp-row">
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'premium' }" @click="onSetThemeStyle('premium')">效率</button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.themeStyle === 'comfortable' }" @click="onSetThemeStyle('comfortable')">舒适</button>
                </div>
              </div>
              <div class="sp-toggle-row" :class="{ active: uiStore.themeMode === 'auto' }" @click="onToggleAutoTheme">
                <span aria-hidden="true" v-html="I.sun" class="sp-icon auto-icon-sun"></span>
                <span aria-hidden="true" v-html="I.moon" class="sp-icon auto-icon-moon"></span>
                <span class="sp-toggle-label">跟随系统</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- Layout -->
            <div class="sp-section sp-section-layout">
              <span class="sp-section-title">视图</span>
              <div class="sp-row">
                <div class="sp-seg">
                  <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'grid' }" :disabled="uiStore.isMobile" @click="onSetLayout('grid')" title="网格视图"><span aria-hidden="true" v-html="I.grid"></span></button>
                  <button class="sp-seg-btn" :class="{ active: uiStore.layoutMode === 'list' }" :disabled="uiStore.isMobile" @click="onSetLayout('list')" title="列表视图"><span aria-hidden="true" v-html="I.list"></span></button>
                </div>
              </div>
            </div>
            <!-- Sort -->
            <div class="sp-section">
              <span class="sp-section-title">排序</span>
              <div class="sp-row">
                <div class="sp-seg sp-seg-wrap">
                  <button v-for="s in sortModes" :key="s.id" class="sp-seg-btn"
                          :class="{ active: uiStore.sortMode === s.id }" @click="onSetSortMode(s.id)">{{ s.label }}</button>
                </div>
              </div>
              <div class="sp-toggle-row" :class="{ active: uiStore.groupsOnTop }" @click="uiStore.groupsOnTop = !uiStore.groupsOnTop">
                <span class="sp-toggle-label">组置顶</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- 维护 -->
            <div class="sp-section">
              <span class="sp-section-title">维护</span>
              <div class="sp-actions">
                <button class="sp-action" :class="{ checking: dlChecking }" @click.stop="onCheckDeadLinks" :disabled="dlChecking">
                  <span aria-hidden="true" v-html="I.radar"></span>
                  <span>{{ dlChecking ? '检测中...' : '检测死链' }}</span>
                  <span v-if="deadCount > 0" class="sp-badge">{{ deadCount }}</span>
                  <span v-if="blockedCount > 0" class="sp-badge sp-badge-gfw">{{ blockedCount }}</span>
                </button>
                <div v-if="dlChecking && dlProgress.total > 0" class="sp-check-progress">
                  <div class="sp-check-progress-bar" :style="{ width: (dlProgress.done / dlProgress.total * 100) + '%' }"></div>
                  <span class="sp-check-progress-text">{{ dlProgress.done }}/{{ dlProgress.total }}</span>
                </div>
                <button v-if="deadCount + blockedCount > 0" class="sp-action sp-action-sm" @click.stop="onViewDeadLinks">
                  <span aria-hidden="true" v-html="I.link"></span>
                  <span>查看</span>
                </button>
              </div>
              <div class="sp-toggle-row" :class="{ active: dlAutoEnabled }" @click="onToggleAutoDeadCheck">
                <span class="sp-toggle-label">定时检测（每周）</span>
                <span class="sp-switch"></span>
              </div>
            </div>
            <!-- 同步与安全 -->
            <div class="sp-section">
              <span class="sp-section-title">同步与安全</span>
              <template v-if="auth.isLoggedIn">
                <div class="sp-row">
                  <span class="sp-row-label"><span aria-hidden="true" v-html="I.cloud" class="sp-icon"></span>云同步</span>
                  <span class="sp-sync-status" :class="syncState.level">
                    <span class="sp-sync-dot" :class="syncState.dotClass"></span>{{ syncState.label }}
                  </span>
                </div>
                <div class="sp-row">
                  <span class="sp-user-email">{{ auth.userEmail }}</span>
                </div>
                <div class="sp-row sp-row-actions">
                  <button class="btn btn-ghost btn-sm text-danger" @click.stop="onLogout">退出登录</button>
                </div>
                <div v-if="syncState.level === 'error' && sync.syncError.value" class="sp-sync-error">{{ sync.syncError.value }}</div>
              </template>
              <template v-else>
                <div class="sp-row">
                  <span class="sp-hint">登录后数据将自动同步到云端，多设备共享</span>
                </div>
                <div class="sp-row">
                  <button class="btn btn-primary btn-sm" @click.stop="onOpenLogin">登录 / 注册</button>
                </div>
              </template>
              <div class="sp-divider"></div>
              <div class="sp-row">
                <span class="sp-row-label"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span>端到端加密</span>
                <span class="sp-sync-status" :class="e2eEnabled ? 'ok' : 'error'">
                  {{ e2eEnabled ? (e2eUnlocked ? '已解锁' : '已锁定') : '未开启' }}
                </span>
              </div>
              <div class="sp-row">
                <span class="sp-hint">开启后密码、账户、备注等敏感数据将加密存储<span v-if="!auth.isLoggedIn">（本机存储，登录云端后可跨设备）</span></span>
              </div>
              <div class="sp-row sp-row-actions">
                <button v-if="!e2eEnabled" class="btn btn-primary btn-sm" @click.stop="onOpenE2ESetup"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> 开启加密</button>
                <button v-else-if="!e2eUnlocked" class="btn btn-primary btn-sm" @click.stop="onOpenE2EUnlock"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> 解锁</button>
                <button v-else class="btn btn-ghost btn-sm" @click.stop="onE2ELock"><span aria-hidden="true" v-html="I.password" class="sp-icon"></span> 锁定</button>
              </div>
            </div>
            <!-- 数据 -->
            <div class="sp-section">
              <span class="sp-section-title">数据</span>
              <div class="sp-actions">
                <button class="sp-action" @click.stop="onOpenTrash"><span v-html="trashIcon"></span>回收站</button>
                <button class="sp-action" @click.stop="onTriggerImport"><span aria-hidden="true" v-html="I.import"></span>导入</button>
                <div class="sp-export-wrap" @click.stop>
                  <button class="sp-action" @click="exportMenuOpen = !exportMenuOpen"><span aria-hidden="true" v-html="I.export"></span>导出</button>
                  <div v-if="exportMenuOpen" class="sp-export-menu">
                    <button class="sp-export-item" @click="onExport('json')">
                      <span class="sp-export-name">LinkVault 备份</span>
                      <span class="sp-export-hint">完整含组/分类 · .json</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('html')">
                      <span class="sp-export-name">浏览器书签</span>
                      <span class="sp-export-hint">Chrome/Edge 通用 · .html</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('csv')">
                      <span class="sp-export-name">CSV 表格</span>
                      <span class="sp-export-hint">不含账户密码 · .csv</span>
                    </button>
                    <button class="sp-export-item" @click="onExport('raindrop')">
                      <span class="sp-export-name">Raindrop.io</span>
                      <span class="sp-export-hint">迁入竞品 · .json</span>
                    </button>
                  </div>
                </div>
              </div>
              <div class="sp-divider"></div>
              <div class="sp-row">
                <span class="sp-row-label">历史版本保留</span>
                <span class="sp-range-value">{{ uiStore.historyMax }} 版</span>
              </div>
              <div class="sp-row">
                <input type="range" class="sp-range" min="5" max="30" step="1"
                       v-model.number="uiStore.historyMax" @change="onHistoryMaxChange">
                <span class="sp-range-hint">5–30</span>
              </div>
            </div>
            <!-- 关于 -->
            <div class="sp-section">
              <span class="sp-section-title">关于</span>
              <button class="sp-action" @click.stop="onFeedback">反馈 / 建议</button>
            </div>
            <!-- Danger -->
            <div class="sp-section sp-danger">
              <span class="sp-section-title">危险操作</span>
              <button class="sp-danger-btn" @click.stop="onResetData">
                <span aria-hidden="true" v-html="I.trash"></span>重置所有数据
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
      <div v-if="feedbackOpen" class="modal-mask open" role="dialog" aria-modal="true" aria-label="反馈 / 建议" @click.self="feedbackOpen = false">
        <div class="modal modal-sm">
          <div class="modal-body modal-body-center">
            <div class="confirm-msg">通过邮箱向我们反馈或建议</div>
            <div class="sp-feedback-email" style="margin-top:12px;font-size:15px;word-break:break-all;">{{ FEEDBACK_EMAIL }}</div>
          </div>
          <div class="modal-foot confirm-foot">
            <button class="btn btn-secondary" @click="copyFeedbackEmail">复制邮箱</button>
            <button class="btn btn-primary" @click="openFeedbackMail">打开邮箱</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, onBeforeUnmount } from 'vue'
import { useUIStore, type ThemeStyle, type SortMode } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { toggleAutoTheme as themeToggleAuto, setThemeStyle as themeSetStyle } from '../../lib/theme.js'
import { exportData, exportHTML, exportCSV, exportRaindrop, resetToDefaults } from '../../composables/domain/useDataIO.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import { I } from '../../config/icons.js'
import { toast } from '../../lib/toast.js'


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

function onE2ELock() { e2e.lock(); toast('已锁定') }
function onOpenE2ESetup() { uiStore.modals.e2eSetup = true; uiStore.panels.settings = false }
function onOpenE2EUnlock() { uiStore.modals.e2eUnlock = true; uiStore.panels.settings = false }

const trashCount = computed(() => dataStore.trashCount)
const trashIcon = computed(() => trashCount.value > 0 ? I.trashFull : I.trash)
const syncState = useSyncState()
const dlChecking = computed(() => dl.checking.value)
const dlProgress = computed(() => dl.progress.value)
const deadCount = computed(() => dl.deadCount.value)
const blockedCount = computed(() => dl.blockedCount.value)
const dlAutoEnabled = computed(() => dl.autoCheckEnabled.value)

const sortModes: { id: SortMode; label: string }[] = [
  { id: 'order', label: '自定义' },
  { id: 'title', label: '名称' },
  { id: 'dateDesc', label: '新→旧' },
  { id: 'dateAsc', label: '旧→新' },
  { id: 'useCount', label: '常用' },
]

function onSetThemeStyle(style: ThemeStyle) {
  themeSetStyle(style)
  uiStore.themeStyle = style
}

function onToggleAutoTheme() {
  themeToggleAuto()
  uiStore.themeMode = localStorage.getItem('lv_themeMode') === 'auto' ? 'auto' : 'manual'
}

function onSetLayout(mode: 'grid' | 'list') {
  if (uiStore.focusedGroupId) return
  if (uiStore.isMobile) return
  uiStore.layoutMode = mode
}

function onSetSortMode(mode: SortMode) {
  uiStore.sortMode = mode
}

function onHistoryMaxChange() {
  uiStore.historyMax = Math.min(30, Math.max(5, uiStore.historyMax))
  uiStore.saveUIState()
}

function onOpenTrash() { pushNavState(); uiStore.panels.trash = true; uiStore.panels.settings = false }
function onTriggerImport() { triggerImport(); uiStore.panels.settings = false }
function onExportData() { exportData(); uiStore.panels.settings = false }

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
  if (ok) sync.resetSyncState()
}

function onCheckDeadLinks() {
  if (dl.checking.value) return
  toast('开始检测死链...')
  dl.checkAll(5, 200).then(() => {
    const ds = dataStore
    let dead = 0
    let blocked = 0
    for (const b of ds.bookmarks) {
      if (b.attributes?.['dead-link']) dead++
      if (b.attributes?.['gfw-blocked']) blocked++
    }
    if (dead > 0 && blocked > 0) {
      toast(`检测完成：${dead} 个失效，${blocked} 个被墙`)
    } else if (dead > 0) {
      toast(`检测完成：发现 ${dead} 个死链`)
    } else if (blocked > 0) {
      toast(`检测完成：${blocked} 个链接被墙`)
    } else {
      toast('检测完成，所有链接正常')
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

// ── 反馈 ──
const FEEDBACK_EMAIL = '2629490959@qq.com'
const feedbackOpen = ref(false)

function onFeedback() {
  pushNavState()
  feedbackOpen.value = true
  uiStore.panels.settings = false
}

async function copyFeedbackEmail() {
  try {
    await navigator.clipboard.writeText(FEEDBACK_EMAIL)
    toast('邮箱地址已复制', true)
  } catch {
    // clipboard API 不可用（旧浏览器/非安全上下文）：提示手动选中复制
    toast('复制失败，请手动选中邮箱地址复制', false)
  }
  feedbackOpen.value = false
}

function openFeedbackMail() {
  window.open('mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent('LinkVault 反馈 / 建议'), '_blank')
  feedbackOpen.value = false
}
</script>
