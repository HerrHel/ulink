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
