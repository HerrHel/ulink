<template>
  <div class="modal-mask" role="dialog" aria-modal="true" aria-label="快捷键速查" :class="{ open: ui.panels.shortcutHelp }" @click.self="close">
    <div class="modal modal-md sh-modal" @click.stop>
      <div class="modal-head">
        <span class="modal-title"><span class="sp-icon" v-html="keyboardIcon"></span>快捷键速查</span>
        <button class="modal-close" @click="close" aria-label="关闭">&times;</button>
      </div>
      <div class="modal-body sh-body">
        <p class="sh-tip">Mac 用户将 Ctrl 替换为 ⌘ Cmd</p>
        <div v-for="g in groups" :key="g.title" class="sh-group">
          <div class="sh-group-title">{{ g.title }}</div>
          <div v-for="item in g.items" :key="item.desc" class="sh-row">
            <span class="sh-label">{{ item.desc }}</span>
            <span class="sh-keys">
              <kbd v-for="(k, i) in item.keys" :key="i">{{ k }}</kbd>
            </span>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-secondary" @click="close">关闭</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useUIStore } from '../../stores/ui.js'
import { pushNavState } from '../../composables/interaction/useKeyboardOps.js'

const ui = useUIStore()

const keyboardIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>'

function close() { ui.panels.shortcutHelp = false }

interface ShortcutItem { desc: string; keys: string[] }
interface ShortcutGroup { title: string; items: ShortcutItem[] }

const groups: ShortcutGroup[] = [
  {
    title: '全局',
    items: [
      { desc: '命令面板 / 全局搜索书签与组', keys: ['Ctrl', 'K'] },
      { desc: '新建书签', keys: ['Ctrl', 'N'] },
      { desc: '快捷键速查（本面板）', keys: ['Ctrl', '/'] },
      { desc: '关闭弹窗 / 退出聚焦 / 退出批量模式', keys: ['Esc'] },
      { desc: '弹窗内字段间循环切换焦点', keys: 'Tab'.split(' ') },
    ],
  },
  {
    title: '组编辑器',
    items: [
      { desc: '加粗选中文字', keys: ['Ctrl', 'B'] },
      { desc: '设为 H1 大标题', keys: ['Ctrl', 'Shift', '1'] },
      { desc: '设为 H2 中标题', keys: ['Ctrl', 'Shift', '2'] },
      { desc: '设为 H3 小标题', keys: ['Ctrl', 'Shift', '3'] },
      { desc: '撤销组内编辑', keys: ['Ctrl', 'Z'] },
      { desc: '重做已撤销操作', keys: ['Ctrl', 'Y'] },
      { desc: '触发书签搜索并内联插入', keys: ['@'] },
      { desc: '触发组搜索并插入组引用', keys: ['#'] },
    ],
  },
  {
    title: '批量模式',
    items: [
      { desc: '全选所有可见卡片', keys: ['Ctrl', 'A'] },
      { desc: '删除所有选中项', keys: ['Delete'] },
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

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

onMounted(() => document.addEventListener('keydown', onGlobalKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onGlobalKeydown))
</script>
