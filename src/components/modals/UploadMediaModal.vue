<template>
  <div v-if="open" class="up-media-overlay" @click.self="close">
    <div class="up-media-modal" role="dialog" aria-modal="true" :aria-label="t('ai.uploadDeepTitle')">
      <header class="up-media-head">
        <div>
          <h2 class="up-media-title">{{ t('ai.uploadDeepTitle') }}</h2>
          <p class="up-media-hint">{{ t('ai.uploadDeepHint') }}</p>
        </div>
        <button class="up-media-close" type="button" :aria-label="t('ai.uploadDeepClose')" @click="close">×</button>
      </header>

      <div
        class="up-media-drop"
        :class="{ 'is-drag': dragging }"
        @click="pickFile"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <input ref="fileInput" class="up-media-file" type="file" :accept="ACCEPT" @change="onFileChange" />
        <template v-if="file">
          <div class="up-media-file-name">{{ file.name }}</div>
          <div class="up-media-file-meta">{{ kindLabel }} · {{ formatSize(file.size) }}</div>
        </template>
        <template v-else>
          <div class="up-media-drop-title">{{ t('ai.uploadDeepPick') }}</div>
          <div class="up-media-drop-sub">mp3 / m4a / wav / mp4 / mov / webm / jpg / png / webp</div>
        </template>
      </div>

      <label class="up-media-rights">
        <input v-model="rights" type="checkbox" :disabled="busy" />
        <span>{{ t('ai.uploadDeepRights') }}</span>
      </label>

      <div v-if="status" class="up-media-status" :class="`is-${statusTone}`">{{ status }}</div>
      <div v-if="error" class="up-media-error">{{ error }}</div>

      <section v-if="result" class="up-media-result">
        <h3 class="up-media-sub">{{ t('ai.uploadDeepTranscript') }}</h3>
        <pre class="up-media-transcript">{{ result.transcript?.text || '—' }}</pre>
        <h3 class="up-media-sub">{{ t('ai.uploadDeepUrls') }}</h3>
        <div v-if="result.on_screen_urls?.length" class="up-media-links">
          <a v-for="item in result.on_screen_urls" :key="item.url" :href="item.url" target="_blank" rel="noreferrer">
            {{ item.url }}
          </a>
        </div>
        <div v-else class="up-media-empty">—</div>
      </section>

      <footer class="up-media-foot">
        <button class="up-media-btn ghost" type="button" :disabled="busy" @click="close">{{ t('ai.uploadDeepClose') }}</button>
        <button class="up-media-btn primary" type="button" :disabled="!canStart || busy" @click="start">
          {{ busy ? (phase === 'upload' ? t('ai.uploadDeepUploading') : t('ai.uploadDeepProcessing')) : t('ai.uploadDeepStart') }}
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '../../stores/auth.js'
import { t } from '../../i18n/index.js'
import {
  deleteDeepMediaFile,
  detectUploadKind,
  formatUploadSize,
  uploadDeepMediaFile,
  validateUploadFile,
} from '../../lib/ai/deepMediaUpload.js'
import { pollDeepVideo, submitDeepUpload, type DeepVideoResult } from '../../lib/ai/deepVideoExtract.js'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const ACCEPT = '.mp3,.m4a,.wav,.aac,.mp4,.mov,.webm,.jpg,.jpeg,.png,.webp,audio/*,video/*,image/*'
const authStore = useAuthStore()
const fileInput = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const rights = ref(false)
const dragging = ref(false)
const busy = ref(false)
const phase = ref<'upload' | 'process'>('upload')
const status = ref('')
const statusTone = ref<'info' | 'success' | 'error'>('info')
const error = ref('')
const result = ref<DeepVideoResult | null>(null)

const fileKind = computed(() => (file.value ? detectUploadKind(file.value) : null))
const kindLabel = computed(() => {
  if (fileKind.value === 'audio') return '音频'
  if (fileKind.value === 'video') return '视频'
  if (fileKind.value === 'image') return '图片'
  return '文件'
})
const canStart = computed(() => !!file.value && rights.value)

function formatSize(bytes: number): string {
  return formatUploadSize(bytes)
}

function pickFile(): void {
  if (!busy.value) fileInput.value?.click()
}

function setFile(next: File | null): void {
  error.value = ''
  result.value = null
  status.value = ''
  try {
    if (next) validateUploadFile(next)
    file.value = next
  } catch (e) {
    file.value = null
    error.value = (e as Error)?.message || '文件不合法'
  }
}

function onFileChange(e: Event): void {
  const target = e.target as HTMLInputElement
  setFile(target.files?.[0] || null)
  target.value = ''
}

function onDrop(e: DragEvent): void {
  dragging.value = false
  setFile(e.dataTransfer?.files?.[0] || null)
}

function close(): void {
  if (busy.value) return
  emit('close')
}

async function start(): Promise<void> {
  if (!file.value) {
    error.value = t('ai.uploadDeepNoFile')
    return
  }
  if (!rights.value) {
    error.value = t('ai.uploadDeepNeedRights')
    return
  }
  const userId = String((authStore.user as { id?: string } | null)?.id || '')
  if (!userId) {
    error.value = t('ai.uploadDeepLogin')
    return
  }
  error.value = ''
  result.value = null
  busy.value = true
  phase.value = 'upload'
  statusTone.value = 'info'
  status.value = t('ai.uploadDeepUploading')
  let objectPath = ''
  try {
    const uploaded = await uploadDeepMediaFile(file.value, userId)
    objectPath = uploaded.path
    phase.value = 'process'
    status.value = t('ai.uploadDeepProcessing')
    const job = await submitDeepUpload({ kind: uploaded.kind, url: uploaded.url, title: uploaded.title })
    const final = await pollDeepVideo(job.job_id, {
      onProgress: (stage, progress) => {
        const pct = Math.round(progress * 100)
        status.value = `${t('ai.uploadDeepProcessing')} ${pct}%${stage ? ` · ${stage}` : ''}`
      },
    })
    if (final.status === 'failed') {
      const code = final.error?.code || 'failed'
      const message = final.error?.message || ''
      throw new Error(`${t('ai.uploadDeepFailed')}（${code}）${message ? `：${message}` : ''}`)
    }
    result.value = final.result || null
    statusTone.value = 'success'
    status.value = t('ai.uploadDeepDone')
  } catch (e) {
    statusTone.value = 'error'
    status.value = ''
    error.value = (e as Error)?.message || t('ai.uploadDeepFailed')
  } finally {
    if (objectPath) void deleteDeepMediaFile(objectPath)
    busy.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    file.value = null
    rights.value = false
    error.value = ''
    status.value = ''
    result.value = null
    busy.value = false
  },
)
</script>

<style scoped>
.up-media-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  background: rgba(30, 24, 20, 0.42);
  backdrop-filter: blur(2px);
}
.up-media-modal {
  width: min(720px, 100%);
  max-height: min(84vh, 760px);
  overflow: auto;
  border-radius: 16px;
  border: 1px solid var(--border-color, #e6d9cd);
  background: var(--bg-primary, #fffaf6);
  color: var(--text-primary, #2f2a26);
  box-shadow: 0 24px 64px rgba(36, 26, 18, 0.22);
  padding: 20px 22px 18px;
}
.up-media-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.up-media-title {
  margin: 0;
  font-size: 18px;
}
.up-media-hint {
  margin: 6px 0 0;
  color: var(--text-secondary, #7a6f66);
  font-size: 12px;
  line-height: 1.6;
}
.up-media-close {
  border: 0;
  background: transparent;
  color: var(--text-secondary, #7a6f66);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.up-media-drop {
  margin-top: 16px;
  border: 1px dashed var(--border-color, #d8c8b8);
  border-radius: 12px;
  padding: 22px 16px;
  text-align: center;
  cursor: pointer;
  background: var(--bg-secondary, #fbf4ed);
}
.up-media-drop.is-drag {
  border-color: var(--accent-color, #2f6f6b);
  background: var(--accent-soft, #e3f0ee);
}
.up-media-file {
  display: none;
}
.up-media-drop-title {
  font-weight: 600;
}
.up-media-drop-sub {
  margin-top: 6px;
  color: var(--text-secondary, #7a6f66);
  font-size: 12px;
}
.up-media-file-name {
  font-weight: 600;
  word-break: break-all;
}
.up-media-file-meta {
  margin-top: 4px;
  color: var(--text-secondary, #7a6f66);
  font-size: 12px;
}
.up-media-rights {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary, #7a6f66);
}
.up-media-rights input {
  margin-top: 3px;
}
.up-media-status {
  margin-top: 12px;
  font-size: 12px;
}
.up-media-status.is-info {
  color: var(--accent-color, #2f6f6b);
}
.up-media-status.is-success {
  color: #2f7a4f;
}
.up-media-status.is-error,
.up-media-error {
  color: #a0442f;
}
.up-media-error {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fdeeea;
  font-size: 12px;
  white-space: pre-wrap;
}
.up-media-result {
  margin-top: 16px;
}
.up-media-sub {
  margin: 14px 0 6px;
  font-size: 13px;
  color: var(--text-secondary, #7a6f66);
}
.up-media-transcript {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #e6d9cd);
  background: var(--bg-secondary, #fbf4ed);
  font: inherit;
  font-size: 12px;
}
.up-media-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}
.up-media-links a {
  color: var(--accent-color, #2f6f6b);
  word-break: break-all;
}
.up-media-empty {
  color: var(--text-secondary, #7a6f66);
  font-size: 12px;
}
.up-media-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.up-media-btn {
  border-radius: 9px;
  border: 1px solid var(--border-color, #d8c8b8);
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  background: transparent;
  color: inherit;
}
.up-media-btn.primary {
  border-color: transparent;
  background: var(--accent-color, #2f6f6b);
  color: #fff;
}
.up-media-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
