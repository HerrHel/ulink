<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('modal.setupGuide.welcome')" :class="{ open: ui.modals.setupGuide }" @click.self="finish">
    <div class="modal modal-sm" @click.stop>
      <div class="modal-head">
        <span class="modal-title">{{ t('modal.setupGuide.welcome') }}</span>
      </div>
      <div class="modal-body setup-body">
        <!-- 品牌视觉 -->
        <div class="setup-brand">
          <div class="setup-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          </div>
          <p class="setup-tagline">{{ t('modal.setupGuide.tagline') }}</p>
        </div>

        <!-- 卡片选项 -->
        <div class="setup-cards">
          <button class="setup-card" @click="onFreshStart" autofocus>
            <span class="setup-card-icon setup-card-icon--accent" v-html="I.star"></span>
            <span class="setup-card-title">{{ t('modal.setupGuide.freshStart') }}</span>
            <span class="setup-card-desc">{{ t('modal.setupGuide.freshStartDesc') }}</span>
          </button>
          <button class="setup-card" @click="onImport">
            <span class="setup-card-icon setup-card-icon--green" v-html="I.import"></span>
            <span class="setup-card-title">{{ t('modal.setupGuide.importTitle') }}</span>
            <span class="setup-card-desc">{{ t('modal.setupGuide.importDesc') }}</span>
          </button>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" @click="onFreshStart">{{ t('modal.setupGuide.skip') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUIStore } from '../../stores/ui.js'
import { I } from '../../config/icons.js'
import { safeSetItem } from '../../lib/storageSafe.js'
import { t } from '../../i18n/index.js'

const ui = useUIStore()
const SETUP_DONE_KEY = 'lv_setup_done'

function close() { ui.modals.setupGuide = false }

function finish() {
  safeSetItem(SETUP_DONE_KEY, '1')
  close()
}

function onFreshStart() {
  finish()
}

function onImport() {
  finish()
  const el = document.getElementById('importFile') as HTMLInputElement | null
  if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() }
}
</script>

<style scoped>
.setup-body{text-align:center;padding:28px 24px 20px}

/* ── 品牌区 ── */
.setup-brand{margin-bottom:24px}
.setup-logo{
  display:inline-flex;align-items:center;justify-content:center;
  width:56px;height:56px;border-radius:16px;
  background:var(--accent-grad);
  color:#fff;margin-bottom:12px;
}
.setup-logo svg{width:28px;height:28px}
.setup-tagline{
  font-size:0.82rem;color:var(--text-muted);
  margin:0;line-height:1.5;
}

/* ── 选择卡片 ── */
.setup-cards{display:flex;flex-direction:column;gap:10px}

.setup-card{
  display:flex;flex-direction:column;align-items:flex-start;gap:6px;
  padding:16px 18px;
  border:1.5px solid var(--border);
  border-radius:var(--radius-lg);
  background:var(--surface);
  cursor:pointer;text-align:left;
  transition:all 0.2s ease;
}
.setup-card:hover{
  border-color:var(--border-hover);
  background:var(--surface-hover);
  box-shadow:var(--shadow-sm);
}
.setup-card:focus-visible{
  outline:2px solid var(--accent);
  outline-offset:2px;
}

.setup-card-icon{
  width:32px;height:32px;border-radius:10px;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;
}
.setup-card-icon svg{width:18px;height:18px}
.setup-card-icon--accent{
  background:var(--accent-light);color:var(--accent);
}
.setup-card-icon--green{
  background:var(--green-light);color:var(--green);
}

.setup-card-title{
  font-size:0.9rem;font-weight:600;color:var(--text);
  font-family:var(--font-display);
}
.setup-card-desc{
  font-size:0.76rem;color:var(--text-muted);
  line-height:1.5;
}
</style>
