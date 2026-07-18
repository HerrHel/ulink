<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="欢迎使用 LinkVault" :class="{ open: ui.modals.setupGuide }" @click.self="finish">
    <div class="modal modal-sm" @click.stop>
      <div class="modal-head">
        <span class="modal-title">👋 欢迎使用 LinkVault</span>
      </div>
      <div class="modal-body setup-body">
        <p class="setup-intro">选择你的起点：</p>
        <div class="setup-cards">
          <button class="setup-card" @click="onFreshStart" autofocus>
            <span class="setup-card-icon">✨</span>
            <span class="setup-card-title">全新开始</span>
            <span class="setup-card-desc">从一个示例组开始，探索功能后再整理自己的书签</span>
          </button>
          <button class="setup-card" @click="onImport">
            <span class="setup-card-icon">📥</span>
            <span class="setup-card-title">从其他工具导入</span>
            <span class="setup-card-desc">从浏览器书签、Raindrop 或 CSV 文件导入</span>
          </button>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" @click="onFreshStart">跳过，直接开始</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUIStore } from '../../stores/ui.js'
import { useDataStore } from '../../stores/data.js'
import { saveAppData } from '../../stores/app.js'

const ui = useUIStore()
const ds = useDataStore()
const SETUP_DONE_KEY = 'lv_setup_done'

function close() { ui.modals.setupGuide = false }

function finish() {
  localStorage.setItem(SETUP_DONE_KEY, '1')
  close()
}

function onFreshStart() {
  finish()
}

function onImport() {
  finish()
  // 触发导入文件选择器
  const el = document.getElementById('importFile') as HTMLInputElement | null
  if (el) { el.accept = '.json,.html,.htm,.csv'; el.click() }
}
</script>

<style scoped>
.setup-body{text-align:center;padding:24px}
.setup-intro{font-size:0.85rem;color:var(--text-secondary);margin:0 0 16px}
.setup-cards{display:flex;flex-direction:column;gap:10px}
.setup-card{
  display:flex;flex-direction:column;align-items:center;gap:8px;
  padding:20px 16px;border:2px solid var(--border,#e5e7eb);
  border-radius:12px;background:var(--surface,#fff);
  cursor:pointer;text-align:center;
  transition:border-color .15s,background .15s;
}
.setup-card:hover,.setup-card:focus{border-color:var(--accent);background:var(--accent-light,rgba(59,130,246,.04))}
.setup-card-icon{font-size:2rem;line-height:1}
.setup-card-title{font-size:0.95rem;font-weight:600;color:var(--text)}
.setup-card-desc{font-size:0.76rem;color:var(--text-muted);line-height:1.5}
</style>
