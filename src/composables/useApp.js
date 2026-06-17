/**
 * useApp — 应用初始化 composable（合并自 useAppSetup + useAppEvents + useAppLifecycle）
 *
 * 职责：
 * 1. 注册全局交互 composables（拖拽、键盘、滚动等）
 * 2. 配置长按操作菜单与事件处理函数
 * 3. 管理数据加载、UI 恢复、beforeunload 持久化
 */
import { onMounted, onUnmounted, watch } from 'vue'
import { useAppStore } from '../stores/app.js'

import { ctxMenuAPI, actionSheetAPI, attrDropdownAPI, mentionAPI } from './bridge.js'
import { toggleGroupFocus, removeBmFromGroup, removeGroupRef, createGroup, deleteGroup, exitGroupFocus, editGroup, searchInFocusedGroup } from './domain/useGroup.js'
import { visit, openBmModal, deleteBookmarkWithUndo as deleteBookmark } from './domain/useBookmark.js'
import { openDetail, updateCardTagsOverflow, initCardTags, destroyCardTags } from './ui/useUI.js'
import { hideAddDropdown } from './ui/useUI.js'
import { showBatchMovePopover, batchDelete } from './domain/useBatch.js'
import { shareGroup, importData, importFromURL } from './domain/useDataIO.js'
import { performUndo, performRedo } from './domain/useUndo.js'
import { captureNavState } from './interaction/useKeyboardOps.js'
import { useGlobalEvents } from './useGlobalEvents.js'
import { useScrollHeader } from './interaction/useScrollHeader.js'
import { useResize } from './interaction/useResize.js'
import { useKeyboard } from './interaction/useKeyboard.js'
import { useDragDrop } from './interaction/useDragDrop.js'
import { useLongPress } from './interaction/useLongPress.js'

export function useApp() {
  const store = useAppStore()
  const cleanups = []

  // ── 1. 注册全局交互 composables ──
  useScrollHeader(); useResize(); useKeyboard(); useDragDrop()

  // ── 2. 长按操作菜单 ──
  const longPress = useLongPress((card) => {
    const bmId = card.dataset.id; const gid = card.dataset.groupId
    if (bmId) return [
      { label: '打开链接', action: () => visit(null, bmId) },
      { label: '编辑', action: () => openBmModal(bmId) },
      { label: '移动到', action: () => actionSheetAPI?.showCategoryPicker(bmId) },
      { label: '删除', action: () => deleteBookmark(bmId, true), danger: true }
    ]
    if (gid) return [
      { label: '展开组', action: () => toggleGroupFocus(gid) },
      { label: '编辑组', action: () => editGroup(gid) },
      { label: '移动到', action: () => actionSheetAPI?.showGroupCategoryPicker(gid) },
      { label: '分享组', action: () => shareGroup(gid) },
      { label: '删除组', action: () => deleteGroup(gid), danger: true }
    ]
    return null
  })
  watch(() => longPress.fired, (v) => { store.lpFired = v })

  // ── 3. 全局事件委派 ──
  useGlobalEvents({
    longPressFired: longPress.fired,
    onOpenDetail: openDetail,
    onToggleGroupFocus: toggleGroupFocus,
    onRemoveGroupRef: removeGroupRef,
    onRemoveBmFromGroup: removeBmFromGroup,
    onVisit: visit,
    onShowCtxMenu: (...args) => ctxMenuAPI?.show?.(...args)
  })

  // ── 4. 事件处理函数（供 App.vue 模板使用）──
  const handlers = {
    onExitGroupFocus() { exitGroupFocus() },
    onFocusTitleChange(e) {
      if (!store.focusedGroupId) return
      const raw = (e.target.textContent || '').trim()
      const name = raw || '未命名'
      e.target.textContent = name
      e.target.classList.toggle('focus-title-unnamed', !raw || raw === '未命名')
      store.updateGroup(store.focusedGroupId, { name }); store.save()
    },
    onSearch() { if (store.focusedGroupId) searchInFocusedGroup() },
    onFocusAddBm(e) { if (!store.focusedGroupId) return; if (e && e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); store._addPopoverTrigger = { top: r.bottom, left: r.left, width: r.width } } else { store._addPopoverTrigger = null } store.addToGid = store.focusedGroupId; store.addBmPopoverOpen = true },
    onFocusEditGroup() { if (store.focusedGroupId) editGroup(store.focusedGroupId) },
    onFocusShareGroup() { if (store.focusedGroupId) shareGroup(store.focusedGroupId) },
    onFocusUndo() { if (store.focusedGroupId) performUndo(store.focusedGroupId) },
    onFocusRedo() { if (store.focusedGroupId) performRedo(store.focusedGroupId) },
    onToggleAttrFilter() { attrDropdownAPI?.toggle?.() },
    onAddBookmark() { hideAddDropdown(); openBmModal() },
    onAddGroup() { hideAddDropdown(); createGroup() },
    onBatchMove() { showBatchMovePopover() },
    onBatchDelete() { batchDelete() },
    onImportFile(e) { importData(e.target.files[0]); e.target.value = '' },
  }

  // ── 5. 生命周期：数据加载、UI 恢复、持久化 ──
  onMounted(async () => {
    const onImgErr = (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('img-error') }
    document.addEventListener('error', onImgErr, true)
    cleanups.push(() => document.removeEventListener('error', onImgErr, true))

    if (history.scrollRestoration) history.scrollRestoration = 'manual'

    store.loadFromStorage()
    store.tryLoadFromIDB().catch(e => console.warn('[LinkVault] IDB load failed:', e.message))
    store.restoreUIState()
    importFromURL()
    updateCardTagsOverflow()

    const onSave = () => store.save()
    const onSaveUI = () => store.saveUIState()
    const onClearSel = () => window.getSelection().removeAllRanges()
    window.addEventListener('beforeunload', onSave)
    window.addEventListener('beforeunload', onSaveUI)
    window.addEventListener('beforeunload', onClearSel)
    cleanups.push(() => {
      window.removeEventListener('beforeunload', onSave)
      window.removeEventListener('beforeunload', onSaveUI)
      window.removeEventListener('beforeunload', onClearSel)
    })

    initCardTags()
    mentionAPI?.init?.()
    if (history.replaceState) history.replaceState(captureNavState(), '')

  })

  onUnmounted(() => {
    cleanups.forEach(fn => fn())
    cleanups.length = 0
    destroyCardTags()
    mentionAPI?.destroy?.()
  })

  return { handlers }
}
