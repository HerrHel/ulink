/**
 * useAppLifecycle — 应用生命周期管理
 * 从 useApp.js 拆分，职责单一：数据加载、UI 恢复、beforeunload 持久化。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { flushSaveAppData } from '../stores/app.js'
import { useMentionStore } from '../stores/overlay.js'
import { toast } from '../lib/toast.js'
import { detectShareRoute } from './domain/useDataShare.js'
import { loadData } from '../stores/persist.js'
import { CAT_UNCATEGORIZED } from '../config/constants.js'

// A4: 分享路由回调，App.vue 注册以接收 share group ID
let _onShareRoute: ((gid: string) => void) | null = null
export function onShareRoute(cb: (gid: string) => void) { _onShareRoute = cb }

// D2: Web Share Target — 从其它 App 分享 URL 到 LinkVault
function _handleShareTarget(ds: ReturnType<typeof useDataStore>) {
  const params = new URLSearchParams(location.search)
  const sharedUrl = params.get('url') || params.get('text') || ''
  if (!sharedUrl) return
  const title = params.get('title') || sharedUrl
  // 非 http 开头的内容不是链接（可能是纯文本分享）
  const url = sharedUrl.startsWith('http') ? sharedUrl : ''
  if (!url) return
  const now = Date.now()
  ds.addBookmark({
    id: 'b' + now.toString(36) + Math.random().toString(36).slice(2, 6),
    title: title.slice(0, 200),
    url,
    username: '', password: '', notes: '', icon: '',
    categoryId: CAT_UNCATEGORIZED, parentId: null,
    order: ds.bookmarks.length, useCount: 0,
    attributes: {}, isExpanded: false,
    createdAt: now, updatedAt: now,
  })
  flushSaveAppData()
  toast('已从分享添加书签')
  // 清除 URL 参数
  history.replaceState(null, '', location.pathname + location.search.replace(/[\?&]share(&|$)/, ''))
}

import { useAuth } from './domain/useAuth.js'
import { useCloudSync } from './domain/useCloudSync.js'
import { updateCardTagsOverflow, initCardTags, destroyCardTags } from './ui/useUI.js'
import { captureNavState } from './interaction/useKeyboardOps.js'
import { flushIDB } from '../stores/persist.js'

export function useAppLifecycle() {
  const ds = useDataStore()
  const ui = useUIStore()
  const cleanups: Array<() => void> = []

  onMounted(async () => {
    const onImgErr = (e: Event) => { if ((e.target as HTMLElement).tagName === 'IMG') (e.target as HTMLElement).classList.add('img-error') }
    document.addEventListener('error', onImgErr, true)
    cleanups.push(() => document.removeEventListener('error', onImgErr, true))

    if (history.scrollRestoration) history.scrollRestoration = 'manual'

    // IDB 权威数据源，localStorage 回退（loadData 内部处理）
    const loaded = await loadData()
    ds.categories = loaded.categories
    ds.bookmarks = loaded.bookmarks
    ds.customAttributes = loaded.customAttributes
    ds.siblingGroups = loaded.siblingGroups
    ds._syncMaps()
    ui.restoreUIState()
    // A4/C3: 检测公开分享路由（#share/<id>）
    const shareGid = detectShareRoute()
    if (shareGid) {
      _onShareRoute?.(shareGid)
    }

    // D1: 首启分流引导
    if (!localStorage.getItem('lv_setup_done') && !shareGid) {
      useUIStore().modals.setupGuide = true
    }
    updateCardTagsOverflow()

    // D2: Web Share Target — 从其它 App 分享 URL 到 LinkVault
    _handleShareTarget(ds)

    // 初始化认证 & 云同步
    const auth = useAuth()
    await auth.init()
    const sync = useCloudSync()
    sync.initOnlineListener()
    if (auth.isLoggedIn.value) {
      sync.initialSync().catch((e: Error) => console.warn('[LinkVault] Cloud sync failed:', e.message))
    }

    // 数据变更后自动触发云同步（从 app.ts save() 解耦过来的横切关注点）
    const syncWatch = watch(() => ds._saveCount, () => {
      try { useCloudSync().debouncedSync() } catch (_) { /* 未登录时忽略 */ }
    })
    cleanups.push(() => syncWatch())

    const flushAndSave = () => {
      flushSaveAppData()
      flushIDB()
    }
    const onSaveUI = () => ui.saveUIState()
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
    useMentionStore().hide()
    if (history.replaceState) history.replaceState(captureNavState(), '')
  })

  onUnmounted(() => {
    cleanups.forEach(fn => fn())
    cleanups.length = 0
    destroyCardTags()
    try { useCloudSync().destroyOnlineListener() } catch (_) { /* ignore */ }
  })
}
