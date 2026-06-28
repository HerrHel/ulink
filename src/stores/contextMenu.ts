/**
 * contextMenu.ts — 右键菜单状态 Store
 *
 * 替代 bridge.ts ctxMenuAPI 服务定位器模式。
 * 菜单组件（ContextMenu.vue）读取 store 渲染，消除模块级可变状态。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useContextMenuStore = defineStore('contextMenu', () => {
  const open = ref(false)
  const type = ref('')
  const id = ref('')
  const x = ref(0)
  const y = ref(0)

  function show(e: MouseEvent, menuType: string, menuId: string) {
    x.value = e.clientX
    y.value = e.clientY
    type.value = menuType
    id.value = menuId
    open.value = true
  }

  function hide() {
    open.value = false
    type.value = ''
    id.value = ''
  }

  return { open, type, id, x, y, show, hide }
})
