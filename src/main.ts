import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/main.css'
import App from './App.vue'
import { vueErrorHandler, unhandledRejectionHandler } from './lib/errorReporter.js'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)

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
    h2.textContent = '出错了'
    const p = document.createElement('p')
    p.style.color = '#888'
    p.textContent = err instanceof Error ? err.message : '未知错误'
    const btn = document.createElement('button')
    btn.id = 'lv-reload-btn'
    btn.type = 'button'
    btn.style.cssText = 'margin-top:16px;padding:8px 24px'
    btn.textContent = '重试'
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
      onNeedRefresh() { /* autoUpdate 会走 onRegisteredSW 路径 */ },
      onOfflineReady() { /* no-op */ },
      onRegisteredSW(_swUrl, registration) {
        // 新 SW 控制页面后强制 reload，保证 index + 异步 chunk 同代
        registration?.addEventListener('updatefound', () => {
          const nw = registration.installing
          if (!nw) return
          nw.addEventListener('statechange', () => {
            if (nw.state === 'activated' && navigator.serviceWorker.controller) {
              window.location.reload()
            }
          })
        })
      },
    })
  }).catch(() => { /* virtual:pwa-register 在非 PWA 构建中可能不可用 */ })
}
