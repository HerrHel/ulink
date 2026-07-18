<template>
  <slot v-if="!errored" />
  <div
    v-else
    class="error-boundary-fallback"
    role="alert"
    aria-live="assertive"
    tabindex="-1"
    ref="fallbackRef"
  >
    <div class="error-boundary-icon">⚠</div>
    <h3>出错了</h3>
    <p>{{ errorMsg }}</p>
    <!-- A6-002：生产不渲染 stack；仅 dev 或 ?debug=1 可见 -->
    <pre v-if="showStack && errStack" style="font-size:11px;max-height:200px;overflow:auto;text-align:left">{{ errStack }}</pre>
    <button ref="retryBtnRef" class="btn btn-secondary" @click="reload">重试</button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onErrorCaptured } from 'vue'
import { reportError } from '../../lib/errorReporter.js'
import { useE2EStore } from '../../stores/e2e.js'

const props = defineProps<{ name?: string }>()

const errored = ref(false)
const errorMsg = ref('')
const errStack = ref('')
const fallbackRef = ref<HTMLElement | null>(null)
const retryBtnRef = ref<HTMLButtonElement | null>(null)
// A6-002：stack 仅诊断，不进生产 DOM
const showStack = import.meta.env.DEV ||
  (typeof location !== 'undefined' && /[?&]debug=1\b/.test(location.search))

onErrorCaptured((err: Error) => {
  errored.value = true
  errorMsg.value = err.message || '未知错误'
  errStack.value = showStack ? (err.stack || '').split('\n').slice(0, 6).join('\n') : ''
  console.error('[ErrorBoundary]', props.name || 'boundary', err)
  // A6-001：return false 会阻断 app.config.errorHandler；此处主动上报，消除监控黑洞
  try {
    reportError({
      message: err.message || String(err),
      stack: err.stack,
      component: props.name ? `ErrorBoundary:${props.name}` : 'ErrorBoundary',
    })
  } catch { /* 上报失败不影响回退 UI */ }
  // A6-003：边界捕获时 drain pendingUnlock，避免 E2E 解锁 Promise 永挂
  try {
    const e2e = useE2EStore()
    const pending = e2e.pendingUnlock.splice(0)
    for (const resolve of pending) {
      try { resolve(false) } catch { /* ignore */ }
    }
  } catch { /* store 未就绪 */ }
  // A6-006：读屏播报 + 焦点落到「重试」
  nextTick(() => {
    retryBtnRef.value?.focus()
    if (document.activeElement !== retryBtnRef.value) fallbackRef.value?.focus()
  })
  return false // 阻止继续传播（防白屏），上报已在上面完成
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
