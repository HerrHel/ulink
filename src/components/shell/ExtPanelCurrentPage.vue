<template>
  <!-- 扩展侧边栏模式：当前标签页卡片。保存走主站新增书签弹窗（含 AI 预填），已收藏则进编辑 -->
  <section v-if="store.tab" class="ext-cur" data-testid="lv-ext-current-page" :aria-label="t('extPanel.currentPage')">
    <div class="ext-cur-row">
      <div class="ext-cur-icon">
        <img v-if="iconSrc" :src="iconSrc" alt="" referrerpolicy="no-referrer">
        <span class="ext-cur-initial" aria-hidden="true">{{ initial }}</span>
      </div>
      <div class="ext-cur-text">
        <div class="ext-cur-title" :title="title">{{ title }}</div>
        <div class="ext-cur-domain">{{ host }}</div>
      </div>
      <button
        v-if="store.matchedId"
        type="button"
        class="btn btn-ghost btn-sm ext-cur-btn"
        data-testid="lv-ext-edit"
        :title="t('extPanel.saved')"
        @click="openPanelSave"
      >
        <span class="ext-cur-check" v-html="I.check"></span>{{ t('extPanel.edit') }}
      </button>
      <button
        v-else
        type="button"
        class="btn btn-primary btn-sm ext-cur-btn"
        data-testid="lv-ext-save"
        @click="openPanelSave"
      >
        {{ t('extPanel.save') }}
      </button>
    </div>
    <!-- 本站回想：这个网站你还存过哪些（不含当前页本身），点开即访问 -->
    <div v-if="siteHits.length" class="ext-site" data-testid="lv-ext-site-recall">
      <div class="ext-site-head">{{ siteHeading }}</div>
      <ul class="ext-site-list">
        <li v-for="bm in visibleHits" :key="bm.id">
          <button type="button" class="ext-site-item" data-testid="lv-ext-site-item" :title="bm.url" @click="openBookmark(bm)">
            <span class="ext-site-title">{{ bm.title || domain(bm.url) }}</span>
            <span v-if="snippet(bm)" class="ext-site-notes">{{ snippet(bm) }}</span>
          </button>
        </li>
      </ul>
      <button
        v-if="siteHits.length > SITE_PREVIEW"
        type="button"
        class="ext-site-toggle"
        data-testid="lv-ext-site-toggle"
        @click="expanded = !expanded"
      >
        {{ expanded ? t('extPanel.siteCollapse') : t('extPanel.siteShowAll', { n: siteHits.length - SITE_PREVIEW }) }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useExtPanelStore } from '../../stores/extPanel.js'
import { useDataStore } from '../../stores/data.js'
import { openPanelSave } from '../../composables/useExtPanel.js'
import { openBookmark } from '../../composables/domain/useBookmark.js'
import { domain, favicon } from '../../utils.js'
import { I } from '../../config/icons.js'
import { cleanWebTitle } from '../../lib/ai/smartIntake.js'
import { findSiteBookmarks, notesSnippet, siteHost } from '../../lib/siteRecall.js'
import { useI18n } from '../../i18n/index.js'
import type { Bookmark } from '../../types.js'

const { t, tN } = useI18n()
const store = useExtPanelStore()
const ds = useDataStore()

/** 默认展示条数，其余折叠 */
const SITE_PREVIEW = 3
const expanded = ref(false)
// 换网站时收起
watch(() => siteHost(store.tab?.url), () => { expanded.value = false })

const siteHits = computed(() => findSiteBookmarks(ds.bookmarks, store.tab?.url, store.matchedId))
const visibleHits = computed(() => (expanded.value ? siteHits.value : siteHits.value.slice(0, SITE_PREVIEW)))
const siteHeading = computed(() => tN(
  store.matchedId ? 'extPanel.siteSavedMore' : 'extPanel.siteSaved',
  siteHits.value.length,
  { n: siteHits.value.length, host: siteHost(store.tab?.url) },
))
const snippet = (bm: Bookmark) => notesSnippet(bm.notes)

const host = computed(() => (store.tab ? domain(store.tab.url).replace(/^www\./, '') : ''))
// 与保存弹窗预填同一套清洗（去掉「- 知乎」这类站点品牌尾巴）
const title = computed(() => {
  const raw = store.tab?.title || ''
  return (raw && (cleanWebTitle(raw, store.tab?.url) || raw)) || host.value || t('extPanel.untitled')
})
const iconSrc = computed(() => (store.tab ? favicon(store.tab.url, store.tab.icon) : ''))
const initial = computed(() => Array.from(title.value.trim())[0]?.toUpperCase() || '?')
</script>

<style scoped>
.ext-cur {
  /* 与下方书签卡片列表左右对齐（panel-content 已有内边距） */
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.ext-cur-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ext-cur-icon {
  position: relative;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
  display: grid;
  place-items: center;
  overflow: hidden;
}
.ext-cur-icon img {
  position: absolute;
  inset: 4px;
  width: 24px;
  height: 24px;
  object-fit: contain;
  background: var(--surface-alt);
}
/* 图标加载失败（全局 onImgErr 打 .img-error）时露出首字母 */
.ext-cur-icon img.img-error { display: none; }
.ext-cur-initial {
  font-weight: 600;
  color: var(--text-secondary);
}
.ext-cur-text {
  flex: 1;
  min-width: 0;
}
.ext-cur-title {
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ext-cur-domain {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ext-cur-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ext-cur-check :deep(svg) {
  width: 14px;
  height: 14px;
}
.ext-site {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.ext-site-head {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.ext-site-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.ext-site-item {
  display: block;
  width: 100%;
  padding: 6px 8px;
  margin: 0 -8px;
  box-sizing: content-box;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ext-site-item:hover,
.ext-site-item:focus-visible {
  background: var(--surface-alt);
}
.ext-site-title,
.ext-site-notes {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ext-site-title {
  font-size: 13px;
  color: var(--text);
}
.ext-site-notes {
  font-size: 12px;
  color: var(--text-secondary);
}
.ext-site-toggle {
  margin-top: 4px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--primary);
  cursor: pointer;
}
</style>
