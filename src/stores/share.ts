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
import { extractGroupTitle } from '../utils.js'
import type { Bookmark, Category, SiblingGroup } from '../types.js'

type ForkPayload =
  | { kind: 'group'; group: SiblingGroup; bookmarks: Bookmark[] }
  | { kind: 'category'; data: PublicCategoryData }

/**
 * 规范化分享书签数据：兼容远端/SSR 的下划线字段与本地驼峰字段
 */
export function normalizeSharedBookmark(raw: any, fallbackCategoryId = ''): Bookmark {
  if (!raw) return raw
  return {
    id: String(raw.id || ''),
    title: raw.title || '',
    url: raw.url || '',
    username: raw.username || '',
    password: raw.password || '',
    notes: raw.notes || '',
    icon: raw.icon || '',
    categoryId: raw.categoryId || raw.category_id || fallbackCategoryId,
    parentId: raw.parentId ?? raw.parent_id ?? null,
    order: typeof raw.order === 'number' ? raw.order : 0,
    useCount: raw.useCount ?? raw.use_count ?? 0,
    attributes: raw.attributes || {},
    isExpanded: Boolean(raw.isExpanded ?? raw.is_expanded),
    createdAt: raw.createdAt ?? raw.created_at_num ?? raw.created_at ?? 0,
    updatedAt: raw.updatedAt ?? raw.updated_at_num ?? raw.updated_at ?? 0,
    pinnedAt: raw.pinnedAt ?? raw.pinned_at ?? undefined,
    deletedAt: raw.deletedAt ?? (raw.deleted_at ? (typeof raw.deleted_at === 'number' ? raw.deleted_at : Date.parse(raw.deleted_at)) : undefined),
  }
}

/**
 * 规范化分享组数据：确保 bookmarkIds、isPublic、updatedAt 等关键字段规范化
 */
export function normalizeSharedGroup(raw: any): SiblingGroup {
  if (!raw) return raw
  return {
    id: String(raw.id || ''),
    name: raw.name || '',
    categoryId: raw.categoryId || raw.category_id || '',
    icon: raw.icon || '',
    order: typeof raw.order === 'number' ? raw.order : 0,
    isExpanded: Boolean(raw.isExpanded ?? raw.is_expanded),
    attributes: raw.attributes || {},
    bookmarkIds: Array.isArray(raw.bookmarkIds)
      ? raw.bookmarkIds
      : Array.isArray(raw.bookmark_ids)
        ? raw.bookmark_ids
        : [],
    notes: raw.notes || '',
    useCount: raw.useCount ?? raw.use_count ?? 0,
    updatedAt: raw.updatedAt ?? raw.updated_at_num ?? raw.updated_at ?? 0,
    isPublic: Boolean(raw.isPublic ?? raw.is_public),
    pinnedAt: raw.pinnedAt ?? raw.pinned_at ?? undefined,
    deletedAt: raw.deletedAt ?? (raw.deleted_at ? (typeof raw.deleted_at === 'number' ? raw.deleted_at : Date.parse(raw.deleted_at)) : undefined),
  }
}

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
    (isCategory.value ? category.value?.name : (extractGroupTitle(group.value?.name, group.value?.notes) || t('shareView.defaultGroupName'))) || '',
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

  /** 剥掉 URL 里的 /s/<gid> 或 /s/c/<id> 段，回到应用主体 /app（/ 现为宣传落地页） */
  function _stripSharePath(): void {
    try {
      const base = location.pathname.replace(/\/s\/(c\/)?[^/]*$/, '/app')
      history.replaceState(null, '', base + location.search)
    } catch {
      /* 无痕模式下 replaceState 可能抛错，忽略即可 */
    }
  }

  /**
   * 拆掉分享态：清影子数据 → 解只读锁 → 还原 head 与 URL → 还原视图快照。
   * fork 与「退出分享」共用：fork 之前必须走这里，否则写入被只读锁挡下。
   * stripUrl: 是否把 URL 剥离回 /app（真正离开分享时为 true；进入新分享初始化时为 false，避免破坏分享路由）
   */
  function _teardown(stripUrl = true) {
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
    if (stripUrl) _stripSharePath()
    _resetData()
  }

  async function enter(route: string) {
    const seq = ++_enterSeq
    const catId = parseCategoryShareRoute(route)
    _teardown(false)
    _resetData()

    uiSnapshot.value = {
      curCat: ui.curCat,
      focusedGroupId: ui.focusedGroupId,
      searchQuery: ui.searchQuery,
    }
    // 先上锁：后续任何 mutation 都被拒，避免 fetch 期间的中间态写进本地库
    ui.shareMode = { kind: catId ? 'category' : 'group', id: catId || route }
    ui.searchQuery = ''
    if (catId) {
      ui.focusedGroupId = null
    }

    // ── SSR 预注入数据秒级水合（零网络等待，杜绝客户端直连 Supabase 延时与转圈卡死）──
    const winData = typeof window !== 'undefined' ? (window as unknown as { __INITIAL_SHARE_DATA__?: any }).__INITIAL_SHARE_DATA__ : null
    if (winData) {
      if (catId && winData.type === 'category' && winData.id === catId && winData.data?.category) {
        category.value = winData.data.category
        groups.value = (winData.data.groups || []).map(normalizeSharedGroup)
        bookmarks.value = (winData.data.bookmarks || []).map((b: any) =>
          normalizeSharedBookmark(b, winData.data.category.id),
        )
        _fillShadow()
        ui.curCat = winData.data.category.id
        ui.focusedGroupId = null
        _applyCategoryHead(winData.data)
        loading.value = false
        error.value = ''
        return
      }
      if (!catId && winData.type === 'group' && winData.id === route && winData.data?.group) {
        group.value = normalizeSharedGroup(winData.data.group)
        bookmarks.value = (winData.data.bookmarks || []).map((b: any) =>
          normalizeSharedBookmark(b, group.value!.categoryId),
        )
        _fillShadow()
        ui.focusedGroupId = winData.data.group.id
        _applyGroupHead(group.value, bookmarks.value)
        loading.value = false
        error.value = ''
        return
      }
    }

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
        groups.value = (data.groups || []).map(normalizeSharedGroup)
        // 书签的 categoryId 归一到影子分类，卡片上取分类名时才不会查到访问者自己的分类
        bookmarks.value = (data.bookmarks || []).map((b) =>
          normalizeSharedBookmark(b, data.category.id),
        )
        _fillShadow()
        ui.curCat = data.category.id
        ui.focusedGroupId = null
        _applyCategoryHead(data)
      } else {
        const data = await fetchPublicGroup(route)
        if (seq !== _enterSeq) return
        if (!data) {
          error.value = t('shareView.notFound')
          return
        }
        group.value = normalizeSharedGroup(data.group)
        bookmarks.value = (data.bookmarks || []).map((b) =>
          normalizeSharedBookmark(b, group.value!.categoryId),
        )
        _fillShadow()
        ui.focusedGroupId = group.value.id
        _applyGroupHead(group.value, bookmarks.value)
      }
    } catch (e) {
      if (seq !== _enterSeq) return
      error.value = t('shareView.loadFailed', { msg: (e as Error).message })
    } finally {
      if (seq === _enterSeq) loading.value = false
    }
  }

  function exit() {
    _teardown(true)
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
    _teardown(true)
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
  // 加载期间或数据未就绪时严禁退出（防异步请求期间的误退）。
  watch(
    () => ui.curCat,
    (v) => {
      if (loading.value) return
      if (ui.shareMode?.kind === 'category' && category.value && v !== category.value.id) exit()
    },
  )
  watch(
    () => ui.focusedGroupId,
    (v) => {
      if (loading.value) return
      if (ui.shareMode?.kind === 'group' && group.value && v !== group.value.id) exit()
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
  const groupTitle = extractGroupTitle(g.name, g.notes) || t('shareView.defaultGroupName')
  const title = t('shareView.pageTitle', { name: groupTitle })
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
