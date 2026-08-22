<template>
  <div class="modal-mask" role="dialog" aria-modal="true" :aria-label="t('settings.shortcutHelp')" :class="{ open: ui.panels.shortcutHelp }" @click.self="close">
    <div class="modal modal-md sh-modal" @click.stop>
      <div class="modal-head">
        <span class="modal-title"><span class="sp-icon" v-html="keyboardIcon"></span>{{ t('settings.shortcutHelp') }}</span>
        <button class="modal-close" @click="close" :aria-label="t('common.close')">&times;</button>
      </div>
      <div class="modal-body sh-body">
        <p class="sh-tip">{{ t('shortcut.macTip') }}</p>
        <div v-for="g in groups" :key="g.title" class="sh-group">
          <div class="sh-group-title">{{ t(g.title) }}</div>
          <div v-for="item in g.items" :key="item.desc" class="sh-row">
            <span class="sh-label">{{ t(item.desc) }}</span>
            <span class="sh-keys">
              <kbd v-for="(k, i) in item.keys" :key="i">{{ k }}</kbd>
            </span>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" @click="close">{{ t('common.close') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { t } from '../../i18n/index.js'
import { useUIStore } from '../../stores/ui.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'
import { isTyping } from './isTyping.js'

const ui = useUIStore()

const keyboardIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>'

function close() { ui.panels.shortcutHelp = false }

interface ShortcutItem { desc: string; keys: string[] }
interface ShortcutGroup { title: string; items: ShortcutItem[] }

const groups: ShortcutGroup[] = [
  {
    title: 'shortcut.groupGlobal',
    items: [
      { desc: 'shortcut.cmdPanel', keys: ['Ctrl', 'K'] },
      { desc: 'filter.newBookmark', keys: ['Ctrl', 'N'] },
      { desc: 'shortcut.panelShortcut', keys: ['Ctrl', '/'] },
      { desc: 'shortcut.esc', keys: ['Esc'] },
      { desc: 'shortcut.cycleFocus', keys: 'Tab'.split(' ') },
    ],
  },
  {
    title: 'shortcut.groupEditor',
    items: [
      { desc: 'shortcut.boldText', keys: ['Ctrl', 'B'] },
      { desc: 'shortcut.setH1', keys: ['Ctrl', 'Shift', '1'] },
      { desc: 'shortcut.setH2', keys: ['Ctrl', 'Shift', '2'] },
      { desc: 'shortcut.setH3', keys: ['Ctrl', 'Shift', '3'] },
      { desc: 'shortcut.undoGroup', keys: ['Ctrl', 'Z'] },
      { desc: 'shortcut.redoGroup', keys: ['Ctrl', 'Y'] },
      { desc: 'shortcut.insertBookmarkSearch', keys: ['@'] },
      { desc: 'shortcut.insertGroupSearch', keys: ['#'] },
    ],
  },
  {
    title: 'shortcut.groupBatch',
    items: [
      { desc: 'shortcut.selectAllVisible', keys: ['Ctrl', 'A'] },
      { desc: 'shortcut.deleteSelected', keys: ['Delete'] },
    ],
  },
  {
    title: 'shortcut.groupList',
    items: [
      { desc: 'shortcut.openBookmarkFocus', keys: ['Enter'] },
      { desc: 'shortcut.openDetail', keys: ['Space'] },
      { desc: 'shortcut.expandCollapse', keys: ['→', '←'] },
      { desc: 'shortcut.prevNext', keys: ['↑', '↓'] },
      { desc: 'shortcut.firstLast', keys: ['Home', 'End'] },
    ],
  },
]

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === '/') {
    e.preventDefault()
    // 仅在「即将打开」时 pushNavState 记未开态，后退能关；关闭时不再 push。
    if (!ui.panels.shortcutHelp) pushNavState()
    ui.panels.shortcutHelp = !ui.panels.shortcutHelp
    return
  }
  // ? 在非输入框时调出（Shift+/ 即 ?）
  if (e.key === '?' && !isTyping(e.target)) {
    e.preventDefault()
    pushNavState()
    ui.panels.shortcutHelp = true
  }
  if (e.key === 'Escape' && ui.panels.shortcutHelp) {
    ui.panels.shortcutHelp = false
  }
}

onMounted(() => document.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onGlobalKeydown))
</script>
