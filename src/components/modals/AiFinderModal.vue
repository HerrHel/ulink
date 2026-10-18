<template>
  <div
    class="modal-mask"
    role="dialog"
    aria-modal="true"
    :aria-label="t('ai.modalTitle')"
    :class="{ open: ui.modals.aiFinder }"
    @click.self="close"
  >
    <div class="modal modal-lg ai-finder-modal" @click.stop>
      <div class="modal-head">
        <div class="modal-title">
          <span class="ai-title-badge">PRO</span>
          <span>{{ t('ai.modalTitle') }}</span>
        </div>
        <button class="modal-close" @click="close" :title="t('common.close')" v-html="I.close"></button>
      </div>

      <!-- Tab 切换器：寻站 / 平替 / 视频提炼 -->
      <div class="ai-tabs-nav">
        <button
          class="ai-tab-btn"
          :class="{ active: currentTab === 'intent' }"
          @click="currentTab = 'intent'"
        >
          <span aria-hidden="true" v-html="I.search"></span>
          <span>{{ t('ai.tabIntent') }}</span>
        </button>
        <button
          class="ai-tab-btn"
          :class="{ active: currentTab === 'similar' }"
          @click="currentTab = 'similar'"
        >
          <span aria-hidden="true" v-html="I.link"></span>
          <span>{{ t('ai.tabSimilar') }}</span>
        </button>
        <button
          class="ai-tab-btn"
          :class="{ active: currentTab === 'video' }"
          @click="currentTab = 'video'"
        >
          <span aria-hidden="true" v-html="I.sparkle || I.plus"></span>
          <span>{{ t('ai.tabVideo') }}</span>
        </button>
      </div>

      <div class="modal-body ai-modal-body">
        <!-- 偏好选择器 -->
        <div class="ai-pref-wrapper">
          <span class="ai-pref-caption">{{ t('ai.filterPreferences') }}:</span>
          <AiPreferenceChips v-model="preferences" />
        </div>

        <!-- 模式 1：意图寻站 -->
        <div v-if="currentTab === 'intent'" class="ai-panel-view">
          <div class="ai-search-box">
            <input
              type="text"
              class="form-input ai-input-field"
              v-model="intentQuery"
              :placeholder="t('ai.intentPlaceholder')"
              @keydown.enter="onSearchIntent"
            />
            <button
              class="btn btn-primary btn-sm ai-submit-btn"
              :disabled="loading || !intentQuery.trim()"
              @click="onSearchIntent"
            >
              {{ loading ? t('ai.searching') : t('ai.searchAction') }}
            </button>
          </div>
        </div>

        <!-- 模式 2：类似网站与平替挖掘 -->
        <div v-else-if="currentTab === 'similar'" class="ai-panel-view">
          <div class="ai-search-box">
            <input
              type="text"
              class="form-input ai-input-field"
              v-model="targetUrl"
              :placeholder="t('ai.similarPlaceholder')"
              @keydown.enter="onFindSimilar"
            />
            <button
              class="btn btn-primary btn-sm ai-submit-btn"
              :disabled="loading || !targetUrl.trim()"
              @click="onFindSimilar"
            >
              {{ loading ? t('ai.analyzing') : t('ai.similarAction') }}
            </button>
          </div>
        </div>

        <!-- 模式 3：视频收割提炼 -->
        <div v-else-if="currentTab === 'video'" class="ai-panel-view">
          <div class="ai-video-box">
            <textarea
              class="form-textarea ai-video-input"
              rows="3"
              v-model="videoInput"
              :placeholder="t('ai.videoPlaceholder')"
            ></textarea>
            <div class="ai-video-actions">
              <button
                class="btn btn-primary btn-sm"
                :disabled="loading || !videoInput.trim()"
                @click="onExtractVideo"
              >
                {{ loading ? t('ai.extracting') : t('ai.videoAction') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 结果列表渲染区 -->
        <div v-if="loading" class="ai-loading-box">
          <div class="ai-spinner"></div>
          <span>{{ t('ai.aiThinking') }}</span>
        </div>

        <div v-else-if="candidates.length > 0" class="ai-results-wrap">
          <div class="ai-results-header">
            <span class="ai-results-count">{{ t('ai.foundCount', { n: candidates.length }) }}</span>
            <div class="ai-bulk-actions">
              <button
                v-if="hasUnadded"
                class="btn btn-ghost btn-xs"
                @click="addAllCandidates"
              >
                {{ t('ai.addAllDirect') }}
              </button>
              <button
                v-if="currentTab === 'video' && videoResult"
                class="btn btn-primary btn-xs"
                @click="createGroupFromResults"
              >
                <span aria-hidden="true" v-html="I.folder"></span>
                {{ t('ai.packAsGroup') }}
              </button>
            </div>
          </div>

          <div v-if="currentTab === 'video' && videoResult?.summary" class="ai-video-summary">
            <span class="ai-video-summary-label">{{ t('ai.videoSummaryLabel') }}</span>
            <p class="ai-video-summary-text">{{ videoResult.summary }}</p>
          </div>

          <div class="ai-cards-stream">
            <AiCandidateCard
              v-for="item in candidates"
              :key="item.url"
              :candidate="item"
            />
          </div>
        </div>

        <!-- 空态提示 -->
        <div v-else-if="searched && !loading" class="empty empty-compact">
          <p>{{ t('ai.emptyResultsHint') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { I } from '../../config/icons.js'
import { t } from '../../i18n/index.js'
import { toast } from '../../lib/toast.js'
import { gid } from '../../utils.js'
import { CAT_UNCATEGORIZED, ATTR_IS_GROUP } from '../../config/constants.js'
import { saveAppData } from '../../stores/app.js'
import { candidateToBookmark } from '../../lib/ai/candidateSave.js'
import AiPreferenceChips from '../ui/AiPreferenceChips.vue'
import AiCandidateCard from '../cards/AiCandidateCard.vue'
import type { SiblingGroup } from '../../types.js'
import type { AiSearchPreference, AiCandidateBookmark, AiVideoExtractResult } from '../../types/ai.js'
import {
  searchWebsitesByIntent,
  findSimilarWebsites,
  extractBookmarksFromVideo,
} from '../../lib/ai/cloudAiClient.js'

const ui = useUIStore()
const ds = useDataStore()

const currentTab = ref<'intent' | 'similar' | 'video'>('intent')
const preferences = ref<AiSearchPreference[]>(['free', 'no_proxy'])

const intentQuery = ref('')
const targetUrl = ref('')
const targetTitle = ref('')
const videoInput = ref('')

const loading = ref(false)
const searched = ref(false)
const candidates = ref<AiCandidateBookmark[]>([])
const videoResult = ref<AiVideoExtractResult | null>(null)

// 响应打开时的入参状态
watch(
  () => ui.modals.aiFinder,
  (open) => {
    if (open) {
      currentTab.value = ui.aiFinderInitialTab || 'intent'
      if (ui.aiFinderInitialQuery) {
        intentQuery.value = ui.aiFinderInitialQuery
        onSearchIntent()
      }
      if (ui.aiFinderInitialTargetUrl) {
        targetUrl.value = ui.aiFinderInitialTargetUrl
        targetTitle.value = ui.aiFinderInitialTargetTitle || ''
        onFindSimilar()
      }
    } else {
      loading.value = false
      searched.value = false
      candidates.value = []
      videoResult.value = null
    }
  }
)

const hasUnadded = computed(() => candidates.value.some(c => !c.isAdded))

function close() {
  ui.modals.aiFinder = false
}

async function onSearchIntent() {
  if (!intentQuery.value.trim()) return
  loading.value = true
  searched.value = true
  try {
    candidates.value = await searchWebsitesByIntent(
      intentQuery.value,
      preferences.value,
      ds.categories,
      ds.customAttributes
    )
  } finally {
    loading.value = false
  }
}

async function onFindSimilar() {
  if (!targetUrl.value.trim()) return
  loading.value = true
  searched.value = true
  try {
    candidates.value = await findSimilarWebsites(
      targetUrl.value,
      targetTitle.value,
      preferences.value,
      ds.categories,
      ds.customAttributes
    )
  } finally {
    loading.value = false
  }
}

async function onExtractVideo() {
  if (!videoInput.value.trim()) return
  loading.value = true
  searched.value = true
  try {
    const res = await extractBookmarksFromVideo(
      videoInput.value,
      ds.categories,
      ds.customAttributes
    )
    videoResult.value = res
    candidates.value = res.bookmarks
  } finally {
    loading.value = false
  }
}

/** 一键直接存入全部候选网站（零弹窗，全自动赋给预匹配分类） */
function addAllCandidates() {
  let count = 0
  for (const c of candidates.value) {
    if (!c.isAdded) {
      ds.addBookmark(candidateToBookmark(ds, c))
      c.isAdded = true
      count++
    }
  }
  if (count) saveAppData()
  toast(t('ai.addedBatchSuccess', { n: count }), true)
}

/** 视频提取一键打包建组 */
function createGroupFromResults() {
  if (!videoResult.value || !candidates.value.length) return

  const addedIds: string[] = []
  for (const c of candidates.value) {
    const bm = candidateToBookmark(ds, c)
    ds.addBookmark(bm)
    c.isAdded = true
    addedIds.push(bm.id)
  }

  // 与 useGroup.createGroup 同范式：完整 SiblingGroup + addGroup（order 取现存最大 +1 排最前）
  const maxBmOrder = ds.bookmarks.reduce((m, b) => (b.parentId ? m : b.order > m ? b.order : m), -1)
  const maxGrpOrder = ds.siblingGroups.reduce((m, g) => (g.order > m ? g.order : m), -1)
  const group: SiblingGroup = {
    id: 'sg_' + gid(),
    name: videoResult.value.groupTitle || '视频提取工具合集',
    categoryId: CAT_UNCATEGORIZED,
    icon: '',
    order: Math.max(maxBmOrder, maxGrpOrder) + 1,
    isExpanded: false,
    attributes: { [ATTR_IS_GROUP]: true },
    bookmarkIds: addedIds,
    notes: videoResult.value.groupNotes || '',
    updatedAt: Date.now(),
    useCount: 0,
  }
  ds.addGroup(group)
  saveAppData()

  toast(t('ai.packedGroupSuccess', { name: group.name }), true)
}
</script>

<style scoped>
.ai-finder-modal {
  max-width: 680px;
}
.ai-video-summary {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-hover);
}
.ai-video-summary-label {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: var(--accent);
  margin-bottom: 4px;
}
.ai-video-summary-text {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.ai-title-badge {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  letter-spacing: 0.05em;
}
.ai-tabs-nav {
  display: flex;
  border-bottom: 1px solid var(--border-light);
  background: var(--surface-hover);
  padding: 0 16px;
}
.ai-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
}
.ai-tab-btn:hover {
  color: var(--text);
}
.ai-tab-btn.active {
  color: var(--accent);
  font-weight: 600;
  border-bottom-color: var(--accent);
}
.ai-tab-btn svg {
  width: 14px;
  height: 14px;
}
.ai-modal-body {
  padding: 16px 20px 24px;
  max-height: 75vh;
  overflow-y: auto;
}
.ai-pref-wrapper {
  margin-bottom: 12px;
}
.ai-pref-caption {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
}
.ai-search-box {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.ai-input-field {
  flex: 1;
}
.ai-video-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.ai-video-input {
  width: 100%;
}
.ai-video-actions {
  display: flex;
  justify-content: flex-end;
}
.ai-loading-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 0;
  color: var(--text-muted);
  font-size: 0.82rem;
}
.ai-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ai-spin 0.8s linear infinite;
}
@keyframes ai-spin {
  to { transform: rotate(360deg); }
}
.ai-results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ai-results-count {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}
.ai-bulk-actions {
  display: flex;
  gap: 8px;
}
.ai-cards-stream {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
