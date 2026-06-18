/**
 * useAppLifecycle — 应用生命周期管理
 * 从 useApp.js 拆分，职责单一：数据加载、UI 恢复、beforeunload 持久化。
 */
import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../stores/app.js'
import { mentionAPI } from './bridge.js'
import { importFromURL } from './domain/useDataIO.js'
import { updateCardTagsOverflow, initCardTags, destroyCardTags } from './ui/useUI.js'
import { captureNavState } from './interaction/useKeyboardOps.js'

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
    importFromURL()
    updateCardTagsOverflow()

    const onSave = () => store.save()
    const onSaveUI = () => store.saveUIState()
    const onClearSel = () => window.getSelection()?.removeAllRanges()
    window.addEventListener('beforeunload', onSave)
    window.addEventListener('beforeunload', onSaveUI)
    window.addEventListener('beforeunload', onClearSel as EventListener)
    cleanups.push(() => {
      window.removeEventListener('beforeunload', onSave)
      window.removeEventListener('beforeunload', onSaveUI)
      window.removeEventListener('beforeunload', onClearSel as EventListener)
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
  })
}
