/**
 * actionSheet.ts — Action Sheet 状态 Store
 *
 * 替代 bridge.ts actionSheetAPI 服务定位器模式。
 * 管理：通用操作列表/分类选择器/手势拖拽。
 */
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useAppStore } from './app.js'
import { toast } from '../lib/toast.js'

interface ActionItem {
  label: string
  action: string | (() => void)
  danger?: boolean
}

export const useActionSheetStore = defineStore('actionSheet', () => {
  const visible = ref(false)
  const dragY = ref(0)
  const isDragging = ref(false)
  const mode = ref<'actions' | 'category'>('actions')
  const items = ref<ActionItem[]>([])
  const catTargetId = ref<string | null>(null)
  const catTargetType = ref<'group' | 'bm' | null>(null)
  const newCatName = ref('')

  let startY = 0
  const _actionRegistry: Record<string, () => void> = {}

  const categories = computed(() => useAppStore().selectableCategories)

  function registerAction(id: string, fn: () => void) { _actionRegistry[id] = fn }

  function showActions(actionItems: ActionItem[]) {
    mode.value = 'actions'
    items.value = actionItems
    visible.value = true
  }

  function showCategoryPicker(targetId: string, targetType: 'group' | 'bm') {
    mode.value = 'category'
    catTargetId.value = targetId
    catTargetType.value = targetType
    newCatName.value = ''
    visible.value = true
  }

  function hide() {
    visible.value = false
    isDragging.value = false
    dragY.value = 0
  }

  function onAction(item: ActionItem) {
    hide()
    if (typeof item.action === 'function') item.action()
    else if (typeof item.action === 'string' && _actionRegistry[item.action]) _actionRegistry[item.action]()
  }

  function onPickCategory(catId: string) {
    const store = useAppStore()
    hide()
    if (catTargetType.value === 'group') {
      store.updateGroup(catTargetId.value!, { categoryId: catId })
    } else {
      store.updateBookmark(catTargetId.value!, { categoryId: catId })
    }
    store.save()
    const cat = store.categoryMap[catId]
    toast('已移动到 ' + (cat ? cat.name : ''))
  }

  // ── Touch drag-to-dismiss ──

  function onTouchStart(e: TouchEvent) {
    if (!visible.value) return
    startY = e.touches[0].clientY
    isDragging.value = false
  }

  function onTouchMove(e: TouchEvent) {
    if (!startY) return
    const dy = e.touches[0].clientY - startY
    if (dy > 0) { isDragging.value = true; dragY.value = dy }
  }

  function onTouchEnd() {
    if (!isDragging.value) { startY = 0; return }
    if (dragY.value > 80) hide()
    else { isDragging.value = false; dragY.value = 0 }
    startY = 0
  }

  // 便捷方法（供 useApp 等桥接消费者使用）
  const showBmCategoryPicker = (bmId: string) => showCategoryPicker(bmId, 'bm')
  const showGroupCategoryPicker = (gid: string) => showCategoryPicker(gid, 'group')

  return {
    visible, mode, items, categories, dragY, isDragging,
    catTargetId, catTargetType, newCatName,
    registerAction,
    showActions, showCategoryPicker, hide,
    showBmCategoryPicker, showGroupCategoryPicker,
    onAction, onPickCategory,
    onTouchStart, onTouchMove, onTouchEnd,
  }
})
