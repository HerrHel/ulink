<template>
  <div class="sp" v-show="store.settingsOpen">
    <!-- Theme -->
    <div class="sp-section">
      <div class="sp-row">
        <span class="sp-row-label">主题</span>
        <div class="sp-seg">
          <button class="sp-seg-btn" :class="{ active: store.themeStyle === 'premium' }" @click="onSetThemeStyle('premium')">效率</button>
          <button class="sp-seg-btn" :class="{ active: store.themeStyle === 'comfortable' }" @click="onSetThemeStyle('comfortable')">舒适</button>
        </div>
      </div>
      <div class="sp-divider"></div>
      <div class="sp-toggle-row" :class="{ active: store.themeMode === 'auto' }" @click="onToggleAutoTheme">
        <span v-html="I.sun" class="sp-icon auto-icon-sun"></span>
        <span v-html="I.moon" class="sp-icon auto-icon-moon"></span>
        <span class="sp-toggle-label">跟随系统</span>
        <span class="sp-switch"></span>
      </div>
    </div>
    <!-- Layout -->
    <div class="sp-section sp-section-layout">
      <div class="sp-row">
        <span class="sp-row-label">视图</span>
        <div class="sp-seg">
          <button class="sp-seg-btn" :class="{ active: store.layoutMode === 'grid' }" :disabled="uiStore.isMobile" @click="onSetLayout('grid')" title="网格视图"><span v-html="I.grid"></span></button>
          <button class="sp-seg-btn" :class="{ active: store.layoutMode === 'list' }" :disabled="uiStore.isMobile" @click="onSetLayout('list')" title="列表视图"><span v-html="I.list"></span></button>
        </div>
      </div>
    </div>
    <!-- Sort -->
    <div class="sp-section">
      <div class="sp-row">
        <span class="sp-row-label">排序</span>
        <div class="sp-seg sp-seg-wrap">
          <button v-for="s in sortModes" :key="s.id" class="sp-seg-btn"
                  :class="{ active: store.sortMode === s.id }" @click="onSetSortMode(s.id)">{{ s.label }}</button>
        </div>
      </div>
    </div>
    <!-- Tools -->
    <div class="sp-section">
      <div class="sp-actions">
        <button class="sp-action" :class="{ checking: dlChecking }" @click.stop="onCheckDeadLinks" :disabled="dlChecking">
          <span v-html="I.radar"></span>
          <span>{{ dlChecking ? '检测中...' : '检测死链' }}</span>
          <span v-if="deadCount > 0" class="sp-badge">{{ deadCount }}</span>
          <span v-if="blockedCount > 0" class="sp-badge sp-badge-gfw">{{ blockedCount }}</span>
        </button>
        <button v-if="deadCount + blockedCount > 0" class="sp-action sp-action-sm" @click.stop="onViewDeadLinks">
          <span v-html="I.link"></span>
          <span>查看</span>
        </button>
      </div>
    </div>
    <!-- Cloud Sync / Auth -->
    <div class="sp-section">
      <div class="sp-row">
        <span class="sp-row-label"><span v-html="auth.isLoggedIn.value ? I.cloud : I.cloudOff" class="sp-icon"></span>云同步</span>
        <span class="sp-sync-status" :class="sync.syncStatus.value">
          <span class="sp-sync-dot" :class="syncDotClass"></span>{{ sync.syncLabel.value }}
        </span>
      </div>
      <template v-if="auth.isLoggedIn.value">
        <div class="sp-row">
          <span class="sp-user-email">{{ auth.userEmail.value }}</span>
        </div>
        <div class="sp-row sp-row-actions">
          <button class="btn btn-ghost btn-sm" @click.stop="onSyncNow" :disabled="sync.syncStatus.value === 'syncing'">
            <span v-html="I.sync" class="sp-icon"></span>立即同步
          </button>
          <button class="btn btn-ghost btn-sm text-danger" @click.stop="onLogout">退出登录</button>
        </div>
        <div v-if="sync.syncError.value" class="sp-sync-error">{{ sync.syncError.value }}</div>
      </template>
      <template v-else>
        <div class="sp-row">
          <span class="sp-hint">登录后数据将自动同步到云端，多设备共享</span>
        </div>
        <div class="sp-row">
          <button class="btn btn-primary btn-sm" @click.stop="onOpenLogin">登录 / 注册</button>
        </div>
      </template>
    </div>
    <!-- E2E Encryption -->
    <div class="sp-section" v-if="auth.isLoggedIn.value">
      <div class="sp-row">
        <span class="sp-row-label"><span class="sp-icon">🔐</span>端到端加密</span>
        <span class="sp-sync-status" :class="e2eEnabled ? 'ok' : 'error'">
          {{ e2eEnabled ? (e2eUnlocked ? '已解锁' : '已锁定') : '未开启' }}
        </span>
      </div>
      <div class="sp-row">
        <span class="sp-hint">开启后密码、账户、备注等敏感数据将加密存储</span>
      </div>
      <div class="sp-row sp-row-actions">
        <button v-if="!e2eEnabled" class="btn btn-primary btn-sm" @click.stop="uiStore.e2eSetupOpen = true">
          🔐 开启加密
        </button>
        <button v-else-if="!e2eUnlocked" class="btn btn-primary btn-sm" @click.stop="uiStore.e2eUnlockOpen = true">
          🔓 解锁
        </button>
        <button v-else class="btn btn-ghost btn-sm" @click.stop="onE2ELock">
          🔒 锁定
        </button>
      </div>
    </div>
    <!-- Data -->
    <div class="sp-section">
      <div class="sp-actions">
        <button class="sp-action" @click.stop="onOpenTrash"><span v-html="trashIcon"></span>回收站</button>
        <button class="sp-action" @click.stop="onTriggerImport"><span v-html="I.import"></span>导入</button>
        <button class="sp-action" @click.stop="onExportData"><span v-html="I.export"></span>导出</button>
      </div>
    </div>
    <!-- Danger -->
    <div class="sp-section sp-danger">
      <button class="sp-danger-btn" @click.stop="onResetData">
        <span v-html="I.trash"></span>重置所有数据
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAppStore } from '../../stores/app.js'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { toggleAutoTheme as themeToggleAuto, setThemeStyle as themeSetStyle } from '../../lib/theme.js'
import { exportData, resetToDefaults } from '../../composables/domain/useDataIO.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { useDeadLinkChecker } from '../../composables/domain/useDeadLinkChecker.js'
import { useE2E } from '../../composables/domain/useE2E.js'
import { I } from '../../config/icons.js'
import { toast } from '../../lib/toast.js'

function triggerImport() { const el = document.getElementById('importFile') as HTMLInputElement | null; if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() } }

const store = useAppStore()
const uiStore = useUIStore()
const dataStore = useDataStore()
const auth = useAuth()
const sync = useCloudSync()
const dl = useDeadLinkChecker()
const e2e = useE2E()
const e2eEnabled = computed(() => e2e.isE2EEnabled.value)
const e2eUnlocked = computed(() => e2e.isUnlocked.value)

onMounted(() => { e2e.checkE2EStatus() })

function onE2ELock() { e2e.lock(); toast('已锁定') }

const trashCount = computed(() => dataStore.trashCount)
const trashIcon = computed(() => trashCount.value > 0 ? I.trashFull : I.trash)
const syncDotClass = computed(() => {
  if (sync.syncStatus.value === 'syncing') return 'dot-syncing'
  if (sync.syncStatus.value === 'error') return 'dot-error'
  if (sync.pendingCount.value > 0) return 'dot-pending'
  return 'dot-ok'
})
const dlChecking = computed(() => dl.checking.value)
const deadCount = computed(() => dl.deadCount.value)
const blockedCount = computed(() => dl.blockedCount.value)

const sortModes = [
  { id: 'order', label: '自定义' },
  { id: 'recommend', label: '推荐' },
  { id: 'title', label: '名称' },
  { id: 'dateDesc', label: '新→旧' },
  { id: 'dateAsc', label: '旧→新' },
  { id: 'useCount', label: '常用' },
]

function onSetThemeStyle(style: string) {
  themeSetStyle(style)
  store.themeStyle = style
}

function onToggleAutoTheme() {
  themeToggleAuto()
  store.themeMode = localStorage.getItem('lv_themeMode') === 'auto' ? 'auto' : 'manual'
}

function onSetLayout(mode: 'grid' | 'list') {
  if (store.focusedGroupId) return
  if (uiStore.isMobile) return
  store.layoutMode = mode
}

function onSetSortMode(mode: string) {
  store.sortMode = mode
}

function onOpenTrash() { store.trashPanelOpen = true; store.settingsOpen = false }
function onTriggerImport() { triggerImport(); store.settingsOpen = false }
function onExportData() { exportData(); store.settingsOpen = false }
function onResetData() { resetToDefaults(); store.settingsOpen = false }

async function onOpenLogin() {
  auth.authModalOpen.value = true
  store.settingsOpen = false
}

async function onLogout() {
  const ok = await auth.signOut()
  if (ok) sync.resetSyncState()
}

async function onSyncNow() {
  await sync.fullSync()
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
  store.deadLinksPopoverOpen = true
  uiStore.settingsOpen = false
}
</script>
