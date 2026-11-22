<template>
  <!-- 从系统拖入文件时的全屏投放提示；pointer-events: none，不遮挡落点判断 -->
  <div
    v-if="overlayMode"
    class="file-drop-overlay"
    data-testid="lv-file-drop-overlay"
    :data-mode="overlayMode"
    aria-hidden="true"
  >
    <div class="file-drop-card">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <div class="file-drop-title">{{ overlayMode === 'ai' ? t('msg.dropAttachTitle') : t('msg.dropImportTitle') }}</div>
      <div class="file-drop-sub">{{ overlayMode === 'ai' ? t('msg.dropAttachHint') : t('msg.dropImportHint') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '../../i18n/index.js'
import { useFileDropImport } from '../../composables/interaction/useFileDropImport.js'

const { overlayMode } = useFileDropImport()
</script>

<style scoped>
.file-drop-overlay {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-popover) + 2);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  pointer-events: none;
  background: var(--accent-light);
  outline: 2px dashed var(--accent);
  outline-offset: -10px;
}
.file-drop-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: 360px;
  padding: 24px 28px;
  border-radius: var(--radius-lg);
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  color: var(--accent);
  text-align: center;
}
.file-drop-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.file-drop-sub {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}
</style>
