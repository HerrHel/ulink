<template>
  <slot v-if="!errored" />
  <div v-else class="error-boundary-fallback">
    <div class="error-boundary-icon">⚠</div>
    <h3>出错了</h3>
    <p>{{ errorMsg }}</p>
    <pre style="font-size:11px;max-height:200px;overflow:auto;text-align:left">{{ errStack }}</pre>
    <button class="btn btn-secondary" @click="reload">重试</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue'

defineProps<{ name?: string }>()

const errored = ref(false)
const errorMsg = ref('')
const errStack = ref('')

onErrorCaptured((err: Error) => {
  errored.value = true
  errorMsg.value = err.message || '未知错误'
  errStack.value = (err.stack || '').split('\n').slice(0, 6).join('\n')
  console.error('[ErrorBoundary]', err)
  return false // 阻止继续传播
})

function reload() {
  location.reload()
}
</script>

<style scoped>
.error-boundary-fallback {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-secondary);
}
.error-boundary-icon {
  font-size: 36px;
  margin-bottom: 12px;
}
.error-boundary-fallback h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
.error-boundary-fallback p {
  margin: 0 0 16px;
  font-size: 13px;
  opacity: 0.7;
}
</style>
