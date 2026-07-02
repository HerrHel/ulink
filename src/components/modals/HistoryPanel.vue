<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="版本历史" :class="{ open }" @click.self="emit('close')">
    <div class="modal modal-md">
      <div class="modal-head">
        <span class="modal-title"><span aria-hidden="true" v-html="I.history" class="sp-icon"></span>版本历史</span>
        <button class="modal-close" @click="emit('close')" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body history-body">
        <div v-if="loading" class="history-loading">加载中...</div>
        <div v-else-if="versions.length === 0" class="history-empty">暂无历史版本</div>

        <!-- Diff 视图 -->
        <template v-else-if="diffMode">
          <div class="diff-header">
            <span class="diff-title">版本对比</span>
            <button class="btn btn-ghost btn-xs" @click="exitDiffMode">返回列表</button>
          </div>
          <div v-if="diffFields.length === 0" class="history-empty">两个版本完全相同</div>
          <div v-else class="diff-list">
            <div v-for="f in diffFields" :key="f.key" class="diff-item" :class="'diff-' + f.type">
              <div class="diff-field-label">{{ f.label }}</div>
              <div class="diff-values">
                <template v-if="f.type === 'changed'">
                  <div class="diff-old">{{ f.oldValue }}</div>
                  <div class="diff-arrow">→</div>
                  <div class="diff-new">{{ f.newValue }}</div>
                </template>
                <template v-else-if="f.type === 'added'">
                  <div class="diff-new">+ {{ f.newValue }}</div>
                </template>
                <template v-else>
                  <div class="diff-old">- {{ f.oldValue }}</div>
                </template>
              </div>
            </div>
          </div>
          <div class="diff-actions">
            <button class="btn btn-primary btn-sm" @click="onRestoreDiff">恢复到较早版本</button>
          </div>
        </template>

        <!-- 列表视图 -->
        <div v-else class="history-list">
          <div v-for="(v, idx) in versions" :key="v.id" class="history-item">
            <div class="history-item-check" v-if="versions.length > 1">
              <input type="radio" :name="'hist_' + itemId" :checked="selectedIdx === idx" @change="selectedIdx = idx">
            </div>
            <div class="history-item-main">
              <div class="history-item-time">{{ formatTime(v.created_at) }}</div>
              <div class="history-item-preview">{{ getPreview(v.data) }}</div>
            </div>
            <div class="history-item-actions">
              <button v-if="selectedIdx >= 0 && selectedIdx !== idx" class="btn btn-ghost btn-xs" @click="enterDiffMode(idx)" title="对比差异">
                <span aria-hidden="true" v-html="I.diff || '⇔'"></span> 对比
              </button>
              <button class="btn btn-ghost btn-xs" @click="onRestore(v)">恢复此版本</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { fetchLocalHistory } from '../../stores/storage.js'
import { useAuth } from '../../composables/domain/useAuth.js'
import { I } from '../../config/icons.js'
import { toast } from '../../lib/toast.js'
import { diffVersions, type DiffField } from '../../lib/diffVersions.js'

interface HistoryVersion {
  id: number
  data: unknown
  created_at: string
}

const props = defineProps<{ open: boolean; itemId: string; itemType: 'bookmark' | 'group' }>()
const emit = defineEmits<{ close: [] }>()

const sync = useCloudSync()
const auth = useAuth()
const versions = ref<HistoryVersion[]>([])
const loading = ref(false)
const selectedIdx = ref(-1)
const diffMode = ref(false)
const diffCompareIdx = ref(-1)

watch(() => props.open, async (isOpen) => {
  if (isOpen && props.itemId) {
    loading.value = true
    selectedIdx.value = -1
    diffMode.value = false
    try {
      // 本地历史（同步读取）
      const local = fetchLocalHistory(props.itemId)
      // 云端历史（登录用户）
      let remote: HistoryVersion[] = []
      if (auth.isLoggedIn.value) {
        remote = await sync.fetchHistory(props.itemId)
      }
      // 合并去重：相同 created_at 保留云端
      const seen = new Set<string>()
      const merged: HistoryVersion[] = []
      for (const v of remote) { seen.add(v.created_at); merged.push(v) }
      for (const v of local) { if (!seen.has(v.created_at)) merged.push(v) }
      merged.sort((a, b) => b.created_at.localeCompare(a.created_at))
      versions.value = merged
    } catch (e) {
      console.warn('[history] fetch failed:', e)
      versions.value = []
    } finally {
      loading.value = false
    }
  }
})

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function getPreview(data: unknown): string {
  const d = data as Record<string, unknown>
  return (d.title || d.name || d.url || '').toString().slice(0, 50)
}

const diffFields = computed<DiffField[]>(() => {
  if (selectedIdx.value < 0 || diffCompareIdx.value < 0) return []
  const v1 = versions.value[diffCompareIdx.value]
  const v2 = versions.value[selectedIdx.value]
  if (!v1 || !v2) return []
  return diffVersions(v1.data as Record<string, unknown>, v2.data as Record<string, unknown>)
})

function enterDiffMode(compareIdx: number) {
  diffCompareIdx.value = compareIdx
  diffMode.value = true
}

function exitDiffMode() {
  diffMode.value = false
  diffCompareIdx.value = -1
}

async function onRestore(v: HistoryVersion) {
  const ok = await sync.restoreFromHistory(v.id, props.itemId, props.itemType)
  if (ok) { toast('已恢复到历史版本'); emit('close') }
  else toast('恢复失败')
}

async function onRestoreDiff() {
  const targetIdx = Math.min(selectedIdx.value, diffCompareIdx.value)
  if (targetIdx < 0) return
  const v = versions.value[targetIdx]
  if (!v) return
  const ok = await sync.restoreFromHistory(v.id, props.itemId, props.itemType)
  if (ok) { toast('已恢复到较早版本'); emit('close') }
  else toast('恢复失败')
}
</script>
