<template>
  <div class="share-page">
    <header class="share-header">
      <div class="share-logo">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        <span class="share-logo-text">LinkVault</span>
      </div>
      <button class="btn btn-ghost btn-sm" @click="backToApp">
        <span aria-hidden="true" v-html="I.back" class="sp-icon"></span>返回
      </button>
    </header>

    <div v-if="loading" class="share-loading">
      <div class="share-spinner"></div>
      <span>加载中...</span>
    </div>

    <div v-else-if="error" class="share-error">
      <span aria-hidden="true" v-html="I.alert" class="share-error-icon"></span>
      <p>{{ error }}</p>
      <button class="btn btn-primary btn-sm" @click="backToApp">返回首页</button>
    </div>

    <template v-else-if="group">
      <div class="share-group-header">
        <h1 class="share-group-name">
          <!-- D2-006：icon 键 → SVG；http(s) → img；其它不渲染 -->
          <img v-if="groupIconImg" :src="groupIconImg" class="share-group-icon-img" referrerpolicy="no-referrer" alt="" />
          <span v-else-if="groupIconSvg" v-html="groupIconSvg" class="share-group-icon"></span>
          {{ group.name }}
        </h1>
        <!-- E2-003：TipTap HTML 经 sanitize 后 v-html，禁止原文插值 / 未清洗 v-html -->
        <div v-if="groupNotesHtml" class="share-group-notes" v-html="groupNotesHtml"></div>
        <div class="share-group-meta">
          <span class="share-meta-item">{{ bookmarks.length }} 个链接</span>
        </div>
        <div class="share-group-actions">
          <button class="btn btn-primary btn-sm" @click="onFork" :disabled="forking">
            {{ forking ? '复制中...' : isLoggedIn ? '复制到我的库' : '登录后复制' }}
          </button>
        </div>
      </div>

      <div class="share-bookmarks">
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
            <span v-else class="share-bm-icon-fallback">{{ (entry.b.title || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="share-bm-info">
            <span class="share-bm-title">{{ entry.b.title }}</span>
            <span class="share-bm-url">{{ entry.urlDomain }}</span>
            <p v-if="entry.b.notes" class="share-bm-notes">{{ entry.b.notes }}</p>
          </div>
          <span aria-hidden="true" v-html="I.external" class="share-bm-arrow"></span>
        </a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { fetchPublicGroup, forkPublicGroup } from '../composables/domain/useDataShare.js'
import { useAuth } from '../composables/domain/useAuth.js'
import { setTitle, setMetaByAttr, setCanonical, setJsonLd, cleanupInjectedHead } from '../lib/head.js'
import { fixUrl, safeIconUrl, sanitizeReadonlyHTML } from '../utils.js'
import { buildShareEntries } from './buildShareEntries.js'
import { I } from '../config/icons.js'
import { toast } from '../lib/toast.js'
import type { Bookmark, SiblingGroup } from '../types.js'

const props = defineProps<{ groupId: string }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(true)
const error = ref('')
const group = ref<SiblingGroup | null>(null)
const bookmarks = ref<Bookmark[]>([])
const forking = ref(false)

const auth = useAuth()
const isLoggedIn = auth.isLoggedIn

/** D2-006：已知图标键 → SVG；http(s) 自定义 → 安全 URL；其它空 */
const groupIconImg = computed(() => {
  const icon = group.value?.icon
  if (!icon) return ''
  const safe = safeIconUrl(icon)
  if (safe && /^https?:\/\//i.test(safe)) return safe
  return ''
})
const groupIconSvg = computed(() => {
  const icon = group.value?.icon
  if (!icon || groupIconImg.value) return ''
  // 仅匹配 icons.ts 已知键；未知字符串不渲染（勿把任意串当 SVG 键回落 star）
  return Object.prototype.hasOwnProperty.call(I, icon) ? I[icon] : ''
})

/** E2-003：分享页 notes 展示用白名单 HTML */
const groupNotesHtml = computed(() => {
  const n = group.value?.notes
  if (!n || !n.trim()) return ''
  return sanitizeReadonlyHTML(n)
})

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
  setCanonical('https://herrhel.github.io/')
  const base = location.pathname.replace(/\/s\/.*$/, '/') || '/'
  history.replaceState(null, '', base + location.search)
  emit('close')
}

async function onFork() {
  if (!auth.isLoggedIn) {
    auth.authModalOpen = true
    toast('请先登录后再复制', false)
    return
  }
  if (!group.value || forking.value) return
  forking.value = true
  try {
    await forkPublicGroup(group.value, bookmarks.value)
    backToApp()
  } catch (e) {
    toast('复制失败：' + (e as Error).message, false)
  } finally {
    forking.value = false
  }
}

// 审计 R10：onMounted async 先 await fetchPublicGroup 再 _applyShareHead 注入 head；
// 慢网下用户点"返回"卸载 + cleanupInjectedHead，但 in-flight fetch 返回后仍执行 _applyShareHead
// 污染主应用 <head> 的 SEO 元数据。用闭包 _unmounted 标志：卸载后丢弃过期 fetch 结果。
let _unmounted = false

onMounted(async () => {
  try {
    const data = await fetchPublicGroup(props.groupId)
    if (_unmounted) return
    if (!data) {
      error.value = '该分享链接不存在或已取消公开'
      return
    }
    group.value = data.group
    bookmarks.value = data.bookmarks
    // 客户端动态 SEO 注入（无 SSR：仅对 Googlebot 二次 JS 抓取与已加载用户生效；
    // 社交 OG 预览器不执行 JS，首次预览仍是 index.html 静态默认值 —— 彻底解决需后续 SSR 轮）
    _applyShareHead(data.group, data.bookmarks)
  } catch (e) {
    if (_unmounted) return
    error.value = '加载失败：' + (e as Error).message
  } finally {
    if (!_unmounted) loading.value = false
  }
})

onUnmounted(() => {
  _unmounted = true
  cleanupInjectedHead()
  setCanonical('https://herrhel.github.io/')
})

/**
 * 把公开组数据注入 <head>：title / description / og:* / twitter:* / canonical / ItemList JSON-LD。
 * 走 src/lib/head.ts 幂等函数，重复渲染不堆叠；子页卸载时 backToApp/onUnmounted 调 cleanup 恢复。
 */
function _applyShareHead(g: SiblingGroup, bms: Bookmark[]) {
  const base = location.pathname.replace(/\/[^/]*$/, '/') || '/'
  const shareUrl = location.origin + base + 's/' + g.id + '#share/' + g.id
  const title = `${g.name || '分享组'} - LinkVault 分享`
  const notesPlain = g.notes ? g.notes.replace(/<[^>]+>/g, '').trim() : ''
  const desc = (notesPlain && notesPlain.slice(0, 120)) || `${bms.length} 个链接 · 由 LinkVault 公开分享`
  setTitle(title)
  setMetaByAttr('name', 'description', desc)
  setMetaByAttr('property', 'og:title', title)
  setMetaByAttr('property', 'og:description', desc)
  setMetaByAttr('property', 'og:url', shareUrl)
  setMetaByAttr('property', 'og:type', 'article')
  setMetaByAttr('name', 'twitter:title', title)
  setMetaByAttr('name', 'twitter:description', desc)
  setCanonical(shareUrl)
  setJsonLd('shareItemList', {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: g.name || '分享组',
    description: desc,
    url: shareUrl,
    numberOfItems: bms.length,
    itemListElement: bms.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: b.title,
      url: fixUrl(b.url),
    })),
  })
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
.share-group-meta { display: flex; gap: 16px; margin-bottom: 16px; }
.share-meta-item { font-size: 13px; color: var(--text-secondary, #888); }
.share-group-actions { display: flex; gap: 8px; }

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
