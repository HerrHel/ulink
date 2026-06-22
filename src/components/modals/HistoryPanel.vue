<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="版本历史" :class="{ open }" @click.self="emit('close')">
    <div class="modal modal-md">
      <div class="modal-head">
        <span class="modal-title"><span v-html="I.history" class="sp-icon"></span>版本历史</span>
        <button class="modal-close" @click="emit('close')" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body history-body">
        <div v-if="loading" class="history-loading">加载中...</div>
        <div v-else-if="versions.length === 0" class="history-empty">暂无历史版本</div>
        <div v-else class="history-list">
          <div v-for="v in versions" :key="v.id" class="history-item">
            <div class="history-item-time">{{ formatTime(v.created_at) }}</div>
            <div class="history-item-preview">{{ getPreview(v.data) }}</div>
            <button class="btn btn-ghost btn-xs" @click="onRestore(v)">恢复此版本</button>
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
import { ref, watch } from 'vue'
import { useCloudSync } from '../../composables/domain/useCloudSync.js'
import { I } from '../../config/icons.js'
import { toast } from '../../lib/toast.js'

const props = defineProps<{ open: boolean; itemId: string; itemType: 'bookmark' | 'group' }>()
const emit = defineEmits<{ close: [] }>()

const sync = useCloudSync()
const versions = ref<Array<{ id: number; data: unknown; created_at: string }>>([])
const loading = ref(false)

watch(() => props.open, async (isOpen) => {
  if (isOpen && props.itemId) {
    loading.value = true
    versions.value = await sync.fetchHistory(props.itemId)
    loading.value = false
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

async function onRestore(v: { id: number }) {
  const ok = await sync.restoreFromHistory(v.id, props.itemId, props.itemType)
  if (ok) { toast('已恢复到历史版本'); emit('close') }
  else toast('恢复失败')
}
</script>
