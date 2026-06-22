/**
 * useAppLifecycle — 应用生命周期管理
 * 从 useApp.js 拆分，职责单一：数据加载、UI 恢复、beforeunload 持久化。
 */
import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../stores/app.js'
import { mentionAPI } from './bridge.js'
import { importFromURL, detectShareRoute } from './domain/useDataIO.js'

// A4: 分享路由回调，App.vue 注册以接收 share group ID
let _onShareRoute: ((gid: string) => void) | null = null
export function onShareRoute(cb: (gid: string) => void) { _onShareRoute = cb }
import { useAuth } from './domain/useAuth.js'
import { useCloudSync } from './domain/useCloudSync.js'
import { updateCardTagsOverflow, initCardTags, destroyCardTags } from './ui/useUI.js'
import { captureNavState } from './interaction/useKeyboardOps.js'
import { flushIDB } from '../stores/persist.js'

export function useAppLifecycle() {
  const store = useAppStore()
  const cleanups: Array<() => void> = []

  onMounted(async () => {
    const onImgErr = (e: Event) => { if ((e.target as HTMLElement).tagName === 'IMG') (e.target as HTMLElement).classList.add('img-error') }
    document.addEventListener('error', onImgErr, true)
    cleanups.push(() => document.removeEventListener('error', onImgErr, true))

    if (history.scrollRestoration) history.scrollRestoration = 'manual'

    store.loadFromStorage()
    store.tryLoadFromIDB().catch((e: Error) => console.warn('[LinkVault] IDB load failed:', e.message))
    store.restoreUIState()
    // A4: 检测公开分享路由（#share/<id>），优先于旧版 base64 分享
    const shareGid = detectShareRoute()
    if (shareGid) {
      _onShareRoute?.(shareGid)
    } else {
      importFromURL()
    }
    updateCardTagsOverflow()

    // 初始化认证 & 云同步
    const auth = useAuth()
    await auth.init()
    const sync = useCloudSync()
    sync.initOnlineListener()
    if (auth.isLoggedIn.value) {
      sync.initialSync().catch((e: Error) => console.warn('[LinkVault] Cloud sync failed:', e.message))
    }

    const flushAndSave = () => {
      flushIDB()
      store.flushDebouncedSave()
    }
    const onSaveUI = () => store.saveUIState()
    const onClearSel = () => window.getSelection()?.removeAllRanges()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushAndSave()
    }
    window.addEventListener('beforeunload', flushAndSave)
    window.addEventListener('beforeunload', onSaveUI)
    window.addEventListener('beforeunload', onClearSel as EventListener)
    document.addEventListener('visibilitychange', onVisibilityChange)
    cleanups.push(() => {
      window.removeEventListener('beforeunload', flushAndSave)
      window.removeEventListener('beforeunload', onSaveUI)
      window.removeEventListener('beforeunload', onClearSel as EventListener)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    })

    initCardTags()
    mentionAPI?.init?.()
    if (history.replaceState) history.replaceState(captureNavState(), '')
  })

  onUnmounted(() => {
    cleanups.forEach(fn => fn())
    cleanups.length = 0
    destroyCardTags()
    mentionAPI?.destroy?.()
    try { useCloudSync().destroyOnlineListener() } catch (_) { /* ignore */ }
  })
}
