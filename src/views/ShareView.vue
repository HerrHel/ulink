<template>
  <div class="share-page" :class="{ 'is-category': isCategory }">
    <header class="share-header">
      <div class="share-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        <span class="share-logo-text">{{ t('app.brand') }}</span>
      </div>
      <button class="btn btn-ghost btn-sm" @click="backToApp">
        <span aria-hidden="true" v-html="I.back" class="sp-icon"></span>{{ t('common.back') }}
      </button>
    </header>

    <div v-if="loading" class="share-loading">
      <div class="share-spinner"></div>
      <span>{{ t('common.loading') }}</span>
    </div>

    <div v-else-if="error" class="share-error">
      <span aria-hidden="true" v-html="I.alert" class="share-error-icon"></span>
      <p>{{ error }}</p>
      <div class="share-error-actions">
        <button class="btn btn-primary btn-sm" @click="onRetry">{{ t('common.retry') }}</button>
        <button class="btn btn-ghost btn-sm" @click="backToApp">{{ t('nav.backToMain') }}</button>
      </div>
    </div>

    <template v-else-if="subject">
      <!-- 分类分享：Hero（分类色 accent + 图标 + 计数 + 操作），对齐应用内分类页观感 -->
      <div v-if="isCategory" class="share-cat-hero" :style="catAccentStyle">
        <span class="share-cat-accent" aria-hidden="true"></span>
        <span class="share-cat-icon">
          <img v-if="subjectIconImg" :src="subjectIconImg" class="share-cat-icon-img" referrerpolicy="no-referrer" alt="" />
          <span v-else-if="subjectIconSvg" v-html="subjectIconSvg" class="share-cat-icon-svg"></span>
          <span v-else class="share-cat-icon-fb">{{ catInitial }}</span>
        </span>
        <div class="share-cat-text">
          <h1 class="share-cat-name">{{ subject.name }}</h1>
          <div class="share-cat-meta">
            <span class="share-meta-item">{{ catBookmarkText }}</span>
            <span v-if="groups.length" class="share-meta-item">{{ catGroupText }}</span>
          </div>
        </div>
        <div class="share-cat-actions">
          <button class="btn btn-primary btn-sm" @click="onFork" :disabled="forking">
            {{ forking ? t('shareView.forking') : isLoggedIn ? t('shareView.forkToMyLibrary') : t('shareView.loginThenCopy') }}
          </button>
        </div>
      </div>

      <!-- 组分享：标题 + 笔记 + 计数 + 操作 -->
      <div v-else class="share-group-header">
        <h1 class="share-group-name">
          <!-- D2-006：icon 键 → SVG；http(s) → img；其它不渲染 -->
          <img v-if="subjectIconImg" :src="subjectIconImg" class="share-group-icon-img" referrerpolicy="no-referrer" alt="" />
          <span v-else-if="subjectIconSvg" v-html="subjectIconSvg" class="share-group-icon"></span>
          {{ subject.name }}
        </h1>
        <!-- E2-003：TipTap HTML 经 sanitize 后 v-html，禁止原文插值 / 未清洗 v-html -->
        <div v-if="subjectNotesHtml" class="share-group-notes" v-html="subjectNotesHtml"></div>
        <div class="share-group-meta">
          <span class="share-meta-item">{{ metaText }}</span>
        </div>
        <div class="share-group-actions">
          <button class="btn btn-primary btn-sm" @click="onFork" :disabled="forking">
            {{ forking ? t('shareView.forking') : isLoggedIn ? t('shareView.forkToMyLibrary') : t('shareView.loginThenCopy') }}
          </button>
        </div>
      </div>

      <!-- 分类分享：卡片网格（组卡在前 + 散落书签卡）。
           卡片 DOM 复用主站 BookmarkCard/GroupCard 的类名（.card / .group-card / .card-logo /
           .card-titlewrap / .card-name / .card-domain / .card-notes 等），样式直接由全局
           cards.css 提供 → 与主站像素级一致，App 改卡片样式时分享页自动跟随、零维护。 -->
      <div v-if="isCategory" class="share-cat-grid">
        <!-- ── 组卡（对齐主站 GroupCard 宫格态）── -->
        <article v-for="entry in categoryCards.groupCards" :key="entry.group.id"
                 class="card group-card share-gcard" :class="{ 'is-open': isGroupOpen(entry.group.id) }">
          <span class="group-card-accent" aria-hidden="true"></span>
          <div class="group-card-head share-gcard-head" role="button" tabindex="0"
               :aria-expanded="isGroupOpen(entry.group.id)"
               :title="t('shareView.catExpand')"
               @click="toggleGroup(entry.group.id)"
               @keydown.enter.prevent="toggleGroup(entry.group.id)"
               @keydown.space.prevent="toggleGroup(entry.group.id)">
            <!-- 图标位：首字母常显，img 加载成功后由 :has() 遮住（加载失败 → 露出首字母） -->
            <div class="card-logo group-card-icon">
              <span class="card-logo-fallback">{{ groupInitialOf(entry.group) }}</span>
              <img v-if="groupIconImgOf(entry.group)" :src="groupIconImgOf(entry.group)"
                   class="share-gcard-icon-img" referrerpolicy="no-referrer" alt="" @error="markIconError" />
            </div>
            <div class="card-titlewrap">
              <div class="card-titlewrap-text">
                <div class="card-name">{{ displayText(entry.group.name) }}</div>
              </div>
            </div>
            <span class="share-gcard-count">{{ tN('shareView.catBookmarks', entry.items.length) }}</span>
            <span aria-hidden="true" v-html="I.chevronDown" class="share-gcard-chev"></span>
          </div>
          <!-- 组笔记（sanitize 后，类名与主站组卡折叠态一致）；无笔记时给灰字回退 -->
          <div class="card-body grp-scroll-body">
            <div class="card-scroll-wrap">
              <div v-if="groupNotesHtmlOf(entry.group)" class="group-notes-preview"
                   v-html="groupNotesHtmlOf(entry.group)"></div>
              <div v-else class="share-gcard-nonotes">{{ t('shareView.catNoNotes') }}</div>
              <div v-if="isGroupOpen(entry.group.id)" class="share-gcard-items">
                <a v-for="item in entry.entries" :key="item.entry.b.id"
                   :href="item.entry.safeUrl || '#'"
                   :target="item.entry.safeUrl ? '_blank' : '_self'"
                   :rel="item.entry.safeUrl ? 'noopener' : undefined"
                   :class="['share-gcard-item', { 'is-disabled': !item.entry.safeUrl, 'is-child': item.isChild }]"
                   @click="!item.entry.safeUrl ? $event.preventDefault() : null">
                  <span class="share-gcard-item-ic">
                    <span class="share-gcard-item-fb">{{ (displayText(item.entry.b.title) || item.entry.urlDomain || '?')[0].toUpperCase() }}</span>
                    <img v-if="item.entry.icon" :src="item.entry.icon" class="share-gcard-item-icon" referrerpolicy="no-referrer"
                         loading="lazy" @error="markIconError" />
                  </span>
                  <span class="share-gcard-item-title">{{ displayText(item.entry.b.title) || item.entry.urlDomain }}</span>
                  <span class="share-gcard-item-url">{{ item.entry.urlDomain }}</span>
                </a>
                <div v-if="!entry.entries.length" class="share-gcard-empty">{{ t('shareView.catGroupEmpty') }}</div>
              </div>
            </div>
          </div>
        </article>

        <!-- ── 散落书签卡（对齐主站 BookmarkCard 宫格态）：父卡 + 子书签
             （<a> 不可嵌套，整卡链接在 card-main，子书签区独立列出）── -->
        <article v-for="card in categoryCards.loose" :key="card.entry.b.id"
                 class="card share-bmcard" :class="{ 'has-children': card.children.length }">
          <a class="share-bmcard-main"
             :href="card.entry.safeUrl || '#'"
             :target="card.entry.safeUrl ? '_blank' : '_self'"
             :rel="card.entry.safeUrl ? 'noopener' : undefined"
             :class="{ 'is-disabled': !card.entry.safeUrl }"
             @click="!card.entry.safeUrl ? $event.preventDefault() : null">
            <div class="card-topline">
              <div class="card-toprow">
                <div class="card-logo">
                  <span class="card-logo-fallback">{{ (displayText(card.entry.b.title) || card.entry.urlDomain || '?')[0].toUpperCase() }}</span>
                  <img v-if="card.entry.icon" :src="card.entry.icon" referrerpolicy="no-referrer" loading="lazy" @error="markIconError" />
                </div>
                <div class="card-titlewrap">
                  <div class="card-titlewrap-text">
                    <div class="card-name">{{ displayText(card.entry.b.title) || card.entry.urlDomain }}</div>
                    <div class="card-domain">{{ card.entry.urlDomain }}</div>
                  </div>
                  <span aria-hidden="true" v-html="I.external" class="card-open-hint"></span>
                </div>
                <!-- 孤儿子书签：父在组内或不在本分类，标出来说明层级来源 -->
                <span v-if="card.isChild" class="share-bmcard-badge">{{ t('shareView.subBookmark') }}</span>
              </div>
            </div>
            <div class="card-body">
              <p v-if="displayText(card.entry.b.notes)" class="card-notes share-bmcard-notes">{{ displayText(card.entry.b.notes) }}</p>
            </div>
          </a>
          <div v-if="card.children.length" class="share-bmcard-children">
            <a v-for="child in card.children" :key="child.entry.b.id"
               class="share-bmcard-child"
               :style="{ paddingLeft: (10 + (child.depth - 1) * 14) + 'px' }"
               :href="child.entry.safeUrl || '#'"
               :target="child.entry.safeUrl ? '_blank' : '_self'"
               :rel="child.entry.safeUrl ? 'noopener' : undefined"
               :class="{ 'is-disabled': !child.entry.safeUrl }"
               @click="!child.entry.safeUrl ? $event.preventDefault() : null">
              <span class="share-bmcard-child-ic">
                <span class="share-gcard-item-fb">{{ (displayText(child.entry.b.title) || child.entry.urlDomain || '?')[0].toUpperCase() }}</span>
                <img v-if="child.entry.icon" :src="child.entry.icon" class="share-bmcard-child-icon"
                     referrerpolicy="no-referrer" loading="lazy" @error="markIconError" />
              </span>
              <span class="share-bmcard-child-text">
                <span class="share-bmcard-child-title">{{ displayText(child.entry.b.title) || child.entry.urlDomain }}</span>
                <span class="share-bmcard-child-url">{{ child.entry.urlDomain }}</span>
                <p v-if="displayText(child.entry.b.notes)" class="share-bmcard-child-notes">{{ displayText(child.entry.b.notes) }}</p>
              </span>
            </a>
          </div>
        </article>

        <div v-if="!categoryCards.groupCards.length && !categoryCards.loose.length" class="share-empty">
          {{ t('shareView.categoryEmpty') }}
        </div>
      </div>

      <!-- 组分享：书签列表 -->
      <div v-else class="share-bookmarks">
        <!-- S1：fixUrl 对 javascript:/data: 等危险 scheme 返回空串，此时降级为 '#'
             并 @click.prevent 阻止跳到页内锚点；b.url 来自跨用户公开数据，不可信。 -->
        <a v-for="entry in bookmarkEntries" :key="entry.b.id"
           :href="entry.safeUrl || '#'"
           :target="entry.safeUrl ? '_blank' : '_self'"
           :rel="entry.safeUrl ? 'noopener' : undefined"
           :class="['share-bookmark-card', { 'share-bookmark-card--disabled': !entry.safeUrl }]"
           @click="!entry.safeUrl ? $event.preventDefault() : null">
          <div class="share-bm-icon">
            <!-- M5：跨用户 b.icon 不可信（追踪像素/任意 URL）；统一由书签 url 派生受控 favicon，并禁 Referer -->
            <img v-if="entry.icon" :src="entry.icon" referrerpolicy="no-referrer" loading="lazy"
                 @error="($event.target as HTMLImageElement).style.display='none'" />
            <span v-else class="share-bm-icon-fallback">{{ (displayText(entry.b.title) || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="share-bm-info">
            <span class="share-bm-title">{{ displayText(entry.b.title) || entry.urlDomain }}</span>
            <span class="share-bm-url">{{ entry.urlDomain }}</span>
            <p v-if="displayText(entry.b.notes)" class="share-bm-notes">{{ displayText(entry.b.notes) }}</p>
          </div>
          <span aria-hidden="true" v-html="I.external" class="share-bm-arrow"></span>
        </a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { fetchPublicGroup, forkPublicGroup, fetchPublicCategory, forkPublicCategory, parseCategoryShareRoute, type PublicCategoryData } from '../composables/domain/useDataShare.js'
import { useAuth } from '../composables/domain/useAuth.js'
import { setTitle, setMetaByAttr, setCanonical, setJsonLd, cleanupInjectedHead } from '../lib/head.js'
import { safeIconUrl, sanitizeReadonlyHTML } from '../utils.js'
import { isThreePartCipher } from '../crypto.js'
import { buildShareEntries } from './buildShareEntries.js'
import { splitCategoryItems } from './splitCategoryItems.js'
import { buildItemListJsonLd } from './buildItemListJsonLd.js'
import { resolveGroupIconSvg } from './resolveGroupIconSvg.js'
import { deriveShareUrl } from './deriveShareUrl.js'
import { getCategoryIcon, I } from '../config/icons.js'
import { toast } from '../lib/toast.js'
import { t, tN } from '../i18n/index.js'
import { APP_CANONICAL_BASE } from '../config/urls.js'
import type { Bookmark, Category, SiblingGroup } from '../types.js'

const props = defineProps<{ groupId: string }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(true)
const error = ref('')
const group = ref<SiblingGroup | null>(null)
const category = ref<Category | null>(null)
const groups = ref<SiblingGroup[]>([])
const bookmarks = ref<Bookmark[]>([])
const forking = ref(false)

// 分类分享路由编码（useDataShare.detectShareRoute 返回 `cat:<share_id>`）：
// 非空即分类分享模式，否则组分享模式。
const categoryShareId = computed(() => parseCategoryShareRoute(props.groupId))
const isCategory = computed(() => !!categoryShareId.value)

// 组件实例级卸载标志。必须在 setup 内声明（非模块级），否则 defineAsyncComponent +
// v-if 反复挂/卸会共享同一模块变量：A 卸载置 true 后永不重置，B 重挂时仍是 true 直接
// 杀死 fetch → 永久"加载中..."。实例级每挂一次新值初 false，卸载只失效本实例。
const _unmounted = ref(false)

const auth = useAuth()
const isLoggedIn = auth.isLoggedIn

/** 分享主体（组分享 = 组；分类分享 = 分类），两者都带 name/icon 供标题渲染 */
const subject = computed<SiblingGroup | Category | null>(() => group.value || category.value)

/** 分类分享元信息：N 个书签 · M 个组（组分享页沿用；分类页 Hero 用 catBookmarkText/catGroupText） */
const metaText = computed(() => {
  if (isCategory.value) {
    return tN('shareView.categoryMeta', bookmarks.value.length, { groups: groups.value.length })
  }
  return tN('count.links', bookmarks.value.length)
})

// ── 分类分享：卡片网格视图模型（纯函数 splitCategoryItems 切分，口径与 SSR 分类页一致）──

/** 展开的组（默认全部收起，与 App 分类宫格一致；点卡片切换） */
const openGroups = ref(new Set<string>())
function isGroupOpen(id: string): boolean {
  return openGroups.value.has(id)
}
function toggleGroup(id: string): void {
  const next = new Set(openGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openGroups.value = next
}

/** 单条书签 → 预渲染条目（逐条走 buildShareEntries，保持同一安全口径） */
function entryOf(b: Bookmark) {
  return buildShareEntries([b])[0]
}

/**
 * M15：E2E 历史密文（salt.iv.data 三段，云端遗留旧版加密数据）→ 占位提示，绝不渲染密文
 * （对齐 App 未解锁时 UI 显空不显乱码的语义；密文串外泄是信息泄露面）。
 */
function displayText(v: string | undefined | null): string {
  const s = (v || '').trim()
  return isThreePartCipher(s) ? t('shareView.encryptedPlaceholder') : s
}

/**
 * 组卡（组 + 组内书签 entries，子书签标 isChild 供渲染层缩进）与散落书签卡
 * （顶层书签 + 其子孙 children，depth 表达缩进层级；父在组内/不在本分类的孤儿子书签
 * 独立成卡并标 isChild —— 子书签一律保留显示，不丢数据）。
 */
const categoryCards = computed(() => {
  const { groupCards, loose } = splitCategoryItems(groups.value, bookmarks.value)
  return {
    groupCards: groupCards.map((e) => ({
      group: e.group,
      items: e.items,
      entries: e.items.map((b) => ({ entry: entryOf(b), isChild: !!b.parentId })),
    })),
    loose: loose.map((card) => ({
      entry: entryOf(card.bookmark),
      isChild: !!card.bookmark.parentId,
      children: card.children.map((c) => ({ entry: entryOf(c.bookmark), depth: c.depth })),
    })),
  }
})

/** 展示口径：网格里实际渲染的书签数（组内 + 散落顶层 + 散落子书签，全部计入） */
const catBookmarkCount = computed(
  () =>
    categoryCards.value.groupCards.reduce((s, e) => s + e.entries.length, 0) +
    categoryCards.value.loose.reduce((s, c) => s + 1 + c.children.length, 0),
)
const catBookmarkText = computed(() => tN('shareView.catBookmarks', catBookmarkCount.value))
const catGroupText = computed(() =>
  tN('shareView.catGroups', groups.value.length, { m: groups.value.length }),
)

/** 分类色（跨用户数据：白名单校验后才进 style，杜绝 CSS 注入） */
const catColor = computed(() => {
  const c = (category.value?.color || "").trim()
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : ""
})
const catAccentStyle = computed(() => (catColor.value ? { "--cat": catColor.value } : {}))
const catInitial = computed(() => (category.value?.name || "?").trim().charAt(0).toUpperCase())

/** 组图标：仅 http(s) 自定义图标生效，其余回退首字母（跨用户图标键不可信） */
function groupIconImgOf(g: SiblingGroup): string {
  const safe = safeIconUrl(g.icon || "")
  return safe && /^https?:\/\//i.test(safe) ? safe : ""
}
function groupInitialOf(g: SiblingGroup): string {
  return (g.name || "?").trim().charAt(0).toUpperCase()
}

/**
 * favicon 加载失败：给 img 打 .img-error（与 cards.css 的 .card-logo:has(img:not(.img-error))
 * 类名一致）→ CSS 隐藏 img、:has() 露出首字母占位。不用 style.display='none'，
 * 否则 :has(img:not(.img-error)) 仍命中 → 首字母被永久遮住。
 */
function markIconError(e: Event): void {
  const el = e.target as HTMLElement | null
  el?.classList?.add("img-error")
}

/** D2-006：已知图标键 → SVG；http(s) 自定义 → 安全 URL；其它空 */
const subjectIconImg = computed(() => {
  const icon = group.value?.icon
  if (!icon) return ''
  const safe = safeIconUrl(icon)
  if (safe && /^https?:\/\//i.test(safe)) return safe
  return ''
})
const subjectIconSvg = computed(() => {
  if (isCategory.value) {
    const c = category.value
    if (!c?.icon) return ''
    return getCategoryIcon(c.icon)
  }
  const icon = group.value?.icon
  if (!icon || subjectIconImg.value) return ''
  // 仅匹配 icons.ts 已知键；未知字符串不渲染（勿把任意串当 SVG 键回落 star）
  // 白名单严格判定（hasOwnProperty）抽到 resolveGroupIconSvg 纯函数，见单测护栏
  return resolveGroupIconSvg(icon, I)
})

/** E2-003：分享主体 notes 展示用白名单 HTML（仅组模式有 notes） */
const subjectNotesHtml = computed(() => {
  const n = group.value?.notes
  if (!n || !n.trim()) return ''
  return sanitizeReadonlyHTML(n)
})

/** 分类分享：单个组的 notes（TipTap HTML sanitize 后展示） */
function groupNotesHtmlOf(g: SiblingGroup): string {
  if (!g.notes || !g.notes.trim()) return ''
  return sanitizeReadonlyHTML(g.notes)
}

/**
 * 分享页书签列表预渲染条目：预计算核抽至 src/views/buildShareEntries.ts（纯函数，
 * 可直接单测锁定 fixUrl/domain/favicon 去重前后的等价性与 M5 安全兜底分支）。
 * 把 fixUrl/domain/favicon 对每条预计算一次，避免模板内（原 5 次 fixUrl + 2 次
 * favicon/icon + 1 次 domain）重复对同 url 调用。函数均为纯函数，预计算与原模板
 * 内联调用语义等价。M5：图标只由 http(s) 书签 URL 派生，跨用户 b.icon 不可信。
 */
const bookmarkEntries = computed(() => buildShareEntries(bookmarks.value))

function backToApp() {
  // 恢复全站默认 head，再回到站点根（保留部署子路径前缀），清除 share 标识
  cleanupInjectedHead()
  setCanonical(APP_CANONICAL_BASE)
  const base = location.pathname.replace(/\/s\/(c\/)?[^/]*$/, '/') || '/'
  history.replaceState(null, '', base + location.search)
  emit('close')
}

async function onFork() {
  if (!auth.isLoggedIn) {
    auth.authModalOpen = true
    toast(t('shareView.loginRequiredToast'), false)
    return
  }
  if ((!group.value && !category.value) || forking.value) return
  forking.value = true
  try {
    if (isCategory.value && category.value) {
      const data: PublicCategoryData = {
        category: category.value,
        groups: groups.value,
        bookmarks: bookmarks.value,
      }
      await forkPublicCategory(data)
    } else if (group.value) {
      await forkPublicGroup(group.value, bookmarks.value)
    }
    backToApp()
  } catch (e) {
    toast(t('shareView.copyFailed', { msg: (e as Error).message }), false)
  } finally {
    forking.value = false
  }
}

async function loadShare() {
  loading.value = true
  error.value = ''
  try {
    if (isCategory.value) {
      const data = await fetchPublicCategory(categoryShareId.value!)
      if (_unmounted.value) return
      if (!data) {
        error.value = t('shareView.notFound')
        return
      }
      category.value = data.category
      groups.value = data.groups
      bookmarks.value = data.bookmarks
      _applyCategoryShareHead(data)
    } else {
      const data = await fetchPublicGroup(props.groupId)
      if (_unmounted.value) return
      if (!data) {
        error.value = t('shareView.notFound')
        return
      }
      group.value = data.group
      bookmarks.value = data.bookmarks
      // 客户端动态 SEO 注入（无 SSR：仅对 Googlebot 二次 JS 抓取与已加载用户生效；
      // 社交 OG 预览器不执行 JS，首次预览仍是 index.html 静态默认值 —— 彻底解决需后续 SSR 轮）
      _applyShareHead(data.group, data.bookmarks)
    }
  } catch (e) {
    if (_unmounted.value) return
    error.value = t('shareView.loadFailed', { msg: (e as Error).message })
  } finally {
    if (!_unmounted.value) loading.value = false
  }
}

onMounted(loadShare)

function onRetry() {
  loadShare()
}

onUnmounted(() => {
  _unmounted.value = true
  cleanupInjectedHead()
  setCanonical(APP_CANONICAL_BASE)
})

/**
 * 把公开组数据注入 <head>：title / description / og:* / twitter:* / canonical / ItemList JSON-LD。
 * 走 src/lib/head.ts 幂等函数，重复渲染不堆叠；子页卸载时 backToApp/onUnmounted 调 cleanup 恢复。
 */
function _applyShareHead(g: SiblingGroup, bms: Bookmark[]) {
  // shareUrl 推导剥部署前缀时必须把 `/s/<gid>` 整段剥掉（旧正则只剥末段残留 `/s/` 再拼
  // 又一遍 `s/` 产生 `/s/s/<gid>` 双段错误 URL）。该推导剥成纯函数 deriveShareUrl 直测，
  // 见 src/views/deriveShareUrl.ts 与单测护栏。
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

/** 分类分享的 head 注入：canonical 直接用当前 /s/c/<share_id> 路径（无组 id 可拼）。 */
function _applyCategoryShareHead(data: PublicCategoryData) {
  const shareUrl = location.origin + location.pathname
  const title = t('shareView.categoryPageTitle', { name: data.category.name })
  const desc = tN('shareView.categoryShareDesc', data.bookmarks.length, { groups: data.groups.length })
  setTitle(title)
  setMetaByAttr('name', 'description', desc)
  setMetaByAttr('property', 'og:title', title)
  setMetaByAttr('property', 'og:description', desc)
  setMetaByAttr('property', 'og:url', shareUrl)
  setMetaByAttr('property', 'og:type', 'article')
  setMetaByAttr('name', 'twitter:title', title)
  setMetaByAttr('name', 'twitter:description', desc)
  setCanonical(shareUrl)
  setJsonLd('shareItemList', buildItemListJsonLd(data.category as unknown as SiblingGroup, data.bookmarks, shareUrl))
}
</script>

<style scoped>
.share-page {
  min-height: 100vh;
  background: var(--bg, #F5EFEA);
  color: var(--text, #1a1a1a);
  max-width: 720px;
  margin: 0 auto;
  padding: 0 16px 60px;
}
.share-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 0; border-bottom: 1px solid var(--border, #e5e7eb);
}
.share-logo { display: flex; align-items: center; gap: 8px; }
.share-logo svg { width: 24px; height: 24px; color: var(--accent, #3B82F6); }
.share-logo-text { font-weight: 700; font-size: 16px; letter-spacing: -0.3px; }

.share-loading, .share-error {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 80px 20px; text-align: center; gap: 16px; color: var(--text-secondary, #666);
}
.share-spinner {
  width: 32px; height: 32px; border: 3px solid var(--border, #e5e7eb);
  border-top-color: var(--accent, #3B82F6); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.share-error-icon { color: var(--danger, #EF4444); }
.share-error-icon :deep(svg) { width: 32px; height: 32px; }
.share-error-actions { display: flex; gap: 8px; }

.share-group-header { padding: 32px 0 24px; }
.share-group-name {
  font-size: 24px; font-weight: 700; margin: 0 0 8px;
  display: flex; align-items: center; gap: 10px;
  letter-spacing: -0.5px;
}
.share-group-icon :deep(svg) { width: 24px; height: 24px; color: var(--accent, #3B82F6); }
.share-group-icon-img {
  width: 24px; height: 24px; object-fit: contain; border-radius: 4px; flex-shrink: 0;
}
.share-group-notes { color: var(--text-secondary, #666); font-size: 14px; margin: 0 0 12px; line-height: 1.6; }
.share-group-notes :deep(p) { margin: 0 0 0.5em; }
.share-group-notes :deep(p:last-child) { margin-bottom: 0; }
.share-group-notes :deep(img) {
  max-width:100%; width:auto; height:auto;
  border-radius:8px; display:inline-block; vertical-align:bottom;
}
/* BUMP-SPEC：分享页 notes 容器是 .share-group-notes，editor 的 .group-body/.group-tiptap
   BUMP 规则匹配不到；且 .share-group-notes :deep(img) (0,2,1) 会覆盖 group.css 的
   .group-inline-card img (0,1,1)，使 inline 卡片里的 favicon 按 SVG 内禀尺寸撑开 → 图标大小不一。
   这里提级到 (0,3,1) 专属压制，只约束组内 inline 卡片图标，不动上传图片的弹性尺寸。 */
.share-group-notes :deep(.group-inline-card img),
.share-group-notes :deep(.group-inline-card svg) {
  width:16px; height:16px; max-width:16px; max-height:16px;
  border-radius:2px; display:block; flex-shrink:0;
}
.share-group-meta { display: flex; gap: 16px; margin-bottom: 16px; }
.share-meta-item { font-size: 13px; color: var(--text-secondary, #888); }
.share-group-actions { display: flex; gap: 8px; }

/* 分类分享：网格页放开宽度（组分享页仍是 720px 单列阅读流） */
.share-page.is-category { max-width: 1180px; }

/* 分类分享：Hero（分类色 accent + 图标 + 计数 + 操作） */
.share-cat-hero {
  position: relative; display: flex; align-items: center; gap: 16px;
  padding: 18px 20px; margin: 24px 0 18px;
  background: var(--surface, #FDFBF9);
  border: 1px solid var(--border, #E5DDD3); border-radius: 18px;
  box-shadow: 0 10px 30px rgba(0,0,0,.07), 0 2px 6px rgba(0,0,0,.03);
  overflow: hidden;
}
.share-cat-accent {
  position: absolute; left: 0; top: 8px; bottom: 8px; width: 4px;
  border-radius: 0 3px 3px 0; background: var(--cat, var(--accent, #3B82F6)); opacity: .85;
}
.share-cat-icon {
  width: 56px; height: 56px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  background: var(--surface-secondary, #EDE4DA); border: 1px solid var(--border, #E5DDD3);
  border-radius: 14px; overflow: hidden; color: var(--cat, var(--accent, #3B82F6));
}
.share-cat-icon-img { width: 32px; height: 32px; object-fit: contain; border-radius: 4px; }
.share-cat-icon-svg :deep(svg) { width: 30px; height: 30px; }
.share-cat-icon-fb { font-size: 24px; font-weight: 800; text-transform: uppercase; }
.share-cat-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.share-cat-name { font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.5px; overflow-wrap: anywhere; }
.share-cat-meta { display: flex; flex-wrap: wrap; gap: 14px; }
.share-cat-actions { flex-shrink: 0; }

/* 分类分享：卡片网格（与 App .card-grid 同参：auto-fill 280px / gap 12px） */
.share-cat-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px; align-items: start;
}
/* 卡片本体视觉（背景/圆角/阴影/高度/入场动画/hover 上浮）全部由全局 cards.css 的
   .card 与 group.css 的 .group-card 提供 → 与主站像素级一致、改主站样式自动跟随。
   本段只保留分享页特有的「只读交互增量」。 */

/* ── 组卡增量 ── */
.share-cat-grid .group-card-head { flex-shrink: 0; z-index: 2; background: var(--surface, #FDFBF9); } /* 对齐 .card-grid:not(.list-view) 规则 */
.share-gcard-head { cursor: pointer; user-select: none; }
.share-gcard-count {
  flex-shrink: 0; align-self: center; font-size: 11.5px; font-weight: 600; white-space: nowrap;
  color: var(--text-muted, #6A6660); background: var(--bg-alt, #F7F2EC);
  border: 1px solid var(--border-light, #E5DDD3); padding: 2px 9px; border-radius: 999px;
}
.share-gcard-chev {
  flex-shrink: 0; align-self: center; display: flex; align-items: center;
  color: var(--text-muted, #B8B1A8); transition: transform .2s ease, color .2s ease;
}
.share-gcard-chev :deep(svg) { width: 14px; height: 14px; display: block; }
.share-gcard-nonotes { font-size: 12.5px; color: var(--text-muted, #B0A9A0); padding: 2px 0; }
/* 展开：跨整行 + 高度自适应 + 笔记可点（折叠态主站语义 pointer-events:none） */
.share-gcard.is-open { grid-column: 1 / -1; height: auto; }
.share-gcard.is-open .share-gcard-chev { transform: rotate(180deg); color: var(--accent, #3B82F6); }
.share-gcard.is-open .group-notes-preview { pointer-events: auto; }
.share-gcard-items {
  display: flex; flex-direction: column; gap: 6px; margin-top: 10px; padding-top: 10px;
  border-top: 1px dashed var(--border, #E5DDD3);
}
.share-gcard-item {
  display: flex; align-items: center; gap: 10px; padding: 6px 10px;
  border: 1px solid var(--border, #E5DDD3); border-radius: 10px;
  text-decoration: none; color: inherit;
  transition: border-color .15s ease, background .15s ease;
}
.share-gcard-item:hover { border-color: var(--accent, #3B82F6); background: var(--bg-alt, #F7F2EC); }
.share-gcard-item.is-disabled { opacity: .55; cursor: default; }
/* 组内子书签：缩进 + 左侧连接线，体现层级（属性照常完整展示） */
.share-gcard-item.is-child { margin-left: 16px; position: relative; }
.share-gcard-item.is-child::before {
  content: ""; position: absolute; left: -10px; top: 50%; width: 8px; height: 1px;
  background: var(--border, #D5CBBE);
}
.share-gcard-item-ic {
  position: relative; width: 22px; height: 22px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.share-gcard-item-icon { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; border-radius: 3px; }
.share-gcard-item-fb {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: var(--accent, #3B82F6); text-transform: uppercase;
}
.share-gcard-item-title {
  flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-gcard-item-url {
  flex-shrink: 0; max-width: 45%; font-size: 11.5px; color: var(--text-secondary, #888);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-gcard-empty {
  font-size: 12.5px; color: var(--text-secondary, #8A847C); text-align: center; padding: 16px 0;
  background: var(--bg-alt, #F7F2EC); border: 1px dashed var(--border, #D5CBBE); border-radius: 10px;
}
/* favicon 失败：img-error（与 cards.css 类名一致）隐藏，:has() 露出首字母 */
.share-gcard-item-ic img.img-error { display: none; }
.share-gcard-item-ic:has(img:not(.img-error)) .share-gcard-item-fb { display: none; }
.share-bmcard-child-ic img.img-error { display: none; }
.share-bmcard-child-ic:has(img:not(.img-error)) .share-gcard-item-fb { display: none; }

/* ── 散落书签卡增量：本体 .card 主站视觉，整卡链接 + 子书签区（<a> 不可嵌套）── */
.share-bmcard.has-children { height: auto; }
.share-bmcard-main {
  position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0;
  text-decoration: none; color: inherit;
}
.share-bmcard-main.is-disabled { opacity: .55; cursor: default; }
.share-bmcard-badge {
  flex-shrink: 0; align-self: flex-start; font-size: 10.5px; font-weight: 600; line-height: 1;
  padding: 3px 6px; border-radius: 5px; white-space: nowrap;
  color: var(--text-muted, #6A6660); background: var(--bg-alt, #F7F2EC);
  border: 1px solid var(--border-light, #E5DDD3);
}
/* 子书签区：与主区之间加虚线分隔，逐条缩进（缩进量由 depth 内联控制） */
.share-bmcard-children {
  display: flex; flex-direction: column; gap: 4px;
  padding: 8px 10px 12px; border-top: 1px dashed var(--border, #E5DDD3);
}
.share-bmcard-child {
  display: flex; align-items: flex-start; gap: 8px; padding: 5px 8px;
  border-radius: 8px; text-decoration: none; color: inherit;
  transition: background .15s ease;
}
.share-bmcard-child:hover { background: var(--bg-alt, #F7F2EC); }
.share-bmcard-child.is-disabled { opacity: .55; cursor: default; }
.share-bmcard-child-ic {
  position: relative; width: 20px; height: 20px; flex-shrink: 0; margin-top: 1px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-alt, #EDE4DA); border: 1px solid var(--border-light, #E5DDD3);
  border-radius: 6px; overflow: hidden;
}
.share-bmcard-child-icon { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.share-bmcard-child-ic .share-gcard-item-fb { font-size: 10px; }
.share-bmcard-child-text { flex: 1; min-width: 0; }
.share-bmcard-child-title {
  display: block; font-size: 13px; font-weight: 600; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-bmcard-child-url {
  display: block; font-size: 11px; color: var(--text-secondary, #888);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-bmcard-child-notes {
  margin-top: 3px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; font-size: 11.5px; color: var(--text-secondary, #666); line-height: 1.45;
}
.share-empty {
  grid-column: 1 / -1; text-align: center; color: var(--text-secondary, #666); font-size: 13px;
  padding: 32px 0; background: var(--bg-alt, #f7f2ec);
  border: 1px dashed var(--border, #e5e7eb); border-radius: 14px;
}

@media (max-width: 560px) {
  .share-cat-hero { flex-wrap: wrap; padding: 16px; gap: 12px; }
  .share-cat-name { font-size: 19px; }
  .share-cat-actions { width: 100%; }
  .share-cat-actions .btn { width: 100%; }
  .share-cat-grid { grid-template-columns: 1fr; gap: 10px; }
}

.share-bookmarks { display: flex; flex-direction: column; gap: 8px; }
.share-bookmark-card {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border-radius: 10px;
  background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb);
  text-decoration: none; color: inherit;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.share-bookmark-card:hover {
  border-color: var(--accent, #3B82F6);
  box-shadow: 0 2px 8px rgba(59,130,246,.1);
}
.share-bm-icon {
  width: 36px; height: 36px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--surface-secondary, #f3f4f6); overflow: hidden;
}
.share-bm-icon img { width: 20px; height: 20px; object-fit: contain; }
.share-bm-icon-fallback {
  font-size: 14px; font-weight: 600; color: var(--accent, #3B82F6);
}
.share-bm-info { flex: 1; min-width: 0; }
.share-bm-title {
  display: block; font-weight: 500; font-size: 14px; line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-bm-url {
  display: block; font-size: 12px; color: var(--text-secondary, #888);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-bm-notes {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; font-size: 12px; color: var(--text-secondary, #666);
  margin: 4px 0 0; line-height: 1.4;
}
.share-bm-arrow { color: var(--text-secondary, #888); flex-shrink: 0; opacity: 0.4; }
.share-bm-arrow :deep(svg) { width: 16px; height: 16px; }
</style>
