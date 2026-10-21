<template>
    <!-- 顶部标题栏：会话切换常驻左侧，暂存卡片入口与操作居右 -->
    <div class="chat-top-bar">
      <div class="chat-top-title-wrap">
        <button
          class="chat-session-dropdown-btn"
          @click.stop="menuOpen = !menuOpen"
          :title="t('ai.switchSession')"
          :aria-label="t('ai.switchSession')"
        >
          <span class="chat-current-title">{{ currentSessionTitle }}</span>
          <svg
            class="dropdown-chevron"
            :class="{ open: menuOpen }"
            viewBox="0 0 16 16"
            width="10"
            height="10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        <!-- 会话历史下拉浮层 -->
        <div v-if="menuOpen" class="session-dropdown-popover" @click.stop>
          <div class="session-popover-header">
            <button
              class="session-new-btn"
              :class="{ 'is-disabled': isCurrentSessionEmpty }"
              :disabled="isCurrentSessionEmpty"
              @click="emit('createSession')"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              <span>{{ t('ai.newSession') }}</span>
            </button>
          </div>
          <div class="session-list-scroll">
            <div
              v-for="s in sessions"
              :key="s.id"
              class="session-item"
              :class="{ active: s.id === currentSessionId }"
              @click="emit('switchSession', s.id)"
            >
              <span class="session-item-dot"></span>
              <div class="session-item-meta">
                <span class="session-item-title">{{ sessionItemTitle(s) }}</span>
                <span class="session-item-time">{{ formatTimeAgo(s.updatedAt) }}</span>
              </div>
              <button
                class="session-item-del"
                @click.stop="emit('deleteSession', s.id)"
                :title="t('common.delete')"
                :aria-label="t('common.delete')"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div v-if="sessions.length === 0" class="session-empty">
              {{ t('ai.noHistory') }}
            </div>
          </div>
          <div class="session-popover-foot">
            <button class="session-memory-btn" @click.stop="openMemory">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4.5-3 5.7V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.3C6.2 13.5 5 11.4 5 9a7 7 0 0 1 7-7z" />
                <path d="M9 21h6" />
              </svg>
              <span>{{ t('ai.memoryManage') }} ({{ memoryCount }})</span>
            </button>
            <button v-if="sessions.length > 1" class="session-clear-all-btn" @click="emit('clearAllSessions')">
              {{ t('ai.clearAllHistory') }}
            </button>
          </div>
        </div>

        <!-- 个人记忆管理浮层（自包含：列表 / 单删 / 清空，数据仅存本地） -->
        <div v-if="memoryOpen" class="memory-popover" @click.stop>
          <div class="memory-popover-header">
            <span class="memory-popover-title">{{ t('ai.memoryTitle') }}</span>
            <button class="memory-close-btn" @click="memoryOpen = false" :title="t('common.close')" :aria-label="t('common.close')">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div class="memory-list-scroll">
            <div v-for="e in memoryEntries" :key="e.id" class="memory-item">
              <span class="memory-badge" :class="e.kind">
                {{ e.kind === 'explicit' ? t('ai.memoryExplicit') : t('ai.memoryImplicit') }}
              </span>
              <div class="memory-item-meta">
                <span class="memory-item-text">{{ e.text }}</span>
                <span class="memory-item-time">{{ formatTimeAgo(e.updatedAt) }}</span>
              </div>
              <button
                class="memory-item-del"
                @click="removeMemory(e.id)"
                :title="t('common.delete')"
                :aria-label="t('common.delete')"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div v-if="memoryEntries.length === 0" class="session-empty">
              {{ t('ai.memoryEmpty') }}
            </div>
          </div>
          <div v-if="memoryEntries.length > 0" class="memory-popover-foot">
            <button class="session-clear-all-btn" @click="clearAllMemory">
              {{ t('ai.memoryClearAll') }}
            </button>
          </div>
        </div>
      </div>

      <div class="chat-top-actions">
        <!-- 💡 环境智能洞察入口（静默微光徽章 + 下拉抽屉） -->
        <div class="ambient-pill-wrap">
          <button
            class="chat-btn-icon ambient-badge-btn"
            :class="{ 'has-badge': activeAmbientInsights.length > 0, 'is-active': ambientOpen }"
            @click.stop="toggleAmbient"
            :title="t('ai.ambientBadge')"
            :aria-label="t('ai.ambientBadge')"
          >
            <span class="ambient-btn-icon">💡</span>
            <span v-if="activeAmbientInsights.length > 0" class="ambient-badge-count">
              {{ activeAmbientInsights.length }}
            </span>
          </button>

          <!-- 环境洞察抽屉浮层 -->
          <div v-if="ambientOpen" class="ambient-popover" @click.stop>
            <div class="ambient-popover-header">
              <div class="ambient-header-left">
                <span class="ambient-header-title">💡 {{ t('ai.ambientBadge') }}</span>
                <span v-if="activeAmbientInsights.length > 0" class="ambient-header-pill">
                  {{ activeAmbientInsights.length }}
                </span>
              </div>
              <button class="memory-close-btn" @click="ambientOpen = false" :title="t('common.close')" :aria-label="t('common.close')">
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div class="ambient-list-scroll">
              <div
                v-for="item in activeAmbientInsights"
                :key="item.id"
                class="ambient-card"
                :class="item.category"
              >
                <div class="ambient-card-top">
                  <span class="ambient-tag" :class="item.category">
                    {{ item.category === 'serendipity' ? '✨ 偶遇' : '⚡ 治理' }}
                  </span>
                  <span class="ambient-card-title">{{ item.title }}</span>
                </div>
                <div class="ambient-card-desc">{{ item.description }}</div>
                <div class="ambient-card-actions">
                  <button
                    v-if="item.actionCommand"
                    class="ambient-act-btn primary"
                    @click="applyAmbientItem(item)"
                  >
                    {{ t('ai.ambientActionExecute') }}
                  </button>
                  <button
                    class="ambient-act-btn dismiss"
                    @click="dismissAmbientItem(item.id)"
                  >
                    {{ t('ai.ambientActionDismiss') }}
                  </button>
                </div>
              </div>

              <div v-if="activeAmbientInsights.length === 0" class="session-empty">
                {{ t('ai.ambientEmpty') }}
              </div>
            </div>
          </div>
        </div>

        <button
          class="chat-btn-icon"
          :class="{ 'is-disabled': isCurrentSessionEmpty }"
          :disabled="isCurrentSessionEmpty"
          @click="emit('createSession')"
          :title="isCurrentSessionEmpty ? t('ai.alreadyNewSession') : t('ai.newSession')"
          :aria-label="t('ai.newSession')"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
        <button
          v-if="!isMobileDevice"
          class="chat-btn-icon float-hud-btn"
          :class="{ 'is-active': isFloatingHud }"
          @click="emit('toggleFloatHud')"
          :title="isFloatingHud ? t('ai.dockPanel') : t('ai.floatPanel')"
          :aria-label="isFloatingHud ? t('ai.dockPanel') : t('ai.floatPanel')"
        >
          <svg v-if="!isFloatingHud" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 3h6v6" />
            <path d="M10 14L21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M15 3v18" />
          </svg>
        </button>
        <button
          class="chat-btn-icon close-btn"
          @click="emit('close')"
          :title="t('common.close')"
          :aria-label="t('common.close')"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
    </div>
</template>

<script setup lang="ts">
import type { AiChatSession } from '../../lib/ai/chatSessions.js'
import { useI18n } from '../../i18n/index.js'
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { activeAmbientInsights, ambientHub, type AmbientInsightItem } from '../../lib/ai/ambientInsights.js'
import { useDataStore } from '../../stores/data.js'
import { listProfileEntries, removeProfileEntry, clearProfile, type AiProfileEntry } from '../../lib/ai/aiProfile.js'
import { toast, showConfirm } from '../../lib/toast.js'

defineOptions({ name: 'ChatTopBar' })

defineProps<{
  currentSessionTitle: string
  isCurrentSessionEmpty: boolean
  sessions: AiChatSession[]
  currentSessionId: string
  isMobileDevice: boolean
  isFloatingHud: boolean
  sessionItemTitle: (s: AiChatSession) => string
  formatTimeAgo: (ts: number) => string
}>()

const menuOpen = defineModel<boolean>('menuOpen', { required: true })

const emit = defineEmits<{
  createSession: []
  deleteSession: [id: string]
  clearAllSessions: []
  switchSession: [id: string]
  toggleFloatHud: []
  close: []
  applyCommand: [cmd: string]
}>()

const { t } = useI18n()

/* ===== 个人记忆管理（自包含浮层：仅本地数据，可逐条删除与清空） ===== */
const memoryOpen = ref(false)
const memoryEntries = ref<AiProfileEntry[]>([])
const memoryCount = ref(0)

function refreshMemory() {
  memoryEntries.value = listProfileEntries()
  memoryCount.value = memoryEntries.value.length
}

// 会话菜单展开时刷新计数（记忆可能在对话中新增）
watch(menuOpen, (v) => {
  if (v) {
    refreshMemory()
    ambientOpen.value = false
  }
})

function openMemory() {
  refreshMemory()
  menuOpen.value = false
  memoryOpen.value = true
}

async function removeMemory(id: string) {
  removeProfileEntry(id)
  refreshMemory()
  toast(t('ai.memoryDeleted'), true)
}

async function clearAllMemory() {
  const ok = await showConfirm(t('ai.memoryClearConfirm'))
  if (!ok) return
  clearProfile()
  refreshMemory()
  toast(t('ai.memoryCleared'), true)
}

/* ===== 环境智能洞察 (Ambient Grooming & Serendipity) ===== */
const ambientOpen = ref(false)
const dataStore = useDataStore()

function triggerAmbientScan() {
  ambientHub.refreshGroomingScan({
    bookmarks: dataStore.bookmarks || [],
    groups: dataStore.siblingGroups || [],
    categories: dataStore.categories || [],
  })
}

onMounted(() => {
  triggerAmbientScan()
})

function toggleAmbient() {
  if (!ambientOpen.value) {
    triggerAmbientScan()
    memoryOpen.value = false
    menuOpen.value = false
    ambientOpen.value = true
  } else {
    ambientOpen.value = false
  }
}

function applyAmbientItem(item: AmbientInsightItem) {
  if (item.actionCommand) {
    emit('applyCommand', item.actionCommand)
    ambientHub.dismissInsight(item.id)
    ambientOpen.value = false
  }
}

function dismissAmbientItem(id: string) {
  ambientHub.dismissInsight(id)
}

// 点击浮层外部关闭（浮层自身 @click.stop 阻止冒泡）
function onDocClick() {
  memoryOpen.value = false
  ambientOpen.value = false
}
watch([memoryOpen, ambientOpen], ([mem, amb]) => {
  if (mem || amb) document.addEventListener('click', onDocClick)
  else document.removeEventListener('click', onDocClick)
})
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<style scoped>
/* 顶栏：轻量温润，质感与 CornerInspectorCard / 主站卡片 Header 严格对齐 */
.chat-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 38px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--border-light);
  background: var(--surface);
  flex-shrink: 0;
  min-width: 0;
  user-select: none;
}

:global([data-theme="dark"]) .chat-top-bar {
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.04) inset;
}

.chat-top-title-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

/* 会话切换胶囊：主站精工卡片徽标质感，兼具微动效与手感反馈 */
.chat-session-dropdown-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  cursor: pointer;
  padding: 3px 9px;
  border-radius: var(--radius-sm, 6px);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(44, 40, 36, 0.02);
  transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  max-width: 175px;
}

.chat-session-dropdown-btn:hover {
  background: var(--surface-active);
  border-color: var(--border);
  color: var(--accent);
  transform: translateY(-0.5px);
}

:global([data-theme="dark"]) .chat-session-dropdown-btn {
  background: var(--surface-hover);
  border-color: var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset;
}

:global([data-theme="dark"]) .chat-session-dropdown-btn:hover {
  border-color: var(--border-hover);
  background: var(--surface-active);
}

.chat-current-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.dropdown-chevron.open {
  transform: rotate(180deg);
  color: var(--accent);
}

/* 会话下拉浮层：与主站 Popover / Card 质感完全对齐 */
.session-dropdown-popover {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  width: 230px;
  max-width: 260px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  overflow: hidden;
  animation: sessionPopIn 0.15s ease-out;
}

:global([data-theme="dark"]) .session-dropdown-popover {
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset,
              0 0 0 1px var(--border-hover),
              var(--shadow-xl);
}

@keyframes sessionPopIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.session-popover-header {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-light);
}

.session-new-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--radius-xs, 4px);
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease;
}

.session-new-btn:hover:not(:disabled) {
  background: var(--accent-light);
}

.session-new-btn:disabled,
.session-new-btn.is-disabled {
  opacity: 0.45;
  cursor: default;
}

.session-list-scroll {
  max-height: 200px;
  overflow-y: auto;
  padding: 4px 0;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  transition: background 0.12s ease;
  position: relative;
}

.session-item:hover,
.session-item.active {
  background: var(--surface-hover);
}

.session-item-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}

.session-item.active .session-item-dot {
  background: var(--accent);
}

.session-item-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.session-item-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-item-time {
  font-size: 10px;
  color: var(--text-muted);
}

.session-item-del {
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: var(--radius-xs, 4px);
}

.session-item-del svg {
  display: block;
}

.session-item:hover .session-item-del {
  display: inline-flex;
}

.session-item-del:hover {
  color: var(--rose);
  background: var(--rose-light);
}

.session-empty {
  padding: 16px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}

.session-popover-foot {
  padding: 4px 8px;
  border-top: 1px solid var(--border-light);
  text-align: center;
}

.session-clear-all-btn {
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 3px;
}

.session-clear-all-btn:hover {
  color: var(--rose);
}

.chat-top-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.chat-btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: all 0.12s ease;
}

.chat-btn-icon:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--border-light);
  color: var(--text);
}

.chat-btn-icon.close-btn:hover:not(:disabled) {
  background: var(--rose-light, #fee2e2);
  border-color: transparent;
  color: var(--rose, #e11d48);
}

:global([data-theme="dark"]) .chat-btn-icon:hover:not(:disabled) {
  border-color: var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.06) inset;
}

:global([data-theme="dark"]) .chat-btn-icon.close-btn:hover:not(:disabled) {
  background: var(--rose-light, rgba(244, 63, 94, 0.15));
  border-color: transparent;
  color: var(--rose, #f43f5e);
  box-shadow: none;
}

.chat-btn-icon:disabled,
.chat-btn-icon.is-disabled {
  opacity: 0.35;
  cursor: default;
}

.chat-btn-icon.float-hud-btn.is-active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
}

:global([data-theme="dark"]) .chat-btn-icon.float-hud-btn.is-active {
  background: color-mix(in srgb, var(--accent) 15%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

/* ===== 个人记忆入口与浮层（与会话下拉浮层同质感） ===== */
.session-popover-foot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.session-memory-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 3px;
  transition: color 0.12s ease, background 0.12s ease;
}

.session-memory-btn:hover {
  color: var(--accent);
  background: var(--surface-hover);
}

.memory-popover {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  width: 260px;
  max-width: 300px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  overflow: hidden;
  animation: sessionPopIn 0.15s ease-out;
}

:global([data-theme="dark"]) .memory-popover {
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset,
              0 0 0 1px var(--border-hover),
              var(--shadow-xl);
}

.memory-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-light);
}

.memory-popover-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.memory-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: var(--radius-xs, 4px);
}

.memory-close-btn:hover {
  color: var(--rose);
  background: var(--rose-light);
}

.memory-list-scroll {
  max-height: 220px;
  overflow-y: auto;
  padding: 4px 0;
}

.memory-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 10px;
  position: relative;
}

.memory-item:hover {
  background: var(--surface-hover);
}

.memory-badge {
  flex-shrink: 0;
  font-size: 9.5px;
  line-height: 1.5;
  padding: 0 5px;
  border-radius: 3px;
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  background: var(--surface-hover);
}

.memory-badge.explicit {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}

.memory-item-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.memory-item-text {
  font-size: 11.5px;
  color: var(--text);
  word-break: break-word;
}

.memory-item-time {
  font-size: 10px;
  color: var(--text-muted);
}

.memory-item-del {
  display: none;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: var(--radius-xs, 4px);
  flex-shrink: 0;
}

.memory-item:hover .memory-item-del {
  display: inline-flex;
}

.memory-item-del:hover {
  color: var(--rose);
  background: var(--rose-light);
}

.memory-popover-foot {
  padding: 4px 8px;
  border-top: 1px solid var(--border-light);
  text-align: center;
}

/* ── 环境智能胶囊与抽屉 ── */
.ambient-pill-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.ambient-badge-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ambient-badge-btn.has-badge {
  color: var(--accent);
}

.ambient-btn-icon {
  font-size: 13px;
  line-height: 1;
}

.ambient-badge-count {
  position: absolute;
  top: -2px;
  right: -3px;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 13px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  animation: ambientPulse 2.5s infinite;
}

@keyframes ambientPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.85; }
}

.ambient-popover {
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
  width: 290px;
  max-width: 320px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-base, 8px);
  box-shadow: var(--shadow-lg);
  z-index: 100;
  overflow: hidden;
  animation: sessionPopIn 0.15s ease-out;
}

:global([data-theme="dark"]) .ambient-popover {
  border: 1px solid var(--border);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.1) inset,
              0 0 0 1px var(--border-hover),
              var(--shadow-xl);
}

.ambient-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-light);
}

.ambient-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ambient-header-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.ambient-header-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 10px;
  background: var(--accent-light, rgba(59, 130, 246, 0.12));
  color: var(--accent);
}

.ambient-list-scroll {
  max-height: 320px;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ambient-card {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-light);
  background: var(--surface-hover);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: all 0.15s ease;
}

.ambient-card.serendipity {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.04);
}

.ambient-card-top {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.ambient-tag {
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
  line-height: 1.2;
}

.ambient-tag.serendipity {
  background: rgba(245, 158, 11, 0.15);
  color: #d97706;
}

.ambient-tag.grooming {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}

:global([data-theme="dark"]) .ambient-tag.serendipity {
  color: #fbbf24;
}

:global([data-theme="dark"]) .ambient-tag.grooming {
  color: #60a5fa;
}

.ambient-card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}

.ambient-card-desc {
  font-size: 11.5px;
  color: var(--text-muted);
  line-height: 1.4;
}

.ambient-card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}

.ambient-act-btn {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: none;
}

.ambient-act-btn.primary {
  background: var(--accent);
  color: #fff;
}

.ambient-act-btn.primary:hover {
  opacity: 0.9;
}

.ambient-act-btn.dismiss {
  background: transparent;
  color: var(--text-muted);
}

.ambient-act-btn.dismiss:hover {
  background: var(--surface-active);
  color: var(--text);
}
</style>
