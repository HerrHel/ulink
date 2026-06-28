import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/main.css'
import App from './App.vue'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)

// Debug: catch rendering errors & prevent total white-screen
app.config.errorHandler = (err, instance, info) => {
  console.error('[LinkVault] Vue error:', err)
  console.error('[LinkVault] Component:', instance?.$options?.name || instance?.$?.type?.name || 'unknown')
  console.error('[LinkVault] Info:', info)
  // 尝试渲染到根节点，避免完全白屏
  const root = document.getElementById('app')
  if (root && !root.querySelector('.lv-panel, .error-boundary-fallback')) {
    root.innerHTML = `<div style="padding:40px;text-align:center;font-family:sans-serif">
      <h2>出错了</h2>
      <p style="color:#888">${(err instanceof Error ? err.message : '未知错误')}</p>
      <button onclick="location.reload()" style="margin-top:16px;padding:8px 24px">重试</button>
    </div>`
  }
}

// Mount Vue app
app.mount('#app')
