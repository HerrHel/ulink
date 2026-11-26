/**
 * useAppLifecycle — 应用生命周期管理
 * 从 useApp.js 拆分，职责单一：数据加载、UI 恢复、beforeunload 持久化。
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { useDataStore, _flushPendingHist } from '../stores/data.js'
import { useUIStore } from '../stores/ui.js'
import { flushSaveAppData, debouncedSaveAppData } from '../stores/app.js'
import { useMentionStore } from '../stores/overlay.js'
import { detectShareRoute } from './domain/useDataShare.js'
import { loadData, saveToLocalStorage as persistSaveToLocalStorage } from '../stores/persist.js'

// A4: 分享路由回调，App.vue 注册以接收 share group ID
let _onShareRoute: ((gid: string) => void) | null = null
export function onShareRoute(cb: (gid: string) => void) { _onShareRoute = cb }

// E1 门闩实现见 lib/dataReady；此处 re-export 便于 App 与其它入口使用
export { whenDataReady, isDataHydrated } from '../lib/dataReady.js'
import { markDataReady, isDataHydrated } from '../lib/dataReady.js'
import { onOtherInstanceSaved } from '../lib/crossInstance.js'
import { initDataOwner, isWriteAllowed, requestReload, watchOwnerChanges } from '../lib/dataOwner.js'
import { restoreDirty } from '../stores/dirtyPersist.js'
import { promptAmbiguousStashes } from './domain/useAccountStash.js'
import { useSyncStore } from '../stores/sync.js'

// 多设备主密码一致性维护（每会话一次）：登录后先确保本机 canary 上云（打通
// 「一个主密码解锁所有设备」——本机设置时未登录、之后登录，云端无 canary 则推送），
// 再对比本机与云端 canary；mismatch 时弹 E2ECanaryConflictModal 引导解决。
// 见 useE2E.ensureCloudCanarySynced / detectCloudCanaryMismatch / adoptCloudCanary。
const E2E_CONFLICT_CHECKED_KEY = 'lv_e2e_canary_conflict_checked'
async function _checkE2ECanaryConflict(): Promise<void> {
  try {
    if (sessionStorage.getItem(E2E_CONFLICT_CHECKED_KEY)) return
    sessionStorage.setItem(E2E_CONFLICT_CHECKED_KEY, '1')
    const { ensureCloudCanarySynced, detectCloudCanaryMismatch } = useE2E()
    // 先 ensure（可能上云）再 detect：ensure 后云端有值，detect 才能准确对比
    await ensureCloudCanarySynced()
    const r = await detectCloudCanaryMismatch()
    if (r.mismatch) {
      // upgraded（其他设备改过主密码）→ 跟随迁移向导；否则 → 多设备冲突（统一/保留）
      useUIStore().modals.e2eCanaryConflict = true
      useUIStore().modals.e2eCanaryConflictUpgraded = r.upgraded
    }
  } catch { /* 检测失败静默，不打扰启动 */ }
}

// D2: Web Share Target 与扩展保存请求统一由 App.vue:saveFromExtension 处理（带 favicon + 撤销 toast + 统计）。
// 历史上的 _handleShareTarget 在此处同步 addBookmark，但 App.vue 的 onMounted 又会 800ms 后
// 调 saveFromExtension 读同一个 `url` 参数再添加一次——两者职责重叠且 _handleShareTarget 清理的是
// 不存在的 `share` 参数（manifest 产生的是 url/title/text），拦不住第二条路径，致同一 URL 产生重复书签。
// 删除由 saveFromExtension 单路径处理，消除重复且获得 favicon + 可撤销。

import { useAuth } from './domain/useAuth.js'
import { useEntitlement } from './domain/useEntitlement.js'
import { useCloudSync } from './domain/useCloudSync.js'
import { useE2E } from './domain/useE2E.js'
import { updateCardTagsOverflow, initCardTags, destroyCardTags } from './ui/useUI.js'
import { captureNavState } from './interaction/useKeyboardOps.js'

let _reloadRetryTimer: ReturnType<typeof setTimeout> | null = null
const RELOAD_RETRY_MS = 800

/**
 * 其他实例落盘后从 IDB 重新载入主页数据。
 * 本实例「忙」时（有未落盘的编辑 / 正在云同步 / 不在主页空间 / 分享只读态）不重载，稍后重试：
 * - 有未落盘编辑时强行重载会丢掉本实例的修改；等它落盘后对方会收到通知再对齐。
 *   两个实例在同一个 300ms 防抖窗口内同时改动仍是「后写者为准」，这是整份快照存储的固有限制。
 */
export async function reloadFromOtherInstance(): Promise<void> {
  if (_reloadRetryTimer) { clearTimeout(_reloadRetryTimer); _reloadRetryTimer = null }
  if (!isDataHydrated()) return
  // 对方实例已按账号换仓：本实例内存是上一个账号的数据，直接整页重载（而不是把新账号的
  // 数据载进一个仍以旧账号身份运行的实例）
  if (!isWriteAllowed()) { requestReload(); return }
  const ds = useDataStore()
  const ui = useUIStore()
  if (ui.shareMode || ui.curSpace !== 'main') return
  if (ds._saveTimer || useSyncStore().syncStatus === 'syncing') {
    _reloadRetryTimer = setTimeout(() => { void reloadFromOtherInstance() }, RELOAD_RETRY_MS)
    return
  }
  const loaded = await loadData('main')
  // await 期间可能切了空间或产生了新编辑：放弃本次，交给下一次通知 / 重试
  if (ui.curSpace !== 'main' || ds._saveTimer) return
  ds.categories = loaded.categories
  ds.bookmarks = loaded.bookmarks
  ds.customAttributes = loaded.customAttributes
  ds.siblingGroups = loaded.siblingGroups
  ds._syncMaps()
  ds._restoreDeletedGroupMemberships()
}

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
    // 账号分仓：迁移归属、从中断的换仓恢复、锁定本实例归属——必须早于任何读取本地数据
    try { await initDataOwner() } catch (e) { console.warn('[LinkVault] data owner init failed:', e) }
    cleanups.push(watchOwnerChanges())
    try {
      const loaded = await loadData()
      ds.categories = loaded.categories
      ds.bookmarks = loaded.bookmarks
      ds.customAttributes = loaded.customAttributes
      ds.siblingGroups = loaded.siblingGroups
      ds._syncMaps()
      // 跨会话恢复软删书签的组归属映射，否则回收站 restore 永远丢组关系（DATA-2）
      ds._restoreDeletedGroupMemberships()
      // 未登录期间的离线修改：待同步标记在上次会话已落盘，并回内存等登录后补推
      restoreDirty(ds)
    } finally {
      // 无论 load 成败都放行扩展保存门闩，避免永久挂起
      markDataReady()
    }
    ui.restoreUIState()
    // A4/C3: 检测公开分享路由（#share/<id>）
    const shareGid = detectShareRoute()
    if (shareGid) {
      _onShareRoute?.(shareGid)
    } else {
      // 双入口配套：给库补官网落地页书签（幂等，见 dataActionsBookmarks.ensureOfficialSiteBookmark）。
      // 分享态跳过——访问 /s/* 是看别人的组，不该写自己的库（_denyWrite 亦兜底）。
      const changed = ds.ensureOfficialSiteBookmark()
      const groupAttrChanged = ds.ensureGroupAttribute()
      if (changed || groupAttrChanged) {
        debouncedSaveAppData()
      }
    }

    updateCardTagsOverflow()

    // 初始化认证 & 云同步
    const auth = useAuth()
    await auth.init()
    const sync = useCloudSync()
    // 本地数据归属另一个账号（换号登录 / 会话异常后换号）：先整体换仓并重载，
    // 在此之前不做任何 E2E 校验值比对或上传——否则会拿上一个账号的本地校验值去比对甚至
    // 覆盖当前账号的云端主密码校验。
    // 返回 false：已换仓（页面正在重载）或换仓失败（存储不可写，同步总闸保持关闭）。
    // 两种情况都只跳过 E2E 与云同步，本地编辑 / 关页保存等其余初始化照常。
    const ownerOk = !auth.isLoggedIn || await sync.ensureLocalOwner()
    // 登录后重新检查 E2E 状态：App.vue onMounted 的 checkE2EStatus 执行时尚未登录，
    // 读不到云端 user_security → isE2EEnabled 为 false。登录后有了 auth.user，
    // 重新检查才能从云端拉取 canary 并正确设置 isE2EEnabled = true（常见于移动端、
    // 换设备等本地无 canary 但云端已设置主密码的场景）。
    if (auth.isLoggedIn && ownerOk) {
      void useEntitlement().refresh().catch(() => {})
      try {
        const e2e = useE2E()
        if (!e2e.isE2EEnabled.value) {
          await e2e.checkE2EStatus()
        }
      } catch { /* 不阻塞初始化 */ }
    }
    // 多设备主密码一致性检测：登录且本机已设主密码时，对比云端 canary。
    // 不一致时弹解决向导（统一主密码 / 保留本机），每会话最多检测一次不打扰。
    if (auth.isLoggedIn && ownerOk) {
      void _checkE2ECanaryConflict()
    }
    // initialSync 必须在 initOnlineListener 之前执行：
    // initOnlineListener → subscribeRealtime → SUBSCRIBED 回调 → _pullChanges → 设 lastSyncAt，
    // 若 lastSyncAt 先于 initialSync 的 pullChanges(false) 被设置，full-absent-delete 本可
    // 把本地书签全删（幸而 initialSync 走增量 false，不跑 full 对账，无此风险）。
    // 注：initialSync 的 initial pull 是增量(false)；全量 ID 对账只在手动 fullSync 跑。
    if (auth.isLoggedIn && ownerOk) {
      sync.initialSync()
        .then(() => promptAmbiguousStashes())
        .catch((e: Error) => console.warn('[LinkVault] Cloud sync failed:', e.message))
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
      // 必须按当前空间写对应 key：私密空间数据绝不能落到主页 linkvault_v2，
      // 否则主页 IDB 读取失败回退 LS 时会把私密内容回填进主页库（空间隔离破坏）。
      try {
        const snap = ds._dataSnapshot()
        persistSaveToLocalStorage(snap, useUIStore().curSpace)
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
          persistSaveToLocalStorage(snap, useUIStore().curSpace)
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

    // 同浏览器其他实例（另一个标签页 / 扩展侧边栏）落盘后，本实例空闲时从 IDB 重新载入，
    // 避免两边各持旧内存快照、后保存的一方把对方刚写的内容整份覆盖（见 lib/crossInstance.ts）。
    cleanups.push(onOtherInstanceSaved(() => { void reloadFromOtherInstance() }))

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
