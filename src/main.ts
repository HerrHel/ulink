import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/main.css'
import App from './App.vue'

const pinia = createPinia()
const app = createApp(App)
app.use(pinia)

// Debug: catch rendering errors
app.config.errorHandler = (err, instance, info) => {
  console.error('[LinkVault] Vue error:', err)
  console.error('[LinkVault] Component:', instance?.$options?.name || instance?.$?.type?.name || 'unknown')
  console.error('[LinkVault] Info:', info)
}

// Mount Vue app
app.mount('#app')
