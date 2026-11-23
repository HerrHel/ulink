<template>
  <!-- 扩展侧边栏模式：当前标签页卡片。保存走主站新增书签弹窗（含 AI 预填），已收藏则进编辑 -->
  <section v-if="store.tab" class="ext-cur" data-testid="lv-ext-current-page" :aria-label="t('extPanel.currentPage')">
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
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useExtPanelStore } from '../../stores/extPanel.js'
import { openPanelSave } from '../../composables/useExtPanel.js'
import { domain, favicon } from '../../utils.js'
import { I } from '../../config/icons.js'
import { cleanWebTitle } from '../../lib/ai/smartIntake.js'
import { useI18n } from '../../i18n/index.js'

const { t } = useI18n()
const store = useExtPanelStore()

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
  display: flex;
  align-items: center;
  gap: 10px;
  /* 与下方书签卡片列表左右对齐（panel-content 已有内边距） */
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
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
</style>
