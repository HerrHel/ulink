/**
 * share.ts — 主应用内的「分享只读态」
 *
 * 设计目标：分享页不再是独立页面，而是主应用的一种只读状态。
 *   - 组分享   → 主应用「聚焦某组」形态（大组卡 + 只读笔记）
 *   - 分类分享 → 主应用「选中某分类」形态（卡片网格）
 *   - 右上角写类按钮换成「保存至我的库」，带只读标识
 *
 * 数据隔离（最重要）：分享内容一律不进 dataStore 的数组，只以影子 Map 形式
 * 由 data.ts 的 groupMap/bookmarkMap/categoryMap getter 合并可见。见 shareShadow.ts
 * 顶部说明——任何遍历数组的路径（过滤、侧栏计数、搜索、落盘、云同步）都看不到
 * 影子数据，从根上杜绝「访问一次分享链接就把他人数据写进自己库」。
 *
 * 写保护：ui.shareMode 非空时，data.ts 的所有 mutation action 与 app.ts 的
 * save() 一律静默拒写（前者见 data.ts 的 `_denyWrite`，后者见 app.ts save()）。
 * fork 是唯一合法的跨模式写操作：执行前必须 `_teardown()` 解锁并清空影子数据，
 * 否则 URL 去重会拿影子书签比对，导致所有书签被判定为「已存在」而跳过。
 */
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useUIStore } from './ui.js'
import { shadowClear, shadowSet, type ShadowData } from './shareShadow.js'
import { useAuth } from '../composables/domain/useAuth.js'
import {
  fetchPublicGroup,
  fetchPublicCategory,
  forkPublicGroup,
  forkPublicCategory,
  parseCategoryShareRoute,
  detectShareRoute,
  type PublicCategoryData,
} from '../composables/domain/useDataShare.js'
import { setTitle, setMetaByAttr, setCanonical, setJsonLd, cleanupInjectedHead } from '../lib/head.js'
import { buildItemListJsonLd } from '../views/buildItemListJsonLd.js'
import { deriveShareUrl } from '../views/deriveShareUrl.js'
import { APP_CANONICAL_BASE } from '../config/urls.js'
import { toast } from '../lib/toast.js'
import { t, tN } from '../i18n/index.js'
import type { Bookmark, Category, SiblingGroup } from '../types.js'

type ForkPayload =
  | { kind: 'group'; group: SiblingGroup; bookmarks: Bookmark[] }
  | { kind: 'category'; data: PublicCategoryData }

/** 每次进入递增；异步 fetch 回包时据此丢弃过期响应（快速切换分享链接） */
let _enterSeq = 0

export const useShareStore = defineStore('share', () => {
  const ui = useUIStore()

  const loading = ref(false)
  const error = ref('')
  const forking = ref(false)
  const group = ref<SiblingGroup | null>(null)
  const category = ref<Category | null>(null)
  const groups = ref<SiblingGroup[]>([])
  const bookmarks = ref<Bookmark[]>([])

  /** 进入分享态前的视图状态，退出时还原（不让用户自己的视图被分享态带偏） */
  const uiSnapshot = ref<{ curCat: string; focusedGroupId: string | null; searchQuery: string } | null>(null)

  const isCategory = computed(() => ui.shareMode?.kind === 'category')
  /** 分享主体名（组名 / 分类名），供 header 只读标题渲染 */
  const subjectName = computed(() =>
    (isCategory.value ? category.value?.name : group.value?.name) || '',
  )
  /** 分享主体 id（组 id / 影子分类 id） */
  const subjectId = computed(() =>
    (isCategory.value ? category.value?.id : group.value?.id) || '',
  )

  function _resetData() {
    group.value = null
    category.value = null
    groups.value = []
    bookmarks.value = []
    error.value = ''
  }

  /** 把已拉取的数据装载进影子 Map（不碰 dataStore 数组） */
  function _fillShadow() {
    const shadow: ShadowData = { bookmarks: {}, groups: {}, categories: {} }
    for (const b of bookmarks.value) shadow.bookmarks[b.id] = b
    if (isCategory.value) {
      for (const g of groups.value) shadow.groups[g.id] = g
      if (category.value) shadow.categories[category.value.id] = category.value
    } else if (group.value) {
      shadow.groups[group.value.id] = group.value
    }
    shadowSet(shadow)
  }

  /** 剥掉 URL 里的 /s/<gid> 或 /s/c/<id> 段，回到站点根路径 */
  function _stripSharePath(): void {
    try {
      const base = location.pathname.replace(/\/s\/(c\/)?[^/]*$/, '/') || '/'
      history.replaceState(null, '', base + location.search)
    } catch {
      /* 无痕模式下 replaceState 可能抛错，忽略即可 */
    }
  }

  /**
   * 拆掉分享态：清影子数据 → 解只读锁 → 还原 head 与 URL → 还原视图快照。
   * fork 与「退出分享」共用：fork 之前必须走这里，否则写入被只读锁挡下。
   */
  function _teardown() {
    if (!ui.shareMode) return
    shadowClear()
    ui.shareMode = null
    const snap = uiSnapshot.value
    if (snap) {
      ui.searchQuery = snap.searchQuery
      ui.focusedGroupId = snap.focusedGroupId
      ui.curCat = snap.curCat
    }
    uiSnapshot.value = null
    cleanupInjectedHead()
    setCanonical(APP_CANONICAL_BASE)
    _stripSharePath()
    _resetData()
  }

  async function enter(route: string) {
    const seq = ++_enterSeq
    const catId = parseCategoryShareRoute(route)
    _teardown()
    _resetData()

    uiSnapshot.value = {
      curCat: ui.curCat,
      focusedGroupId: ui.focusedGroupId,
      searchQuery: ui.searchQuery,
    }
    // 先上锁：后续任何 mutation 都被拒，避免 fetch 期间的中间态写进本地库
    ui.shareMode = { kind: catId ? 'category' : 'group', id: catId || route }
    ui.searchQuery = ''
    loading.value = true
    error.value = ''
    try {
      if (catId) {
        const data = await fetchPublicCategory(catId)
        if (seq !== _enterSeq) return
        if (!data) {
          error.value = t('shareView.notFound')
          return
        }
        category.value = data.category
        groups.value = data.groups
        // 书签的 categoryId 归一到影子分类，卡片上取分类名时才不会查到访问者自己的分类
        bookmarks.value = data.bookmarks.map((b) => ({ ...b, categoryId: data.category.id }))
        _fillShadow()
        ui.curCat = data.category.id
        _applyCategoryHead(data)
      } else {
        const data = await fetchPublicGroup(route)
        if (seq !== _enterSeq) return
        if (!data) {
          error.value = t('shareView.notFound')
          return
        }
        group.value = data.group
        bookmarks.value = data.bookmarks
        _fillShadow()
        ui.focusedGroupId = data.group.id
        _applyGroupHead(data.group, data.bookmarks)
      }
    } catch (e) {
      if (seq !== _enterSeq) return
      error.value = t('shareView.loadFailed', { msg: (e as Error).message })
    } finally {
      if (seq === _enterSeq) loading.value = false
    }
  }

  function exit() {
    _teardown()
  }

  function retry() {
    const route = ui.shareMode?.id
    if (!route) return
    void enter(ui.shareMode?.kind === 'category' ? `cat:${route}` : route)
  }

  /** 当前分享内容快照，供 fork 使用（fork 前会先 _teardown 清掉影子数据） */
  function _payload(): ForkPayload | null {
    if (isCategory.value) {
      if (!category.value) return null
      return {
        kind: 'category',
        data: { category: category.value, groups: groups.value, bookmarks: bookmarks.value },
      }
    }
    if (!group.value) return null
    return { kind: 'group', group: group.value, bookmarks: bookmarks.value }
  }

  async function fork() {
    const auth = useAuth()
    if (!auth.isLoggedIn) {
      auth.authModalOpen = true
      toast(t('shareView.loginRequiredToast'), false)
      return
    }
    const payload = _payload()
    if (!payload || forking.value) return
    forking.value = true
    // 关键：fork 写的是访问者自己的库，必须先解锁并清空影子数据
    _teardown()
    try {
      if (payload.kind === 'category') await forkPublicCategory(payload.data)
      else await forkPublicGroup(payload.group, payload.bookmarks)
    } catch (e) {
      toast(t('shareView.copyFailed', { msg: (e as Error).message }), false)
    } finally {
      forking.value = false
    }
  }

  // ── 视图状态被外部改动即视为「离开分享内容」→ 自动退出分享态 ──
  // 覆盖 AppNav 切分类、搜索、快捷键、命令面板等所有路径，无需逐个埋点。
  // _teardown 先清 shareMode 再改 curCat，故不会递归触发。
  watch(
    () => ui.curCat,
    (v) => {
      if (ui.shareMode?.kind === 'category' && v !== category.value?.id) exit()
    },
  )
  watch(
    () => ui.focusedGroupId,
    (v) => {
      if (ui.shareMode?.kind === 'group' && v !== group.value?.id) exit()
    },
  )

  // 浏览器后退 / 前进离开 /s/<gid>（或 hash 兜底段）后，URL 不再是分享路由 →
  // 自动退出分享态（否则界面停留在他人内容但 URL 已是自己主页，状态与地址脱节）。
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', _onPopState)
  }
  function _onPopState() {
    try {
      if (ui.shareMode && !detectShareRoute()) exit()
    } catch {
      /* 路由探测异常不阻断 */
    }
  }

  return {
    loading,
    error,
    forking,
    group,
    category,
    groups,
    bookmarks,
    isCategory,
    subjectName,
    subjectId,
    enter,
    exit,
    retry,
    fork,
  }
})

// ── head 注入：与 SSR（functions/_lib/share-render.ts）的 OG 口径保持一致 ──

function _applyGroupHead(g: SiblingGroup, bms: Bookmark[]) {
  const shareUrl = deriveShareUrl(location.pathname, location.origin, g.id)
  const title = t('shareView.pageTitle', { name: g.name || t('shareView.defaultGroupName') })
  const notesPlain = g.notes ? g.notes.replace(/<[^>]+>/g, '').trim() : ''
  const desc = (notesPlain && notesPlain.slice(0, 120)) || tN('shareView.shareDesc', bms.length)
  setTitle(title)
  setMetaByAttr('name', 'description', desc)
  setMetaByAttr('property', 'og:title', title)
  setMetaByAttr('property', 'og:description', desc)
  setMetaByAttr('property', 'og:url', shareUrl)
  setMetaByAttr('property', 'og:type', 'article')
  setMetaByAttr('name', 'twitter:title', title)
  setMetaByAttr('name', 'twitter:description', desc)
  setCanonical(shareUrl)
  setJsonLd('shareItemList', buildItemListJsonLd(g, bms, shareUrl))
}

function _applyCategoryHead(data: PublicCategoryData) {
  const shareUrl = location.origin + location.pathname
  const title = t('shareView.categoryPageTitle', { name: data.category.name })
  const desc = tN('shareView.categoryShareDesc', data.bookmarks.length, {
    groups: data.groups.length,
  })
  setTitle(title)
  setMetaByAttr('name', 'description', desc)
  setMetaByAttr('property', 'og:title', title)
  setMetaByAttr('property', 'og:description', desc)
  setMetaByAttr('property', 'og:url', shareUrl)
  setMetaByAttr('property', 'og:type', 'article')
  setMetaByAttr('name', 'twitter:title', title)
  setMetaByAttr('name', 'twitter:description', desc)
  setCanonical(shareUrl)
  setJsonLd(
    'shareItemList',
    buildItemListJsonLd(data.category as unknown as SiblingGroup, data.bookmarks, shareUrl),
  )
}
