import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/main.css'
import App from './App.vue'
import { vueErrorHandler, unhandledRejectionHandler } from './lib/errorReporter.js'
import { t, tN } from './i18n/index.js'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)
app.config.globalProperties.$t = t
app.config.globalProperties.$tN = tN

// Debug: catch rendering errors & prevent total white-screen
app.config.errorHandler = (err, instance, info) => {
  vueErrorHandler(err, instance, info)
  // 尝试渲染到根节点，避免完全白屏
  const root = document.getElementById('app')
  if (root && !root.querySelector('.lv-panel, .error-boundary-fallback')) {
    // SEC-06：用 textContent 构建，禁止把 err.message 拼进 innerHTML（防错误路径 HTML 注入）
    root.textContent = ''
    const wrap = document.createElement('div')
    wrap.style.cssText = 'padding:40px;text-align:center;font-family:sans-serif'
    const h2 = document.createElement('h2')
    h2.textContent = t('errors.crashTitle')
    const p = document.createElement('p')
    p.style.color = '#888'
    p.textContent = err instanceof Error ? err.message : t('errors.unknown')
    const btn = document.createElement('button')
    btn.id = 'lv-reload-btn'
    btn.type = 'button'
    btn.style.cssText = 'margin-top:16px;padding:8px 24px'
    btn.textContent = t('common.retry')
    btn.addEventListener('click', () => location.reload())
    wrap.append(h2, p, btn)
    root.appendChild(wrap)
  }
}

// 全局未捕获 Promise 错误
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', unhandledRejectionHandler)
}

// Mount Vue app
app.mount('#app')

// L1 E2E：仅 DEV 暴露最小测试钩子（冲突 banner UI；生产构建 tree-shake 掉）
if (import.meta.env.DEV) {
  void import('./stores/sync.js').then(({ useSyncStore }) => {
    ;(window as unknown as { __LV_E2E__?: { addConflict: (c: unknown) => void } }).__LV_E2E__ = {
      addConflict(c) {
        useSyncStore().addConflict(c as Parameters<ReturnType<typeof useSyncStore>['addConflict']>[0])
      },
    }
  })
}

// D3-001：PWA autoUpdate 仅 SW skipWaiting 不够——客户端必须 register 并在新 SW 激活后整页刷新，
// 否则旧标签懒加载异步 chunk 会 404（hash 已变）。
if (import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedRefresh() { /* autoUpdate 自动处理 skipWaiting */ },
      onOfflineReady() { /* no-op */ },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return

        // 定期轮询检查新版本——浏览器默认最长 24h 才检查一次 SW 更新，
        // 这里改为 30 分钟主动调 update() 触发更新检测。
        const POLL_MS = Number(import.meta.env.VITE_SW_UPDATE_INTERVAL) || 30 * 60 * 1000
        setInterval(() => { registration.update() }, POLL_MS)
      },
    })

    // 新 SW 激活接管后强制整页刷新，确保所有 chunk 同代（hash 一致）
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  }).catch(() => { /* virtual:pwa-register 在非 PWA 构建中可能不可用 */ })
}
