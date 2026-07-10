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
          <span v-if="group.icon" v-html="getIcon(group.icon)" class="share-group-icon"></span>
          {{ group.name }}
        </h1>
        <p v-if="group.notes" class="share-group-notes">{{ group.notes }}</p>
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
        <a v-for="b in bookmarks" :key="b.id"
           :href="fixUrl(b.url) || '#'"
           :target="fixUrl(b.url) ? '_blank' : '_self'"
           :rel="fixUrl(b.url) ? 'noopener' : undefined"
           :class="['share-bookmark-card', { 'share-bookmark-card--disabled': !fixUrl(b.url) }]"
           @click="!fixUrl(b.url) ? $event.preventDefault() : null">
          <div class="share-bm-icon">
            <img v-if="b.icon" :src="b.icon" @error="($event.target as HTMLImageElement).style.display='none'" />
            <span v-else class="share-bm-icon-fallback">{{ (b.title || '?')[0].toUpperCase() }}</span>
          </div>
          <div class="share-bm-info">
            <span class="share-bm-title">{{ b.title }}</span>
            <span class="share-bm-url">{{ domain(b.url) }}</span>
            <p v-if="b.notes" class="share-bm-notes">{{ b.notes }}</p>
          </div>
          <span aria-hidden="true" v-html="I.external" class="share-bm-arrow"></span>
        </a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useCloudSync } from '../composables/domain/useCloudSync.js'
import { useAuth } from '../composables/domain/useAuth.js'
import { forkPublicGroup } from '../composables/domain/useDataShare.js'
import { setTitle, setMetaByAttr, setCanonical, setJsonLd, cleanupInjectedHead } from '../lib/head.js'
import { I } from '../config/icons.js'
import { fixUrl, domain } from '../utils.js'
import { getCategoryIcon } from '../config/icons.js'
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

function getIcon(icon: string) { return getCategoryIcon(icon) }

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

onMounted(async () => {
  try {
    const sync = useCloudSync()
    const data = await sync.fetchPublicGroup(props.groupId)
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
    error.value = '加载失败：' + (e as Error).message
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
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
.share-group-notes { color: var(--text-secondary, #666); font-size: 14px; margin: 0 0 12px; line-height: 1.6; }
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
