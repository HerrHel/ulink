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
    // 不用内联 onclick=（会依赖 CSP script-src 'unsafe-inline'），改用 addEventListener 绑定
    root.innerHTML = `<div style="padding:40px;text-align:center;font-family:sans-serif">
      <h2>出错了</h2>
      <p style="color:#888">${(err instanceof Error ? err.message : '未知错误')}</p>
      <button id="lv-reload-btn" type="button" style="margin-top:16px;padding:8px 24px">重试</button>
    </div>`
    const btn = document.getElementById('lv-reload-btn')
    if (btn) btn.addEventListener('click', () => location.reload())
  }
}

// 全局未捕获 Promise 错误
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', unhandledRejectionHandler)
}

// Mount Vue app
app.mount('#app')
