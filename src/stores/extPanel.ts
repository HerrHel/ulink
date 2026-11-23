/**
 * extPanel.ts — 浏览器扩展侧边栏模式的运行时状态
 *
 * 协议与判定见 src/lib/extPanel.ts，消息收发与保存编排见 composables/useExtPanel.ts。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { ExtTabInfo } from '../lib/extPanel.js'

export const useExtPanelStore = defineStore('extPanel', () => {
  /** 是否处于扩展侧栏模式（被扩展 iframe 嵌入的 /app?mode=panel） */
  const active = ref(false)
  /** 扩展推来的当前标签页；null = 内部页 / 尚未收到 */
  const tab = ref<ExtTabInfo | null>(null)
  /** 当前页已收藏时对应的书签 ID */
  const matchedId = ref<string | null>(null)
  return { active, tab, matchedId }
})
