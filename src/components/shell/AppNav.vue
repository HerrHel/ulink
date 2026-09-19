<template>
  <nav class="icon-rail" :class="{ open: uiStore.panels.rail }" :aria-label="t('nav.rail')">
    <div class="rail-logo">
      <BrandLogo :size="22" />
      <span class="rail-logo-text" :data-space="uiStore.curSpace">{{ isVault ? t('nav.vaultSpace') : t('nav.brand') }}</span>
    </div>
    <div class="rail-section-label">{{ t('nav.categories') }}</div>
    <div class="rail-nav" id="railNav">
      <!-- Phase 2: Vue 模板渲染替代 innerHTML -->
      <button
        v-for="cat in categories"
        :key="cat.id"
        class="rail-item"
        :class="{ active: curCat === cat.id }"
        :data-cat-id="cat.id"
        :draggable="cat.id !== CAT_ALL && cat.id !== CAT_UNCATEGORIZED"
        @click="selectCat(cat.id)"
      >
        <span v-html="getCategoryIcon(cat.icon)"></span>
        {{ cat.name }}
        <span class="rail-count">{{ cardCounts[cat.id] || 0 }}</span>
      </button>
    </div>
    <div class="rail-bottom">
      <button v-if="isVault" class="rail-item" data-testid="btnBackToMain" @click="onBackToMain">
        <span aria-hidden="true" v-html="I.back"></span>
        {{ t('nav.backToMain') }}
      </button>
      <div v-if="!shareMode" class="rail-action-row">
        <button class="rail-item rail-action-main" id="btnManageCats" @click="openCatModalNav" :title="t('nav.manageCategories')">
          <span aria-hidden="true" v-html="I.settings"></span>
          {{ t('nav.manageCategories') }}
        </button>
        <button
          class="rail-action-icon-btn"
          id="btnToggleThemeQuick"
          data-testid="btn-toggle-theme-quick"
          @click="toggleThemeQuick"
          :title="t('nav.toggleThemeLabel')"
          :aria-label="t('nav.toggleThemeLabel')"
        >
          <span class="icon-sun" aria-hidden="true" v-html="I.sun"></span>
          <span class="icon-moon" aria-hidden="true" v-html="I.moon"></span>
        </button>
      </div>
      <!-- 专属账户底座 -->
      <div
        ref="railUserRef"
        class="rail-user"
        :class="{ logged: auth.isLoggedIn, unlogged: !auth.isLoggedIn }"
        data-testid="rail-user-card"
        @click="onUserClick"
        :title="auth.isLoggedIn ? (auth.userEmail || t('nav.loggedIn')) : t('nav.loginTitle')"
        :aria-label="auth.isLoggedIn ? (auth.userEmail || t('nav.loggedIn')) : t('nav.loginTitle')"
        role="button"
        tabindex="0"
        @keydown.enter="onUserClick"
        @keydown.space.prevent="onUserClick"
      >
        <div class="rail-user-avatar">
          <template v-if="auth.isLoggedIn">
            <span v-if="customAvatarEmoji" class="rail-user-emoji">{{ customAvatarEmoji }}</span>
            <span v-else class="rail-user-initial">{{ userInitial }}</span>
            <span class="rail-user-dot" :class="syncState.dotClass"></span>
          </template>
          <template v-else>
            <span class="rail-user-cloud-icon" aria-hidden="true" v-html="I.cloud"></span>
          </template>
        </div>
        <div class="rail-user-meta">
          <span class="rail-user-title">{{ auth.isLoggedIn ? (auth.displayName || userDisplay) : t('nav.loginTitle') }}</span>
          <span class="rail-user-sub">{{ auth.isLoggedIn ? syncState.label : t('nav.loginSubtitle') }}</span>
        </div>
      </div>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDataStore } from '../../stores/data.js'
import { useUIStore } from '../../stores/ui.js'
import { useUserPopoverStore } from '../../stores/overlay.js'
import { useVault } from '../../composables/domain/useVault.js'
import { openCatModal } from '../../composables/ui/useUI.js'
import { I, getCategoryIcon } from '../../config/icons.js'
import BrandLogo from '../ui/BrandLogo.vue'
import { CAT_ALL, CAT_UNCATEGORIZED } from '../../config/constants.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { useSyncState } from '../../composables/ui/useSyncStatus.js'
import { t } from '../../i18n/index.js'

const dataStore = useDataStore()
const uiStore = useUIStore()
const userPopover = useUserPopoverStore()
const vault = useVault()
const auth = useAuth()
const syncState = useSyncState()
const railUserRef = ref<HTMLElement | null>(null)

// 分享只读态：隐藏「管理分类」等写类入口（点分类/切走即退出分享，见 share store 的 watch）
const shareMode = computed(() => uiStore.shareMode)

// 当前是否在私密空间（数据集）；入口/返回按钮与 logo 切换依此
const isVault = computed(() => uiStore.curSpace === 'vault')

// B-11：按 order 升序渲染，pull 后字段已更新但数组位置可能仍是本地旧序。
// 置顶护栏：全部/未分类是虚拟分类，恒排最前，不参与 order 排序——云端存量
// order 可能是 B-12 修复前的毫秒戳（超界），pull assign 直接覆盖本地 0/1 会让
// 这两项穿插进真实分类之间；渲染层置顶后 order 数据异常不再影响显示顺序。
const categories = computed(() => {
  const all = dataStore.categories
  const virtual = all.filter(c => !c.deletedAt && (c.id === CAT_ALL || c.id === CAT_UNCATEGORIZED))
  const rest = all
    .filter(c => !c.deletedAt && c.id !== CAT_ALL && c.id !== CAT_UNCATEGORIZED)
  const restSorted = rest.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  return [...virtual, ...restSorted]
})
const curCat = computed(() => uiStore.curCat)
const cardCounts = computed(() => dataStore.cardCounts)

const customAvatarEmoji = computed(() => {
  return auth.avatar || ''
})

const userInitial = computed(() => {
  const name = auth.displayName || auth.userEmail
  if (!name) return 'U'
  return name.charAt(0).toUpperCase()
})

const userDisplay = computed(() => {
  if (!auth.userEmail) return ''
  return auth.userEmail.split('@')[0]
})

function selectCat(id: string) {
  uiStore.curCat = id
  uiStore.focusedGroupId = null
  // A4-006：移动端点分类后关 rail，避免遮罩残留
  if (uiStore.isMobile) uiStore.panels.rail = false
}

/** 退出私密空间：锁保险柜并切回主页数据集 */
async function onBackToMain() {
  vault.lockVault()
  await dataStore.switchSpace('main')
}

function onUserClick() {
  if (!auth.isLoggedIn) {
    auth.authModalOpen = true
    if (uiStore.isMobile) {
      uiStore.panels.rail = false
    }
  } else {
    const rect = railUserRef.value?.getBoundingClientRect()
    userPopover.toggle(rect)
  }
}

function toggleThemeQuick(e?: MouseEvent) {
  uiStore.toggleTheme(e)
}

function openCatModalNav() { openCatModal() }
</script>