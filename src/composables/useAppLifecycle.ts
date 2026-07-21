/**
 * useAppLifecycle — 应用生命周期管理
 * 从 useApp.js 拆分，职责单一：数据加载、UI 恢复、beforeunload 持久化。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { useDataStore } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { flushSaveAppData } from '../stores/app.js'
import { useMentionStore } from '../stores/overlay.js'
import { detectShareRoute } from './domain/useDataShare.js'
import { loadData, saveToLocalStorage as persistSaveToLocalStorage } from '../stores/persist.js'

// A4: 分享路由回调，App.vue 注册以接收 share group ID
let _onShareRoute: ((gid: string) => void) | null = null
export function onShareRoute(cb: (gid: string) => void) { _onShareRoute = cb }

// E1 门闩实现见 lib/dataReady；此处 re-export 便于 App 与其它入口使用
export { whenDataReady, isDataHydrated } from '../lib/dataReady.js'
import { markDataReady } from '../lib/dataReady.js'
import { safeGetItem } from '../lib/storageSafe.js'

// D2: Web Share Target 与扩展保存请求统一由 App.vue:saveFromExtension 处理（带 favicon + 撤销 toast + 统计）。
// 历史上的 _handleShareTarget 在此处同步 addBookmark，但 App.vue 的 onMounted 又会 800ms 后
// 调 saveFromExtension 读同一个 `url` 参数再添加一次——两者职责重叠且 _handleShareTarget 清理的是
// 不存在的 `share` 参数（manifest 产生的是 url/title/text），拦不住第二条路径，致同一 URL 产生重复书签。
// 删除由 saveFromExtension 单路径处理，消除重复且获得 favicon + 可撤销。

import { useAuth } from './domain/useAuth.js'
import { useCloudSync } from './domain/useCloudSync.js'
import { updateCardTagsOverflow, initCardTags, destroyCardTags } from './ui/useUI.js'
import { captureNavState } from './interaction/useKeyboardOps.js'

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
    try {
      const loaded = await loadData()
      ds.categories = loaded.categories
      ds.bookmarks = loaded.bookmarks
      ds.customAttributes = loaded.customAttributes
      ds.siblingGroups = loaded.siblingGroups
      ds._syncMaps()
      // 跨会话恢复软删书签的组归属映射，否则回收站 restore 永远丢组关系（DATA-2）
      ds._restoreDeletedGroupMemberships()
    } finally {
      // 无论 load 成败都放行扩展保存门闩，避免永久挂起
      markDataReady()
    }
    ui.restoreUIState()
    // A4/C3: 检测公开分享路由（#share/<id>）
    const shareGid = detectShareRoute()
    if (shareGid) {
      _onShareRoute?.(shareGid)
    }

    // D1: 首启分流引导
    if (!safeGetItem('lv_setup_done') && !shareGid) {
      useUIStore().modals.setupGuide = true
    }
    updateCardTagsOverflow()

    // 初始化认证 & 云同步
    const auth = useAuth()
    await auth.init()
    const sync = useCloudSync()
    // initialSync 必须在 initOnlineListener 之前执行：
    // initOnlineListener → subscribeRealtime → SUBSCRIBED 回调 → _pullChanges → 设 lastSyncAt，
    // 若 lastSyncAt 先于 initialSync 的 _pullChanges(true) 被设置，云端为空时 full 分支会把本地书签全删。
    if (auth.isLoggedIn) {
      sync.initialSync().catch((e: Error) => console.warn('[LinkVault] Cloud sync failed:', e.message))
    }
    sync.initOnlineListener()

    // 数据变更后自动触发云同步（从 app.ts save() 解耦过来的横切关注点）
    const syncWatch = watch(() => ds._saveCount, () => {
      try { useCloudSync().debouncedSync() } catch (_) { /* 未登录时忽略 */ }
    })
    cleanups.push(() => syncWatch())

    // E1-003：beforeunload 同步写 localStorage 兜底；visibility hidden 链式 await flush
    const flushAndSave = () => {
      // 同步 localStorage 快照（关页时浏览器可完成同步写，难等 IDB）
      try {
        const snap = ds._dataSnapshot()
        persistSaveToLocalStorage(snap)
      } catch (_) { /* ignore */ }
      void flushSaveAppData()
    }
    const onSaveUI = () => ui.saveUIState()
    const onClearSel = () => window.getSelection()?.removeAllRanges()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // 先同步 LS 兜底，再 await IDB flush（hidden 生命周期内尽量完成）
        try {
          const snap = ds._dataSnapshot()
          persistSaveToLocalStorage(snap)
        } catch (_) { /* ignore */ }
        void flushSaveAppData()
        // A4-005：切后台/杀进程前落盘 UI 偏好
        ui.saveUIState()
      }
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
